import { type Result, ok, err } from '../types/result.js';
import { scaleMoney, subMoney } from '../types/money.js';
import type { BlockingReason, ConfirmableOrder, Product, Quote } from '../types/commerce.js';
import type { ConversationState } from '../types/conversation.js';
import { PROBLEM_HANDOFF_THRESHOLD } from '../scoring/signals.js';

const CENT = 0.01;

/**
 * The order gate. Deterministic. This REPLACES the `Claude - Order Validation`
 * LLM call entirely.
 *
 * The old system asked a language model to check nine rules — is the UUID
 * present, is qty >= MOQ, does the email contain "@", does total == qty * price.
 * We were paying a model to do arithmetic and regex, slowly, at a cost, with a
 * nonzero error rate, on the one gate that stands between a conversation and
 * real money. Worse: a model that decides whether an order is valid is a model
 * that can be TALKED INTO deciding an order is valid. Prompt injection reached
 * straight into the money path.
 *
 * All nine rules are mechanical. So they are code.
 *
 * `ConfirmableOrder` is branded and has no public constructor: this function is
 * the only way to obtain one, and the order repository will not accept anything
 * else. You therefore cannot write an order to the database that has not passed
 * every rule — the Milestone-0 failure becomes unrepresentable, not merely
 * tested for.
 */
export function toConfirmableOrder(input: {
  state: ConversationState;
  product: Product | null;
  quote: Quote | null;
  paymentTerms: string;
}): Result<ConfirmableOrder, BlockingReason[]> {
  const { state, product, quote, paymentTerms } = input;
  const reasons: BlockingReason[] = [];

  // Rule 0 (new): a human owns this conversation. The AI does not close deals
  // behind a human's back. This did not exist in the n8n system.
  if (state.assignedTo !== null) reasons.push('conversation_handed_off');

  // Rule 1: product identified.
  if (!state.product || !product) reasons.push('missing_product');

  // Rule 2: the client actually confirmed it.
  // In the old system this could NEVER be true — nothing ever set it.
  if (state.product && !state.product.confirmedByClient) {
    reasons.push('product_not_confirmed_by_client');
  }

  // Rules 3 & 4: quantity present, and at or above MOQ.
  if (!state.quantity || state.quantity.value <= 0) {
    reasons.push('quantity_missing');
  } else if (product && state.quantity.value < product.moq) {
    reasons.push('quantity_below_moq');
  }

  // Rule 5: we have a price.
  if (!quote || quote.unitPrice.amount <= 0) reasons.push('price_missing');

  // Rule 6: the arithmetic is right. (An LLM was doing this.)
  if (quote && state.quantity) {
    // Both sides of this check are in the quote's own currency, so the
    // subtraction is between comparable amounts by construction.
    const expected = scaleMoney(quote.unitPrice, state.quantity.value);
    if (Math.abs(subMoney(quote.total, expected).amount) > CENT) reasons.push('total_mismatch');
  }

  // Rule 7: a validated email. Nothing in the old system ever captured one.
  if (!state.contact.email) reasons.push('email_missing');

  // Rule 8: no question left hanging.
  if (state.pendingQuestion !== null) reasons.push('pending_question_unresolved');

  // Rule 9: PROBLEM score only. `lead` is deliberately absent — a hot lead is a
  // reason to close faster, not a reason to block. The old single monotonic
  // score made large orders unclosable.
  if (state.scores.problem >= PROBLEM_HANDOFF_THRESHOLD) {
    reasons.push('problem_score_too_high');
  }

  if (reasons.length > 0) return err(reasons);

  // Everything above passed, so these are all non-null. The casts are safe and
  // are confined to this one place, immediately after the checks that prove them.
  const q = quote as Quote;
  const qty = state.quantity as NonNullable<ConversationState['quantity']>;
  const email = state.contact.email as NonNullable<ConversationState['contact']['email']>;
  const p = product as Product;

  return ok({
    productId: p.id,
    quantity: qty,
    unitPrice: q.unitPrice,
    total: q.total,
    email,
    paymentTerms,
  } as ConfirmableOrder);
}
