import { sql } from 'kysely';
import { withTenantTx, type Db, type Tx } from '../db/client.js';
import type { BusinessId } from '../core/types/ids.js';
import type { Locale } from '../core/owner/i18n/locale.js';
import { orderStatusName, messages, type MessageKey } from '../core/owner/i18n/messages.js';
import { t, assistantName } from '../api/web/say.js';
import * as show from '../api/web/values.js';
import { dayKey, addDays } from '../core/owner/i18n/format.js';
import { zoneOf } from '../db/zone.js';
import { needsOwnerFor, IS_BLOCKED, DELETION_WAITING } from '../db/buyersList.js';
import { SPEND_STATUSES, customerValues } from '../db/customerValue.js';
import { notOwnerTesting, handledCount } from '../db/handled.js';
import { readAttention, type AttentionItem } from '../db/inboxAttention.js';
import { loadCustomerCard } from '../db/customerCard.js';
import { loadCalendar, type CalendarEntry, type CalendarCategory } from '../db/calendar.js';
import { isDone } from '../api/web/calendar.js';
import { loadAnalytics, type Range } from '../api/web/analytics.js';
import { loadKnowledgeOps } from '../api/web/knowledge-insights.js';
import { assistantHold, assistantStopped } from '../db/assistantStop.js';
import { loadKillSwitches } from '../db/opsFlags.js';
import { rampState } from '../db/ramp.js';
import { ratePairOf } from '../db/currency.js';
import { aloneNow } from '../core/conversation/aloneNow.js';
import { autonomyReleased } from '../core/conversation/disclosure.js';
import { levelOf } from '../core/conversation/autonomyLevel.js';
import { PROBLEM_SIGNAL_KINDS } from '../core/scoring/signals.js';
import { moneyFromRow, type Money } from '../core/types/money.js';

/**
 * THE ADVISOR'S READS — the ONLY place an advisor fact comes from (the owner, 2026-10-06: "every factual
 * answer comes from a read-only query in src/advisor/reads.ts; the model only phrases it; missing data
 * returns its fixed sentence and NEVER a figure").
 *
 *   · Each read runs in its own tenant transaction (`withTenantTx`, row security) on the advisor's pool,
 *     which is read-only at the server (`createReadOnlyDb`), and opens it `read only` itself as well.
 *   · Each reuses the product's own definitions — needs you (`needsOwnerFor`), revenue (`SPEND_STATUSES`),
 *     a price given (`PRICE_GIVEN`, through `readAttention`), handled (`handledCount`), quiet (`readAttention`) — never its own.
 *   · Nothing that is not business: the owner's own test conversations are left out of every fact
 *     (`notOwnerTesting`, and `testing` for the lists other readers draw); a practice copy is another
 *     business row and never reaches these reads.
 *   · A read returns a SHEET: the facts as lines in the owner's language (the model's only input, and the
 *     answer itself if the model's sentence fails the check), or `empty` — then the answer is the
 *     sheet's fixed sentence, and no model is asked.
 *
 * Imports are of read functions only (tests/parity/advisor-build.test.ts holds the list).
 */

export type Params = {
  readonly period: Range | null;
  readonly customer: string | null;
  readonly product: string | null;
  readonly reference: string | null;
};

export type ReadCtx = {
  /** The advisor's read-only pool. */
  readonly db: Db;
  readonly businessId: BusinessId;
  /** Who asks — the Inbox's own "needs you" is theirs. */
  readonly viewerId: string;
  readonly locale: Locale;
  readonly now: Date;
  readonly params: Params;
};

export type Door = { readonly href: string; readonly label: MessageKey };

export type Sheet = {
  /** The facts, as lines in the owner's language. */
  readonly lines: readonly string[];
  /** Nothing to say: the answer is `none` (with `noneParams`), fixed, and the model is not asked. */
  readonly empty: boolean;
  readonly none?: MessageKey;
  readonly noneParams?: Readonly<Record<string, string>>;
  /** The customers' and products' names these lines carry — the only names an answer may use. */
  readonly names: readonly string[];
  /**
   * The customers these lines name, by id (0130, docs/ADVISOR-MEMORY.md §2): a kept turn is linked to each
   * (`advisor_turn_subjects`), so a customer's erasure finds every turn that names them. Every customer a
   * line names is here; tests/integration/advisor-subjects.test.ts holds it for every entry that names any.
   */
  readonly subjects: readonly string[];
  /** Figures every answer must carry, or it is not shown (B8: the median, the replies measured, the unanswered). */
  readonly must?: readonly string[];
  /** The page that shows the same thing. */
  readonly door?: Door;
};

/** Each read in its own tenant transaction, read-only twice over (the pool's default, and here). */
async function ro<T>(ctx: ReadCtx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenantTx(ctx.db, ctx.businessId, async (tx) => {
    await sql`set transaction read only`.execute(tx);
    return fn(tx);
  });
}

const L = (ctx: ReadCtx, key: string, p: Record<string, string | number> = {}): string => t(ctx.locale, key as MessageKey, p);
const nameOf = (ctx: ReadCtx, n: string | null): string => n ?? t(ctx.locale, 'common.buyer');
const when = (ctx: ReadCtx, d: Date): string => show.date(ctx.locale, d);
const count = (ctx: ReadCtx, n: number): string => show.count(ctx.locale, n);
const money = (ctx: ReadCtx, m: Money): string => show.money(ctx.locale, m);
/** The customers a sheet names, by id: each once, and none for a row that has no customer. */
const subjectsOf = (ids: readonly (string | null | undefined)[]): string[] => [...new Set(ids.filter((x): x is string => !!x))];
/** A sheet; the customers its lines name come in `more.subjects` (a row with no customer adds none). */
type More = Partial<Omit<Sheet, 'subjects'>> & { readonly subjects?: readonly (string | null | undefined)[] };
const sheet = (lines: readonly string[], names: readonly string[], door?: Door, more: More = {}): Sheet =>
  ({ lines, empty: false, names: names.filter((x) => x.trim().length >= 2), ...(door ? { door } : {}), ...more, subjects: subjectsOf(more.subjects ?? []) });
/** Nothing to say; a fixed sentence that names a customer (in `noneParams`) has them as its subjects, as a line would. */
const nothing = (none: MessageKey, noneParams?: Record<string, string>, door?: Door, subjects: readonly (string | null)[] = []): Sheet =>
  ({ lines: [], empty: true, none, ...(noneParams ? { noneParams } : {}), names: [], subjects: subjectsOf(subjects), ...(door ? { door } : {}) });
/** At most `n` lines of a list, then how many more there are. */
const cap = (ctx: ReadCtx, lines: readonly string[], n = 15): string[] =>
  lines.length > n ? [...lines.slice(0, n), L(ctx, 'advisor.k.more', { n: count(ctx, lines.length - n) })] : [...lines];
/**
 * The rows `cap` gives a line to: the first `n`. A customer counted only in "…and N more" is not named by the
 * sheet, so they are not one of its subjects; every customer whose line is shown is.
 */
const shown = <T>(rows: readonly T[], n = 15): readonly T[] => rows.slice(0, n);

/** The period asked about, else the entry's own; and where it starts, in the workspace's zone. */
const rangeOf = (ctx: ReadCtx, fallback: Range): Range => ctx.params.period ?? fallback;
async function periodStart(tx: Tx, zone: string, range: Range): Promise<Date> {
  const unit = range === 'today' ? 'day' : range;
  return (await sql<{ c: Date }>`select (date_trunc(${unit}, now() at time zone ${zone}) at time zone ${zone}) as c`.execute(tx)).rows[0]!.c;
}
const periodLine = (ctx: ReadCtx, range: Range, start: Date, zone: string): string =>
  L(ctx, `advisor.period.${range}`, { since: show.dayMonth(ctx.locale, dayKey(start, zone)) });

/** The owner's own test conversations, for the lists other readers draw. */
async function testing(tx: Tx): Promise<ReadonlySet<string>> {
  return new Set((await sql<{ id: string }>`select id::text as id from conversations where owner_testing`.execute(tx)).rows.map((r) => r.id));
}

