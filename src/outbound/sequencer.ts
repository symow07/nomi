import { CHANNEL_REGISTRY, type ChannelCapability } from '../core/channel/registry.js';

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
  | 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'canceled'
  /** 0052 — the provider was called and never answered. A person decides. */
  | 'uncertain';

export type OutboundRow = {
  readonly id: string;
  readonly seq: number;
  readonly status: OutboundStatus;
  readonly requiresOrder: boolean;
  readonly attempts: number;
  readonly sentAt: Date | null;
  /** C4.c — which channel carried it; absent is WhatsApp, as every row before e-mail was. */
  readonly channel?: string;
};

/**
 * C4.c — does a 'sent' row on this channel still have a receipt to wait for?
 * Asked of the registry, and an unknown channel is assumed to have one: waiting
 * is the conservative answer.
 */
const awaitsReceipt = (channel: string | undefined): boolean =>
  (CHANNEL_REGISTRY as Readonly<Record<string, ChannelCapability | undefined>>)[channel ?? 'whatsapp']
    ?.deliveryReceipts !== false;

/**
 * delivered/read = confirmed at handset; failed/canceled = will never block.
 *
 * 0052 — and 'uncertain' does not block either. It is out of the pipeline until
 * a person decides, which may be hours: holding the rest of the conversation
 * behind it would turn one unanswerable question into a silent buyer. Ordering
 * is a courtesy about two messages arriving the wrong way round; leaving a man
 * with no answer at all is worse, and she can still see both.
 */
const TERMINAL = new Set<OutboundStatus>(['delivered', 'read', 'failed', 'canceled', 'uncertain']);

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

      // Accepted by a channel that never confirms delivery: accepted is final.
      if (prior.status === 'sent' && !awaitsReceipt(prior.channel)) continue;
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
