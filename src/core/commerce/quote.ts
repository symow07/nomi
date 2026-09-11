import { type Result, ok, err } from '../types/result.js';
import {
  type Money, scaleMoney, roundMoney, isBelow, isAbove, compareMoney,
} from '../types/money.js';
import { blockingClosure, type FactoryClosure } from './closures.js';
import type {
  HistoryContradiction,
  NegotiationRule,
  PriceTier,
  PricingPolicy,
  Product,
  PriorQuote,
  Quote,
  QuoteRefusal,
  RuleAction,
} from '../types/commerce.js';

/** Round to cents. Floating point must never leak into a quoted price. */
const cents = (n: number): number => Math.round(n * 100) / 100;

/** Select the volume tier for a quantity. Tiers are half-open: [minQty, maxQty]. */
export function selectTier(tiers: readonly PriceTier[], qty: number): PriceTier | null {
  const matches = tiers.filter(
    (t) => qty >= t.minQty && (t.maxQty === null || qty <= t.maxQty),
  );
  if (matches.length === 0) return null;
  // Most specific wins: the highest minQty that still applies.
  return matches.reduce((best, t) => (t.minQty > best.minQty ? t : best));
}

function matches(rule: NegotiationRule, product: Product, qty: number, gross: Money): boolean {
  const c = rule.condition;
  if (c.qtyGte !== undefined && qty < c.qtyGte) return false;
  if (c.qtyLte !== undefined && qty > c.qtyLte) return false;
  if (c.productId !== undefined && c.productId !== product.id) return false;
  // The rule's threshold is written in the quote's own currency — there is
  // one, and M43b is where a second one gets a rate she stated.
  if (c.totalValueGte !== undefined && isBelow(gross, { amount: c.totalValueGte, currency: gross.currency })) return false;
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
  unitPrice: Money,
): HistoryContradiction | null {
  const prior = [...priors].sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  if (!prior) return null;
  // The same or cheaper is never a contradiction. `compareMoney` refuses to
  // order two currencies rather than comparing their bare amounts, so a prior
  // quote in another currency cannot silently look cheap.
  if (!isAbove(unitPrice, prior.unitPrice)) return null;

  const how = quantity > prior.quantity ? 'higher_at_larger_quantity' : 'higher_same_quantity';
  return {
    prior,
    proposedUnitPrice: unitPrice,
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
  /**
   * M44 — the days her factory is shut, as she stated them. Absent means she
   * has stated none, which is not the same as "open": it is "she has not told
   * us", and the lead time is quoted exactly as it always was. Adding a
   * calendar of our own would be inventing her shutdown.
   */
  closures?: readonly FactoryClosure[];
  /** Today, injected — core is pure and owns no clock (ADR-0002). */
  now?: Date;
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

  const listUnit = tier.unitPrice;
  const gross = scaleMoney(listUnit, quantity);

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
  if (policy) {
    // 1. The AI's discount authority.
    if (discountPct > policy.maxDiscountPct) {
      discountPct = policy.maxDiscountPct;
      applied.push(`clamped_to_authority:${policy.maxDiscountPct}`);
    }
  }

  let unitPrice = roundMoney(scaleMoney(listUnit, 1 - discountPct / 100));

  // 2. The floor. Absolute. Nothing crosses it.
  if (policy && isBelow(unitPrice, policy.floorPrice)) {
    // Prefer degrading the discount to refusing the sale entirely...
    if (compareMoney(listUnit, policy.floorPrice) >= 0) {
      unitPrice = policy.floorPrice;
      discountPct = cents(((listUnit.amount - unitPrice.amount) / listUnit.amount) * 100);
      applied.push(`clamped_to_floor:${policy.floorPrice.amount}`);
    } else {
      // ...but if even the list price is below the floor, the catalog is
      // misconfigured. Refuse rather than quote a loss.
      return err({ kind: 'below_floor', floorPrice: policy.floorPrice });
    }
  }

  // 3. Her "ask me above this" line. We do NOT refuse — the reply waits for
  //    her (pipeline/turn.ts holds it as a draft).
  //
  // G7a — decided on the discount the buyer would actually GET, after both
  // clamps. It used to be decided before the floor: 25% asked for, clamped to
  // a 20% authority, then to a floor that left 6.67% — and the quote still
  // said it needed her sign-off for a discount nobody was being given. Once
  // this decides draft-vs-send, that is a false hold on every floor-clamped
  // quote.
  const requiresHuman = policy !== null && discountPct > policy.humanRequiredAbovePct;

  // ── M36 · THE CONSISTENCY GUARD ─────────────────────────────────────────
  //
  // below_floor asks "does this break the owner's POLICY"; this asks "does
  // this break what she already TOLD this buyer". Unlike below_floor it does
  // not refuse (G7b): the price may be right, and only she can decide to
  // stand behind it. The quote carries the contradiction, the turn holds the
  // reply for her, and her 发送 is what makes the new price the one he has.
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
  // new buyer, and holding there would make every first quote wait.
  //
  // "History" is what he was actually given: auto-sent, or approved by her
  // unchanged (db/repos.ts `priorQuotesForClient`). A draft she skipped or
  // rewrote never set his expectation, so it never sets the baseline.
  const contradicts = contradictsHistory(input.priorQuotes ?? [], quantity, unitPrice);

  // ── M44 · SHE DOES NOT PROMISE A DATE THE FACTORY CANNOT HIT ────────────
  //
  // Not rescheduled — REFUSED. Adding the closed days and quoting the later
  // date would be a promise she never made: a factory does not resume at full
  // rate the morning it reopens. So the number goes away, and with it every
  // reply's ability to state one: `guardNumerals` sources figures from the
  // quote, so a lead time that is null cannot appear in a sentence.
  const blocked = leadTimeDays !== null && input.now
    ? blockingClosure({ now: input.now, leadTimeDays, closures: input.closures ?? [] })
    : null;

  return ok({
    productId: product.id,
    quantity: { value: quantity, unit: product.unit },
    unitPrice,
    discountPct,
    total: roundMoney(scaleMoney(unitPrice, quantity)),
    moq: product.moq,
    leadTimeDays: blocked ? null : leadTimeDays,
    leadTimeBlocked: blocked,
    requiresHuman,
    contradicts,
    appliedRules: applied,
  });
}