/** A customer by what the owner called them: a name, part of one, or their number. Real customers only. */
async function findCustomers(tx: Tx, said: string): Promise<{ readonly id: string; readonly name: string | null; readonly exact: boolean }[]> {
  const q = said.trim().slice(0, 80);
  const digits = q.replace(/\D/g, '');
  return (await sql<{ id: string; name: string | null; exact: boolean }>`
    select cl.id::text as id, cl.display_name as name, lower(coalesce(cl.display_name, '')) = lower(${q}) as exact
      from clients cl
     where exists (select 1 from conversations c where c.client_id = cl.id and not c.owner_testing)
       and (position(lower(${q}) in lower(coalesce(cl.display_name, ''))) > 0
         or exists (select 1 from client_channels cc where cc.client_id = cl.id and position(lower(${q}) in lower(cc.channel_user_id)) > 0)
         or (length(${digits}) >= 6 and regexp_replace(coalesce(cl.phone, ''), '\\D', '', 'g') like '%' || ${digits}))
     order by 3 desc, cl.display_name nulls last
     limit 6`.execute(tx)).rows;
}

/** One customer named in the question, or the sheet that says why not. */
async function oneCustomer(ctx: ReadCtx, tx: Tx): Promise<{ readonly id: string; readonly name: string | null } | Sheet> {
  const said = ctx.params.customer;
  if (!said) return nothing('advisor.none.whichCustomer');
  const found = await findCustomers(tx, said);
  if (found.length === 0) return nothing('advisor.none.noSuchCustomer', { name: said });
  const exact = found.filter((f) => f.exact);
  if (exact.length === 1 || found.length === 1) return exact[0] ?? found[0]!;
  const names = found.map((f) => nameOf(ctx, f.name));
  return sheet([L(ctx, 'advisor.k.matches', { name: said, list: names.join(', ') })], names, undefined, { subjects: found.map((f) => f.id) });
}
const isSheet = (x: unknown): x is Sheet => typeof x === 'object' && x !== null && 'lines' in x;

const INBOX: Door = { href: '/app/inbox', label: 'nav.inbox' };
const WAITING: Door = { href: '/app/inbox?filter=pending', label: 'nav.inbox' };
const CALENDAR: Door = { href: '/app/calendar', label: 'nav.calendar' };
const resultsDoor = (range: Range): Door => ({ href: `/app/analytics?range=${range}`, label: 'today.results.link' });
const ASSISTANT: Door = { href: '/app/settings/assistant', label: 'nav.employee' };
const PRODUCTS: Door = { href: '/app/products', label: 'nav.products' };
const KNOWLEDGE: Door = { href: '/app/knowledge', label: 'nav.knowledge' };
const BUSINESS: Door = { href: '/app/business', label: 'nav.factory' };
const cardDoor = (clientId: string): Door => ({ href: `/app/customers/${clientId}`, label: 'advisor.door.customer' });

// ── A · Customers ────────────────────────────────────────────────────────────

/** A1 — one per customer, the Inbox's count, without the owner's own tests. */
async function customersCount(ctx: ReadCtx): Promise<Sheet> {
  const n = await ro(ctx, async (tx) => (await sql<{ n: number }>`
    select count(distinct c.client_id)::int as n from conversations c where c.client_id is not null and not c.owner_testing`.execute(tx)).rows[0]!.n);
  return n === 0 ? nothing('advisor.none.customers', undefined, INBOX) : sheet([L(ctx, 'advisor.k.customers', { n: count(ctx, n) })], [], INBOX);
}

/** A2 — the customers, newest contact first. */
async function customersList(ctx: ReadCtx): Promise<Sheet> {
  const rows = await ro(ctx, async (tx) => (await sql<{ id: string; name: string | null; at: Date | null; total: number }>`
    select cl.id::text as id, cl.display_name as name, max(m.sent_at) as at, (count(*) over ())::int as total
      from clients cl join conversations c on c.client_id = cl.id and not c.owner_testing
      left join messages m on m.conversation_id = c.id
     group by cl.id, cl.display_name
     order by max(m.sent_at) desc nulls last limit 30`.execute(tx)).rows);
  if (rows.length === 0) return nothing('advisor.none.customers', undefined, INBOX);
  const lines = rows.map((r) => r.at ? L(ctx, 'advisor.k.customerLast', { name: nameOf(ctx, r.name), when: when(ctx, r.at) }) : nameOf(ctx, r.name));
  return sheet([L(ctx, 'advisor.k.customers', { n: count(ctx, rows[0]!.total) }), ...cap(ctx, lines, 20)], rows.map((r) => r.name ?? ''), { href: '/app/inbox?filter=all', label: 'nav.inbox' },
    { subjects: shown(rows, 20).map((r) => r.id) });
}

/** A3 — one customer's card: the Inbox's own reading of who they are. */
async function customerAbout(ctx: ReadCtx): Promise<Sheet> {
  return ro(ctx, async (tx) => {
    const who = await oneCustomer(ctx, tx);
    if (isSheet(who)) return who;
    const card = await loadCustomerCard(tx, who.id, ctx.viewerId);
    if (!card) return nothing('advisor.none.noSuchCustomer', { name: ctx.params.customer ?? '' });
    const name = nameOf(ctx, card.name);
    const product = (p: { readonly name: string | null; readonly nameZh: string | null }) => (ctx.locale === 'zh' ? p.nameZh ?? p.name : p.name) ?? '';
    const lines = [
      L(ctx, 'advisor.k.card.name', { name }),
      ...(card.channels.length ? [L(ctx, 'advisor.k.card.channels', { list: card.channels.join(', ') })] : []),
      ...(card.lastWrote ? [L(ctx, 'advisor.k.card.lastWrote', { when: when(ctx, card.lastWrote) })] : []),
      ...(card.value.orders > 0 ? [L(ctx, 'advisor.k.card.orders', { n: count(ctx, card.value.orders) })] : []),
      ...(card.value.spent ? [L(ctx, 'advisor.k.card.spent', { amount: money(ctx, card.value.spent) })] : []),
      ...(card.value.regular ? [L(ctx, 'advisor.k.card.regular')] : []),
      ...(card.bought.length ? [L(ctx, 'advisor.k.card.bought', { list: card.bought.map(product).filter(Boolean).join(', ') })] : []),
      ...(card.askedAbout.length ? [L(ctx, 'advisor.k.card.asked', { list: card.askedAbout.map(product).filter(Boolean).join(', ') })] : []),
      ...(card.waiting ? [L(ctx, 'advisor.k.card.waiting')] : []),
    ];
    return sheet(lines, [card.name ?? '', ...card.bought.map(product), ...card.askedAbout.map(product)], cardDoor(card.clientId), { subjects: [card.clientId] });
  });
}

/** A4 — when they last wrote (the card's reading), and when we last wrote to them (a new query). */
async function lastContact(ctx: ReadCtx): Promise<Sheet> {
  return ro(ctx, async (tx) => {
    const who = await oneCustomer(ctx, tx);
    if (isSheet(who)) return who;
    const r = (await sql<{ them: Date | null; us: Date | null }>`
      select max(m.sent_at) filter (where m.direction = 'inbound') as them, max(m.sent_at) filter (where m.direction = 'outbound') as us
        from messages m join conversations c on c.id = m.conversation_id
       where c.client_id = ${who.id}::uuid and not c.owner_testing`.execute(tx)).rows[0]!;
    const name = nameOf(ctx, who.name);
    if (!r.them && !r.us) return nothing('advisor.none.neverWrote', { name }, undefined, [who.id]);
    return sheet([
      ...(r.them ? [L(ctx, 'advisor.k.theyWrote', { name, when: when(ctx, r.them) })] : []),
      ...(r.us ? [L(ctx, 'advisor.k.weWrote', { name, when: when(ctx, r.us) })] : []),
    ], [who.name ?? ''], cardDoor(who.id), { subjects: [who.id] });
  });
}

/** A5 — who wrote most recently (new): each customer's newest message to us. */
async function recentContacts(ctx: ReadCtx): Promise<Sheet> {
  const rows = await ro(ctx, async (tx) => (await sql<{ id: string; name: string | null; at: Date }>`
    select cl.id::text as id, cl.display_name as name, max(m.sent_at) as at
      from messages m join conversations c on c.id = m.conversation_id and not c.owner_testing
      join clients cl on cl.id = c.client_id
     where m.direction = 'inbound'
     group by cl.id, cl.display_name order by 2 desc limit 10`.execute(tx)).rows);
  if (rows.length === 0) return nothing('advisor.none.customers', undefined, INBOX);
  return sheet(rows.map((r) => L(ctx, 'advisor.k.wrote', { name: nameOf(ctx, r.name), when: when(ctx, r.at) })), rows.map((r) => r.name ?? ''), INBOX,
    { subjects: rows.map((r) => r.id) });
}

