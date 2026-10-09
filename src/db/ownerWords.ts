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

/**
 * The design pass (2026-09-29) — the approval card has ONE Send, and it carries
 * what is in the box. The words go as the draft itself when they are the
 * draft's (line endings and the space at either end aside), and as the owner's
 * edit otherwise. `null`: no draft of this business's by that id.
 */
export async function draftTextOf(tx: Tx, businessId: BusinessId, draftId: string): Promise<string | null> {
  const row = (await sql<{ draft_text: string }>`
    select draft_text from drafts where id = ${draftId}::uuid and business_id = ${businessId}::uuid
  `.execute(tx)).rows[0];
  return row ? row.draft_text : null;
}

/**
 * R2 (docs/PRE-LAUNCH.md) — which conversation a draft belongs to, in this workspace; null when there is no such
 * draft. The approval route asks it before anything else, so a draft is only ever acted on from its own page.
 */
export async function draftConversationOf(tx: Tx, businessId: BusinessId, draftId: string): Promise<string | null> {
  const row = (await sql<{ conversation_id: string }>`
    select conversation_id::text as conversation_id from drafts where id = ${draftId}::uuid and business_id = ${businessId}::uuid
  `.execute(tx)).rows[0];
  return row ? row.conversation_id : null;
}

/**
 * The same words, as the card and the approval path compare them — after
 * whitespace normalisation (R1, the ramp's "sent as written"): spaces, tabs
 * and line breaks are spacing, not an edit.
 */
const spacing = (x: string): string => x.replace(/\s+/g, ' ').trim();
export const sameWords = (a: string, b: string): boolean => spacing(a) === spacing(b);

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
