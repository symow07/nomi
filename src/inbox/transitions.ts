import { type Result, ok, err } from '../core/types/result.js';

/**
 * Human inbox — the state machine. (Priority 3)
 *
 *   AI ──handoff──▶ open/unclaimed ──claim──▶ claimed ──release──▶ AI
 *                        │
 *                   SLA breach ──▶ ONE holding message + re-alert (stays open)
 *
 * Pure transitions; the worker and the Telegram bridge are thin callers.
 * Invariants enforced elsewhere: one OPEN handoff per conversation (0008's
 * exclusion constraint — the orders pattern again), and the AI is silent the
 * entire time assigned_to is non-null (decideTurn Gate 0).
 */

export type Handoff = {
  readonly id: string;
  readonly conversationId: string;
  readonly requestedAt: Date;
  readonly slaDeadlineAt: Date;
  readonly holdingSentAt: Date | null;
  readonly claimedAt: Date | null;
  readonly claimedBy: string | null;
  readonly releasedAt: Date | null;
};

export type ClaimError = 'already_claimed' | 'already_released';
export type ReleaseError = 'not_claimed' | 'not_the_claimer' | 'summary_required';

export function claim(h: Handoff, agentId: string, now: Date):
    Result<{ claimedAt: Date; claimedBy: string }, ClaimError> {
  if (h.releasedAt) return err('already_released');
  if (h.claimedBy) return err('already_claimed');   // first claim wins; no stealing
  return ok({ claimedAt: now, claimedBy: agentId });
}

/**
 * Release returns control to the AI. The summary is MANDATORY: it is written
 * into context_summary so the AI's next reply builds on what the human agreed
 * instead of contradicting it. Any commercial agreement must already exist as
 * a quote row — the numeral guard makes off-book promises unrepeatable.
 */
export function release(h: Handoff, agentId: string, summary: string, now: Date):
    Result<{ releasedAt: Date; releaseSummary: string }, ReleaseError> {
  if (!h.claimedBy || !h.claimedAt) return err('not_claimed');
  if (h.claimedBy !== agentId) return err('not_the_claimer');
  if (summary.trim().length < 10) return err('summary_required');
  return ok({ releasedAt: now, releaseSummary: summary.trim() });
}

export type SlaAction =
  | { kind: 'none' }
  | { kind: 'send_holding_and_realert' }   // once, at first breach
  | { kind: 'realert_only' };              // repeat alerts, no second holding msg

/**
 * SLA check, run by a pg-boss cron every minute over open unclaimed handoffs.
 * The holding message is deterministic, sent exactly once, and does NOT resume
 * selling — it buys the human time without un-pausing the AI.
 */
export function slaCheck(h: Handoff, now: Date): SlaAction {
  if (h.claimedBy || h.releasedAt) return { kind: 'none' };
  if (now < h.slaDeadlineAt) return { kind: 'none' };
  return h.holdingSentAt ? { kind: 'realert_only' } : { kind: 'send_holding_and_realert' };
}

export const HOLDING_MESSAGE =
  'A colleague will be with you very shortly — meanwhile, is there anything I can prepare for them (quantities, delivery destination, or reference photos)?';