/** A6 · B5 · D1 · D2 · D4 · G4 — Results' own figures (loadAnalytics), for the period. */
async function results(ctx: ReadCtx, range: Range) {
  return loadAnalytics(ctx.db, String(ctx.businessId), range);
}

async function newCustomers(ctx: ReadCtx): Promise<Sheet> {
  const range = rangeOf(ctx, 'week');
  const r = await results(ctx, range);
  if (r.summary.newClients === 0) return nothing('advisor.none.newCustomers', { period: L(ctx, `advisor.when.${range}`) }, resultsDoor(range));
  return sheet([periodSince(ctx, range, r.since), L(ctx, 'advisor.k.newCustomers', { n: count(ctx, r.summary.newClients) })], [], resultsDoor(range));
}
const periodSince = (ctx: ReadCtx, range: Range, since: Date | undefined): string =>
  L(ctx, `advisor.period.${range}`, { since: since ? show.date(ctx.locale, since) : '' });

/** A7 — who spent the most: SPENT, each in the currency of their newest standing order. */
async function bestCustomers(ctx: ReadCtx): Promise<Sheet> {
  return ro(ctx, async (tx) => {
    const ids = (await sql<{ id: string }>`
      select distinct o.client_id::text as id from orders o
       where o.client_id is not null and o.status = any(${[...SPEND_STATUSES]}::text[]) and ${notOwnerTesting('o.conversation_id')}`.execute(tx)).rows.map((r) => r.id);
    if (ids.length === 0) return nothing('advisor.none.bestCustomers', undefined, { href: '/app/inbox?lens=value', label: 'nav.inbox' });
    const values = await customerValues(tx, ids, ctx.now);
    const names = await namesOf(tx, ids);
    const top = [...values.values()].filter((v) => v.spent).sort((a, b) => (b.spent!.amount - a.spent!.amount)).slice(0, 10);
    return sheet(top.map((v) => L(ctx, 'advisor.k.spent', { name: nameOf(ctx, names.get(v.clientId) ?? null), amount: money(ctx, v.spent!) })),
      top.map((v) => names.get(v.clientId) ?? ''), { href: '/app/inbox?lens=value', label: 'nav.inbox' }, { subjects: top.map((v) => v.clientId) });
  });
}
async function namesOf(tx: Tx, ids: readonly string[]): Promise<Map<string, string | null>> {
  if (ids.length === 0) return new Map();
  return new Map((await sql<{ id: string; name: string | null }>`
    select id::text as id, display_name as name from clients where id = any(${[...ids]}::uuid[])`.execute(tx)).rows.map((r) => [r.id, r.name]));
}

/** A8 — regulars: three standing orders or more (`REGULAR_ORDERS`, customerValue.ts). */
async function regulars(ctx: ReadCtx): Promise<Sheet> {
  return ro(ctx, async (tx) => {
    const ids = (await sql<{ id: string }>`
      select distinct o.client_id::text as id from orders o
       where o.client_id is not null and o.status = any(${[...SPEND_STATUSES]}::text[]) and ${notOwnerTesting('o.conversation_id')}`.execute(tx)).rows.map((r) => r.id);
    const values = [...(await customerValues(tx, ids, ctx.now)).values()].filter((v) => v.regular);
    if (values.length === 0) return nothing('advisor.none.regulars', undefined, INBOX);
    const names = await namesOf(tx, values.map((v) => v.clientId));
    const list = values.map((v) => nameOf(ctx, names.get(v.clientId) ?? null));
    return sheet([L(ctx, 'advisor.k.regulars', { n: count(ctx, values.length), list: list.slice(0, 20).join(', ') })], [...names.values()].map((n) => n ?? ''), INBOX,
      { subjects: values.slice(0, 20).map((v) => v.clientId) });
  });
}

/** A10 — which channel customers use most (new). */
async function channels(ctx: ReadCtx): Promise<Sheet> {
  const rows = await ro(ctx, async (tx) => (await sql<{ channel: string; n: number }>`
    select c.channel, count(distinct c.client_id)::int as n from conversations c
     where c.client_id is not null and not c.owner_testing group by 1 order by 2 desc`.execute(tx)).rows);
  if (rows.length === 0) return nothing('advisor.none.customers', undefined, INBOX);
  const channelName = (c: string): string => (messages[ctx.locale] as Record<string, string>)[`conv.channel.${c}`] ?? c;
  return sheet(rows.map((r) => L(ctx, 'advisor.k.channel', { channel: channelName(r.channel), n: count(ctx, r.n) })), [], INBOX);
}

// ── B · Conversations, and what waits ────────────────────────────────────────

/** B1 — the Inbox's "Needs you", as this reader sees it (`needsOwnerFor`), by customer. */
async function waiting(ctx: ReadCtx): Promise<Sheet> {
  const rows = await ro(ctx, async (tx) => (await sql<{ client_id: string; name: string | null; review: boolean; order: boolean; deletion: boolean; reason: string | null }>`
    select distinct on (c.client_id) c.client_id::text as client_id, cl.display_name as name,
           exists (select 1 from drafts d where d.conversation_id = c.id and d.status = 'pending') as review,
           exists (select 1 from order_proposals op where op.conversation_id = c.id and op.state = 'pending') as order,
           ${DELETION_WAITING} as deletion,
           (select s.kind from conversation_signals s where s.conversation_id = c.id and s.resolved_at is null order by s.created_at desc limit 1) as reason
      from conversations c left join clients cl on cl.id = c.client_id
     where ${needsOwnerFor(ctx.viewerId)} and not c.owner_testing and c.client_id is not null
     order by c.client_id, c.created_at desc`.execute(tx)).rows);
  if (rows.length === 0) return nothing('advisor.none.waiting', undefined, WAITING);
  const why = (r: typeof rows[number]): string => r.order ? t(ctx.locale, 'advisor.k.why.order') : r.deletion ? t(ctx.locale, 'advisor.k.why.deletion')
    : r.review ? t(ctx.locale, 'advisor.k.why.review')
    : (r.reason && (messages[ctx.locale] as Record<string, string>)[`takeover.reason.${r.reason}`]) || t(ctx.locale, 'advisor.k.why.person');
  return sheet([L(ctx, 'advisor.k.waitingCount', { n: count(ctx, rows.length) }),
    ...cap(ctx, rows.map((r) => L(ctx, 'advisor.k.row', { name: nameOf(ctx, r.name), detail: why(r) })))], rows.map((r) => r.name ?? ''), WAITING,
    { subjects: shown(rows).map((r) => r.client_id) });
}

/** B2 · B3 · B4 · B9 — a count by one of the Inbox's own definitions. */
async function countOf(ctx: ReadCtx, what: 'review' | 'handed' | 'blocked' | 'deletion'): Promise<number> {
  return ro(ctx, async (tx) => (await (what === 'review'
    ? sql<{ n: number }>`select count(*)::int as n from drafts d where d.status = 'pending' and ${notOwnerTesting('d.conversation_id')}`
    : what === 'handed'
      ? sql<{ n: number }>`select count(distinct c.client_id)::int as n from conversations c where c.assigned_to = 'unclaimed' and c.is_active and not c.owner_testing`
      : what === 'blocked'
        ? sql<{ n: number }>`select count(distinct c.client_id)::int as n from conversations c where ${IS_BLOCKED} and not c.owner_testing`
        : sql<{ n: number }>`select count(distinct c.client_id)::int as n from conversations c where ${DELETION_WAITING} and not c.owner_testing`
  ).execute(tx)).rows[0]!.n);
}
const counted = (key: string, none: MessageKey, door: Door, what: 'review' | 'handed' | 'blocked' | 'deletion') =>
  async (ctx: ReadCtx): Promise<Sheet> => {
    const n = await countOf(ctx, what);
    return n === 0 ? nothing(none, undefined, door) : sheet([L(ctx, key, { n: count(ctx, n) })], [], door);
  };

async function conversations(ctx: ReadCtx): Promise<Sheet> {
  const range = rangeOf(ctx, 'week');
  const r = await results(ctx, range);
  if (r.summary.activeConvos === 0) return nothing('advisor.none.conversations', { period: L(ctx, `advisor.when.${range}`) }, resultsDoor(range));
  return sheet([periodSince(ctx, range, r.since), L(ctx, 'advisor.k.inTouch', { n: count(ctx, r.summary.activeConvos) }),
    L(ctx, 'advisor.k.inbound', { n: count(ctx, r.activity.inbound) })], [], resultsDoor(range));
}

