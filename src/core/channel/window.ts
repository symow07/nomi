import { CHANNEL_REGISTRY, type ChannelCapability } from './registry.js';

/**
 * M3 — WhatsApp 24-hour customer-service window, as a state machine.
 *
 * Meta's rule: free-form messages may only be sent within 24h of the buyer's
 * last inbound message. Outside it, only pre-approved template messages are
 * allowed; violating replies are rejected (and burn quality rating).
 *
 * The owner never sees any of that vocabulary. Owner copy here is limited to
 * the locked phrases (可以直接回复 / 需要使用已批准的消息 / 暂时不能主动发送 /
 * 客户回复后即可继续 / 需要你确认后再联系).
 */

export const WINDOW_MS = 24 * 3600 * 1000;
/** "closing soon" = less than 2h left — time to nudge, not to panic. */
export const CLOSING_SOON_MS = 2 * 3600 * 1000;

export type WindowState = 'open' | 'closing_soon' | 'expired';

/**
 * C4.a — A CHANNEL WITH NO WINDOW HAS NOTHING TO BE OUTSIDE OF.
 *
 * The 24-hour rule is WhatsApp's, and this module was written when WhatsApp was
 * the only channel. E-mail has no such rule: the registry says so already
 * (`replyWindowHours: null`), and nobody needs a buyer's permission-by-recency
 * to receive a letter — what an unwanted e-mail needs is consent, a
 * suppression check and a way out, which is the outreach gate's job and not
 * this one's.
 *
 * Without this, every e-mail would be refused `window_closed`: the window is
 * computed from a WhatsApp-only join, so an address has no `lastInboundAt`,
 * and `windowState(null)` is 'expired' by design. The owner would be told her
 * buyer must write first — about a channel where that is not true.
 *
 * It reads the registry rather than naming e-mail, so the next channel with no
 * window answers correctly on the day it arrives.
 */
export function channelHasWindow(replyWindowHours: number | null): boolean {
  return replyWindowHours !== null;
}

/** A buyer who has never written has no window: nothing may be initiated. */
export function windowState(lastInboundAt: Date | null, now: Date): WindowState {
  if (!lastInboundAt) return 'expired';
  const left = lastInboundAt.getTime() + WINDOW_MS - now.getTime();
  if (left <= 0) return 'expired';
  return left <= CLOSING_SOON_MS ? 'closing_soon' : 'open';
}

export function windowMsLeft(lastInboundAt: Date | null, now: Date): number {
  if (!lastInboundAt) return 0;
  return Math.max(0, lastInboundAt.getTime() + WINDOW_MS - now.getTime());
}

export type TemplateState = 'approved' | 'none' | 'rejected';
export type SendIntent = 'reply' | 'follow_up';

export type SendPlan =
  | { readonly action: 'send_free'; readonly ownerNoteZh: string }
  /** Template sends always go through the owner first (需要你确认后再联系). */
  | { readonly action: 'send_template'; readonly ownerNoteZh: string }
  | { readonly action: 'wait_for_buyer'; readonly ownerNoteZh: string };

/**
 * What are we allowed to do right now? Buyer reopening the window is not a
 * special case: a new inbound message moves lastInboundAt, windowState returns
 * 'open', and the next call lands in the first branch.
 */
export function sendPlan(
  state: WindowState,
  intent: SendIntent,
  template: TemplateState,
): SendPlan {
  if (state !== 'expired') {
    return { action: 'send_free', ownerNoteZh: '可以直接回复' };
  }
  if (template === 'approved') {
    return {
      action: 'send_template',
      ownerNoteZh: '需要使用已批准的消息，需要你确认后再联系',
    };
  }
  // No usable template (none yet, or rejected): nothing can be initiated.
  // Intent doesn't matter — a "reply" 25h later is a re-engagement too.
  void intent;
  return {
    action: 'wait_for_buyer',
    ownerNoteZh: '暂时不能主动发送，客户回复后即可继续',
  };
}

/**
 * C4.a — the same question, asked of the channel the message is actually on.
 *
 * The send path had one window because the product had one channel. It now has
 * rows on two, and `sendPlan` alone would answer for an e-mail with WhatsApp's
 * rule: no `lastInboundAt` (there is no such thing for an address nobody has
 * written from), so 'expired', so `wait_for_buyer`, so `window_closed` — the
 * owner told to wait for a buyer to write first on the one channel where
 * writing first is the entire point.
 *
 * It ASKS THE REGISTRY rather than naming e-mail, so a channel added tomorrow
 * with no window answers correctly on the day it lands. And it fails CLOSED on
 * a channel the registry does not know: an unrecognised name is treated as
 * windowed, which refuses rather than sends.
 *
 * It is the only caller of `channelHasWindow`, which stays exported because the
 * rule — "a null reply window means no window" — is what the parity test pins;
 * a test that read `replyWindowHours !== null` itself would be asserting its own
 * arithmetic.
 */
export function channelSendPlan(
  channel: string,
  lastInboundAt: Date | null,
  now: Date,
  template: TemplateState,
): SendPlan {
  const cap = (CHANNEL_REGISTRY as Readonly<Record<string, ChannelCapability | undefined>>)[channel];
  // A channel the registry does not know is treated as windowed. A missing
  // entry must never read as a missing window — those are opposite answers, and
  // only one of them is safe.
  const windowed = cap === undefined ? true : channelHasWindow(cap.replyWindowHours);
  /**
   * C9 — a template can only reopen a window where the channel HAS templates.
   * Instagram and Messenger have none, so outside the 24 hours the honest plan
   * is to wait for the buyer. Treating her approved WhatsApp template as usable
   * there would produce a send Meta refuses and this product records as sent.
   */
  const reopenable = cap?.reopenWithTemplate === true ? template : 'none';
  return sendPlan(windowed ? windowState(lastInboundAt, now) : 'open', 'reply', reopenable);
}
