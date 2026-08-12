import { sql } from 'kysely';
import { withTenantTx, lockConversation, type Db, type Tx } from '../db/client.js';
import { tenantRepos } from '../db/repos.js';
import {
  ownershipOf, canTransition, OWNER_AGENT, type ConversationOwnership,
} from '../core/conversation/ownership.js';
import { isProblemSignal, type Signal } from '../core/scoring/signals.js';
import type { BusinessId, ConversationId } from '../core/types/ids.js';

/**
 * M16.1 — Human takeover services.
 *
 * takeOver / resumeAi move a conversation through the ownership state machine
 * (src/core/conversation/ownership) using the EXISTING primitives only:
 * conversations.assign (the one ownership model), conversation_events (audit),
 * and the soft-resolve on conversation_signals (history is kept, never
 * deleted). No new tables, no new approval or send path.
 */

export type TakeoverDeps = { readonly db: Db; readonly now: () => Date };

export type TakeoverOutcome = 'taken_over' | 'resumed' | 'not_found' | 'invalid_state';
export type TakeoverResult = { readonly outcome: TakeoverOutcome; readonly ownership: ConversationOwnership | null };

/** Read assigned_to for a tenant-owned conversation. null row = not this tenant's. */
async function currentOwnership(tx: Tx, businessId: BusinessId, conversationId: string): Promise<ConversationOwnership | null> {
  const r = await sql<{ assigned_to: string | null }>`
    select assigned_to from conversations
     where id = ${conversationId} and business_id = ${businessId} limit 1
  `.execute(tx);
  const row = r.rows[0];
  return row ? ownershipOf(row.assigned_to) : null;
}

/** Owner takes control. AI becomes silent (the existing decideTurn gate). No message sent. */
export async function takeOver(deps: TakeoverDeps, input: { businessId: BusinessId; conversationId: string; actor: string }): Promise<TakeoverResult> {
  return withTenantTx(deps.db, input.businessId, async (tx) => {
    const cid = input.conversationId as ConversationId;
    const cur = await currentOwnership(tx, input.businessId, input.conversationId);
    if (cur === null) return { outcome: 'not_found', ownership: null };
    if (!canTransition(cur, 'OWNER_CONTROLLED')) return { outcome: 'invalid_state', ownership: cur };

    await lockConversation(tx, input.conversationId);
    const repos = tenantRepos(tx, input.businessId);
    await repos.conversations.assign(cid, OWNER_AGENT);
    await repos.events.append(cid, 'takeover', { actor: input.actor });
    return { outcome: 'taken_over', ownership: 'OWNER_CONTROLLED' };
  });
}

/**
 * Owner hands the conversation back to the AI.
 *
 * SAFELY: the problem signals that triggered the handoff are SOFT-resolved
 * (resolved_at set) so the AI does not instantly re-hand-off — the rows are
 * KEPT (history preserved), and a resume_ai event records that a human handled
 * it. If the buyer genuinely re-escalates, a fresh signal re-triggers handoff.
 */
export async function resumeAi(deps: TakeoverDeps, input: { businessId: BusinessId; conversationId: string; actor: string }): Promise<TakeoverResult> {
  return withTenantTx(deps.db, input.businessId, async (tx) => {
    const cid = input.conversationId as ConversationId;
    const cur = await currentOwnership(tx, input.businessId, input.conversationId);
    if (cur === null) return { outcome: 'not_found', ownership: null };
    if (!canTransition(cur, 'AI')) return { outcome: 'invalid_state', ownership: cur };

    await lockConversation(tx, input.conversationId);
    const repos = tenantRepos(tx, input.businessId);
    await repos.conversations.assign(cid, null);
    const unresolved = await repos.signals.unresolved(cid);
    for (const s of unresolved) {
      if (isProblemSignal(s)) await repos.signals.resolve(cid, s.kind);   // soft: not deleted
    }
    await repos.events.append(cid, 'resume_ai', { actor: input.actor });
    return { outcome: 'resumed', ownership: 'AI' };
  });
}

/*
 * M34.10 — `takeoverContext` was deleted here. It was exported, referenced by
 * nothing at all — not even a test — and answered "why was this handed over?"
 * from unresolved problem signals. api/web/inbox.ts answers the same question
 * from the same rows, in the read model the page actually uses
 * (`handoffReason`), so this was a second implementation nobody ran.
 */