/** B7 — customers whose newest message, on any conversation, is theirs: the Inbox's "unanswered". */
async function unanswered(ctx: ReadCtx): Promise<Sheet> {
  const rows = await ro(ctx, async (tx) => (await sql<{ client_id: string; name: string | null; at: Date }>`
    with last as (
      select distinct on (c.client_id) c.client_id, m.direction, m.sent_at
        from messages m join conversations c on c.id = m.conversation_id and not c.owner_testing
       where c.client_id is not null
       order by c.client_id, m.sent_at desc, m.id desc
    )
    select l.client_id::text as client_id, cl.display_name as name, l.sent_at as at from last l join clients cl on cl.id = l.client_id
     where l.direction = 'inbound' order by l.sent_at desc limit 30`.execute(tx)).rows);
  if (rows.length === 0) return nothing('advisor.none.unanswered', undefined, INBOX);
  return sheet([L(ctx, 'advisor.k.unansweredCount', { n: count(ctx, rows.length) }),
    ...cap(ctx, rows.map((r) => L(ctx, 'advisor.k.wrote', { name: nameOf(ctx, r.name), when: when(ctx, r.at) })))], rows.map((r) => r.name ?? ''), INBOX,
    { subjects: shown(rows).map((r) => r.client_id) });
}

/**
 * B8 — REPLY TIMES (the owner's approved metric, with the owner's amendment): for each reply that went out
 * in the period after the customer wrote, the time from the first message of theirs it answered to the
 * reply; the median of those, how many replies it was measured on, and — always with them — how many of the
 * customers' messages in the period are still unanswered. Never a percentage. A message nobody answered
 * counts in the third figure, never in the median.
 */
async function replyTimes(ctx: ReadCtx): Promise<Sheet> {
  const range = rangeOf(ctx, 'week');
  return ro(ctx, async (tx) => {
    const zone = await zoneOf(tx, ctx.businessId);
    const start = await periodStart(tx, zone, range);
    const r = (await sql<{ median_s: number | null; replies: number; unanswered: number }>`
      with real as (select id from conversations where not owner_testing),
      m as (select m.conversation_id, m.direction, m.sent_at,
                   lag(m.direction) over (partition by m.conversation_id order by m.sent_at, m.id) as prev
              from messages m where m.conversation_id in (select id from real) and m.sent_at is not null),
      runs as (  -- each customer message that starts a run of theirs (the first one a reply answers)
        select conversation_id, sent_at from m where direction = 'inbound' and (prev is null or prev = 'outbound')),
      answered as (
        select r.conversation_id, r.sent_at as asked,
               (select min(o.sent_at) from m o where o.conversation_id = r.conversation_id and o.direction = 'outbound' and o.sent_at > r.sent_at) as replied
          from runs r)
      select (select extract(epoch from percentile_cont(0.5) within group (order by (replied - asked)))::float
                from answered where replied is not null and replied >= ${start}) as median_s,
             (select count(*)::int from answered where replied is not null and replied >= ${start}) as replies,
             (select count(*)::int from m i where i.direction = 'inbound' and i.sent_at >= ${start}
                and not exists (select 1 from m o where o.conversation_id = i.conversation_id and o.direction = 'outbound' and o.sent_at > i.sent_at)) as unanswered
    `.execute(tx)).rows[0]!;
    if (r.replies === 0 && r.unanswered === 0) return nothing('advisor.none.replies', { period: L(ctx, `advisor.when.${range}`) }, INBOX);
    const median = r.median_s === null ? null : r.median_s < 60 ? show.seconds(ctx.locale, r.median_s) : show.timeLeft(ctx.locale, r.median_s * 1000);
    const lines = [
      periodLine(ctx, range, start, zone),
      median === null ? L(ctx, 'advisor.k.replyNone') : L(ctx, 'advisor.k.replyMedian', { time: median }),
      L(ctx, 'advisor.k.replyMeasured', { n: count(ctx, r.replies) }),
      L(ctx, 'advisor.k.replyUnanswered', { n: count(ctx, r.unanswered) }),
    ];
    return sheet(lines, [], INBOX, { must: [...(median === null ? [] : [median]), count(ctx, r.replies), count(ctx, r.unanswered)] });
  });
}

// ── C · Gone quiet, and follow-ups ───────────────────────────────────────────

/** C1 · C2 · C3 — the Inbox's "slipping" band (`readAttention`, 3 to 30 days), as this reader sees it. */
async function attention(ctx: ReadCtx, only: AttentionItem['kind'] | null, none: MessageKey): Promise<Sheet> {
  const items = await ro(ctx, async (tx) => {
    const tests = await testing(tx);
    return (await readAttention(tx, ctx.now, ctx.viewerId)).filter((i) => !tests.has(i.conversationId) && (only === null || i.kind === only));
  });
  if (items.length === 0) return nothing(none, undefined, INBOX);
  return sheet(cap(ctx, items.map((i) => L(ctx, `advisor.k.quiet.${i.kind}`, { name: nameOf(ctx, i.name), when: when(ctx, i.since) }))),
    items.map((i) => i.name ?? ''), INBOX, { subjects: shown(items).map((i) => i.clientId) });
}

/** C4 · E1 · E2 · E3 · E4 · E6 — the calendar's own rows (`loadCalendar`), minus what is done (`isDone`). */
async function dated(ctx: ReadCtx, days: number, category: CalendarCategory | null, keep: (e: CalendarEntry) => boolean = () => true): Promise<CalendarEntry[]> {
  const zone = await ro(ctx, (tx) => zoneOf(tx, ctx.businessId));
  const today = dayKey(ctx.now, zone);
  const view = await loadCalendar(ctx.db, String(ctx.businessId), { from: addDays(today, -60), to: addDays(today, days), category, buyer: null, outreach: false }, ctx.now);
  const tests = await ro(ctx, testing);
  return view.entries
    .filter((e) => !isDone(e, ctx.now) && keep(e) && !(e.conversationId && tests.has(e.conversationId)))
    .filter((e) => e.day >= today || e.kind === 'reply_due' || e.kind === 'sample_asked' || e.kind.startsWith('promise_'))
    .sort((a, b) => a.day.localeCompare(b.day) || a.at.getTime() - b.at.getTime());
}
const entryLine = (ctx: ReadCtx, e: CalendarEntry): string => {
  const who = nameOf(ctx, e.buyer?.name ?? null);
  const what = L(ctx, `advisor.k.cal.${e.kind}`, {
    name: who, ref: e.detail.orderReference ?? '', state: e.detail.orderState ? orderStatusName(ctx.locale, e.detail.orderState) : '',
    label: e.detail.closureLabel ?? '', title: e.detail.title ?? '',
  });
  return L(ctx, e.detail.overdue ? 'advisor.k.datedOverdue' : 'advisor.k.dated', { when: e.allDay ? show.dayMonth(ctx.locale, e.day) : when(ctx, e.at), what });
};
/**
 * Whether an entry's line names its customer: its kind's sentence has a `{name}`. An order's says only its
 * reference, a closure and the owner's own date name nobody.
 */
const namesBuyer = (ctx: ReadCtx, e: CalendarEntry): boolean =>
  ((messages[ctx.locale] as Record<string, string>)[`advisor.k.cal.${e.kind}`] ?? '').includes('{name}');
const datedSheet = (ctx: ReadCtx, entries: readonly CalendarEntry[], none: MessageKey, door: Door = CALENDAR, n = 12): Sheet =>
  entries.length === 0 ? nothing(none, undefined, door)
    : sheet(cap(ctx, entries.map((e) => entryLine(ctx, e)), n), entries.map((e) => e.buyer?.name ?? ''), door,
      { subjects: shown(entries, n).filter((e) => namesBuyer(ctx, e)).map((e) => e.buyer?.id) });

// ── D · Sales and orders ─────────────────────────────────────────────────────

/** "Never" or "not in this period": has any order ever stood? (The same definition, all time.) */
async function everSold(ctx: ReadCtx): Promise<boolean> {
  return ro(ctx, async (tx) => (await sql<{ any: boolean }>`
    select exists (select 1 from orders o where o.status = any(${[...SPEND_STATUSES]}::text[]) and ${notOwnerTesting('o.conversation_id')}) as any`.execute(tx)).rows[0]!.any);
}

