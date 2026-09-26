import { sql } from 'kysely';
import { withTenantTx, type Db, type Tx } from './client.js';
import { parseBusinessId, type BusinessId } from '../core/types/ids.js';
import { type Money, moneyFromRow } from '../core/types/money.js';
import { closureDate } from '../core/commerce/closures.js';
import { addDays, dayKey, dayStart } from '../core/owner/i18n/format.js';

/**
 * V2 — the calendar: a timeline over dates the data ALREADY holds.
 *
 * A view, not a data model. Nothing here writes, schedules or stores; every
 * entry is one column of one existing row, and carries the row it came from
 * (`source`), so the page can say where each line is written down. What does
 * not exist — a promised ship date, a sample deadline — is not shown, and not
 * estimated: a date on this page is a date somebody recorded (ROADMAP §3, no
 * invented numbers).
 *
 * `conversation_state.last_message_at` is left out on purpose: every message
 * moves it, so on a calendar it is noise that buries the dates that matter.
 * The Buyers list already orders by it.
 *
 * Every read is inside one `withTenantTx`, and every query also names the
 * business, so isolation does not rest on a single mechanism.
 */

export const CALENDAR_CATEGORIES = ['samples', 'orders', 'negotiation', 'followups', 'closures', 'conversations'] as const;
export type CalendarCategory = typeof CALENDAR_CATEGORIES[number];

/** What an entry says happened, or is due. Each names exactly one column. */
export type CalendarKind =
  | 'sample_asked' | 'sample_handled'
  | 'order_state'
  | 'price_worked_out' | 'reply_due'
  | 'followup_due'
  | 'closure'
  | 'conversation_closed';

/** The row and column an entry was read from. Provenance, not a summary. */
export type CalendarSource = { readonly table: string; readonly id: string; readonly column: string };

export type CalendarBuyer = { readonly id: string; readonly name: string | null; readonly country: string | null };

export type CalendarEntry = {
  readonly category: CalendarCategory;
  readonly kind: CalendarKind;
  /** The business-timezone day it sits under. */
  readonly day: string;
  /** The recorded instant; for an all-day entry, the start of `day`. */
  readonly at: Date;
  readonly allDay: boolean;
  readonly conversationId: string | null;
  /** Set for order entries: the order page is the better door. */
  readonly orderId: string | null;
  /** Null for a closure, which belongs to the whole business. */
  readonly buyer: CalendarBuyer | null;
  /** Shown when no buyer row exists — a follow-up to an address not yet in a conversation. */
  readonly identity: string | null;
  readonly detail: {
    readonly orderReference?: string;
    readonly orderState?: string;
    readonly trackingReference?: string | null;
    readonly price?: Money;
    readonly quantity?: number;
    readonly sequenceName?: string;
    readonly closureLabel?: string;
    readonly closureFrom?: string;
    readonly closureTo?: string;
    /** A sample request nobody has dealt with yet. */
    readonly open?: boolean;
    /** A reply owed whose time has already passed — said in words, not colour. */
    readonly overdue?: boolean;
  };
  readonly source: CalendarSource;
};

export type CalendarQuery = {
  /** First day shown, 'YYYY-MM-DD', business timezone. */
  readonly from: string;
  /** First day NOT shown. */
  readonly to: string;
  readonly category: CalendarCategory | null;
  /** A client id. Unknown here (or another tenant's) reads as no filter. */
  readonly buyer: string | null;
  /** Follow-ups exist only where the outreach area is on (rule 8). */
  readonly outreach: boolean;
};

export type CalendarView = {
  readonly from: string;
  readonly to: string;
  readonly today: string;
  readonly category: CalendarCategory | null;
  readonly buyer: CalendarBuyer | null;
  /** The buyers with anything in this window — the choices for the filter. */
  readonly buyers: readonly CalendarBuyer[];
  /** The categories with anything in this window, for this buyer. */
  readonly categories: readonly CalendarCategory[];
  readonly entries: readonly CalendarEntry[];
};

/** order_updates also carries 'pending_confirmation', which the engine writes and the owner is never offered. */
const ORDER_STATES = ['confirmed', 'in_production', 'shipped', 'cancelled'] as const;

/** A page is three weeks; this is a guard against a pathological tenant, not a page size. */
const PER_SOURCE = 500;

