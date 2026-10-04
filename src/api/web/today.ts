import { sql } from 'kysely';
import { withTenantTx, type Db, type Tx } from '../../db/client.js';
import { parseBusinessId, type BusinessId } from '../../core/types/ids.js';
import { connectedChannels, BUYER_CHANNELS, type BuyerChannel } from '../../db/connectedChannels.js';
import { zoneOf } from '../../db/zone.js';
import { faceVersions } from '../../db/faces.js';
import { SPEND_STATUSES } from '../../db/customerValue.js';
import { PRICE_GIVEN } from '../../db/quotesGiven.js';
import { ownershipOf } from '../../core/conversation/ownership.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import { loadInboxList, needsWhy, rowState, channelName, type ConversationSummary } from './inbox.js';
import { t, tn } from './say.js';
import { esc, conversationUrl, signalMark } from './layout.js';
import { face, faceLink, type FaceOf } from './faces.js';
import * as show from './values.js';
import { GO } from './icons.js';
import { agentMark } from './agentMark.js';

/**
 * THE WARMTH RUN, PHASE 2 (2026-10-03) — TODAY IN THREE ZONES. The owner's
 * verdict that started the run: "the Today page does not make it obvious what
 * Nomi actually does." So, top to bottom:
 *
 *   1. WHO WAITS FOR YOU — a thin band. The customers who need the owner now,
 *      the Inbox's own "Needs you" in the Inbox's own order (`loadInboxList`,
 *      `needsOwnerFor`): a face (the profile card's door), the name, one line
 *      of why (the Inbox's words, `needsWhy`), the name and the line a door to
 *      the conversation at its newest message. It carries the waiting signal's
 *      magenta and its ○. Nobody waiting: a calm, warm line, never a grey box.
 *   2. WHAT THE ASSISTANT HANDLED — the hero. A headline with the assistant's
 *      chosen name, then a row of customers' faces, each with one word.
 *   3. THE DAY'S THREE FIGURES — orders confirmed, quotes sent, answered after
 *      hours. Small, calm, ink only.
 *
 * Everything here is read from rows the product already keeps; nothing is
 * scored, ranked by a formula or summarised. "Today" is the workspace's own
 * day, in its own time zone (`zoneOf`), from local midnight.
 */

/** How many people the band names before it points at the Inbox. */
export const TODAY_PEOPLE = 5;
/**
 * How many faces the hero row draws. Past this the row ends in one tile, "+N
 * more", to the Inbox: a day of 200 customers draws 60 faces, never 200.
 */
const TODAY_FACES = 60;

/**
 * "After hours", in the workspace's own time. The product keeps the business's
 * working hours as free text only (`businesses.working_hours`, "Mon–Sat 9–18",
 * 周一至周六), which nothing can read reliably; the autonomy windows
 * (`autonomy_policy.time_window`) say when the assistant may send alone, not
 * when the business is open. So, decided for this page: a reply the assistant
 * sent before 08:00 or from 20:00 on, local time, was sent after hours.
 */
const OPEN_HOUR = 8;
const CLOSE_HOUR = 20;

/** The one word under a face: the strongest thing that happened in that conversation today. */
export type HandledWord = 'confirmed' | 'quoted' | 'handed' | 'answered';
export type HandledFace = FaceOf & { readonly conversationId: string; readonly word: HandledWord };

export type TodayData = {
  readonly now: Date;
  /** The Inbox's "Needs you": how many in all, and the first few rows. */
  readonly needs: {
    readonly total: number;
    readonly rows: readonly ConversationSummary[];
    /** Each named row's face, by conversation. A row absent here draws its initial, with no card to open. */
    readonly faces?: Readonly<Record<string, FaceOf>>;
  };
  /** Conversations a reply the assistant wrote went out in today: how many, and the faces drawn (at most 60). Absent: none. */
  readonly handled?: { readonly total: number; readonly people: readonly HandledFace[] };
  /** Today's three figures. Absent: all three zero. */
  readonly tally?: { readonly orders: number; readonly quotes: number; readonly afterHours: number };
  /** The channels customers can reach this workspace on. */
  readonly sending: readonly BuyerChannel[];
};

export const NOTHING_TODAY = (now: Date): TodayData => ({
  now, needs: { total: 0, rows: [] }, handled: { total: 0, people: [] }, tally: { orders: 0, quotes: 0, afterHours: 0 }, sending: [],
});

