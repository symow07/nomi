import { sql } from 'kysely';
import { withTenantTx, lockConversation, type Db, type Tx } from '../db/client.js';
import { tenantRepos } from '../db/repos.js';
import { enqueueOutboundRow } from '../db/channels.js';
import { ownershipOf, ownerMayReply, type ConversationOwnership } from '../core/conversation/ownership.js';
import type { BusinessId, ConversationId } from '../core/types/ids.js';

/**
 * M16.1 — Owner reply during a human takeover.
 *
 * The owner's message goes through the ONE outbound path — exactly as an AI
 * reply does:
 *     ownerReply → enqueueOutboundRow(origin='owner') → QUEUES.outbound worker → adapter
 * There is no direct send and no owner-specific sender. `kickDrive` fires the
 * existing bare re-drive tick so the worker delivers the queued row.
 *
 * Allowed ONLY when the owner holds control (assigned_to = owner). If the AI
 * owns it, or a handoff is still unclaimed, the reply is refused — a human must
 * take over first.
 */

export type OwnerReplyDeps = {
  readonly db: Db;
  readonly now: () => Date;
  /** The existing bare re-drive tick: boss.send(QUEUES.outbound, {businessId, conversationId}). */
  readonly kickDrive: (businessId: string, conversationId: string) => Promise<void>;
};

export type OwnerReplyOutcome =
  | 'sent'            // enqueued through the one outbound path
  | 'empty'           // nothing to send
  | 'not_found'       // no such conversation for this tenant
  | 'ai_owned'        // the AI owns it — cannot inject an owner message
  | 'must_take_over'  // handed off but not yet claimed — take over first
  | 'no_channel';     // conversation has no channel identity to send to

export type OwnerReplyResult = { readonly outcome: OwnerReplyOutcome; readonly ownership: ConversationOwnership | null };

async function currentOwnership(tx: Tx, businessId: BusinessId, conversationId: string): Promise<ConversationOwnership | null> {
  const r = await sql<{ assigned_to: string | null }>`
    select assigned_to from conversations
     where id = ${conversationId} and business_id = ${businessId} limit 1
  `.execute(tx);
  const row = r.rows[0];
  return row ? ownershipOf(row.assigned_to) : null;
}

export async function ownerReply(deps: OwnerReplyDeps, input: { businessId: BusinessId; conversationId: string; text: string; actor: string }): Promise<OwnerReplyResult> {
  const text = input.text.trim();
  if (!text) return { outcome: 'empty', ownership: null };

  const result = await withTenantTx(deps.db, input.businessId, async (tx): Promise<{ outcome: OwnerReplyOutcome; ownership: ConversationOwnership | null }> => {
    const cur = await currentOwnership(tx, input.businessId, input.conversationId);
    if (cur === null) return { outcome: 'not_found', ownership: null };
    // The ownership gate IS the safety boundary — an owner cannot bypass it.
    if (cur === 'AI') return { outcome: 'ai_owned', ownership: cur };
    if (!ownerMayReply(cur)) return { outcome: 'must_take_over', ownership: cur };

    await lockConversation(tx, input.conversationId);
    const cid = input.conversationId as ConversationId;
    // THE one send path. origin='owner' distinguishes it in the transcript.
    const rowId = await enqueueOutboundRow(tx, input.businessId, input.conversationId, text, 'owner');
    if (rowId === null) return { outcome: 'no_channel', ownership: cur };

    // Audit: actor + action + timestamp only — no message body, no sensitive data.
    await tenantRepos(tx, input.businessId).events.append(cid, 'owner_reply', { actor: input.actor });
    return { outcome: 'sent', ownership: cur };
  });

  // Fire the existing drive tick AFTER commit so the worker delivers the queued row.
  if (result.outcome === 'sent') {
    await deps.kickDrive(input.businessId, input.conversationId);
  }
  return result;
}
