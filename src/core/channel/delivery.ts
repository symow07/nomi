import type { OutboundStatus } from '../../outbound/sequencer.js';

/**
 * M3 — Outbound delivery reconciliation + retry policy. Pure decisions; the
 * outbound worker applies them.
 *
 * Provider status webhooks arrive duplicated and out of order (retries for up
 * to 7 days). Reconciliation is monotonic: a status can only move FORWARD
 * along queued → sending → sent → delivered → read. Anything else — a late
 * 'delivered' after 'read', a duplicate, a 'failed' after the handset already
 * confirmed receipt — is ignored, and the audit trail records that it was.
 */

const RANK: Record<OutboundStatus, number> = {
  queued: 0, sending: 1, sent: 2, delivered: 3, read: 4, failed: 5, canceled: 5,
  // 0052 — ranked with 'sending', which is what it is: a send whose answer was
  // lost. NOT terminal, so if a provider ever does report on it — a status
  // webhook that finds its row — the receipt is believed and she is spared the
  // question.
  uncertain: 1,
};

const TERMINAL = new Set<OutboundStatus>(['failed', 'canceled']);

export type ProviderStatus = 'sent' | 'delivered' | 'read' | 'failed';

export type StatusReconciliation =
  | { readonly apply: true; readonly next: OutboundStatus }
  | { readonly apply: false; readonly reason: 'duplicate_or_late' | 'already_terminal' | 'failed_after_receipt' };

export function applyStatus(
  current: OutboundStatus,
  incoming: ProviderStatus,
): StatusReconciliation {
  if (TERMINAL.has(current)) return { apply: false, reason: 'already_terminal' };
  if (incoming === 'failed') {
    // The handset already confirmed receipt — a late 'failed' is provider noise.
    if (current === 'delivered' || current === 'read') {
      return { apply: false, reason: 'failed_after_receipt' };
    }
    return { apply: true, next: 'failed' };
  }
  if (RANK[incoming] <= RANK[current]) {
    return { apply: false, reason: 'duplicate_or_late' };
  }
  return { apply: true, next: incoming };
}

/** ── Retry policy: bounded exponential backoff, then dead-letter ────────── */

export const RETRY_BASE_MS = 2_000;
export const RETRY_MAX_MS = 4 * 60_000;
export const MAX_SEND_ATTEMPTS = 6;

/** attempt is 1-indexed (the attempt that just failed). Deterministic — the
 * worker may add jitter; the core does not roll dice. */
export function retryDelayMs(attempt: number): number {
  const n = Math.max(1, Math.floor(attempt));
  return Math.min(RETRY_BASE_MS * 2 ** (n - 1), RETRY_MAX_MS);
}

export type SendFailure = { readonly retryable: boolean; readonly error: string };

export type FailureDecision =
  | { readonly kind: 'retry'; readonly delayMs: number }
  | { readonly kind: 'dead_letter' }          // exhausted — ops alert, owner copy via OWNER_PROBLEM
  | { readonly kind: 'fail_permanent' };      // 4xx: policy/payload — retrying burns quality rating

export function onSendFailure(failure: SendFailure, attempts: number): FailureDecision {
  if (!failure.retryable) return { kind: 'fail_permanent' };
  if (attempts >= MAX_SEND_ATTEMPTS) return { kind: 'dead_letter' };
  return { kind: 'retry', delayMs: retryDelayMs(attempts) };
}

/** ── Restart safety ─────────────────────────────────────────────────────── */

/**
 * A row stuck in 'sending' longer than this was interrupted mid-send (crash,
 * deploy, dropped socket). The window is generous because the provider POST may
 * have succeeded without us recording it.
 *
 * ── IT IS NOT RE-QUEUED, AND THAT IS THE POINT (0052) ─────────────────────
 *
 * This constant used to feed a reclaim back to 'queued', on the reasoning that
 * "a rare duplicate send is the accepted cost of never losing a message". That
 * trade was the wrong way round. A buyer who gets the same price, or the same
 * first e-mail, twice learns something false about the factory — and a machine
 * chose that for her, silently, in the one case where nobody could say what had
 * happened. Losing the message is not the alternative: the row becomes
 * 'uncertain', she is told it is not known whether it left, and she decides.
 *
 * No provider can settle it for us in general. WhatsApp will not answer for a
 * message whose id we never received; SMTP has nothing to ask. So the honest
 * answer is a person, and everything here exists to put the question in front
 * of one rather than guess.
 */
export const SENDING_RECLAIM_MS = 2 * 60_000;

/**
 * Whether a send that never reported back has waited long enough to be called
 * unknown. Pure; the caller supplies the clock.
 */
export function isUncertainSend(sendingSince: Date | null, now: Date): boolean {
  if (!sendingSince) return false;
  return now.getTime() - sendingSince.getTime() >= SENDING_RECLAIM_MS;
}
