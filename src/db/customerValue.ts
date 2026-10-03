import { sql } from 'kysely';
import type { Tx } from './client.js';
import { type Money, moneyFromRow } from '../core/types/money.js';

/**
 * THE WARMTH RUN (2026-10-03) — WHAT A CUSTOMER IS WORTH TO THE BUSINESS, and
 * who is a regular. One place, read by the Inbox's rows and its "matters most"
 * lens, the profile card, the conversation's catch-up strip and the Inbox's
 * "needs attention" band, so no two of them can disagree.
 *
 * SPENT is the sum of their orders that stand: confirmed, in production or
 * shipped. A cancelled order, and the old "pending confirmation" state nobody
 * records any more, count for nothing. It is the headline number because this
 * business has customers who buy big once and customers who buy small often,
 * and spend is the only number comparable across both (the owner's words).
 *
 * A REGULAR is decided by Nomi, never tagged by the owner: three orders that
 * stand or more. (Decided by me, as the owner asked: two orders is a customer
 * who came back once; three is a habit.)
 *
 * A regular WHO HAS NOT ORDERED IN A WHILE: their last order is older than
 * twice the usual gap between their orders (the median, so one long pause
 * does not stretch it), and at least 30 days old — a regular who orders every
 * week is not "slipping" after ten quiet days.
 */

export const SPEND_STATUSES = ['confirmed', 'in_production', 'shipped'] as const;
export const REGULAR_ORDERS = 3;
export const QUIET_FLOOR_DAYS = 30;

export type CustomerValue = {
  readonly clientId: string;
  /** Their orders that stand, summed, in the currency of their newest order; null when they have none. */
  readonly spent: Money | null;
  readonly orders: number;
  readonly lastOrderAt: Date | null;
  readonly regular: boolean;
  /** For a regular who has not ordered in a while: when they last did. Null otherwise. */
  readonly quietSince: Date | null;
};

const DAY = 86_400_000;

/** Their value for each customer asked about; a customer with no order is there with nothing spent. */
export async function customerValues(tx: Tx, clientIds: readonly string[], now: Date = new Date()): Promise<ReadonlyMap<string, CustomerValue>> {
  const ids = [...new Set(clientIds)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const out = new Map<string, CustomerValue>();
  if (ids.length === 0) return out;
  const rows = (await sql<{ client_id: string; currency: string | null; spent: string | null; orders: number; last_at: Date | null; median_gap_days: number | null }>`
    with o as (
      select o.client_id, o.currency, o.total_value_usd, coalesce(o.confirmed_at, o.created_at) as at
        from orders o
       where o.client_id = any(${ids}::uuid[]) and o.status = any(${[...SPEND_STATUSES]}::text[])
    ), newest as (
      select distinct on (client_id) client_id, currency from o order by client_id, at desc
    ), gaps as (
      select client_id, extract(epoch from at - lag(at) over (partition by client_id order by at)) / 86400.0 as gap from o
    )
    select n.client_id::text as client_id, n.currency,
           (select sum(o.total_value_usd) from o where o.client_id = n.client_id and o.currency = n.currency)::text as spent,
           (select count(*)::int from o where o.client_id = n.client_id) as orders,
           (select max(o.at) from o where o.client_id = n.client_id) as last_at,
           (select percentile_cont(0.5) within group (order by g.gap) from gaps g where g.client_id = n.client_id and g.gap is not null)::float8 as median_gap_days
      from newest n`.execute(tx)).rows;
  for (const r of rows) {
    const spent = r.spent !== null && r.currency ? moneyFromRow(Number(r.spent), r.currency) : null;
    const regular = r.orders >= REGULAR_ORDERS;
    const quietAfterDays = Math.max(QUIET_FLOOR_DAYS, 2 * (r.median_gap_days ?? 0));
    const quiet = regular && r.last_at !== null && now.getTime() - r.last_at.getTime() > quietAfterDays * DAY;
    out.set(r.client_id, { clientId: r.client_id, spent, orders: r.orders, lastOrderAt: r.last_at, regular, quietSince: quiet ? r.last_at : null });
  }
  for (const id of ids) {
    if (!out.has(id)) out.set(id, { clientId: id, spent: null, orders: 0, lastOrderAt: null, regular: false, quietSince: null });
  }
  return out;
}
