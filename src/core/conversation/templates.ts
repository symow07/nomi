import type { BlockingReason, Quote, QuoteRefusal } from '../types/commerce.js';
import { currencySymbol, symbolIsCode } from '../types/money.js';

/**
 * Deterministic outbound templates.
 *
 * Requirement: "Every outbound commitment must remain deterministic."
 * A message that COMMITS the business — an order confirmation, a refusal, a
 * blocking question about money — is rendered here, from code, with numbers
 * that came from SQL. The LLM writes conversational prose; it never writes
 * commitments. (Multilingual variants land with the follow-up engine; a
 * commitment in English beats a hallucination in the client's language.)
 */

/**
 * G4 — "A confirmation email is on its way" was a promise nothing in this
 * product can keep: it sends no e-mail at all until M40 has a sender. The buyer
 * was told to wait for a message that would never come. What happens next is
 * the factory's own step, and that is what is said.
 */
export function orderConfirmedReply(input: {
  orderReference: string;
  productName: string;
  quantity: number;
  unit: string;
}): string {
  const { orderReference, productName, quantity, unit } = input;
  return (
    `Your order is confirmed — reference ${orderReference}: ` +
    `${quantity.toLocaleString('en-US')} ${unit} of ${productName}. ` +
    // The positioning rewrite (2026-09-30): not every business is a factory,
    // and not every one sends a proforma.
    `We'll send you the invoice next.`
  );
}

export function orderBlockedReply(reasons: readonly BlockingReason[], quote: Quote | null): string {
  // One question at a time: the FIRST unmet requirement, in funnel order.
  const first = reasons[0];
  switch (first) {
    case 'email_missing':
      return 'Almost there — could you share the email address for the order confirmation?';
    case 'product_not_confirmed_by_client':
      return 'Before I confirm — could you confirm this is exactly the product you want?';
    case 'quantity_missing':
      return 'How many would you like?';
    case 'quantity_below_moq':
      // 0081 — only a product with a stated minimum is ever below it; the
      // minimum is said in the product's own unit, not in "pieces".
      return quote && quote.moq !== null
        ? `The minimum order for this product is ${quote.moq.toLocaleString('en-US')} ${quote.quantity.unit} — would that quantity work for you?`
        : 'The requested quantity is below the minimum order for this product — could you increase it?';
    case 'pending_question_unresolved':
      return 'Just to be sure we are aligned — could you answer my previous question first?';
    case 'problem_score_too_high':
    case 'conversation_handed_off':
      return 'A colleague of mine will personally review this order with you shortly.';
    case 'missing_product':
      return 'Could you tell me which product you would like to order?';
    default:
      return 'I need one more detail before I can confirm — bear with me a moment.';
  }
}

export function quoteRefusalContext(refusal: QuoteRefusal): { note: string; allow: number[] } {
  switch (refusal.kind) {
    case 'below_moq':
      return {
        note: `Quantity ${refusal.requested} is below the minimum of ${refusal.moq}.`,
        allow: [refusal.moq, refusal.requested],
      };
    case 'below_floor':
      return { note: 'The requested price is below what we can offer.', allow: [] };
    case 'no_price_tier':
    case 'no_price_configured':
      // Passed as next_question, so it can reach the customer: said the way a customer may read it.
      return { note: 'There is no price set for this yet. Do not give one; say someone from the team will confirm the price.', allow: [] };
  }
}

/** The positioning rewrite (2026-09-30): "specialists" assumed a sales team; a one-person brand has none. */
export const HANDOFF_REPLY =
  'Thanks — someone from our team will reply to you personally, as soon as they can.';

/**
 * G8 — the one reply that needs no guard: no figure, no claim, no promise, no
 * word an owner could reasonably forbid. Used when even the stand-in below
 * fails a guard, and always held for her (core/conversation/hold.ts).
 */
export const SAFE_REPLY = 'Thanks for your message — let me check the details and come back to you shortly.';

/**
 * Stand-in when generation failed the guards twice. G8: guarded before use
 * (pipeline/turn.ts), and `nextQuestion` must be the analyser's question —
 * never an internal note meant for the writer.
 */
export function guardFallbackReply(quote: Quote | null, nextQuestion: string | null): string {
  // RT — the price of one, as a shop gives it: no "for 1 pcs", no total that repeats it.
  if (quote && quote.quantity.value === 1) {
    return `${currencySymbol(quote.unitPrice.currency)}${quote.unitPrice.amount.toFixed(2)}` +
      `${symbolIsCode(quote.unitPrice.currency) ? '' : ` ${quote.unitPrice.currency}`} each` +
      (quote.leadTimeDays ? `, ready in ${quote.leadTimeDays} days.` : '.');
  }
  if (quote) {
    return (
      `For ${quote.quantity.value.toLocaleString('en-US')} ${quote.quantity.unit}: ` +
      // Symbol and code both come from the quote's currency. A hardcoded "$"
      // beside an amount that is not dollars is the defect M43a removes.
      // CUR — a currency written by its code ("AED 12.00") is not repeated after it.
      `${currencySymbol(quote.unitPrice.currency)}${quote.unitPrice.amount.toFixed(2)}` +
      `${symbolIsCode(quote.unitPrice.currency) ? '' : ` ${quote.unitPrice.currency}`} each, ` +
      `${currencySymbol(quote.total.currency)}${quote.total.amount.toLocaleString('en-US')} in total` +
      // The positioning rewrite: "lead time" is trade vocabulary.
      (quote.leadTimeDays ? `, ready in ${quote.leadTimeDays} days.` : '.')
    );
  }
  return nextQuestion ?? 'Thanks for your message — could you tell me a little more about what you need?';
}