/** D1 — Results' totals: one per currency, never added across currencies. */
async function sales(ctx: ReadCtx): Promise<Sheet> {
  const range = rangeOf(ctx, 'month');
  const r = await results(ctx, range);
  if (r.commerce.orders === 0 || r.commerce.totals.length === 0) {
    return await everSold(ctx) ? nothing('advisor.none.salesPeriod', { period: L(ctx, `advisor.when.${range}`) }, resultsDoor(range))
      : nothing('advisor.none.salesNever', undefined, resultsDoor(range));
  }
  return sheet([periodSince(ctx, range, r.since), L(ctx, 'advisor.k.orders', { n: count(ctx, r.commerce.orders) }),
    ...r.commerce.totals.map((m) => L(ctx, 'advisor.k.sales', { amount: money(ctx, m) }))], [], resultsDoor(range));
}

/** D2 — Results' deals: the standing orders of the period, by state. */
async function ordersByState(ctx: ReadCtx): Promise<Sheet> {
  const range = rangeOf(ctx, 'month');
  const r = await results(ctx, range);
  if (r.commerce.orders === 0) {
    return await everSold(ctx) ? nothing('advisor.none.ordersPeriod', { period: L(ctx, `advisor.when.${range}`) }, resultsDoor(range))
      : nothing('advisor.none.salesNever', undefined, resultsDoor(range));
  }
  return sheet([periodSince(ctx, range, r.since), L(ctx, 'advisor.k.orders', { n: count(ctx, r.commerce.orders) }),
    ...r.commerce.deals.map((d) => L(ctx, 'advisor.k.state', { state: orderStatusName(ctx.locale, d.status), n: count(ctx, d.n) }))], [], resultsDoor(range));
}

/** D3 — a customer's yes waiting for the owner's tap (`ORDER_WAITING`). */
async function ordersWaiting(ctx: ReadCtx): Promise<Sheet> {
  const rows = await ro(ctx, async (tx) => (await sql<{ client_id: string | null; name: string | null; total: string | null; currency: string | null }>`
    select cl.id::text as client_id, cl.display_name as name, op.total::text as total, op.currency
      from order_proposals op join conversations c on c.id = op.conversation_id and not c.owner_testing
      left join clients cl on cl.id = c.client_id
     where op.state = 'pending' order by op.created_at`.execute(tx)).rows);
  if (rows.length === 0) return nothing('advisor.none.ordersWaiting', undefined, WAITING);
  return sheet(rows.map((r) => {
    const m = r.total !== null && r.currency ? moneyFromRow(Number(r.total), r.currency) : null;
    return m ? L(ctx, 'advisor.k.orderWaiting', { name: nameOf(ctx, r.name), amount: money(ctx, m) }) : L(ctx, 'advisor.k.orderWaitingBare', { name: nameOf(ctx, r.name) });
  }), rows.map((r) => r.name ?? ''), WAITING, { subjects: rows.map((r) => r.client_id) });
}

async function pricesSent(ctx: ReadCtx): Promise<Sheet> {
  const range = rangeOf(ctx, 'week');
  const r = await results(ctx, range);
  if (r.commerce.quotes === 0) return nothing('advisor.none.prices', { period: L(ctx, `advisor.when.${range}`) }, resultsDoor(range));
  return sheet([periodSince(ctx, range, r.since), L(ctx, 'advisor.k.prices', { n: count(ctx, r.commerce.quotes) })], [], resultsDoor(range));
}

/** Standing orders since `start`, per currency: how many and how much (D5, D7, D8). */
async function totalsSince(tx: Tx, start: Date, until: Date | null = null): Promise<{ currency: string; n: number; sum: number }[]> {
  return (await sql<{ currency: string; n: number; sum: string }>`
    select o.currency, count(*)::int as n, coalesce(sum(o.total_value_usd), 0)::text as sum from orders o
     where o.status = any(${[...SPEND_STATUSES]}::text[]) and coalesce(o.confirmed_at, o.created_at) >= ${start}
       and (${until}::timestamptz is null or coalesce(o.confirmed_at, o.created_at) < ${until}::timestamptz)
       and ${notOwnerTesting('o.conversation_id')}
     group by o.currency order by 3 desc`.execute(tx)).rows.map((r) => ({ currency: r.currency, n: r.n, sum: Number(r.sum) }));
}
const moneyOr = (ctx: ReadCtx, amount: number, currency: string): string | null => {
  const m = moneyFromRow(amount, currency);
  return m ? money(ctx, m) : null;
};

/** D5 — the average order (new): the division in code, per currency. */
async function averageOrder(ctx: ReadCtx): Promise<Sheet> {
  const range = rangeOf(ctx, 'month');
  return ro(ctx, async (tx) => {
    const zone = await zoneOf(tx, ctx.businessId);
    const start = await periodStart(tx, zone, range);
    const rows = (await totalsSince(tx, start)).filter((r) => r.n > 0);
    if (rows.length === 0) return nothing('advisor.none.salesPeriod', { period: L(ctx, `advisor.when.${range}`) }, resultsDoor(range));
    return sheet([periodLine(ctx, range, start, zone), ...rows.flatMap((r) => {
      const avg = moneyOr(ctx, Math.round((r.sum / r.n) * 100) / 100, r.currency);
      return avg ? [L(ctx, 'advisor.k.average', { amount: avg, n: count(ctx, r.n) })] : [];
    })], [], resultsDoor(range));
  });
}

/** D7 — this month so far against the same days of last month (new), per currency: two figures, never a percentage. */
async function againstLastMonth(ctx: ReadCtx): Promise<Sheet> {
  return ro(ctx, async (tx) => {
    const zone = await zoneOf(tx, ctx.businessId);
    const b = (await sql<{ this_start: Date; last_start: Date; last_until: Date }>`
      select (date_trunc('month', now() at time zone ${zone}) at time zone ${zone}) as this_start,
             (date_trunc('month', now() at time zone ${zone}) - interval '1 month') at time zone ${zone} as last_start,
             ((now() at time zone ${zone}) - interval '1 month') at time zone ${zone} as last_until`.execute(tx)).rows[0]!;
    const now = await totalsSince(tx, b.this_start);
    const then = await totalsSince(tx, b.last_start, b.last_until);
    if (now.length === 0 && then.length === 0) return nothing(await everSoldTx(tx) ? 'advisor.none.bothMonths' : 'advisor.none.salesNever', undefined, resultsDoor('month'));
    const currencies = [...new Set([...now, ...then].map((r) => r.currency))];
    const said = (rows: typeof now, c: string): string => {
      const r = rows.find((x) => x.currency === c);
      return r ? moneyOr(ctx, r.sum, c) ?? L(ctx, 'advisor.k.noSales') : L(ctx, 'advisor.k.noSales');
    };
    return sheet(currencies.flatMap((c) => [
      L(ctx, 'advisor.k.thisMonth', { since: show.date(ctx.locale, b.this_start), amount: said(now, c) }),
      L(ctx, 'advisor.k.lastMonth', { from: show.date(ctx.locale, b.last_start), until: show.date(ctx.locale, b.last_until), amount: said(then, c) }),
    ]), [], resultsDoor('month'));
  });
}
async function everSoldTx(tx: Tx): Promise<boolean> {
  return (await sql<{ any: boolean }>`select exists (select 1 from orders o where o.status = any(${[...SPEND_STATUSES]}::text[]) and ${notOwnerTesting('o.conversation_id')}) as any`.execute(tx)).rows[0]!.any;
}

/**
 * D8 — SALES AT THE OWNER'S OWN RATE (the owner's approved metric): only at the rate the owner stated
 * (`owner_rates`, the workspace currency → the country's), with that rate and its date in the answer. Never
 * a live rate, never silently: a total in another currency is said as it is, unconverted.
 */
