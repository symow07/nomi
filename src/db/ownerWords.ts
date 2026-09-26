import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';

/**
 * CC-24 — the owner's words survive a refusal (0072, 2026-09-27).
 *
 * Editing a draft started from an empty box, and when the send was refused —
 * the buyer's window shut, the assistant stopped, sending paused — the page
 * redirected with a notice and the text the owner had typed was gone. So was a
 * refused reply of the owner's own. Refusals are exactly the moments an owner
 * has to come back to, so the words wait where they were typed:
 *
 *   - an edit of a draft is kept ON THAT DRAFT, and the edit box opens with it
 *     (with the draft's own text when there is no edit yet);
 *   - the owner's own reply is kept on the conversation until a reply goes.
 *
 * Nothing kept here is ever sent by anyone but the owner pressing send again.
 * Every write is scoped by business as well as by row, like the read models.
 */

/** Keep the owner's edit of a draft that is still pending. A blank edit keeps nothing. */
export async function keepDraftEdit(tx: Tx, businessId: BusinessId, draftId: string, text: string): Promise<void> {
  if (!text.trim()) return;
  await sql`
    update drafts set owner_edit = ${text}, owner_edit_at = now()
     where id = ${draftId}::uuid and business_id = ${businessId}::uuid and status = 'pending'
  `.execute(tx);
}

/** Keep the owner's own reply that was refused before it could be queued. */
export async function keepUnsentReply(tx: Tx, businessId: BusinessId, conversationId: string, text: string): Promise<void> {
  if (!text.trim()) return;
  await sql`
    update conversations set owner_unsent_reply = ${text}, owner_unsent_reply_at = now()
     where id = ${conversationId}::uuid and business_id = ${businessId}::uuid
  `.execute(tx);
}

/** A reply went: nothing is waiting in the box any more. */
export async function clearUnsentReply(tx: Tx, businessId: BusinessId, conversationId: string): Promise<void> {
  await sql`
    update conversations set owner_unsent_reply = null, owner_unsent_reply_at = null
     where id = ${conversationId}::uuid and business_id = ${businessId}::uuid and owner_unsent_reply is not null
  `.execute(tx);
}
