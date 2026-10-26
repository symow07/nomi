/**
 * 0215 — HOW MANY MESSAGES TIKTOK LETS A BUSINESS SEND, read from the conversation's own messages
 * (docs/TIKTOK-CHANNEL.md §3; TikTok's "Messaging limits for Business Messaging API", read 2026-10-24):
 *
 *   · "You are prohibited from initiating a conversation": nothing goes to someone who never wrote.
 *   · INITIAL WINDOW: "After receiving the first message from a TikTok user, TikTok account can send up to 10 messages
 *     within the next 48 hours."
 *   · ACTIVE: "If the TikTok user replies to the TikTok account's message … Within 48 hours after each last reply …
 *     an unlimited number of messages."
 *   · INACTIVE: "If more than 48 hours have passed since the TikTok user's last reply, the TikTok account is limited to
 *     sending a maximum of three additional messages … until the TikTok user responds again."
 *
 * Every message the ACCOUNT sent counts — Nomi's, and the owner's from TikTok's own app (recorded from the echoes) —
 * because TikTok counts the account's, not the tool's. Read conservatively: where the rule could be read two ways,
 * the reading that sends less is the one held. Pure (ADR-0002).
 */
export const TIKTOK_WINDOW_MS = 48 * 3600 * 1000;
export const TIKTOK_INITIAL_MAX = 10;
export const TIKTOK_QUIET_MAX = 3;

export type TikTokHistory = {
  /** The customer's first message in this conversation, and their latest. */
  readonly firstInboundAt: Date | null;
  readonly lastInboundAt: Date | null;
  /** Did the account write before the customer's latest message — so that message is a REPLY to it? */
  readonly repliedToUs: boolean;
  /** The account's messages since the customer's first message (the initial window's count). */
  readonly sentSinceFirst: number;
  /** The account's messages since 48 hours after the customer's latest message (the quiet allowance's count). */
  readonly sentSinceQuiet: number;
};

export type TikTokVerdict = { readonly send: true } | { readonly send: false; readonly why: 'never_wrote' | 'initial_used' | 'quiet_used' };

export function tiktokMaySend(h: TikTokHistory, now: Date): TikTokVerdict {
  if (!h.lastInboundAt || !h.firstInboundAt) return { send: false, why: 'never_wrote' };
  const sinceLast = now.getTime() - h.lastInboundAt.getTime();
  if (sinceLast > TIKTOK_WINDOW_MS) return h.sentSinceQuiet < TIKTOK_QUIET_MAX ? { send: true } : { send: false, why: 'quiet_used' };
  if (h.repliedToUs) return { send: true };
  // Still the first exchange: the customer has not answered anything the account sent. Ten, from their first message.
  return h.sentSinceFirst < TIKTOK_INITIAL_MAX ? { send: true } : { send: false, why: 'initial_used' };
}
