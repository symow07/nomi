import { sql } from 'kysely';
import { withTenantTx, lockConversation, type Db } from '../db/client.js';
import { parseOwnerReply } from '../core/conversation/cards.js';
import type { BusinessId } from '../core/types/ids.js';
import { ensureSpotChecks } from './spotChecks.js';

/**
 * M9.3 (Option B) — the ONE draft-resolution service. Completes the trust
 * loop that was only half-wired: computeTurn creates a pending draft →
 * the owner issues a command → this service resolves the draft and sends
 * through the EXISTING outbound path.
 *
 * Reuse, not reinvention:
 *   - parseOwnerReply is the command parser (发送 / 改 / 不回 / 收回). Unchanged.
 *   - Sending goes through the existing QUEUES.outbound worker via the injected
 *     kickOutbound (main.ts passes boss.send) — no second send path, no direct
 *     provider call, no duplicate outbound logic.
 *   - Idempotency: the draft is resolved FOR UPDATE and only when 'pending', so
 *     a double-submit or a page refresh cannot send twice.
 *   - Audit/trust reuse existing patterns: decided_by/at on the draft, the
 *     training_examples view derives from 'edited' drafts, 收回 writes a
 *     capability_events row and flips autonomy_policy (the M5 reduction path).
 *
 * BOTH the future WhatsApp webhook reply handler and the Command Center inbox
 * call this same service.
 */

export type ApplyOutcome =
  | 'sent'            // 发送 — approved draft enqueued
  | 'edited_sent'     // 改 — owner's text enqueued, edit recorded for learning
  | 'skipped'         // 不回 — draft rejected, nothing sent
  | 'revoked'         // 收回 — capability pulled back to draft, nothing sent
  | 'unknown'         // command not understood — no change
  | 'not_found'       // no such draft for this business
  | 'already_resolved'; // draft already decided (idempotent no-op)

export type ApplyResult = {
  readonly outcome: ApplyOutcome;
  readonly conversationId: string | null;
  readonly messageZh: string;   // owner-facing, no technical vocabulary
};

export type ApplyDeps = {
  readonly db: Db;
  readonly now: () => Date;
  /** Existing outbound path (main.ts: boss.send(QUEUES.outbound, …)). */
  readonly kickOutbound: (businessId: string, conversationId: string, reply: string) => Promise<void>;
};

export async function applyOwnerCommand(
  deps: ApplyDeps,
  input: { businessId: BusinessId; draftId: string; rawReply: string; decidedBy: string },
): Promise<ApplyResult> {
  const cmd = parseOwnerReply(input.rawReply);
  const now = deps.now();
  // drafts.decided_by FKs to agents(id); the owner acting via the Command
  // Center is not an agent row, so it stays null and the human actor is
  // recorded in the event payload / capability_events.actor (both text).
  const decidedByAgent = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.decidedBy)
    ? input.decidedBy : null;

  const result = await withTenantTx(deps.db, input.businessId, async (tx): Promise<{
    outcome: ApplyOutcome; conversationId: string | null; sendText: string | null;
  }> => {
    // FOR UPDATE + status='pending' is the idempotency guard: a second submit
    // finds it no longer pending and does nothing.
    const dr = await sql<{ id: string; conversation_id: string; status: string; capability: string; draft_text: string }>`
      select id, conversation_id, status, capability, draft_text
        from drafts where id = ${input.draftId} for update
    `.execute(tx);
    const draft = dr.rows[0];
    if (!draft) return { outcome: 'not_found', conversationId: null, sendText: null };
    if (draft.status !== 'pending') {
      return { outcome: 'already_resolved', conversationId: draft.conversation_id, sendText: null };
    }
    await lockConversation(tx, draft.conversation_id);

    const resolve = async (status: string, sentText: string | null) => {
      await sql`
        update drafts set status = ${status}, decided_by = ${decidedByAgent},
               decided_at = ${now}, sent_text = ${sentText}
         where id = ${draft.id}
      `.execute(tx);
      await sql`
        insert into conversation_events (business_id, conversation_id, type, payload)
        values (${input.businessId}, ${draft.conversation_id}, 'draft_resolved',
                ${JSON.stringify({ draftId: draft.id, status, actor: input.decidedBy })}::jsonb)
      `.execute(tx);
    };

    switch (cmd.kind) {
      case 'approve':
        await resolve('approved', draft.draft_text);
        // M34.7 — completed work becomes checkable work. This is the producer
        // for 抽查: until it existed, spot_checks had no writer outside the demo
        // seed and no capability in a real tenant could ever be promoted.
        // Capped at three a week and silent — nothing is pushed to the owner.
        await ensureSpotChecks(tx, input.businessId);
        return { outcome: 'sent', conversationId: draft.conversation_id, sendText: draft.draft_text };
      case 'edit':
        // sent_text ≠ draft_text is exactly what the training_examples view reads.
        await resolve('edited', cmd.text);
        await ensureSpotChecks(tx, input.businessId);
        return { outcome: 'edited_sent', conversationId: draft.conversation_id, sendText: cmd.text };
      case 'skip':
        await resolve('rejected', null);
        return { outcome: 'skipped', conversationId: draft.conversation_id, sendText: null };
      case 'revoke': {
        await resolve('rejected', null);
        // 收回 = pull the capability back to draft (M5 reduction path, reused).
        await sql`
          update autonomy_policy set mode = 'draft', updated_at = ${now}
           where business_id = ${input.businessId} and capability = ${draft.capability} and mode = 'auto'
        `.execute(tx);
        await sql`
          insert into capability_events (business_id, capability, action, from_mode, to_mode, reasons, actor)
          values (${input.businessId}, ${draft.capability}, 'pause', 'auto', 'draft',
                  array['owner_revoked'], ${input.decidedBy})
        `.execute(tx);
        return { outcome: 'revoked', conversationId: draft.conversation_id, sendText: null };
      }
      case 'unknown':
      default:
        return { outcome: 'unknown', conversationId: draft.conversation_id, sendText: null };
    }
  });

  // Send AFTER commit, through the existing worker path. Only approve/edit send.
  if (result.sendText && result.conversationId) {
    await deps.kickOutbound(input.businessId, result.conversationId, result.sendText);
  }

  return { outcome: result.outcome, conversationId: result.conversationId, messageZh: messageFor(result.outcome) };
}

function messageFor(outcome: ApplyOutcome): string {
  switch (outcome) {
    case 'sent': return '已发送。';
    case 'edited_sent': return '已按你的修改发送，这次改法已记下。';
    case 'skipped': return '好的，这条不回。';
    case 'revoked': return '已收回，这项以后先等你确认。';
    case 'already_resolved': return '这条已经处理过了。';
    case 'not_found': return '找不到这条待办。';
    case 'unknown': return '没听懂，回复「发送」照发、「改+内容」改一下、或「不回」跳过。';
  }
}
