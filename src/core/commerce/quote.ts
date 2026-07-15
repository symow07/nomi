import { type Result, ok, err } from '../types/result.js';
import type {
  NegotiationRule,
  PriceTier,
  PricingPolicy,
  Product,
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
export function computeQuote(input: {
  product: Product;
  tiers: readonly PriceTier[];
  policy: PricingPolicy | null;
  rules: readonly NegotiationRule[];
  quantity: number;
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
