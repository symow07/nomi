import type { Quote } from '../types/commerce.js';
import { quantityWasHeardNotTyped, type TextProvenance } from '../safety/heardNumbers.js';

/**
 * G7a — ONE rule for "this reply waits for her", whatever her autonomy says.
 *
 * ── WHAT WAS WRONG ────────────────────────────────────────────────────────
 *
 * The owner answers "above how much off should she ask you first?" on her
 * price rules. `computeQuote` turned that into `requiresHuman`, the quote
 * audit stored it — and nothing ever read it. With `quote` in auto, a
 * discount past her line went straight to the buyer. The one hold that DID
 * exist (M34.5, a quantity heard in a voice note) was a boolean inline in
 * `commitTurn`, and the trust harness and the sandbox each re-derived the
 * mode without it, so they could not have described a held turn correctly.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────
 *
 * `computeTurn` decides one reason, and the three places that need to know
 * — `commitTurn` (the real send-or-draft), the trust harness and the
 * sandbox's live checks — read that one field. A hold only ever NARROWS
 * permission: auto becomes draft, draft stays draft, and a capability the
 * ops switches have silenced stays silent (which is why the invariant is
 * "never auto-sends", not "always a draft").
 *
 * The first reason that applies wins, most fundamental first: a price built
 * on a quantity she may have misheard is wrong before it contradicts him, and
 * contradicting him matters more than how generous it is.
 *
 * Pure per ADR-0002.
 */

export const HOLD_REASONS = [
  'quantity_heard_not_typed', 'contradicts_history', 'discount_needs_owner',
  // The identity guard's two, kept apart from `guards_failed_twice` and from
  // each other. They are not the same event to the owner: one is her employee
  // claiming to be a person, which is the thing that must never happen; the
  // other is a buyer asking a direct question and not getting an answer. A card
  // that called both "could not write this reply within your rules" would be
  // true and useless.
  'identity_denial', 'identity_question',
  'guards_failed_twice',
] as const;

export type HoldReason = (typeof HOLD_REASONS)[number];

export const isHoldReason = (s: unknown): s is HoldReason =>
  typeof s === 'string' && (HOLD_REASONS as readonly string[]).includes(s);

export function holdReasonOf(input: {
  readonly provenance: TextProvenance;
  readonly quote: Quote | null;
  /** The text the turn actually ran on — the transcript, when there was one. */
  readonly turnText: string;
  /** G8 — both generated attempts failed a guard, so the reply is a stand-in. */
  readonly guardsFailedTwice?: boolean;
  /**
   * Which identity failure stopped her, if that is what did. Only meaningful
   * alongside `guardsFailedTwice`: the guard firing once and the retry
   * succeeding is not a hold, it is the retry loop working.
   */
  readonly identity?: 'denied_being_ai' | 'identity_question_unanswered' | null;
}): HoldReason | null {
  if (quantityWasHeardNotTyped(input)) return 'quantity_heard_not_typed';
  // G7b — above what he was already told. Before her discount line: a price
  // that contradicts a buyer's history is the one she most needs to see, and
  // the card shows both prices whichever reason is named.
  if (input.quote?.contradicts) return 'contradicts_history';
  if (input.quote?.requiresHuman) return 'discount_needs_owner';
  // G8 — last: the price reasons say what she is deciding; these say the
  // wording is a plain stand-in, which she can see for herself. The identity
  // reasons are named ahead of the general one because they are the specific
  // thing that happened, and the card can only say what it is told.
  if (input.guardsFailedTwice) {
    if (input.identity === 'denied_being_ai') return 'identity_denial';
    if (input.identity === 'identity_question_unanswered') return 'identity_question';
    return 'guards_failed_twice';
  }
  return null;
}
