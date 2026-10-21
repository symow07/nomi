import { sql } from 'kysely';
import type { Db, Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { readBuyerCounts } from './buyersList.js';
import { readAttention } from './inboxAttention.js';
import { SPEND_STATUSES } from './customerValue.js';
import { notOwnerTesting } from './handled.js';
import { zoneOf } from './zone.js';
import { isPositive, moneyFromRow, type Money } from '../core/types/money.js';
import { formatMoney } from '../core/owner/i18n/format.js';
import type { MorningFacts } from '../core/owner/morningSummary.js';

/**
 * Phase 2a (0150) — the morning summary's store: whose summary is due (claimed once per local day), the facts it
 * says, and what came of it. The words are core/owner/morningSummary.ts's; the way out is notify.ts's.
 */

export type DueSummary = { readonly businessId: string; readonly personId: string; readonly day: string };

/** The summaries due now, each claimed once (08:00 in the business's zone, outside the owner's quiet hours). */
export async function claimMorningSummaries(db: Db): Promise<DueSummary[]> {
  return (await sql<{ business_id: string; person_id: string; day: string }>`
    select business_id::text as business_id, person_id::text as person_id, day::text as day from claim_morning_summaries()`
    .execute(db)).rows.map((r) => ({ businessId: r.business_id, personId: r.person_id, day: r.day }));
}

export async function morningSummaryDone(db: Db, personId: string, day: string,
  outcome: 'sent' | 'nothing' | 'failed', way: 'email' | 'browser' | 'whatsapp' | null): Promise<void> {
  await sql`select morning_summary_done(${personId}::uuid, ${day}::date, ${outcome}, ${way})`.execute(db);
}

/**
 * What the summary says, inside the workspace (row security), as the owner sees it: how many wait for them (the
 * Buyers tab's own count), how many went quiet (Home's own rule, `readAttention`), and the orders confirmed in the
 * business's yesterday with their totals, one per currency — the owner's own tests left out, as everywhere.
 * Counts only: no customer's name leaves Nomi in it (core/owner/morningSummary.ts).
 */
export async function morningFacts(tx: Tx, businessId: BusinessId, ownerPersonId: string, now: Date): Promise<MorningFacts> {
  const waiting = (await readBuyerCounts(tx, ownerPersonId)).waiting;
  const quiet = (await readAttention(tx, now, ownerPersonId)).length;
  const zone = await zoneOf(tx, businessId);
  const sold = (await sql<{ currency: string; n: number; val: string }>`
    select o.currency, count(*)::int as n, coalesce(sum(o.total_value_usd), 0)::numeric::text as val
      from orders o
     where o.status = any(${[...SPEND_STATUSES]}::text[])
       and coalesce(o.confirmed_at, o.created_at) >= (date_trunc('day', ${now}::timestamptz at time zone ${zone}) - interval '1 day') at time zone ${zone}
       and coalesce(o.confirmed_at, o.created_at) < date_trunc('day', ${now}::timestamptz at time zone ${zone}) at time zone ${zone}
       and ${notOwnerTesting('o.conversation_id')}
     group by o.currency order by 3 desc`.execute(tx)).rows;
  const totals = sold.map((r) => moneyFromRow(r.val, r.currency))
    .filter((m): m is Money => m !== null && isPositive(m)).map(formatMoney);
  return {
    waiting,
    quiet,
    sold: { n: sold.reduce((s, r) => s + r.n, 0), totals },
  };
}

/** The owner's switch and quiet hours, for Notifications. */
export type MorningSetting = { readonly on: boolean; readonly quietFrom: number | null; readonly quietUntil: number | null };

export async function morningSetting(tx: Tx, businessId: BusinessId): Promise<MorningSetting | null> {
  const r = (await sql<{ morning_summary: boolean; quiet_from: number | null; quiet_until: number | null }>`
    select morning_summary, quiet_from, quiet_until from people
     where business_id = ${businessId} and is_owner and archived_at is null order by created_at limit 1`.execute(tx)).rows[0];
  return r ? { on: r.morning_summary, quietFrom: r.quiet_from, quietUntil: r.quiet_until } : null;
}

export async function saveMorningSetting(tx: Tx, businessId: BusinessId, s: MorningSetting): Promise<boolean> {
  const r = await sql<{ id: string }>`
    update people set morning_summary = ${s.on}, quiet_from = ${s.quietFrom}, quiet_until = ${s.quietUntil}
     where business_id = ${businessId} and is_owner and archived_at is null
    returning id::text as id`.execute(tx);
  return r.rows.length > 0;
}
