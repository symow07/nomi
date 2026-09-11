import { sql } from 'kysely';
import type { Tx } from '../db/client.js';

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