async function salesAtRate(ctx: ReadCtx): Promise<Sheet> {
  const range = rangeOf(ctx, 'month');
  return ro(ctx, async (tx) => {
    const pair = await ratePairOf(tx, ctx.businessId);
    const rate = pair ? (await sql<{ rate: string; at: Date }>`
      select rate::text as rate, stated_at as at from owner_rates
       where from_currency = ${pair.from} and to_currency = ${pair.to} order by stated_at desc limit 1`.execute(tx)).rows[0] : undefined;
    if (!pair || !rate) return nothing('advisor.none.rate', undefined, { href: '/app/settings/rate', label: 'advisor.door.rate' });
    const zone = await zoneOf(tx, ctx.businessId);
    const start = await periodStart(tx, zone, range);
    const rows = await totalsSince(tx, start);
    if (rows.length === 0) return nothing(await everSoldTx(tx) ? 'advisor.none.salesPeriod' : 'advisor.none.salesNever', { period: L(ctx, `advisor.when.${range}`) }, resultsDoor(range));
    // As the rate page says it (settings.ts `toRate`): the stored figure, never rounded by a formatter.
    const r = Number(rate.rate);
    const rateSaid = L(ctx, 'advisor.k.rate', { from: pair.from, rate: String(r), to: pair.to, date: show.date(ctx.locale, rate.at) });
    return sheet([periodLine(ctx, range, start, zone), rateSaid, ...rows.flatMap((x) => {
      const own = moneyOr(ctx, x.sum, x.currency);
      if (!own) return [];
      if (x.currency !== pair.from) return [L(ctx, 'advisor.k.notConverted', { amount: own })];
      const converted = moneyOr(ctx, Math.round(x.sum * r * 100) / 100, pair.to);
      return converted ? [L(ctx, 'advisor.k.converted', { amount: own, converted })] : [];
    })], [], resultsDoor(range));
  });
}

/** D11 — one order by its reference (new): where it stands, and each step with its date (`order_updates`). */
async function orderByReference(ctx: ReadCtx): Promise<Sheet> {
  const ref = ctx.params.reference?.trim();
  if (!ref) return nothing('advisor.none.whichOrder');
  return ro(ctx, async (tx) => {
    const o = (await sql<{ id: string; status: string; quantity: number | null; unit: string | null; total: string | null; currency: string; name: string | null; product: string | null; tracking: string | null; client: string | null }>`
      select o.id::text as id, o.status, o.quantity, o.unit, o.total_value_usd::text as total, o.currency, cl.display_name as name, p.name as product,
             o.tracking_reference as tracking, o.client_id::text as client
        from orders o left join clients cl on cl.id = o.client_id left join products p on p.id = o.product_id
       where lower(o.order_reference) = lower(${ref}) and ${notOwnerTesting('o.conversation_id')} limit 1`.execute(tx)).rows[0];
    if (!o) return nothing('advisor.none.noSuchOrder', { ref });
    const steps = (await sql<{ state: string; at: Date }>`
      select state, at from order_updates where order_id = ${o.id}::uuid order by at`.execute(tx)).rows;
    const total = o.total !== null ? moneyOr(ctx, Number(o.total), o.currency) : null;
    return sheet([
      L(ctx, 'advisor.k.order', { ref, state: orderStatusName(ctx.locale, o.status), name: nameOf(ctx, o.name) }),
      ...(o.product ? [L(ctx, 'advisor.k.orderWhat', { quantity: o.quantity === null ? '' : show.count(ctx.locale, o.quantity), unit: o.unit ?? '', product: o.product })] : []),
      ...(total ? [L(ctx, 'advisor.k.orderTotal', { amount: total })] : []),
      ...steps.map((s) => L(ctx, 'advisor.k.orderStep', { state: orderStatusName(ctx.locale, s.state), when: when(ctx, s.at) })),
      ...(o.tracking ? [L(ctx, 'advisor.k.tracking', { ref: o.tracking })] : []),
    ], [o.name ?? '', o.product ?? ''], { href: `/app/orders/${o.id}`, label: 'advisor.door.order' }, { subjects: [o.client] });
  });
}

// ── E · Schedule ─────────────────────────────────────────────────────────────

/** E5 — the closures still ahead (`factory_closures`, not archived). */
async function closures(ctx: ReadCtx): Promise<Sheet> {
  const rows = await ro(ctx, async (tx) => {
    const zone = await zoneOf(tx, ctx.businessId);
    return (await sql<{ label: string | null; from: string; to: string }>`
      select label, starts_on::text as from, ends_on::text as to from factory_closures
       where archived_at is null and ends_on >= ${dayKey(ctx.now, zone)}::date order by starts_on limit 10`.execute(tx)).rows;
  });
  if (rows.length === 0) return nothing('advisor.none.closures', undefined, { href: '/app/settings/closures', label: 'advisor.door.closures' });
  return sheet(rows.map((r) => L(ctx, 'advisor.k.closure', { label: r.label ?? '', from: show.dayMonth(ctx.locale, r.from), to: show.dayMonth(ctx.locale, r.to) })),
    [], { href: '/app/settings/closures', label: 'advisor.door.closures' });
}

/** E6 — a delivery date a sent reply promised to that customer; Nomi never turns lead times into dates. */
async function deliveryPromised(ctx: ReadCtx): Promise<Sheet> {
  return ro(ctx, async (tx) => {
    const who = await oneCustomer(ctx, tx);
    if (isSheet(who)) return who;
    const rows = (await sql<{ due: string }>`
      select pd.due_on::text as due from promised_dates pd join conversations c on c.id = pd.conversation_id and not c.owner_testing
       where c.client_id = ${who.id}::uuid and pd.kind = 'delivery' and pd.kept_at is null order by pd.due_on`.execute(tx)).rows;
    const name = nameOf(ctx, who.name);
    if (rows.length === 0) return nothing('advisor.none.delivery', { name }, cardDoor(who.id), [who.id]);
    return sheet(rows.map((r) => L(ctx, 'advisor.k.delivery', { name, when: show.dayMonth(ctx.locale, r.due) })), [who.name ?? ''], cardDoor(who.id), { subjects: [who.id] });
  });
}

// ── F · Products ─────────────────────────────────────────────────────────────

/** F1 — the products and their STORED price tiers (never a new quote: the pricing engine is not called here). */
async function products(ctx: ReadCtx): Promise<Sheet> {
  const rows = await ro(ctx, async (tx) => (await sql<{ name: string; unit: string; min_qty: number | null; price: string | null; currency: string | null }>`
    select p.name, p.unit, t.min_qty, t.unit_price_usd::text as price, t.currency
      from products p left join price_tiers t on t.product_id = p.id
     where p.is_active and (${ctx.params.product}::text is null or position(lower(${ctx.params.product ?? ''}) in lower(p.name)) > 0)
     order by p.name, t.min_qty nulls first limit 80`.execute(tx)).rows);
  if (rows.length === 0) return ctx.params.product ? nothing('advisor.none.noSuchProduct', { name: ctx.params.product }, PRODUCTS) : nothing('advisor.none.products', undefined, PRODUCTS);
  const lines = rows.map((r) => {
    const m = r.price !== null && r.currency ? moneyOr(ctx, Number(r.price), r.currency) : null;
    return m ? L(ctx, 'advisor.k.tier', { name: r.name, min: r.min_qty === null ? '1' : show.count(ctx.locale, r.min_qty), unit: r.unit, price: m })
      : L(ctx, 'advisor.k.noPriceOne', { name: r.name });
  });
  return sheet(cap(ctx, lines, 25), rows.map((r) => r.name), PRODUCTS);
}

/** F2 — what sells best (new): the period's standing orders grouped by product (one product per order). */
async function bestSellers(ctx: ReadCtx): Promise<Sheet> {
  const range = rangeOf(ctx, 'month');
  return ro(ctx, async (tx) => {
    const zone = await zoneOf(tx, ctx.businessId);
    const start = await periodStart(tx, zone, range);
    const rows = (await sql<{ name: string; n: number; currency: string; sum: string }>`
      select p.name, count(*)::int as n, o.currency, coalesce(sum(o.total_value_usd), 0)::text as sum
        from orders o join products p on p.id = o.product_id
       where o.status = any(${[...SPEND_STATUSES]}::text[]) and coalesce(o.confirmed_at, o.created_at) >= ${start} and ${notOwnerTesting('o.conversation_id')}
       group by p.name, o.currency order by 2 desc, 4 desc limit 10`.execute(tx)).rows;
    if (rows.length === 0) return nothing(await everSoldTx(tx) ? 'advisor.none.salesPeriod' : 'advisor.none.salesNever', { period: L(ctx, `advisor.when.${range}`) }, resultsDoor(range));
    return sheet([periodLine(ctx, range, start, zone), ...rows.map((r) => L(ctx, 'advisor.k.seller', { name: r.name, n: count(ctx, r.n), amount: moneyOr(ctx, Number(r.sum), r.currency) ?? '' }))],
      rows.map((r) => r.name), PRODUCTS);
  });
}

