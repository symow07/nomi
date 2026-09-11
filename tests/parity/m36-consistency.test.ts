import { describe, it, expect } from 'vitest';
import { usd } from '../../src/core/types/money.js';
import { computeQuote, contradictsHistory } from '../../src/core/commerce/quote.js';
import { holdReasonOf } from '../../src/core/conversation/hold.js';
import { guardNumerals } from '../../src/core/safety/numerals.js';
import type { PriorQuote } from '../../src/core/types/commerce.js';
import { product, tiers, policy, emptyState } from './fixtures.js';

/**
 * M36 — she does not contradict herself.
 *
 * $0.38 in March and $0.44 in May destroys a relationship, and a human
 * salesperson would remember. `quotes` existed and `isReturning` existed; the
 * guard did not, so the only thing standing between a returning buyer and a
 * contradiction was that nobody had tried it yet.
 *
 * Built first as `below_floor`'s sibling — a refusal out of computeQuote. G7b
 * made it a HOLD: refusing meant no quote, so the owner was never asked and
 * her approval could not make the new price stick. Now the quote exists and
 * carries the contradiction, the turn holds it for her, and her 发送 makes it
 * the price he has (tests/integration/contradiction.test.ts). She may not be
 * surprised by it in front of a buyer who kept the first message.
 */

const march = new Date('2026-03-04T10:00:00Z');
const may = new Date('2026-05-20T10:00:00Z');
const prior = (quantity: number, unitPrice: number, at = march): PriorQuote =>
  ({ quantity, unitPrice: usd(unitPrice), at });

const quote = (quantity: number, priorQuotes: readonly PriorQuote[] = []) =>
  computeQuote({ product: product(), tiers: tiers(), policy: policy(), rules: [], quantity, priorQuotes });

describe('M36 · a higher price for a returning buyer stops and asks', () => {
  it('the same quantity at a higher price is HELD, with BOTH numbers and BOTH dates', () => {
    // The fixture's price for 20,000 is well below this invented prior, so the
    // new quote is the cheaper one — flip it: claim she was quoted very little.
    const r = quote(20000, [prior(20000, 0.01)]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = r.value.contradicts;
    expect(c).not.toBeNull();
    expect(c!.how).toBe('higher_same_quantity');
    expect(c!.prior.unitPrice).toEqual(usd(0.01));
    expect(c!.prior.at).toEqual(march);
    expect(c!.proposedQuantity).toBe(20000);
    expect(c!.proposedUnitPrice).toEqual(r.value.unitPrice);
  });

  it('THE WORSE CASE: a higher unit price at a LARGER quantity inverts her own tiers', () => {
    // Every price sheet in this product says more units cost less each. A buyer
    // who ordered more and was charged more per piece has been given a reason to
    // distrust the price list itself, not just this quote.
    const r = contradictsHistory([prior(5000, 0.30)], 50000, usd(0.41));
    expect(r).not.toBeNull();
    expect(r!.how).toBe('higher_at_larger_quantity');
  });

  it('the two cases are distinguishable, because they are not equally bad', () => {
    expect(contradictsHistory([prior(20000, 0.30)], 20000, usd(0.44))!.how).toBe('higher_same_quantity');
    expect(contradictsHistory([prior(20000, 0.30)], 40000, usd(0.44))!.how).toBe('higher_at_larger_quantity');
  });
});

describe('M36 · what is NOT a contradiction', () => {
  it('a NEW buyer — no history means nothing to contradict', () => {
    expect(contradictsHistory([], 20000, usd(9.99))).toBeNull();
    const r = quote(20000);
    expect(r.ok && r.value.contradicts).toBeNull();
  });

  it('the SAME price again', () => {
    expect(contradictsHistory([prior(20000, 0.38)], 20000, usd(0.38))).toBeNull();
  });

  it('a LOWER price — coming down is a concession she may make silently', () => {
    expect(contradictsHistory([prior(20000, 0.44)], 20000, usd(0.38))).toBeNull();
    // and at any quantity
    expect(contradictsHistory([prior(5000, 0.50)], 50000, usd(0.30))).toBeNull();
  });

  it('compares against the MOST RECENT prior, not the cheapest ever given', () => {
    // A one-off discount in March followed by a return to list in May is a
    // recovery, and the buyer's expectation is set by the last thing they were
    // told. Comparing against an all-time low would refuse every legitimate one.
    const priors = [prior(20000, 0.20, march), prior(20000, 0.40, may)];
    expect(contradictsHistory(priors, 20000, usd(0.38))).toBeNull();     // below May's 0.40
    expect(contradictsHistory(priors, 20000, usd(0.44))).not.toBeNull();  // above it
  });
});

describe('G7b · it is a hold, not a refusal', () => {
  it('the quote exists and the turn holds it for her — the owner is ASKED', () => {
    // This test used to assert the opposite ("no half-quote"): a refusal
    // produced no quote, the turn fell to `recommend`, and nobody asked her.
    const r = quote(20000, [prior(20000, 0.01)]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(holdReasonOf({ provenance: 'typed', quote: r.value, turnText: 'price for 20000?' }))
      .toBe('contradicts_history');
  });

  it('the draft may state the NEW price, and only that — the old one is not a sourced figure', () => {
    // A held turn cannot auto-send, so stating the new price is safe: she
    // reads it before he does. The old price stays out of the reply; it is on
    // HER card, beside the new one.
    const r = quote(20000, [prior(20000, 0.30)]);
    if (!r.ok) throw new Error('fixture');
    const price = r.value.unitPrice.amount.toFixed(2);
    const at = (reply: string) => guardNumerals({ reply, quote: r.value, state: emptyState(), clientText: '', allow: [] }).ok;
    expect(at(`For 20,000 pcs the price is $${price} each.`)).toBe(true);
    expect(at('Last time it was $0.30 each.')).toBe(false);
  });
});

describe('M36 · the floor still comes first', () => {
  it('runs AFTER the floor, so a misconfigured catalogue still reports the floor first', () => {
    // Both wrong at once should surface the owner's own policy error, which is
    // hers to fix, rather than a history mismatch that is a consequence of it.
    const impossible = computeQuote({
      product: product(), tiers: tiers(),
      policy: { ...policy()!, floorPrice: usd(99) }, rules: [], quantity: 20000,
      priorQuotes: [prior(20000, 0.01)],
    });
    expect(impossible.ok).toBe(false);
    if (!impossible.ok) expect(impossible.error.kind).toBe('below_floor');
  });
});
