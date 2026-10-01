import { sql } from 'kysely';
import type { Tx } from './client.js';
import { connectionsPaused } from './opsFlags.js';
import { cardNeeded } from './billing.js';

/**
 * KS6 (0115) — THE OPERATOR APPROVES EACH WORKSPACE'S FIRST CONNECTION, while
 * the installation's `approve_connections` switch is on (opening step 4).
 *
 * A workspace that signed itself up and has never connected a channel asks
 * once, naming where the business can be seen; the operator decides
 * (tools/connections.mjs); the owner hears by e-mail. The app reads its own
 * row and asks through `ask_connection_approval()` — it can never decide.
 */

export type ApprovalDecision = 'approved' | 'refused';
export type ApprovalAsk = { readonly page: string; readonly askedAt: Date; readonly decision: ApprovalDecision | null };
export type ApprovalState = { readonly needed: boolean; readonly ask: ApprovalAsk | null };

/** Must this workspace wait for the operator before its first channel connects? And has it asked? */
export async function approvalState(tx: Tx, businessId: string): Promise<ApprovalState> {
  const needed = (await sql<{ n: boolean }>`select connection_approval_needed() as n`.execute(tx)).rows[0]?.n === true;
  const r = (await sql<{ page: string; asked_at: Date; decision: ApprovalDecision | null }>`
    select page, asked_at, decision from connection_approvals where business_id = ${businessId}::uuid`.execute(tx)).rows[0];
  return { needed, ask: r ? { page: r.page, askedAt: r.asked_at, decision: r.decision } : null };
}

/** The owner asks, once: 'asked', or where an earlier ask stands. */
export async function askApproval(tx: Tx, page: string, by: string): Promise<'asked' | 'waiting' | ApprovalDecision> {
  const r = (await sql<{ r: string }>`select ask_connection_approval(${page}, ${by}) as r`.execute(tx)).rows[0]?.r;
  return r === 'asked' || r === 'approved' || r === 'refused' ? r : 'waiting';
}

/**
 * What stands between this workspace and connecting a channel: nothing, the
 * operator's stop (G7, `connections_off`), or the approval it has not had yet.
 * Both connect routes — the Page and WhatsApp — ask this one question.
 */
export type ConnectionGate = 'open' | 'stopped' | 'approval' | 'card';
export async function connectionGate(tx: Tx, businessId: string): Promise<ConnectionGate> {
  if (await connectionsPaused(tx, businessId)) return 'stopped';
  const n = (await sql<{ n: boolean }>`select connection_approval_needed() as n`.execute(tx)).rows[0]?.n === true;
  if (n) return 'approval';
  // BILL (0117) — card upfront: while the installation requires it, a billed
  // workspace connects a channel once a card is saved (Billing).
  return (await cardNeeded(tx)) ? 'card' : 'open';
}