/** F3 — what customers ask about most (new): the askedAbout sources (the identified product, a price worked out), across the workspace. */
async function mostAsked(ctx: ReadCtx): Promise<Sheet> {
  const range = rangeOf(ctx, 'month');
  return ro(ctx, async (tx) => {
    const zone = await zoneOf(tx, ctx.businessId);
    const start = await periodStart(tx, zone, range);
    const rows = (await sql<{ name: string; n: number }>`
      with asked as (
        select q.conversation_id, q.product_id from quotes q where q.created_at >= ${start} and ${notOwnerTesting('q.conversation_id')}
        union
        select cs.conversation_id, cs.identified_product_id from conversation_state cs
          join conversations c on c.id = cs.conversation_id and not c.owner_testing
         where cs.identified_product_id is not null and cs.last_message_at >= ${start}
      )
      select p.name, count(distinct a.conversation_id)::int as n from asked a join products p on p.id = a.product_id
       group by p.name order by 2 desc limit 10`.execute(tx)).rows;
    if (rows.length === 0) return nothing('advisor.none.asked', { period: L(ctx, `advisor.when.${range}`) }, PRODUCTS);
    return sheet([periodLine(ctx, range, start, zone), ...rows.map((r) => L(ctx, 'advisor.k.askedAbout', { name: r.name, n: count(ctx, r.n) }))], rows.map((r) => r.name), PRODUCTS);
  });
}

/** F4 — active products with no price tier (the insight's own rule). */
async function noPrice(ctx: ReadCtx): Promise<Sheet> {
  const rows = await ro(ctx, async (tx) => (await sql<{ name: string }>`
    select p.name from products p where p.is_active and not exists (select 1 from price_tiers t where t.product_id = p.id) order by p.name limit 40`.execute(tx)).rows);
  if (rows.length === 0) return nothing('advisor.none.noPrice', undefined, PRODUCTS);
  return sheet([L(ctx, 'advisor.k.noPrice', { n: count(ctx, rows.length), list: rows.map((r) => r.name).join(', ') })], rows.map((r) => r.name), PRODUCTS);
}

// ── G · The assistant ────────────────────────────────────────────────────────

/** G1 — the level in force: the assistant page's own reading (`aloneNow` on the same facts). */
async function alone(ctx: ReadCtx): Promise<Sheet> {
  return ro(ctx, async (tx) => {
    const caps = (await sql<{ capability: string; mode: 'auto' | 'draft' }>`select capability, mode from autonomy_policy order by capability`.execute(tx)).rows;
    const named = (await sql<{ at: Date | null }>`select assistant_named_at as at from onboarding_state limit 1`.execute(tx)).rows[0]?.at != null;
    const ramp = await rampState(tx, ctx.businessId);
    const now = aloneNow({
      capabilities: caps, released: autonomyReleased(), named, earned: ramp.rung >= 1, ...(ramp.gated ? { rung: ramp.rung } : {}),
      stopped: await assistantStopped(tx, ctx.businessId), silenced: (await loadKillSwitches(tx, ctx.businessId)).globalSilence,
    });
    const effective = levelOf(Object.fromEntries(caps.map((c) => [c.capability, now.alone.includes(c.capability) ? 'auto' : 'draft'])));
    const name = assistantName(ctx.locale);
    return sheet([
      effective ? L(ctx, 'advisor.k.level', { level: t(ctx.locale, `autonomy.level.${effective}` as MessageKey, { name }) }) : L(ctx, 'advisor.k.levelMixed', { n: count(ctx, now.alone.length) }),
      ...(now.hold ? [L(ctx, `advisor.k.hold.${now.hold}`, { name })] : []),
    ], [], ASSISTANT);
  });
}

async function handled(ctx: ReadCtx): Promise<Sheet> {
  const range = rangeOf(ctx, 'week');
  return ro(ctx, async (tx) => {
    const zone = await zoneOf(tx, ctx.businessId);
    const start = await periodStart(tx, zone, range);
    const n = await handledCount(tx, ctx.businessId, start);
    if (n === 0) return nothing('advisor.none.handled', { period: L(ctx, `advisor.when.${range}`), name: assistantName(ctx.locale) }, resultsDoor(range));
    return sheet([periodLine(ctx, range, start, zone), L(ctx, 'advisor.k.handled', { n: count(ctx, n), name: assistantName(ctx.locale) })], [], resultsDoor(range));
  });
}

/** G3 — sent alone (`auto_sent`) against approved and edited by the owner (decided drafts), in the period (new). */
async function aloneVsApproved(ctx: ReadCtx): Promise<Sheet> {
  const range = rangeOf(ctx, 'week');
  return ro(ctx, async (tx) => {
    const zone = await zoneOf(tx, ctx.businessId);
    const start = await periodStart(tx, zone, range);
    const r = (await sql<{ alone: number; approved: number; edited: number }>`
      select (select count(*)::int from conversation_events e where e.type = 'auto_sent' and e.created_at >= ${start} and ${notOwnerTesting('e.conversation_id')}) as alone,
             (select count(*)::int from drafts d where d.status = 'approved' and d.decided_at >= ${start} and ${notOwnerTesting('d.conversation_id')}) as approved,
             (select count(*)::int from drafts d where d.status = 'edited' and d.decided_at >= ${start} and ${notOwnerTesting('d.conversation_id')}) as edited`.execute(tx)).rows[0]!;
    if (r.alone + r.approved + r.edited === 0) return nothing('advisor.none.sent', { period: L(ctx, `advisor.when.${range}`) }, resultsDoor(range));
    return sheet([periodLine(ctx, range, start, zone), L(ctx, 'advisor.k.sentAlone', { n: count(ctx, r.alone) }),
      L(ctx, 'advisor.k.approved', { n: count(ctx, r.approved) }), L(ctx, 'advisor.k.edited', { n: count(ctx, r.edited) })], [], resultsDoor(range));
  });
}

async function edits(ctx: ReadCtx): Promise<Sheet> {
  const range = rangeOf(ctx, 'week');
  const r = await results(ctx, range);
  if (r.employee.edits === 0) return nothing('advisor.none.edits', { period: L(ctx, `advisor.when.${range}`) }, resultsDoor(range));
  return sheet([periodSince(ctx, range, r.since), L(ctx, 'advisor.k.edits', { n: count(ctx, r.employee.edits) })], [], resultsDoor(range));
}

/** G5 — the questions without taught knowledge (`loadKnowledgeOps`). */
async function gaps(ctx: ReadCtx): Promise<Sheet> {
  const range = rangeOf(ctx, 'month');
  // The owner's own test questions are left out at the source (loadKnowledgeOps, the advisor batch).
  const k = await loadKnowledgeOps(ctx.db, String(ctx.businessId), range);
  if (k.gaps.length === 0) return nothing('advisor.none.gaps', { period: L(ctx, `advisor.when.${range}`) }, KNOWLEDGE);
  return sheet(cap(ctx, k.gaps.map((g) => L(ctx, 'advisor.k.gap', { question: g.question.slice(0, 160), n: count(ctx, g.count) })), 10), [], KNOWLEDGE);
}

/** G6 — why customers needed a person: the problem signals of the period, counted by reason. */
async function reasons(ctx: ReadCtx): Promise<Sheet> {
  const range = rangeOf(ctx, 'month');
  return ro(ctx, async (tx) => {
    const zone = await zoneOf(tx, ctx.businessId);
    const start = await periodStart(tx, zone, range);
    const rows = (await sql<{ kind: string; n: number }>`
      select s.kind, count(distinct s.conversation_id)::int as n from conversation_signals s
       where s.kind = any(${[...PROBLEM_SIGNAL_KINDS]}::text[]) and s.created_at >= ${start} and ${notOwnerTesting('s.conversation_id')}
       group by s.kind order by 2 desc`.execute(tx)).rows;
    if (rows.length === 0) return nothing('advisor.none.reasons', { period: L(ctx, `advisor.when.${range}`) }, WAITING);
    const said = (k: string): string => (messages[ctx.locale] as Record<string, string>)[`takeover.reason.${k}`] ?? k;
    return sheet([periodLine(ctx, range, start, zone), ...rows.map((r) => L(ctx, 'advisor.k.reason', { reason: said(r.kind), n: count(ctx, r.n) }))], [], WAITING);
  });
}

/** G7 — the replies sent alone that wait to be checked (Home's own count). */
async function checks(ctx: ReadCtx): Promise<Sheet> {
  const n = await ro(ctx, async (tx) => (await sql<{ n: number }>`
    select count(*)::int as n from spot_checks s where s.answered_at is null and ${notOwnerTesting('s.conversation_id')}`.execute(tx)).rows[0]!.n);
  return n === 0 ? nothing('advisor.none.checks', undefined, ASSISTANT) : sheet([L(ctx, 'advisor.k.checks', { n: count(ctx, n) })], [], { href: '/app/settings/assistant#spot-checks', label: 'nav.employee' });
}

