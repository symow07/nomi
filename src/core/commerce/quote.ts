import { type Result, ok, err } from '../types/result.js';
import type {
  NegotiationRule,
  PriceTier,
  PricingPolicy,
  Product,
  PriorQuote,
  Quote,
  QuoteRefusal,
  RuleAction,
} from '../types/commerce.js';

/** Round money to cents. Floating point must never leak into a quoted price. */
const money = (n: number): number => Math.round(n * 100) / 100;

/** Select the volume tier for a quantity. Tiers are half-open: [minQty, maxQty]. */
export function selectTier(tiers: readonly PriceTier[], qty: number): PriceTier | null {
  const matches = tiers.filter(
    (t) => qty >= t.minQty && (t.maxQty === null || qty <= t.maxQty),
  );
  if (matches.length === 0) return null;
  // Most specific wins: the highest minQty that still applies.
  return matches.reduce((best, t) => (t.minQty > best.minQty ? t : best));
}

function matches(rule: NegotiationRule, product: Product, qty: number, gross: number): boolean {
  const c = rule.condition;
  if (c.qtyGte !== undefined && qty < c.qtyGte) return false;
  if (c.qtyLte !== undefined && qty > c.qtyLte) return false;
  if (c.productId !== undefined && c.productId !== product.id) return false;
  if (c.totalValueGte !== undefined && gross < c.totalValueGte) return false;
  return true;
}

/**
 * Compute an authoritative quote.
 *
 * Total function. No LLM. No network. Every figure it returns is derived from
 * SQL rows and arithmetic — which is what lets the numeral guard (safety/numerals)
 * reject any other number in an outbound message.
 *
 * The floor price is enforced HERE, in code. That is the point: no prompt,
 * however cleverly injected, can talk the system below the floor, because the
 * language model is never the thing deciding the price.
 */
/**
 * M36 — does this price contradict one this buyer already has? Pure.
 *
 * Compares against the MOST RECENT prior quote rather than the cheapest ever
 * given: the buyer's expectation is set by the last thing they were told, and
 * comparing against an all-time low would refuse every legitimate recovery from
 * a one-off discount.
 */
export function contradictsHistory(
  priors: readonly PriorQuote[],
  quantity: number,
  unitPriceUsd: number,
): Extract<QuoteRefusal, { kind: 'contradicts_history' }> | null {
  const prior = [...priors].sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  if (!prior) return null;
  if (unitPriceUsd <= prior.unitPriceUsd) return null;   // the same or cheaper is never a contradiction

  const how = quantity > prior.quantity ? 'higher_at_larger_quantity' : 'higher_same_quantity';
  return {
    kind: 'contradicts_history',
    prior,
    proposedUnitPriceUsd: unitPriceUsd,
    proposedQuantity: quantity,
    how,
  };
}

