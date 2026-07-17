/**
 * Delivery-ordering state machine (ADR-0012 C).
 *
 * WhatsApp does not guarantee outbound order. If we fire greeting + quote
 * back-to-back, the buyer can receive the quote FIRST — an incoherent
 * employee. Rule: an order-dependent message may send only when every prior
 * order-dependent message in its conversation has reached 'delivered' (or a
 * terminal state). Pure decision over the conversation's outbound rows.
 */

export type OutboundStatus =
  | 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'canceled';

export type OutboundRow = {
  readonly id: string;
  readonly seq: number;
  readonly status: OutboundStatus;
  readonly requiresOrder: boolean;
  readonly attempts: number;
  readonly sentAt: Date | null;
};

/** delivered/read = confirmed at handset; failed/canceled = will never block. */
const TERMINAL = new Set<OutboundStatus>(['delivered', 'read', 'failed', 'canceled']);

/** 'sent' but unconfirmed for this long → stop blocking successors (buyer may
 * have receipts off / flaky network). Coherence yields to responsiveness. */
export const DELIVERY_WAIT_CAP_MS = 90_000;

export type SequencerDecision =
  | { readonly action: 'send'; readonly id: string }
  | { readonly action: 'wait'; readonly blockedOn: string; readonly recheckInMs: number }
  | { readonly action: 'idle' };

export function nextToSend(
  rows: readonly OutboundRow[],
  now: Date,
): SequencerDecision {
  const bySeq = [...rows].sort((a, b) => a.seq - b.seq);

  const candidate = bySeq.find((r) => r.status === 'queued');
  if (!candidate) return { action: 'idle' };

  if (candidate.requiresOrder) {
    for (const prior of bySeq) {
      if (prior.seq >= candidate.seq) break;
      if (!prior.requiresOrder) continue;
      if (TERMINAL.has(prior.status)) continue;

      if (prior.status === 'sent' && prior.sentAt) {
        const waited = now.getTime() - prior.sentAt.getTime();
        if (waited >= DELIVERY_WAIT_CAP_MS) continue; // cap reached — unblock
        return { action: 'wait', blockedOn: prior.id, recheckInMs: DELIVERY_WAIT_CAP_MS - waited };
      }
      // queued/sending predecessor: strictly blocked
      return { action: 'wait', blockedOn: prior.id, recheckInMs: 5_000 };
    }
  }

  return { action: 'send', id: candidate.id };
}
