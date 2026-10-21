import { describe, it, expect } from 'vitest';
import { computeQuote } from '../../src/core/commerce/quote.js';
import { confirmableFromProposal } from '../../src/core/commerce/confirmable.js';
import { moneyOf } from '../../src/core/types/money.js';
import { compareDecimal, decimal } from '../../src/core/types/decimal.js';
import type { NegotiationRule } from '../../src/core/types/commerce.js';
import { product, BUSINESS, PRODUCT } from './fixtures.js';

/**
 * A1 (Phase 5) — THE QUOTE ENGINE AND THE ORDER PATH, exact. The arithmetic itself is proven in exact-decimal.test.ts;
 * this drives the REAL `computeQuote` (tier, the owner's discount rule, her authority, her floor) and the REAL order
 * check (`confirmableFromProposal`) over random inputs, against a reference written separately here in exact
 * fractions. docs/PHASE-5.md §2.1: the old floating-point path quoted $5.30 less 5% as $5.03.
 */

// ── the reference: exact rationals, independent of decimal.ts ──────────────────────────────────────────────────────
// Every amount here is an integer count of 1/10,000 (price tiers and floors are numeric(10,4)); a percentage is an
// integer count of 1/100 (numeric(5,2)).
const halfUp = (num: bigint, den: bigint): bigint => {          // num/den ≥ 0, half away from zero
  return (2n * num + den) / (2n * den);
};
/** price (1/10,000) less pct (1/100 of a percent), rounded to cents → cents. */
const discountedCents = (price4: bigint, pct2: bigint): bigint => halfUp(price4 * (10_000n - pct2), 10_000n * 100n);
const text = (minor: bigint, places: number): string => {
  let d = minor.toString().padStart(places + 1, '0');
  if (places > 0) d = `${d.slice(0, -places)}.${d.slice(-places)}`;
  if (d.includes('.')) d = d.replace(/0+$/, '').replace(/\.$/, '');
  return d;
};