/** G8 — the owner's Stop, the operator's pause, the allowance, billing (`assistantHold`). */
async function hold(ctx: ReadCtx): Promise<Sheet> {
  const h = await ro(ctx, (tx) => assistantHold(tx, ctx.businessId));
  return sheet([L(ctx, `advisor.k.held.${h ?? 'none'}`, { name: assistantName(ctx.locale) })], [], ASSISTANT);
}

// ── H · The business ─────────────────────────────────────────────────────────

/** H1 — the terms, the sample policy, How you sell's progress, the profile: each newest row, as stored. */
async function terms(ctx: ReadCtx): Promise<Sheet> {
  return ro(ctx, async (tx) => {
    const tt = (await sql<{ payment: string | null; incoterm: string | null }>`
      select payment_terms as payment, incoterm from trade_terms order by stated_at desc limit 1`.execute(tx)).rows[0];
    const sp = (await sql<{ price: string | null; currency: string | null; credited: boolean }>`
      select price_amount::text as price, currency, credited_on_first_order as credited from sample_policy order by stated_at desc limit 1`.execute(tx)).rows[0];
    const b = (await sql<{ location: string | null; description: string | null; contact_phone: string | null; contact_email: string | null }>`
      select location, description, contact_phone, contact_email from businesses where id = ${ctx.businessId}`.execute(tx)).rows[0];
    const sell = (await sql<{ answered: number; total: number }>`
      select count(*) filter (where state = 'answered')::int as answered, count(*)::int as total from selling_answers`.execute(tx)).rows[0];
    const sample = sp ? (sp.price !== null && sp.currency && Number(sp.price) > 0 ? moneyOr(ctx, Number(sp.price), sp.currency) : null) : null;
    const lines = [
      ...(tt?.payment ? [L(ctx, 'advisor.k.payment', { v: tt.payment })] : []),
      ...(tt?.incoterm ? [L(ctx, 'advisor.k.incoterm', { v: tt.incoterm })] : []),
      ...(sp ? [sample ? L(ctx, sp.credited ? 'advisor.k.sampleCredited' : 'advisor.k.samplePaid', { price: sample }) : L(ctx, 'advisor.k.sampleFree')] : []),
      ...(b?.location ? [L(ctx, 'advisor.k.location', { v: b.location })] : []),
      ...(b?.description ? [L(ctx, 'advisor.k.description', { v: b.description.slice(0, 300) })] : []),
      ...(sell && sell.total > 0 ? [L(ctx, 'advisor.k.howYouSell', { done: count(ctx, sell.answered), total: count(ctx, sell.total) })] : []),
    ];
    return lines.length === 0 ? nothing('advisor.none.terms', undefined, BUSINESS) : sheet(lines, [], BUSINESS);
  });
}

/** H2 — the hours as the owner wrote them (free text: Nomi cannot tell "open now" from it). */
async function hours(ctx: ReadCtx): Promise<Sheet> {
  const h = await ro(ctx, async (tx) => (await sql<{ v: string | null }>`select working_hours as v from businesses where id = ${ctx.businessId}`.execute(tx)).rows[0]?.v ?? null);
  return h && h.trim() ? sheet([L(ctx, 'advisor.k.hours', { v: h.trim().slice(0, 200) })], [], { href: '/app/settings/profile', label: 'settings.profile.title' })
    : nothing('advisor.none.hours', undefined, { href: '/app/settings/profile', label: 'settings.profile.title' });
}

/** H3 — what was taught: a product's facts, or how many each product and the business have. */
async function knowledge(ctx: ReadCtx): Promise<Sheet> {
  return ro(ctx, async (tx) => {
    if (ctx.params.product) {
      const rows = (await sql<{ name: string; fact: string }>`
        select p.name, k.content as fact from product_knowledge k join products p on p.id = k.product_id
         where position(lower(${ctx.params.product}) in lower(p.name)) > 0 and k.status = 'active' order by k.created_at desc limit 12`.execute(tx)).rows;
      if (rows.length === 0) return nothing('advisor.none.knowledgeOf', { name: ctx.params.product }, KNOWLEDGE);
      return sheet(rows.map((r) => L(ctx, 'advisor.k.fact', { name: r.name, fact: r.fact.slice(0, 200) })), rows.map((r) => r.name), KNOWLEDGE);
    }
    const rows = (await sql<{ name: string | null; n: number }>`
      select p.name, count(*)::int as n from product_knowledge k left join products p on p.id = k.product_id
       where k.status = 'active' group by p.name order by 2 desc limit 15`.execute(tx)).rows;
    if (rows.length === 0) return nothing('advisor.none.knowledge', undefined, KNOWLEDGE);
    return sheet(rows.map((r) => r.name ? L(ctx, 'advisor.k.facts', { name: r.name, n: count(ctx, r.n) }) : L(ctx, 'advisor.k.factsBusiness', { n: count(ctx, r.n) })),
      rows.map((r) => r.name ?? ''), KNOWLEDGE);
  });
}

/** Every read, by catalogue id (src/advisor/catalogue.ts). 50 in all: 37 grounded, 3 split, 8 new, 2 approved metrics. */
export const READS: Readonly<Record<string, (ctx: ReadCtx) => Promise<Sheet>>> = {
  A1: customersCount, A2: customersList, A3: customerAbout, A4: lastContact, A5: recentContacts, A6: newCustomers,
  A7: bestCustomers, A8: regulars, A10: channels,
  B1: waiting,
  B2: counted('advisor.k.reviewCount', 'advisor.none.review', WAITING, 'review'),
  B3: counted('advisor.k.handedCount', 'advisor.none.handed', WAITING, 'handed'),
  B4: counted('advisor.k.blockedCount', 'advisor.none.blocked', { href: '/app/inbox?filter=blocked', label: 'nav.inbox' }, 'blocked'),
  B5: conversations, B7: unanswered, B8: replyTimes,
  B9: counted('advisor.k.deletionCount', 'advisor.none.deletion', { href: '/app/inbox?filter=deletion', label: 'nav.inbox' }, 'deletion'),
  C1: (ctx) => attention(ctx, null, 'advisor.none.quiet'),
  C2: (ctx) => attention(ctx, 'quote', 'advisor.none.quietAfterPrice'),
  C3: (ctx) => attention(ctx, 'regular', 'advisor.none.regularsQuiet'),
  C4: async (ctx) => datedSheet(ctx, await dated(ctx, 14, null, (e) => e.kind === 'promise_follow_up' || e.kind === 'followup_due'), 'advisor.none.followUps'),
  D1: sales, D2: ordersByState, D3: ordersWaiting, D4: pricesSent, D5: averageOrder, D7: againstLastMonth, D8: salesAtRate, D11: orderByReference,
  E1: async (ctx) => {
    const days = rangeOf(ctx, 'week') === 'today' ? 0 : 6;
    return datedSheet(ctx, await dated(ctx, days, null), days === 0 ? 'advisor.none.today' : 'advisor.none.calendar');
  },
  E2: async (ctx) => {
    const soon = (await dated(ctx, 15, null)).slice(0, 4);
    return datedSheet(ctx, soon.length ? soon : (await dated(ctx, 90, null)).slice(0, 4), 'advisor.none.comingUp');
  },
  E3: async (ctx) => datedSheet(ctx, await dated(ctx, 90, 'samples', (e) => e.kind === 'sample_asked'), 'advisor.none.samples'),
  E4: async (ctx) => datedSheet(ctx, await dated(ctx, 14, 'negotiation', (e) => e.kind === 'reply_due' && e.detail.overdue === true), 'advisor.none.overdue', WAITING),
  E5: closures, E6: deliveryPromised,
  F1: products, F2: bestSellers, F3: mostAsked, F4: noPrice,
  G1: alone, G2: handled, G3: aloneVsApproved, G4: edits, G5: gaps, G6: reasons, G7: checks, G8: hold,
  H1: terms, H2: hours, H3: knowledge,
};

/** The workspace's customers' and products' names: an answer may name only those its facts carry. */
export async function knownNames(ctx: ReadCtx): Promise<readonly string[]> {
  return ro(ctx, async (tx) => (await sql<{ n: string }>`
    select display_name as n from clients where display_name is not null and length(display_name) >= 3
    union select name as n from products where length(name) >= 3 limit 5000`.execute(tx)).rows.map((r) => r.n));
}