export function computeQuote(input: {
  product: Product;
  tiers: readonly PriceTier[];
  policy: PricingPolicy | null;
  rules: readonly NegotiationRule[];
  quantity: number;
  /**
   * M36 — what this buyer was already quoted for THIS product. Absent means a
   * new buyer, and a new buyer cannot be contradicted. Optional so every
   * existing caller keeps its behaviour exactly.
   */
  priorQuotes?: readonly PriorQuote[];
}): Result<Quote, QuoteRefusal> {
  const { product, tiers, policy, rules, quantity } = input;

  if (quantity < product.moq) {
    return err({ kind: 'below_moq', moq: product.moq, requested: quantity });
  }
  if (tiers.length === 0) {
    return err({ kind: 'no_price_configured' });
  }

  const tier = selectTier(tiers, quantity);
  if (!tier) return err({ kind: 'no_price_tier', quantity });

  const listUnit = tier.unitPriceUsd;
  const gross = listUnit * quantity;

  // Apply negotiation rules in priority order. Discounts do not stack blindly:
  // we take the single best discount, which is how humans actually negotiate and
  // avoids "3% + 5% + 4%" silently giving away the margin.
  const applicable = rules
    .filter((r) => matches(r, product, quantity, gross))
    .sort((a, b) => a.priority - b.priority);

  const applied: string[] = [];
  let discountPct = 0;
  let leadTimeDays = product.leadTimeDays;

  for (const rule of applicable) {
    const a: RuleAction = rule.action;
    switch (a.kind) {
      case 'discount_pct':
        if (a.value > discountPct) {
          discountPct = a.value;
          applied.push(`discount_pct:${a.value}`);
        }
        break;
      case 'lead_time_days':
        leadTimeDays = a.value;
        applied.push(`lead_time_days:${a.value}`);
        break;
      case 'free_shipping':
        applied.push('free_shipping');
        break;
      case 'free_samples':
        applied.push(`free_samples:${a.count}`);
        break;
    }
  }

  // --- The guardrails. Both are hard. ---
  let requiresHuman = false;

  if (policy) {
    // 1. The AI's discount authority.
    if (discountPct > policy.maxDiscountPct) {
      discountPct = policy.maxDiscountPct;
      applied.push(`clamped_to_authority:${policy.maxDiscountPct}`);
    }
    // 2. Beyond this, a human signs it off. We do NOT refuse — we escalate.
    if (discountPct > policy.humanRequiredAbovePct) {
      requiresHuman = true;
    }
  }

  let unitPriceUsd = money(listUnit * (1 - discountPct / 100));

  // 3. The floor. Absolute. Nothing crosses it.
  if (policy && unitPriceUsd < policy.floorPriceUsd) {
    // Prefer degrading the discount to refusing the sale entirely...
    if (listUnit >= policy.floorPriceUsd) {
      unitPriceUsd = policy.floorPriceUsd;
      discountPct = money(((listUnit - unitPriceUsd) / listUnit) * 100);
      applied.push(`clamped_to_floor:${policy.floorPriceUsd}`);
    } else {
      // ...but if even the list price is below the floor, the catalog is
      // misconfigured. Refuse rather than quote a loss.
      return err({ kind: 'below_floor', floorPriceUsd: policy.floorPriceUsd });
    }
  }

  // ── M36 · THE CONSISTENCY GUARD ─────────────────────────────────────────
  //
  // below_floor's sibling: same mechanic, same fail-closed posture, a different
  // axis. below_floor asks "does this break the owner's POLICY"; this asks
  // "does this break what she already TOLD this buyer".
  //
  // WHAT "CONTRADICTS" MEANS, and why there are two cases rather than one:
  //
  //   higher_same_quantity — $0.38 in March, $0.44 in May for the same 20,000.
  //     The obvious case. A buyer who kept the first message reads the second
  //     as either a mistake or an attempt.
  //
  //   higher_at_larger_quantity — $0.38 for 20,000 in March, $0.41 for 50,000
  //     in May. WORSE, and easy to miss, because it inverts her own tier logic:
  //     every price sheet in this product says more units cost less each. A
  //     buyer who ordered more and was charged more per piece has been given a
  //     reason to distrust the price list itself, not just this quote.
  //
  // A LOWER price is not a contradiction. Coming down is a concession the owner
  // is free to make silently; going up is the thing that needs her signature.
  //
  // Absent history is not a contradiction either — `priorQuotes` empty means a
  // new buyer, and refusing there would make a first quote impossible.
  const contradiction = contradictsHistory(input.priorQuotes ?? [], quantity, unitPriceUsd);
  if (contradiction) return err(contradiction);

  return ok({
    productId: product.id,
    quantity: { value: quantity, unit: product.unit },
    unitPriceUsd,
    discountPct,
    totalUsd: money(unitPriceUsd * quantity),
    moq: product.moq,
    leadTimeDays,
    requiresHuman,
    appliedRules: applied,
  });
}
