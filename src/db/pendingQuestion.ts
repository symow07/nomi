import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { PendingQuestion } from '../core/types/conversation.js';

/**
 * 0080 — THE PENDING QUESTION IS SET WHEN ITS QUESTION LEAVES.
 *
 * The fast path reads a bare "yes" as the answer to the conversation's pending
 * question: to "shall I confirm?", a "yes" proposes the order. So the pending
 * question must be one the customer was actually asked. It was saved with the
 * turn that wrote it — including a draft the owner never sent — and a "yes" to
 * something else could propose an order.
 *
 * Here is the one writer, called when a message is accepted by the provider
 * (the outbound worker) or recorded as sent (Practice): the pending question
 * becomes the question THAT message asks — or none, for a message that asks
 * nothing, and for the owner's own words, which Nomi cannot read for a
 * question. The turn itself only keeps or clears one (pipeline/turn.ts).
 */
export async function markQuestionAsked(tx: Tx, conversationId: string, asks: PendingQuestion | null): Promise<void> {
  await sql`
    update conversation_state set pending_question = ${asks}::text
     where conversation_id = ${conversationId}::uuid
       and pending_question is distinct from ${asks}::text`.execute(tx);
}