function mulberry32(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

const rule = (pct: string): NegotiationRule => ({
  businessId: BUSINESS, priority: 1, condition: {}, action: { kind: 'discount_pct', value: Number(pct) },
});

describe('A1 · the quote engine and the order check, exact', () => {
  it('§2.1 — $5.30 less 5% is quoted $5.04 (exactly 5.035), and the order of 1,000 totals $5,040.00', () => {
    const r = computeQuote({
      product: product({ moq: null }),
      tiers: [{ productId: PRODUCT, minQty: 1, maxQty: null, unitPrice: moneyOf('5.30', 'USD') }],
      policy: { businessId: BUSINESS, productId: null, floorPrice: moneyOf('1', 'USD'), maxDiscountPct: 10, humanRequiredAbovePct: 10 },
      rules: [rule('5')], quantity: 1000,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.unitPrice.amount).toBe('5.04');
    expect(r.value.total.amount).toBe('5040');
    expect(confirmableFromProposal({
      productId: PRODUCT as string, quantity: 1000, unit: 'pcs', unitPrice: r.value.unitPrice, total: r.value.total,
      email: null, paymentTerms: null, incoterm: null,
    }).ok).toBe(true);
  });

  it('200,000 RANDOM QUOTES through computeQuote and the order check — every one equal to the exact reference', () => {
    const r = mulberry32(20261022);
    const N = 200_000;
    let quoted = 0, refused = 0, wrongUnit = 0, wrongTotal = 0, wrongPct = 0, belowFloor = 0, wrongRefusal = 0;
    let orderRefused = 0, oldFloatWrong = 0, moreThanCents = 0;
    let first = '';
    for (let i = 0; i < N; i++) {
      // Half the cases as most shops write them — a price in whole cents, discounts in whole percent, where a
      // half-cent tie (5.30 less 5% = 5.035) is common; half anywhere in the stored range (four decimals, two).
      const plain = i % 2 === 0;
      const price4 = plain ? BigInt(int(r, 1, 99_999)) * 100n : BigInt(int(r, 1, 9_999_999));   // to 999.99 / 999.9999
      const rulePct2 = plain ? BigInt(int(r, 0, 50)) * 100n : BigInt(int(r, 0, 5_000));          // the owner's rule, to 50%
      const authority2 = plain ? BigInt(int(r, 0, 60)) * 100n : BigInt(int(r, 0, 6_000));        // her authority, to 60%
      const askAbove2 = BigInt(int(r, 0, 6_000));
      // the floor: usually below the price, sometimes above it (a refusal), at four decimals
      const floor4 = BigInt(int(r, 0, Number(price4) * 12 / 10 | 0));
      const qty = int(r, 1, 100_000);

      const price = text(price4, 4), floor = text(floor4, 4);
      const q = computeQuote({
        product: product({ moq: null }),
        tiers: [{ productId: PRODUCT, minQty: 1, maxQty: null, unitPrice: moneyOf(price, 'USD') }],
        policy: {
          businessId: BUSINESS, productId: null, floorPrice: moneyOf(floor, 'USD'),
          maxDiscountPct: Number(text(authority2, 2)), humanRequiredAbovePct: Number(text(askAbove2, 2)),
        },
        rules: rulePct2 > 0n ? [rule(text(rulePct2, 2))] : [], quantity: qty,
      });

      // the reference
      const pct2 = rulePct2 < authority2 ? rulePct2 : authority2;
      const cents = discountedCents(price4, pct2);
      const discounted4 = cents * 100n;                            // in 1/10,000
      let unit4: bigint | null; let refPct2: bigint;
      if (discounted4 >= floor4) { unit4 = discounted4; refPct2 = pct2; }
      else if (price4 >= floor4) { unit4 = floor4; refPct2 = halfUp((price4 - floor4) * 10_000n, price4); }
      else { unit4 = null; refPct2 = 0n; }

      // what the old code did, in floating point, for the same inputs (counted, not asserted on)
      if (unit4 !== null && discounted4 >= floor4) {
        // quote.ts before A1, exactly: roundMoney(scaleMoney(listUnit, 1 - discountPct / 100)), roundMoney being
        // Number(amount.toFixed(2)) — the list price a float from Number(row), the discount a float percentage.
        const old = Number(((Number(price) * (1 - Number(text(pct2, 2)) / 100)).toFixed(2)));
        if (old !== Number(text(cents, 2))) oldFloatWrong++;
      }

      if (unit4 === null) {
        if (q.ok || q.error.kind !== 'below_floor') { wrongRefusal++; if (!first) first = `${price} floor ${floor}: expected below_floor`; }
        else refused++;
        continue;
      }
      if (!q.ok) { wrongRefusal++; if (!first) first = `${price} less ${text(pct2, 2)}% floor ${floor}: refused ${q.error.kind}`; continue; }
      quoted++;
      const refUnit = text(unit4, 4);
      const refTotal = text(halfUp(unit4 * BigInt(qty), 100n), 2);
      if (q.value.unitPrice.amount !== refUnit) { wrongUnit++; if (!first) first = `${price} less ${text(pct2, 2)}%, floor ${floor}: unit ${q.value.unitPrice.amount}, reference ${refUnit}`; }
      if (q.value.total.amount !== refTotal) { wrongTotal++; if (!first) first = `${price} × ${qty}: total ${q.value.total.amount}, reference ${refTotal}`; }
      if (q.value.discountPct !== Number(text(refPct2, 2))) { wrongPct++; if (!first) first = `${price} floor ${floor}: discount ${q.value.discountPct}, reference ${text(refPct2, 2)}`; }
      if ((q.value.total.amount.split('.')[1]?.length ?? 0) > 2) moreThanCents++;
      if (compareDecimal(q.value.unitPrice.amount, decimal(floor)) < 0) belowFloor++;

      // the order: what the buyer confirms is checked against the same arithmetic, and passes
      const order = confirmableFromProposal({
        productId: PRODUCT as string, quantity: qty, unit: 'pcs', unitPrice: q.value.unitPrice, total: q.value.total,
        email: null, paymentTerms: null, incoterm: null,
      });
      if (!order.ok) { orderRefused++; if (!first) first = `${price} × ${qty}: the order check refused ${JSON.stringify(order.error)}`; }
    }
    console.log(`A1 quote property test: ${N.toLocaleString('en')} random quotes through computeQuote (half in whole cents and whole percent, ` +
      `half to 4 decimals and 2, a floor sometimes above the price, quantity 1–100,000): ${quoted.toLocaleString('en')} quoted, ` +
      `${refused.toLocaleString('en')} refused below the floor. Against the exact reference — unit price wrong: ${wrongUnit}; ` +
      `total wrong: ${wrongTotal}; discount wrong: ${wrongPct}; refused when it should not be, or not when it should: ${wrongRefusal}; ` +
      `below the floor: ${belowFloor}; total with more than cents: ${moreThanCents}; orders the check refused: ${orderRefused}. ` +
      `The old floating-point path on the same discounted prices: ${oldFloatWrong.toLocaleString('en')} a cent wrong.`);
    expect(first).toBe('');
    expect([wrongUnit, wrongTotal, wrongPct, wrongRefusal, belowFloor, moreThanCents, orderRefused]).toEqual([0, 0, 0, 0, 0, 0, 0]);
    // the control: the inputs reach the cases the old code got wrong, so "0 wrong" above is a result, not a vacuum
    expect(oldFloatWrong).toBeGreaterThan(0);
  }, 300_000);

  it('the order check still refuses a total that does not follow from the price — the test above can fail', () => {
    const order = confirmableFromProposal({
      productId: PRODUCT as string, quantity: 1000, unit: 'pcs', unitPrice: moneyOf('5.04', 'USD'), total: moneyOf('5030', 'USD'),
      email: null, paymentTerms: null, incoterm: null,
    });
    expect(order.ok).toBe(false);
    if (!order.ok) expect(order.error).toContain('total_mismatch');
  });
});