/** Midnight today in the workspace's zone, as an instant. */
async function dayStart(tx: Tx, zone: string, now: Date): Promise<Date> {
  return (await sql<{ s: Date }>`
    select (date_trunc('day', ${now}::timestamptz at time zone ${zone}) at time zone ${zone}) as s`.execute(tx)).rows[0]!.s;
}

/**
 * The hero's people. "Handled" is a conversation in which a reply the
 * assistant wrote went out today: sent alone, or approved or edited by the
 * owner (`outbound_messages.origin = 'employee'`, a sent status — the Results
 * page's and the customer panel's own reading of the sent rows). Its word, the
 * strongest first:
 *
 *   confirmed  an order of this conversation that stands (`SPEND_STATUSES`,
 *              the customer-value definition) was confirmed today;
 *   quoted     a price was worked out today before the assistant's last reply
 *              went out, so a reply carried it;
 *   handed     it was handed over today and a person has it now (the ONE
 *              ownership model reads `assigned_to`);
 *   answered   otherwise.
 *
 * Ordered by that strength, then the newest first, so the 60 drawn of a busy
 * day are the orders and the quotes.
 */
async function readHandled(tx: Tx, B: BusinessId, start: Date): Promise<NonNullable<TodayData['handled']>> {
  const rows = (await sql<{
    conversation_id: string; client_id: string | null; name: string | null; assigned_to: string | null;
    confirmed: boolean; quoted: boolean; handed: boolean; total: number;
  }>`
    with sent as (
      select o.conversation_id, max(o.sent_at) as last_at
        from outbound_messages o
       where o.business_id = ${B} and o.origin = 'employee'
         and o.status in ('sent', 'delivered', 'read') and o.sent_at >= ${start}
       group by o.conversation_id
    ), handled as (
      select s.conversation_id, s.last_at, c.client_id, c.assigned_to, cl.display_name as name,
             exists (select 1 from orders r where r.conversation_id = s.conversation_id
                      and r.status = any(${[...SPEND_STATUSES]}::text[])
                      and coalesce(r.confirmed_at, r.created_at) >= ${start}) as confirmed,
             exists (select 1 from quotes q where q.conversation_id = s.conversation_id
                      and q.created_at >= ${start} and q.created_at <= s.last_at) as quoted,
             exists (select 1 from conversation_events e where e.conversation_id = s.conversation_id
                      and e.type = 'handoff' and e.created_at >= ${start}) as handed
        from sent s
        join conversations c on c.id = s.conversation_id
        left join clients cl on cl.id = c.client_id
    )
    select conversation_id::text as conversation_id, client_id::text as client_id, name, assigned_to,
           confirmed, quoted, handed, (count(*) over ())::int as total
      from handled
     order by (case when confirmed then 0 when quoted then 1 else 2 end), last_at desc, conversation_id desc
     limit ${TODAY_FACES}`.execute(tx)).rows;
  const photos = await faceVersions(tx, rows.flatMap((r) => (r.client_id ? [r.client_id] : [])));
  return {
    total: rows[0]?.total ?? 0,
    people: rows.map((r): HandledFace => ({
      conversationId: r.conversation_id,
      // A conversation with no customer row is drawn by its own id, and opens no card.
      clientId: r.client_id ?? r.conversation_id,
      name: r.name,
      photo: r.client_id ? photos.get(r.client_id) ?? null : null,
      word: r.confirmed ? 'confirmed' : r.quoted ? 'quoted'
        : r.handed && ownershipOf(r.assigned_to) !== 'AI' ? 'handed' : 'answered',
    })),
  };
}

/**
 * Today's three figures, in the workspace's day.
 *   orders      orders that stand (`SPEND_STATUSES`) confirmed today;
 *   quotes      prices worked out today that were GIVEN (`PRICE_GIVEN`,
 *               `quotesGiven.ts` — not held back, and a line left after it):
 *               a price nobody sent is not "sent". Results and the calendar
 *               count by the same rule (phase 9, w4-customers-20);
 *   afterHours  conversations the assistant answered outside 08:00–20:00 local
 *               time (`OPEN_HOUR`, `CLOSE_HOUR`).
 */
