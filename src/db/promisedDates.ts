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

export type Promised = {
  readonly id: string; readonly conversationId: string; readonly kind: PromiseKind;
  readonly dueOn: string; readonly said: string; readonly saidBy: 'assistant' | 'person'; readonly kept: boolean;
};
