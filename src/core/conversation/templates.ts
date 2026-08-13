import type { BlockingReason, Quote, QuoteRefusal } from '../types/commerce.js';
import { currencySymbol } from '../types/money.js';

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

export function orderConfirmedReply(input: {
  orderReference: string;
  productName: string;
  quantity: number;
  unit: string;
  email: string;
}): string {
  const { orderReference, productName, quantity, unit, email } = input;
  return (
    `Your order is confirmed — reference ${orderReference}: ` +
    `${quantity.toLocaleString('en-US')} ${unit} of ${productName}. ` +
    `A confirmation email is on its way to ${email}.`
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
      return 'How many pieces should I put on the order?';
    case 'quantity_below_moq':
      return quote
        ? `The minimum order for this product is ${quote.moq.toLocaleString('en-US')} pieces — would that quantity work for you?`
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
    // M36 — she does not quote past this; the owner decides. The note exists so
    // the deterministic fallback says something true if it is ever reached, and
    // the allowed numerals are the two REAL prices — nothing here may invent a
    // third.
    case 'contradicts_history':
      return {
        note: 'This buyer was already quoted a different price for this product. Do not state a new price.',
        allow: [refusal.prior.unitPrice.amount, refusal.prior.quantity,
                refusal.proposedUnitPrice.amount, refusal.proposedQuantity],
      };
    case 'below_moq':
      return {
        note: `Quantity ${refusal.requested} is below the minimum of ${refusal.moq}.`,
        allow: [refusal.moq, refusal.requested],
      };
    case 'below_floor':
      return { note: 'The requested price is below what we can offer.', allow: [] };
    case 'no_price_tier':
    case 'no_price_configured':
      return { note: 'No price is configured for this quantity — a human must quote.', allow: [] };
  }
}

export const HANDOFF_REPLY =
  'Thanks — one of our specialists will follow up with you personally, shortly.';

/** Last-resort reply when generation failed the numeral guard twice. */
export function guardFallbackReply(quote: Quote | null, nextQuestion: string | null): string {
  if (quote) {
    return (
      `For ${quote.quantity.value.toLocaleString('en-US')} ${quote.quantity.unit}, ` +
      // Symbol and code both come from the quote's currency. A hardcoded "$"
      // beside an amount that is not dollars is the defect M43a removes.
      `the unit price is ${currencySymbol(quote.unitPrice.currency)}${quote.unitPrice.amount.toFixed(2)} ${quote.unitPrice.currency} — ` +
      `${currencySymbol(quote.total.currency)}${quote.total.amount.toLocaleString('en-US')} in total` +
      (quote.leadTimeDays ? `, with a lead time of ${quote.leadTimeDays} days.` : '.')
    );
  }
  return nextQuestion ?? 'Thanks for your message — could you tell me a little more about what you need?';
}
