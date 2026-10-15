import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { zoneOf } from './zone.js';

/**
 * 0162 — each workspace numbers its own orders (the owner, 2026-10-15:
 * "Per-workspace numbering, no shared counter, no YW."). One count per
 * workspace and year, the year in the workspace's own time zone: 2026-0001,
 * 2026-0002 … 2027-0001.
 *
 * The count is raised inside the order's own transaction, so an order that
 * rolls back takes its number with it, and two orders at once in one
 * workspace wait for each other on the row. A reference already issued is
 * never rewritten.
 */

/** The year an order is numbered in: the workspace's calendar, not the server's. */
export function numberingYear(at: Date, zone: string): number {
  try {
    return Number(new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric' }).format(at));
  } catch {
    return at.getUTCFullYear();
  }
}

/** The year, then that year's count — four digits at least, more when the year needs them. */
export function formatOrderReference(year: number, n: number): string {
  return `${year}-${String(n).padStart(4, '0')}`;
}

/** The next reference in this workspace. Call it in the transaction that writes the order. */
export async function nextOrderReference(tx: Tx, businessId: BusinessId | string, at: Date = new Date()): Promise<string> {
  const year = numberingYear(at, await zoneOf(tx, businessId));
  const n = (await sql<{ n: number }>`
    insert into order_numbers as o (business_id, year, last_number)
    values (${businessId}::uuid, ${year}, 1)
    on conflict (business_id, year)
      do update set last_number = o.last_number + 1, updated_at = now()
    returning o.last_number as n`.execute(tx)).rows[0]?.n;
  if (!n) throw new Error('order_numbers: no number was issued');
  return formatOrderReference(year, n);
}
