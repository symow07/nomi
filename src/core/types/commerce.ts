import type { Brand } from './brand.js';
import type { BusinessId, Email, ProductId } from './ids.js';
import type { Quantity } from './conversation.js';

/**
 * THE CENTRAL RULE OF THIS FILE
 *
 *   Postgres owns the numbers. The LLM writes prose and may never invent a
 *   figure — no price, no MOQ, no discount, no lead time, no shipping cost.
 *
 * Every type here exists so that a number reaching a customer can be traced to
 * a row in the database. See docs/adr/0006.
 */

export type Product = {
  readonly id: ProductId;
  readonly businessId: BusinessId;
  readonly sku: string;
  readonly name: string;
  readonly moq: number;
  readonly unit: string;
  readonly leadTimeDays: number | null;
  readonly customizable: boolean;
};

/** Volume break. `maxQty: null` = unbounded. */
export type PriceTier = {
  readonly productId: ProductId;
  readonly minQty: number;
  readonly maxQty: number | null;
  readonly unitPriceUsd: number;
};

/**
 * The guardrail the AI may never cross.
 *
 * `floorPriceUsd` is enforced in CODE, so no prompt — however cleverly injected
 * — can discount below it. This is what makes "negotiate within business rules"
 * a real constraint rather than a polite request to a language model.
 */
export type PricingPolicy = {
  readonly businessId: BusinessId;
  /** null = business-wide default */
  readonly productId: ProductId | null;
  readonly floorPriceUsd: number;
  /** The AI's own authority, in percent. */
  readonly maxDiscountPct: number;
  /** Beyond this, a human must approve. Triggers handoff, not refusal. */
  readonly humanRequiredAbovePct: number;
};

/** "3% off above 10,000 units." Deterministic, priority-ordered. */
export type NegotiationRule = {
  readonly businessId: BusinessId;
  readonly priority: number;
  readonly condition: RuleCondition;
  readonly action: RuleAction;
};

export type RuleCondition = {
  readonly qtyGte?: number;
  readonly qtyLte?: number;
  readonly productId?: ProductId;
  readonly category?: string;
  readonly totalValueGte?: number;
};

export type RuleAction =
  | { readonly kind: 'discount_pct'; readonly value: number }
  | { readonly kind: 'free_samples'; readonly count: number }
  | { readonly kind: 'free_shipping' }
  | { readonly kind: 'lead_time_days'; readonly value: number };

/** "Buy A + B together, get C." Drives cross-sell without the LLM inventing offers. */
export type BundleRule = {
  readonly businessId: BusinessId;
  readonly name: string;
  readonly requires: readonly ProductId[];
  readonly grants: RuleAction;
};

/** "Out of stock / below MOQ → offer this instead." Drives recommendation. */
export type SubstitutionRule = {
  readonly businessId: BusinessId;
  readonly productId: ProductId;
  readonly substituteId: ProductId;
  readonly reason: 'below_moq' | 'out_of_stock' | 'cheaper' | 'upsell';
  readonly rank: number;
};

/**
 * A computed, authoritative quote. Every number here came from SQL and
 * deterministic arithmetic. This is the ONLY source of figures permitted in an
 * outbound message — the numeral guard rejects anything else.
 */
export type Quote = {
  readonly productId: ProductId;
  readonly quantity: Quantity;
  readonly unitPriceUsd: number;
  readonly discountPct: number;
  readonly totalUsd: number;
  readonly moq: number;
  readonly leadTimeDays: number | null;
  /** Discount exceeds the AI's authority → route to a human before sending. */
  readonly requiresHuman: boolean;
  /** Which rules fired. For audit, and for explaining the price to the client. */
  readonly appliedRules: readonly string[];
};

/** A price this buyer was already given for this product. M36. */
export type PriorQuote = {
  readonly quantity: number;
  readonly unitPriceUsd: number;
  readonly at: Date;
};

export type QuoteRefusal =
  | { readonly kind: 'below_moq'; readonly moq: number; readonly requested: number }
  | { readonly kind: 'below_floor'; readonly floorPriceUsd: number }
  | { readonly kind: 'no_price_tier'; readonly quantity: number }
  | { readonly kind: 'no_price_configured' }
  /**
   * M36 — this contradicts what she already told this buyer.
   *
   * Not a price error: the new number may be perfectly correct. It is a
   * RELATIONSHIP error, and the owner is the only person who can decide whether
   * to stand behind it. She sees both prices and both dates and may approve it;
   * what she may not be is surprised by it in front of a buyer who remembers.
   */
  | {
      readonly kind: 'contradicts_history';
      readonly prior: PriorQuote;
      readonly proposedUnitPriceUsd: number;
      readonly proposedQuantity: number;
      /** Which way it contradicts — the two cases are not equally bad. */
      readonly how: 'higher_same_quantity' | 'higher_at_larger_quantity';
    };

/**
 * An order that has passed EVERY rule.
 *
 * Branded and unconstructable by hand: the only way to obtain one is
 * `toConfirmableOrder()`, which returns Result. You therefore cannot write an
 * order to the database without having passed validation — the Milestone-0
 * failure (an order path that could never validate) becomes unrepresentable
 * rather than merely tested for.
 *
 * This also DELETES the `Claude - Order Validation` LLM call. All nine rules are
 * mechanical; we were paying a language model to do arithmetic and regex on a
 * money gate that prompt injection could reach.
 */
export type ConfirmableOrder = Brand<
  {
    readonly productId: ProductId;
    readonly quantity: Quantity;
    readonly unitPriceUsd: number;
    readonly totalUsd: number;
    readonly email: Email;
    readonly paymentTerms: string;
  },
  'ConfirmableOrder'
>;

/** Why an order cannot yet be confirmed. Mirrors prompts/order_validation.txt. */
export type BlockingReason =
  | 'missing_product'
  | 'product_not_confirmed_by_client'
  | 'quantity_missing'
  | 'quantity_below_moq'
  | 'price_missing'
  | 'email_missing'
  | 'total_mismatch'
  | 'pending_question_unresolved'
  | 'problem_score_too_high'
  | 'conversation_handed_off';
