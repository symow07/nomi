import { describe, it, expect } from 'vitest';
import { usd } from '../../src/core/types/money.js';
import { computeQuote, contradictsHistory } from '../../src/core/commerce/quote.js';
import { quoteRefusalContext } from '../../src/core/conversation/templates.js';
import type { PriorQuote } from '../../src/core/types/commerce.js';
import { product, tiers, policy } from './fixtures.js';

/**
 * M36 — she does not contradict herself.
 *
 * $0.38 in March and $0.44 in May destroys a relationship, and a human
 * salesperson would remember. `quotes` existed and `isReturning` existed; the
 * guard did not, so the only thing standing between a returning buyer and a
 * contradiction was that nobody had tried it yet.
 *
 * Built as `below_floor`'s sibling: same mechanic (a refusal out of
 * computeQuote), same fail-closed posture, a different axis — history rather
 * than policy. The owner may APPROVE the new price. She may not be surprised by
 * it in front of a buyer who kept the first message.
 */

const march = new Date('2026-03-04T10:00:00Z');
const may = new Date('2026-05-20T10:00:00Z');
const prior = (quantity: number, unitPrice: number, at = march): PriorQuote =>
  ({ quantity, unitPrice: usd(unitPrice), at });

const quote = (quantity: number, priorQuotes: readonly PriorQuote[] = []) =>
  computeQuote({ product: product(), tiers: tiers(), policy: policy(), rules: [], quantity, priorQuotes });

describe('M36 · a higher price for a returning buyer stops and asks', () => {
  it('the same quantity at a higher price is refused, with BOTH numbers and BOTH dates', () => {
    // The fixture's price for 20,000 is well below this invented prior, so the
    // new quote is the cheaper one — flip it: claim she was quoted very little.
    const r = quote(20000, [prior(20000, 0.01)]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('contradicts_history');
    if (r.error.kind !== 'contradicts_history') return;
    expect(r.error.how).toBe('higher_same_quantity');
    expect(r.error.prior.unitPrice).toEqual(usd(0.01));
    expect(r.error.prior.at).toEqual(march);
    expect(r.error.proposedQuantity).toBe(20000);
    expect(r.error.proposedUnitPrice.amount).toBeGreaterThan(0.01);
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
    expect(quote(20000).ok).toBe(true);
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

describe('M36 · the refusal reaches the owner without inventing anything', () => {
  it('names no price the history does not contain', () => {
    const r = contradictsHistory([prior(20000, 0.30)], 20000, usd(0.44))!;
    const ctx = quoteRefusalContext({ ...r });
    // Only the four real figures are permitted into a reply.
    expect(new Set(ctx.allow)).toEqual(new Set([0.30, 20000, 0.44, 20000]));
    expect(ctx.note).not.toMatch(/\d/);   // the note itself states no number
  });

  it('tells the reply writer NOT to state a new price', () => {
    const r = contradictsHistory([prior(20000, 0.30)], 20000, usd(0.44))!;
    expect(quoteRefusalContext({ ...r }).note.toLowerCase()).toContain('do not state a new price');
  });
});

describe('M36 · it is below_floor’s sibling, structurally', () => {
  it('refuses through the same Result channel, not a side effect', () => {
    const r = quote(20000, [prior(20000, 0.01)]);
    expect(r.ok).toBe(false);
    // No quote is produced at all — she cannot half-quote and hope.
    if (!r.ok) expect('value' in r).toBe(false);
  });

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