const ymdOf = (v: unknown): string => closureDate(v).toISOString().slice(0, 10);

type BuyerCols = { client_id: string | null; buyer: string | null; country: string | null };
const buyerOf = (r: BuyerCols): CalendarBuyer | null =>
  r.client_id ? { id: r.client_id, name: r.buyer, country: r.country } : null;

async function read(tx: Tx, bid: BusinessId, q: CalendarQuery, now: Date): Promise<CalendarView> {
  const start = dayStart(q.from);
  const end = dayStart(q.to);
  const inWindow = (d: Date | null): d is Date => d !== null && d >= start && d < end;
  const out: CalendarEntry[] = [];
  const timed = (e: Omit<CalendarEntry, 'day' | 'allDay'>): void => {
    out.push({ ...e, day: dayKey(e.at), allDay: false });
  };

  // ── Samples: when they asked, and when she dealt with it.
  const samples = (await sql<BuyerCols & {
    id: string; conv: string; requested_at: Date; handled_at: Date | null;
  }>`
    select s.id::text as id, s.conversation_id::text as conv, s.requested_at, s.handled_at,
           cl.id::text as client_id, cl.display_name as buyer, cl.country
      from sample_requests s
      join conversations c on c.id = s.conversation_id and c.business_id = s.business_id
      left join clients cl on cl.id = c.client_id
     where s.business_id = ${bid}
       and ((s.requested_at >= ${start} and s.requested_at < ${end})
         or (s.handled_at >= ${start} and s.handled_at < ${end}))
     limit ${PER_SOURCE}`.execute(tx)).rows;
  for (const r of samples) {
    const base = { category: 'samples' as const, conversationId: r.conv, orderId: null, buyer: buyerOf(r), identity: null, detail: {} };
    if (inWindow(r.requested_at)) timed({ ...base, kind: 'sample_asked', at: r.requested_at, detail: { open: r.handled_at === null },
      source: { table: 'sample_requests', id: r.id, column: 'requested_at' } });
    if (inWindow(r.handled_at)) timed({ ...base, kind: 'sample_handled', at: r.handled_at,
      source: { table: 'sample_requests', id: r.id, column: 'handled_at' } });
  }

  // ── Orders: each state she recorded, from the order's own log.
  const updates = (await sql<BuyerCols & {
    id: string; order_id: string; state: string; tracking_reference: string | null; at: Date;
    order_reference: string; conv: string;
  }>`
    select u.id::text as id, u.order_id::text as order_id, u.state, u.tracking_reference, u.at,
           o.order_reference, o.conversation_id::text as conv,
           cl.id::text as client_id, cl.display_name as buyer, cl.country
      from order_updates u
      join orders o on o.id = u.order_id and o.business_id = u.business_id
      left join clients cl on cl.id = o.client_id
     where u.business_id = ${bid} and u.at >= ${start} and u.at < ${end}
       and u.state in (${sql.join([...ORDER_STATES])})
     order by u.at
     limit ${PER_SOURCE}`.execute(tx)).rows;
  for (const r of updates) {
    timed({ category: 'orders', kind: 'order_state', at: r.at, conversationId: r.conv, orderId: r.order_id,
      buyer: buyerOf(r), identity: null,
      detail: { orderReference: r.order_reference, orderState: r.state, trackingReference: r.tracking_reference },
      source: { table: 'order_updates', id: r.id, column: 'at' } });
  }
  // An order confirmed before its log existed, or whose log was never
  // written: `orders.confirmed_at` stands in. Where the log HAS a confirmed
  // entry, that entry is the one shown — the same fact is not listed twice.
  const confirmed = (await sql<BuyerCols & { id: string; order_reference: string; confirmed_at: Date; conv: string }>`
    select o.id::text as id, o.order_reference, o.confirmed_at, o.conversation_id::text as conv,
           cl.id::text as client_id, cl.display_name as buyer, cl.country
      from orders o
      left join clients cl on cl.id = o.client_id
     where o.business_id = ${bid} and o.confirmed_at >= ${start} and o.confirmed_at < ${end}
       and not exists (select 1 from order_updates u where u.order_id = o.id and u.state = 'confirmed')
     limit ${PER_SOURCE}`.execute(tx)).rows;
  for (const r of confirmed) {
    timed({ category: 'orders', kind: 'order_state', at: r.confirmed_at, conversationId: r.conv, orderId: r.id,
      buyer: buyerOf(r), identity: null,
      detail: { orderReference: r.order_reference, orderState: 'confirmed', trackingReference: null },
      source: { table: 'orders', id: r.id, column: 'confirmed_at' } });
  }

  // ── Negotiation: a price worked out, and a reply a person owes.
  // A quote is recorded on every turn that priced something, so a buyer who
  // asks the same thing four times in an afternoon makes four identical rows.
  // One line per distinct figure per conversation per day — the latest row,
  // which is the one named as the source.
  const quotes = (await sql<BuyerCols & {
    id: string; conv: string; created_at: Date; quantity: number; unit_price_usd: string; currency: string;
  }>`
    select q.id::text as id, q.conversation_id::text as conv, q.created_at, q.quantity,
           q.unit_price_usd::text as unit_price_usd, q.currency,
           cl.id::text as client_id, cl.display_name as buyer, cl.country
      from quotes q
      join conversations c on c.id = q.conversation_id and c.business_id = q.business_id
      left join clients cl on cl.id = c.client_id
     where q.business_id = ${bid} and q.created_at >= ${start} and q.created_at < ${end}
     order by q.created_at desc
     limit ${PER_SOURCE}`.execute(tx)).rows;
  const seenQuote = new Set<string>();
  for (const r of quotes) {
    const price = moneyFromRow(Number(r.unit_price_usd), r.currency);
    if (price === null) continue;
    const key = `${r.conv}|${dayKey(r.created_at)}|${r.quantity}|${r.unit_price_usd}|${r.currency}`;
    if (seenQuote.has(key)) continue;
    seenQuote.add(key);
    timed({ category: 'negotiation', kind: 'price_worked_out', at: r.created_at, conversationId: r.conv, orderId: null,
      buyer: buyerOf(r), identity: null, detail: { price, quantity: r.quantity },
      source: { table: 'quotes', id: r.id, column: 'created_at' } });
  }
  const handoffs = (await sql<BuyerCols & { id: string; conv: string; sla_deadline_at: Date }>`
    select h.id::text as id, h.conversation_id::text as conv, h.sla_deadline_at,
           cl.id::text as client_id, cl.display_name as buyer, cl.country
      from handoffs h
      join conversations c on c.id = h.conversation_id and c.business_id = h.business_id
      left join clients cl on cl.id = c.client_id
     where h.business_id = ${bid} and h.released_at is null
       and h.sla_deadline_at >= ${start} and h.sla_deadline_at < ${end}
     limit ${PER_SOURCE}`.execute(tx)).rows;
  for (const r of handoffs) {
    timed({ category: 'negotiation', kind: 'reply_due', at: r.sla_deadline_at, conversationId: r.conv, orderId: null,
      buyer: buyerOf(r), identity: null, detail: { overdue: r.sla_deadline_at.getTime() < now.getTime() },
      source: { table: 'handoffs', id: r.id, column: 'sla_deadline_at' } });
  }

  // ── Follow-ups: the next step of a live sequence. The outreach area only.
  if (q.outreach) {
    const due = (await sql<BuyerCols & {
      id: string; conv: string | null; next_due_at: Date; identity: string; sequence: string; contact: string | null;
    }>`
      select e.id::text as id, e.conversation_id::text as conv, e.next_due_at, e.identity, s.name as sequence,
             cl.id::text as client_id, cl.display_name as buyer, cl.country,
             (select ct.display_name from contacts ct
               where ct.business_id = e.business_id and ct.channel = 'email'
                 and ct.identity = e.identity and ct.archived_at is null
               limit 1) as contact
        from sequence_enrollments e
        join sequences s on s.id = e.sequence_id and s.business_id = e.business_id and s.archived_at is null
        left join conversations c on c.id = e.conversation_id and c.business_id = e.business_id
        left join clients cl on cl.id = c.client_id
       where e.business_id = ${bid} and e.stopped_at is null and e.completed_at is null
         and e.next_due_at >= ${start} and e.next_due_at < ${end}
       limit ${PER_SOURCE}`.execute(tx)).rows;
    for (const r of due) {
      timed({ category: 'followups', kind: 'followup_due', at: r.next_due_at,
        conversationId: r.client_id ? r.conv : null, orderId: null,
        buyer: buyerOf(r), identity: r.contact ?? r.identity, detail: { sequenceName: r.sequence },
        source: { table: 'sequence_enrollments', id: r.id, column: 'next_due_at' } });
    }
  }

  // ── Closures: the whole business, all day. Listed once, on the first day of
  // it that falls in the window, with its full span in the line.
  const closures = (await sql<{ id: string; label: string; starts_on: unknown; ends_on: unknown }>`
    select f.id::text as id, f.label, f.starts_on, f.ends_on
      from factory_closures f
     where f.business_id = ${bid} and f.archived_at is null
       and f.starts_on <= ${addDays(q.to, -1)}::date and f.ends_on >= ${q.from}::date
     limit ${PER_SOURCE}`.execute(tx)).rows;
  for (const r of closures) {
    const from = ymdOf(r.starts_on);
    const to = ymdOf(r.ends_on);
    const day = from < q.from ? q.from : from;
    out.push({ category: 'closures', kind: 'closure', day, at: dayStart(day), allDay: true,
      conversationId: null, orderId: null, buyer: null, identity: null,
      detail: { closureLabel: r.label, closureFrom: from, closureTo: to },
      source: { table: 'factory_closures', id: r.id, column: 'starts_on' } });
  }

  // ── Conversations: when one was closed.
  const closed = (await sql<BuyerCols & { id: string; closed_at: Date }>`
    select c.id::text as id, c.closed_at, cl.id::text as client_id, cl.display_name as buyer, cl.country
      from conversations c
      left join clients cl on cl.id = c.client_id
     where c.business_id = ${bid} and c.closed_at >= ${start} and c.closed_at < ${end}
     limit ${PER_SOURCE}`.execute(tx)).rows;
  for (const r of closed) {
    timed({ category: 'conversations', kind: 'conversation_closed', at: r.closed_at, conversationId: r.id, orderId: null,
      buyer: buyerOf(r), identity: null, detail: {},
      source: { table: 'conversations', id: r.id, column: 'closed_at' } });
  }

  // ── The filters. Buyers and categories are offered from what is here.
  const buyers = new Map<string, CalendarBuyer>();
  for (const e of out) if (e.buyer && !buyers.has(e.buyer.id)) buyers.set(e.buyer.id, e.buyer);
  let buyer: CalendarBuyer | null = q.buyer ? buyers.get(q.buyer) ?? null : null;
  if (q.buyer && !buyer) {
    // A buyer with nothing in THIS window is still a buyer: the filter holds
    // while she pages. Read through RLS, so another tenant's id finds nothing
    // and the filter simply falls away.
    const r = (await sql<{ id: string; buyer: string | null; country: string | null }>`
      select cl.id::text as id, cl.display_name as buyer, cl.country
        from clients cl where cl.business_id = ${bid} and cl.id = ${q.buyer}::uuid`.execute(tx)).rows[0];
    if (r) buyer = { id: r.id, name: r.buyer, country: r.country };
  }
  const chosen = buyer;
  const forBuyer = chosen ? out.filter((e) => e.buyer?.id === chosen.id) : out;
  const present = new Set(forBuyer.map((e) => e.category));
  const order = (e: CalendarEntry): number => CALENDAR_CATEGORIES.indexOf(e.category);
  const entries = forBuyer
    .filter((e) => q.category === null || e.category === q.category)
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)
      || Number(b.allDay) - Number(a.allDay)
      || a.at.getTime() - b.at.getTime()
      || order(a) - order(b));

  return {
    from: q.from, to: q.to, today: dayKey(now), category: q.category, buyer,
    buyers: [...buyers.values()].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
    categories: CALENDAR_CATEGORIES.filter((c) => present.has(c)),
    entries,
  };
}

export async function loadCalendar(db: Db, businessIdRaw: string, q: CalendarQuery, now: Date): Promise<CalendarView> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) {
    return { from: q.from, to: q.to, today: dayKey(now), category: q.category, buyer: null, buyers: [], categories: [], entries: [] };
  }
  return withTenantTx(db, bid.value, (tx) => read(tx, bid.value, q, now));
}