async function readTally(tx: Tx, B: BusinessId, zone: string, start: Date): Promise<NonNullable<TodayData['tally']>> {
  const r = (await sql<{ orders: number; quotes: number; after_hours: number }>`
    select
      (select count(*)::int from orders r
        where r.business_id = ${B} and r.status = any(${[...SPEND_STATUSES]}::text[])
          and coalesce(r.confirmed_at, r.created_at) >= ${start}) as orders,
      (select count(*)::int from quotes q
        where q.business_id = ${B} and q.created_at >= ${start} and ${PRICE_GIVEN}) as quotes,
      (select count(distinct o.conversation_id)::int from outbound_messages o
        where o.business_id = ${B} and o.origin = 'employee'
          and o.status in ('sent', 'delivered', 'read') and o.sent_at >= ${start}
          and (extract(hour from (o.sent_at at time zone ${zone})) < ${OPEN_HOUR}::int
            or extract(hour from (o.sent_at at time zone ${zone})) >= ${CLOSE_HOUR}::int)) as after_hours`
    .execute(tx)).rows[0]!;
  return { orders: r.orders, quotes: r.quotes, afterHours: r.after_hours };
}

/** The band's faces: each row's customer and their photo's version, by conversation. */
async function facesOf(tx: Tx, conversationIds: readonly string[]): Promise<Record<string, FaceOf>> {
  if (conversationIds.length === 0) return {};
  const rows = (await sql<{ id: string; client_id: string; name: string | null }>`
    select c.id::text as id, c.client_id::text as client_id, cl.display_name as name
      from conversations c left join clients cl on cl.id = c.client_id
     where c.id = any(${[...conversationIds]}::uuid[]) and c.client_id is not null`.execute(tx)).rows;
  const photos = await faceVersions(tx, rows.map((r) => r.client_id));
  return Object.fromEntries(rows.map((r) => [r.id, { clientId: r.client_id, name: r.name, photo: photos.get(r.client_id) ?? null }]));
}

export async function loadToday(db: Db, businessId: string, viewerId: string | undefined, now: Date): Promise<TodayData> {
  const bid = parseBusinessId(businessId);
  if (!bid.ok) return NOTHING_TODAY(now);
  const B = bid.value;
  const [needs, day] = await Promise.all([
    loadInboxList(db, businessId, 'pending', viewerId),
    withTenantTx(db, B, async (tx) => {
      const zone = await zoneOf(tx, B);
      const start = await dayStart(tx, zone, now);
      return {
        channels: await connectedChannels(tx, B),
        handled: await readHandled(tx, B, start),
        tally: await readTally(tx, B, zone, start),
      };
    }),
  ]);
  const rows = needs.conversations.slice(0, TODAY_PEOPLE);
  const faces = rows.length === 0 ? {} : await withTenantTx(db, B, (tx) => facesOf(tx, rows.map((r) => r.conversationId)));
  return {
    now,
    needs: { total: needs.waitingCount, rows, faces },
    handled: day.handled,
    tally: day.tally,
    sending: BUYER_CHANNELS.filter((c) => day.channels[c]),
  };
}

// ── 1 · who waits for you ────────────────────────────────────────────────────

/**
 * One person in the band: their face (the card's door), and their name over
 * the one line of why — the Inbox's words — the two a door to the
 * conversation at its newest message. A conversation the owner holds says so
 * in words ("You are handling"), as the Inbox says it under its heading.
 */
function waitingItem(locale: Locale, c: ConversationSummary, who: FaceOf | undefined): string {
  const name = c.buyer ?? t(locale, 'common.buyer');
  const why = rowState(c) === 'yours' ? t(locale, 'buyers.group.yours') : needsWhy(locale, c);
  const theFace = who
    ? faceLink(who, { size: 's', label: name, className: 'tw-face' })
    : `<span class="tw-face">${face({ clientId: c.conversationId, name: c.buyer }, 's')}</span>`;
  return `<li class="tw-item">${theFace}<a class="tw-go" href="${conversationUrl(c.conversationId)}">`
    + `<span class="tw-who"><span class="tw-name" dir="auto"><bdi>${esc(name)}</bdi></span>`
    + `<span class="tw-why"><bdi>${esc(why)}</bdi></span></span>`
    + `${GO}</a></li>`;
}

/** The band's heading: the waiting count in the waiting signal's colour, with its ○. */
export function waitingHead(locale: Locale, total: number): string {
  return `<h2 id="today-now" class="tw-head"><span class="tw-need">${signalMark('waiting')} ${esc(tn(locale, 'today.waiting', total))}</span></h2>`;
}

