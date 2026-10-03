/**
 * THE WARMTH RUN (2026-10-03), phase 5 — THE STATE OF PLAY: one line at the
 * head of a conversation that tells whoever opens it, owner or whoever runs
 * the socials, where things stand right now. Pure: the rows are read by
 * `src/db/catchUp.ts` and the conversation's own loader; this decides.
 *
 * In this order — the first that holds is the line:
 *
 *   1. NEEDS YOU, and why: an order they said yes to waits for the owner's
 *      tap; their data asked to be deleted; handed to a person; a reply to
 *      review. The Buyers row's own order and words (`needsWhy`, inbox.ts), so
 *      the list and the conversation never disagree about why.
 *   2. AN ORDER JUST CONFIRMED: their newest order that stands (confirmed, in
 *      production or shipped — `SPEND_STATUSES`) was confirmed in the last
 *      `ORDER_JUST_DAYS` days.
 *   3. WAITING ON THEIR ANSWER TO A QUOTE: the newest price they were given
 *      left, and no order of theirs stands from then on. A question after it
 *      ("what plug type?") does not answer it: the quote still waits on their
 *      decision (the fix wave, w4-conversation-13 — a follow-up erased it).
 *   4. GONE QUIET: nothing from them for `QUIET_DAYS` days or more. A customer
 *      who never wrote (we wrote first) has not gone quiet: they never spoke.
 *   5. Otherwise what happened last: TALKING NOW when the newest message is
 *      under `TALKING_MINUTES` old, else the LAST MESSAGE — who wrote it and
 *      when. NONE when the conversation has no message at all.
 *
 * Nothing here is inferred from words: every input is a row (a draft, a
 * signal, an order, a quote and the reply that carried it, a message's time).
 */

export const ORDER_JUST_DAYS = 7;
export const QUIET_DAYS = 14;
export const TALKING_MINUTES = 60;

const MINUTE = 60_000;
const DAY = 86_400_000;

/** Who wrote a message: the customer, a person here (the owner or a colleague), or the assistant. */
export type Speaker = 'buyer' | 'person' | 'assistant';

/** Why the conversation waits for the owner, in the Buyers row's order. */
export type NeedsWhy = 'order' | 'deletion' | 'handed' | 'review';

export type PlayFacts = {
  /** 0080 — an order they said yes to waits for the owner's tap. */
  readonly orderWaiting: boolean;
  /** 0075/0076 — a deletion request from their message waits, or they were handed over for one. */
  readonly deletionWaiting: boolean;
  /** Handed to a person and nobody has it yet (ownership WAITING_HUMAN). */
  readonly handedOver: boolean;
  /** The stored reason of the hand-over, when one is on record. */
  readonly handoffReason: string | null;
  /** A reply the assistant wrote waits for review while the assistant holds the conversation. */
  readonly replyToReview: boolean;
  /** Their newest order that stands, and when it was confirmed. */
  readonly lastOrder: { readonly reference: string; readonly confirmedAt: Date } | null;
  /** When the reply carrying the newest price they were given left. */
  readonly quoteSentAt: Date | null;
  /** Their newest message, in any of their conversations. */
  readonly lastFromThemAt: Date | null;
  /** This conversation's newest message. */
  readonly lastMessage: { readonly from: Speaker; readonly at: Date } | null;
};

export type StateOfPlay =
  | { readonly kind: 'needs'; readonly why: NeedsWhy; readonly reason: string | null }
  | { readonly kind: 'ordered'; readonly reference: string; readonly at: Date }
  | { readonly kind: 'quoted'; readonly at: Date }
  | { readonly kind: 'quiet'; readonly since: Date }
  | { readonly kind: 'talking'; readonly from: Speaker; readonly at: Date }
  | { readonly kind: 'last'; readonly from: Speaker; readonly at: Date }
  | { readonly kind: 'none' };

export function stateOfPlay(f: PlayFacts, now: Date): StateOfPlay {
  if (f.orderWaiting) return { kind: 'needs', why: 'order', reason: null };
  if (f.deletionWaiting) return { kind: 'needs', why: 'deletion', reason: null };
  if (f.handedOver) return { kind: 'needs', why: 'handed', reason: f.handoffReason };
  if (f.replyToReview) return { kind: 'needs', why: 'review', reason: null };

  // A confirmation stamped a moment ahead of this clock is still just now.
  if (f.lastOrder && now.getTime() - f.lastOrder.confirmedAt.getTime() <= ORDER_JUST_DAYS * DAY) {
    return { kind: 'ordered', reference: f.lastOrder.reference, at: f.lastOrder.confirmedAt };
  }
  if (f.quoteSentAt && !(f.lastOrder && f.lastOrder.confirmedAt >= f.quoteSentAt)) {
    return { kind: 'quoted', at: f.quoteSentAt };
  }
  if (f.lastFromThemAt && now.getTime() - f.lastFromThemAt.getTime() >= QUIET_DAYS * DAY) {
    return { kind: 'quiet', since: f.lastFromThemAt };
  }
  if (!f.lastMessage) return { kind: 'none' };
  return now.getTime() - f.lastMessage.at.getTime() < TALKING_MINUTES * MINUTE
    ? { kind: 'talking', from: f.lastMessage.from, at: f.lastMessage.at }
    : { kind: 'last', from: f.lastMessage.from, at: f.lastMessage.at };
}
