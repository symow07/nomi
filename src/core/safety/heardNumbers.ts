import type { Quote } from '../types/commerce.js';
import { extractNumerals } from './numerals.js';

/**
 * M34.5 — a number she HEARD is not a number she was told.
 *
 * M34 allows her to act on an uncertain transcript, and that is right: a
 * transcript is a reading of what the BUYER said, not a claim by the factory,
 * so it may be uncertain provided the uncertainty is visible. Numbers are the
 * exception, and the exception matters more than the rule.
 *
 * "2,000 pieces" heard as "20,000" changes the tier, changes the unit price,
 * and she states it with total confidence — turning the machine's guess into a
 * factory price, in writing, to a B2B buyer. That is precisely the exposure
 * `numerals.ts` exists to prevent, arriving through a door it cannot see:
 * `guardNumerals` treats `clientText` as a SOURCE of truth ("the client's own
 * figures"), and a transcript passed as clientText launders a mishearing into
 * a sourced numeral. The guard is not wrong; it was written when the client's
 * text was the client's text.
 *
 * THE RULE. A quantity that came from a transcript and drove a quote does not
 * auto-send. It becomes a draft, and the owner — who can see the audio, the
 * words heard, and the price they produced, all on one screen — decides.
 *
 * WHY DRAFT RATHER THAN ASKING THE BUYER TO CONFIRM. Both were open. Drafting
 * reuses machinery that already exists and is already trusted: autonomy is
 * per-capability and revocable, "turning a capability on does not grant
 * permission to send" is the product's oldest rule, and the owner surface for
 * reviewing a draft is built. Asking the buyer would mean composing a new kind
 * of reply, and would spend a buyer's turn on the machine's uncertainty rather
 * than the owner's attention — the wrong person paying for it.
 *
 * NARROW ON PURPOSE. It fires only when the number actually reached the price.
 * A quantity the owner typed last week, carried in conversation state, is not
 * re-heard this turn and does not downgrade anything.
 *
 * Pure per ADR-0002.
 */

/** Where this turn's text came from. Typed is the historical default. */
export type TextProvenance = 'typed' | 'transcribed' | 'photo';

export function quantityWasHeardNotTyped(input: {
  readonly provenance: TextProvenance;
  readonly quote: Quote | null;
  /** The text the turn actually ran on — the transcript, when there was one. */
  readonly turnText: string;
}): boolean {
  if (input.provenance !== 'transcribed') return false;
  if (!input.quote) return false;
  // Did the quantity that priced this quote come out of the heard words? If
  // the figure is not in the transcript, it came from somewhere she was told.
  const heard = new Set(extractNumerals(input.turnText).map((n) => n.value));
  return heard.has(input.quote.quantity.value);
}
