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