/** The people, the first few by name, in the Inbox's order. */
export function renderWaitingPeople(d: TodayData, locale: Locale): string {
  if (d.needs.rows.length === 0) return '';
  return `<ul class="tw-list">${d.needs.rows.map((c) => waitingItem(locale, c, d.needs.faces?.[c.conversationId])).join('')}</ul>`;
}

// ── 2 · what the assistant handled ───────────────────────────────────────────

const WORD: Readonly<Record<HandledWord, MessageKey>> = {
  confirmed: 'today.word.confirmed', quoted: 'today.word.quoted', handed: 'today.word.handed', answered: 'today.word.answered',
};

/**
 * The name under a face: the first word of the customer's name, so two
 * customers drawn as the same initial (WhatsApp gives no photo) are told
 * apart without opening a card (phase 9, w4-today-setup-03). A name in a
 * script written without spaces is whole.
 */
export const shortName = (name: string): string => name.trim().split(/\s+/u)[0] ?? name;

/**
 * The hero: the headline in the assistant's chosen name (rule 7: "your
 * assistant" until one is chosen), then the faces — each the profile card's
 * door, the customer's name and one word of what happened under it — in a row
 * that scrolls sideways (from the right in Arabic) and fades at its end to say
 * so. Past 60 the row ends in one tile that says how many more; it opens
 * nothing, because no list singles out the others (phase 9,
 * w4-today-setup-04). Nothing handled: the fact, in a sentence; no empty row.
 */
export function renderHandled(d: TodayData, locale: Locale, o: { readonly ready: boolean }): string {
  const h = d.handled ?? { total: 0, people: [] };
  if (h.total === 0 || h.people.length === 0) {
    return `<h2 id="today-done" class="td-head">${esc(t(locale, 'today.handled.none'))}</h2>${
      o.ready ? `<p class="td-ready">${agentMark(16, 'rest', 'am as')} ${esc(t(locale, 'today.handled.ready'))}</p>` : ''}`;
  }
  const drawn = h.people.slice(0, TODAY_FACES);
  const faces = drawn.map((p) => {
    const word = t(locale, WORD[p.word]);
    const name = p.name ?? t(locale, 'common.buyer');
    return `<li>${faceLink(p, {
      size: 'l', className: 'td-face',
      label: `${name}${locale === 'zh' ? '：' : ': '}${word}`,
      // The name's own direction, from its own letters (no inner <bdi>, which `dir="auto"` would skip).
      after: `<span class="td-name" dir="auto">${esc(shortName(name))}</span><span class="td-word">${esc(word)}</span>`,
    })}</li>`;
  }).join('');
  const rest = h.total - drawn.length;
  const more = rest > 0
    ? `<li><span class="td-more"><span class="td-plus"><bdi>+${esc(show.count(locale, rest))}</bdi></span>`
      + `<span class="td-word">${esc(t(locale, 'today.handled.more'))}</span></span></li>`
    : '';
  return `<h2 id="today-done" class="td-head">${agentMark(28, 'rest', 'am as', 'bold')} ${esc(tn(locale, 'today.handled.title', h.total))}</h2>
    <ul class="td-row">${faces}${more}</ul>`;
}

/** Which channels send, or that sending is paused — one line, the channels named. */
export function renderSending(d: TodayData, locale: Locale, paused: boolean): string {
  if (d.sending.length === 0) return '';
  const state = t(locale, paused ? 'today.sending.paused' : 'today.sending.on');
  const each = d.sending.map((c) => `${esc(channelName(locale, c))} ${signalMark(paused ? 'waiting' : 'ok')} ${esc(state)}`);
  return `<p class="today-foot"><span class="muted">${esc(t(locale, 'today.sending'))}</span> ${each.join(' · ')}</p>`;
}

// ── 3 · the day's three figures ──────────────────────────────────────────────

/** Three figures, each with its word: a fact each, in ink — no percentage, no trend, no colour. */
export function renderTally(d: TodayData, locale: Locale): string {
  const n = d.tally ?? { orders: 0, quotes: 0, afterHours: 0 };
  const one = (v: number, key: string): string =>
    `<li><span class="tt-n">${show.count(locale, v)}</span><span class="tt-l">${esc(tn(locale, key, v))}</span></li>`;
  return `<h2 id="today-tally" class="tt-head">${esc(t(locale, 'today.tally.title'))}</h2>
    <ul class="tt-row">${one(n.orders, 'today.tally.orders')}${one(n.quotes, 'today.tally.quotes')}${one(n.afterHours, 'today.tally.late')}</ul>`;
}
