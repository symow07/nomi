import { sql } from 'kysely';
import type { Tx } from './client.js';
import { readPromises, type PromiseKind } from '../core/conversation/promises.js';

/**
 * 0083 — WHAT A REPLY PROMISED, written when it LEFT (the design pass,
 * decided 2026-09-29). Called from the one place a message becomes sent — the
 * 'sent' transition, beside the line that copies the words onto the owner's
 * timeline — so a draft, a refused reply or a failed one promised nothing.
 * Once per sent row and promise (a re-read of the same row adds nothing).
 */
export async function notePromises(tx: Tx, outboundId: string, today: string): Promise<number> {
  const row = (await sql<{ business_id: string; conversation_id: string; body: string; origin: string }>`
    select business_id::text as business_id, conversation_id::text as conversation_id, body, origin
      from outbound_messages where id = ${outboundId}::uuid`.execute(tx)).rows[0];
  if (!row) return 0;
  // Reading the words can never cost the message its 'sent': a fault in the
  // reader is read as no promise. (What is inserted meets its constraints by
  // construction: a known kind, a real day, the sentence cut to 300.)
  let found: ReturnType<typeof readPromises> = [];
  try { found = readPromises(row.body, today); } catch { found = []; }
  let n = 0;
  for (const p of found) {
    const r = await sql`
      insert into promised_dates (business_id, conversation_id, outbound_id, kind, due_on, said, said_by)
      values (${row.business_id}::uuid, ${row.conversation_id}::uuid, ${outboundId}::uuid, ${p.kind}, ${p.day}::date, ${p.said},
              ${row.origin === 'owner' ? 'person' : 'assistant'})
      on conflict do nothing`.execute(tx);
    n += Number(r.numAffectedRows ?? 0);
  }
  return n;
}

/**
 * Audit batch 3 (B13, 2026-10-30) — A PROMISE TO GET BACK IS KEPT BY GETTING BACK. `kept_at` had no writer, so every
 * follow-up promised stayed owed — and, once its day passed, late — for good. Called from the same 'sent' transition,
 * AFTER this message's own promises are read: a later message that reaches the customer in that conversation keeps the
 * follow-ups promised before it — unless it promises to get back again itself ("still checking, I'll confirm on
 * Friday" answers nothing yet; the earlier promise stays owed beside the new one). A delivery is kept by the owner's
 * word (`markPromiseKept`); a price's end is no promise to keep, and is never owed (`src/db/calendar.ts`).
 */
export async function keepFollowUps(tx: Tx, outboundId: string): Promise<number> {
  const r = await sql`
    update promised_dates p set kept_at = now(), kept_by = 'next_message'
      from outbound_messages o
     where o.id = ${outboundId}::uuid and p.conversation_id = o.conversation_id and p.business_id = o.business_id
       and p.kind = 'follow_up' and p.kept_at is null and p.outbound_id is distinct from o.id
       and not exists (select 1 from promised_dates q where q.outbound_id = o.id and q.kind = 'follow_up')`.execute(tx);
  return Number(r.numAffectedRows ?? 0);
}

/** B13 — the owner (or staff) says a promise was kept: a delivery made, a follow-up done another way. Once. */
export async function markPromiseKept(tx: Tx, businessId: string, id: string, by: string): Promise<boolean> {
  const r = await sql`
    update promised_dates set kept_at = now(), kept_by = ${by}
     where id = ${id}::uuid and business_id = ${businessId}::uuid and kept_at is null and kind <> 'price_end'`.execute(tx);
  return Number(r.numAffectedRows ?? 0) > 0;
}

export type Promised = {
  readonly id: string; readonly conversationId: string; readonly kind: PromiseKind;
  readonly dueOn: string; readonly said: string; readonly saidBy: 'assistant' | 'person'; readonly kept: boolean;
};
