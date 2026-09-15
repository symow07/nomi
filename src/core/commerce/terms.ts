import { type Result, ok, err } from '../types/result.js';
import { INCOTERM_KEYS } from '../safety/claims.js';

/**
 * G6 — the terms on HER proforma, in her words.
 *
 * ── WHAT THIS REPLACES ────────────────────────────────────────────────────
 *
 * Every order this product confirmed was stamped "30% deposit, 70% before
 * shipment", and every proforma it rendered said FOB. Neither came from
 * anything the owner wrote: they were literals in the turn pipeline and the
 * message catalogue. A proforma is a commercial document a buyer pays against;
 * terms on it that she never gave are the most expensive invented number this
 * product could print.
 *
 * ── WHY THIS IS NOT THE CLAIMS POLICY ─────────────────────────────────────
 *
 * `claims_policy` says what she may SAY. It has payment-terms and incoterm
 * kinds, but its payment terms are four fixed patterns ("50% deposit" matches
 * none of them), and several incoterms may be allowed at once while a
 * proforma names exactly one. So her proforma terms are their own statement:
 * her wording for payment, and the one delivery term she puts on the document.
 * Stating an incoterm here also allows her employee to mention it — the same
 * decision, recorded where the guard reads it.
 *
 * ABSENCE IS THE ANSWER when she has said nothing: no terms, no proforma, and
 * she is told why. There is no default to fall back to.
 *
 * Pure per ADR-0002.
 */

export type TradeTerms = {
  /** Hers, verbatim — "30% deposit, balance against copy of B/L". Never parsed. */
  readonly paymentTerms: string;
  /** One of the delivery terms the claims guard knows. */
  readonly incoterm: string;
  readonly statedAt: Date;
};

export type TradeTermsError = 'payment_missing' | 'payment_too_long' | 'incoterm_invalid';

/** Long enough for a real clause; short enough to be a term, not a contract. */
export const MAX_PAYMENT_TERMS = 200;

export function validateTradeTerms(input: {
  readonly payment?: string | null;
  readonly incoterm?: string | null;
  readonly now: Date;
}): Result<TradeTerms, TradeTermsError> {
  const payment = (input.payment ?? '').trim();
  if (!payment) return err('payment_missing');
  if (payment.length > MAX_PAYMENT_TERMS) return err('payment_too_long');
  const incoterm = (input.incoterm ?? '').trim().toUpperCase();
  if (!INCOTERM_KEYS.includes(incoterm)) return err('incoterm_invalid');
  return ok({ paymentTerms: payment, incoterm, statedAt: input.now });
}
