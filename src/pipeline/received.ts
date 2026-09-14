import { sql } from 'kysely';
import type { Tx } from '../db/client.js';
import type { tenantRepos } from '../db/repos.js';
import type { ConversationId } from '../core/types/ids.js';
import type { Signal } from '../core/scoring/signals.js';
import type { TurnEffects } from './turn.js';
import { ownershipOf, canTransition, WAITING_HUMAN_AGENT } from '../core/conversation/ownership.js';

/**
 * G2c — recording a message she will not answer: a reaction or a sticker she
 * ignores, or a document, video or location she cannot read and hands to a
 * person.
 *
 * Recorded either way, for the same reason `recordImageMessage` records a photo
 * she could not see: a row that exists only when she answered makes "he sent
 * something" indistinguishable from "he sent nothing". The kind of thing that
 * arrived goes in `ai_analysis`, so the owner's timeline can name it.
 *
 * `input_type` 'unknown' has been in the CHECK since the baseline. `text_content`
 * is the buyer's own caption on a document or video, when he wrote one.
 */
/**
 * G10a — a line the buyer TYPED, on the timeline the owner reads.
 *
 * Nothing in production wrote one. A voice note, a photo and a file each had
 * their writer; a typed message only ever became a batching fragment, so the
 * conversation page, Buyers' latest line, the analytics counts and the
 * contacts' "he wrote first" evidence all read a `messages` table that held
 * everything a buyer said except the words he typed. The demo seed wrote
 * them directly, which is why every screen looked right.
 *
 * One row per WhatsApp message, as it arrives — before any batching — so the
 * timeline shows his lines as he sent them. Idempotent on the provider's id.
 */
export async function recordTypedMessage(
  tx: Tx, conversationId: string, messageId: string, text: string,
): Promise<void> {
  await sql`
    insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at)
    values (${conversationId}, ${messageId}, 'inbound', 'text', ${text}, clock_timestamp())
    on conflict do nothing
  `.execute(tx);
}

export async function recordReceivedMessage(
  tx: Tx,
  conversationId: string,
  messageId: string,
  caption: string | null,
  received: string,
): Promise<void> {
  await sql`
    insert into messages
      (conversation_id, external_id, direction, input_type, text_content, ai_analysis, sent_at)
    values
      (${conversationId}, ${messageId}, 'inbound', 'unknown', ${caption},
       ${JSON.stringify({ received })}::jsonb, clock_timestamp())
    on conflict do nothing
  `.execute(tx);
}

/**
 * G2c — she could not read what the buyer sent, so a PERSON must.
 *
 * C4.c — moved here from the worker's closure, unchanged, because an e-mail
 * reply hands the conversation to a person the same way and a second copy of
 * this transition would be a second place to get it wrong.
 *
 * Records the reason, and moves the conversation to "waiting for a person"
 * when she is the one holding it.
 *
 * Before this, the unheard-note and unclear-photo paths recorded their
 * signal and a handoff event and left the conversation with her. Those
 * signals score no problem points, so ownership never changed, and the
 * conversation never appeared under "needs you" — the owner learned of it
 * only if the WhatsApp alert happened to arrive.
 *
 * The ownership model is unchanged: this is the existing AI → WAITING_HUMAN
 * transition, taken through `canTransition`. A conversation a person already
 * holds is left with that person.
 */
export async function handToPerson(
  tenant: ReturnType<typeof tenantRepos>, conversationId: ConversationId, signal: Signal,
): Promise<TurnEffects> {
  await tenant.signals.record(conversationId, signal);
  const state = await tenant.conversations.loadState(conversationId);
  const from = ownershipOf(state?.assignedTo ?? null);
  // Only AI → WAITING_HUMAN is an allowed move into waiting; a person who
  // already holds it keeps it.
  if (state && canTransition(from, 'WAITING_HUMAN')) {
    await tenant.conversations.assign(conversationId, WAITING_HUMAN_AGENT);
  }
  await tenant.events.append(conversationId, 'handoff', { reason: signal.kind });
  return {
    outbound: null, draftCreated: null, hotLeadAlert: false,
    handoffAlert: true, orderCreated: null,
  } satisfies TurnEffects;
}
