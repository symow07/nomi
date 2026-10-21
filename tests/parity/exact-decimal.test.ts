import { describe, it, expect } from 'vitest';
import {
  decimal, parseDecimal, fromInteger, addDecimal, subDecimal, mulDecimal, divDecimal, roundDecimal,
  compareDecimal, ceilDecimal, storedDecimal, type Decimal,
} from '../../src/core/types/decimal.js';
import { moneyFromRow, moneyFromStored } from '../../src/core/types/money.js';

/**
 * A1 (Phase 5) — exact decimals, proven against an INDEPENDENT reference: exact fractions (numerator / denominator in
 * BigInt), rounded half away from zero by integer arithmetic of their own. docs/PHASE-5.md §2.1 has the defect this
 * replaces: $5.30 less 5% (exactly 5.035) quoted $5.03.
 */

// ── the reference: exact rationals, written separately from decimal.ts ────────────────────────────────────────────
type Q = { readonly p: bigint; readonly q: bigint };           // p/q, q > 0
const gcd = (a: bigint, b: bigint): bigint => { a = a < 0n ? -a : a; while (b) [a, b] = [b, a % b]; return a; };
const norm = (p: bigint, q: bigint): Q => { if (q < 0n) { p = -p; q = -q; } const g = gcd(p, q) || 1n; return { p: p / g, q: q / g }; };
const qOf = (cents: bigint, scale: number): Q => norm(cents, 10n ** BigInt(scale));
const qMul = (a: Q, b: Q): Q => norm(a.p * b.p, a.q * b.q);
/** Half away from zero at `places`, as minor units. */
const qRoundMinor = (a: Q, places: number): bigint => {
  const num = a.p * 10n ** BigInt(places), den = a.q;
  const neg = num < 0n, abs = neg ? -num : num;
  const r = (2n * abs + den) / (2n * den);
  return neg ? -r : r;
};
const minorText = (m: bigint, places: number): string => {
  const neg = m < 0n; let d = (neg ? -m : m).toString().padStart(places + 1, '0');
  if (places > 0) d = `${d.slice(0, -places)}.${d.slice(-places)}`;
  return `${neg ? '-' : ''}${d}`;
};
/** Canonical form, as decimal.ts writes it (no trailing fractional zeros). */
const canon = (s: string): string => {
  if (!s.includes('.')) return s.replace(/^(-?)0+(\d)/, '$1$2') === '-0' ? '0' : s.replace(/^(-?)0+(\d)/, '$1$2');
  const t = s.replace(/0+$/, '').replace(/\.$/, '');
  return t === '-0' ? '0' : t;
};

// ── a seeded generator, so a failure names its own case ──────────────────────────────────────────────────────────
function mulberry32(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

describe('A1 · exact decimals', () => {
  it('§2.1, the cases the floating-point code got wrong, now exact (half away from zero)', () => {
    const discounted = (price: string, pct: string) =>
      roundDecimal(mulDecimal(decimal(price), subDecimal(decimal('1'), divDecimal(decimal(pct), decimal('100'), 6))), 2);
    expect(discounted('5.30', '5')).toBe('5.04');      // exactly 5.035 — the float quoted 5.03
    expect(discounted('5.10', '15')).toBe('4.34');     // exactly 4.335 — the float quoted 4.33
    expect(discounted('5.48', '12.5')).toBe('4.8');    // exactly 4.795 — the float quoted 4.79
    expect(discounted('0.12', '12.5')).toBe('0.11');   // exactly 0.105 — the float quoted 0.10
  });

  it('text in, canonical text out; nothing that is not a plain decimal gets in', () => {
    expect(parseDecimal('5.0350')).toBe('5.035');
    expect(parseDecimal('-0.50')).toBe('-0.5');
    expect(parseDecimal('007')).toBe('7');
    expect(parseDecimal('-0.000')).toBe('0');
    for (const bad of ['', ' 5', '5 ', '1e3', '5,03', '+5', '.5', '5.', 'NaN', 'Infinity', '0x10']) expect(parseDecimal(bad), bad).toBeNull();
    expect(() => decimal('5,03')).toThrow();
    expect(fromInteger(500)).toBe('500');
    expect(() => fromInteger(2.4)).toThrow();          // a float price is refused, never read
    expect(() => fromInteger(Number.MAX_SAFE_INTEGER + 2)).toThrow();
  });

  it('rounding is half away from zero, symmetric, at any number of places', () => {
    expect(roundDecimal(decimal('2.5'), 0)).toBe('3');
    expect(roundDecimal(decimal('-2.5'), 0)).toBe('-3');
    expect(roundDecimal(decimal('2.4999'), 0)).toBe('2');
    expect(roundDecimal(decimal('1.0049'), 2)).toBe('1');
    expect(roundDecimal(decimal('1.005'), 2)).toBe('1.01');   // the classic float trap: 1.005.toFixed(2) is "1.00"
    expect(roundDecimal(decimal('1234.5'), 3)).toBe('1234.5');
    expect(() => roundDecimal(decimal('1'), -1)).toThrow();
  });

  it('up to the next cent, for a floor that must never allow more off than was said', () => {
    expect(ceilDecimal(decimal('8.4915'), 2)).toBe('8.5');
    expect(ceilDecimal(decimal('8.49'), 2)).toBe('8.49');
    expect(ceilDecimal(decimal('0.000001'), 2)).toBe('0.01');
    expect(ceilDecimal(decimal('-1.005'), 2)).toBe('-1');       // toward positive infinity, not away from zero
    expect(ceilDecimal(decimal('12'), 2)).toBe('12');
    expect(() => ceilDecimal(decimal('1'), -1)).toThrow();
  });

  it('a STORED value reads back as the decimal that was written: text, or an older payload\'s number', () => {
    expect(storedDecimal('5.0350')).toBe('5.035');
    expect(storedDecimal(5.03)).toBe('5.03');                   // a number in a JSON payload written before A1
    expect(storedDecimal(0.1 + 0.2)).toBe('0.30000000000000004');   // read as stored, never "corrected" into 0.3
    expect(storedDecimal(1e-7)).toBeNull();                     // an exponent is not a stored amount
    expect(storedDecimal(Number.NaN)).toBeNull();
    expect(storedDecimal(Number.POSITIVE_INFINITY)).toBeNull();
    expect(storedDecimal('5,03')).toBeNull();
    expect(moneyFromStored(4.2, 'USD')).toEqual({ amount: '4.2', currency: 'USD' });
    expect(moneyFromStored('4.20', 'CHF')).toBeNull();           // a currency this build cannot price is dropped
    expect(moneyFromRow('4.20', 'USD')).toEqual({ amount: '4.2', currency: 'USD' });
    expect(moneyFromRow('4,20', 'USD')).toBeNull();
  });

  it('division is exact up to its rounding; by zero throws', () => {
    expect(divDecimal(decimal('10'), decimal('3'), 4)).toBe('3.3333');
    expect(divDecimal(decimal('2'), decimal('3'), 2)).toBe('0.67');
    expect(divDecimal(decimal('-1'), decimal('8'), 2)).toBe('-0.13');   // -0.125 → away from zero
    expect(() => divDecimal(decimal('1'), decimal('0'), 2)).toThrow();
  });

  it('A MILLION RANDOM QUOTES — discount, round, multiply — every one equal to the exact-fraction reference', () => {
    const r = mulberry32(20261022);
    const N = 1_000_000;
    let checked = 0, wrongAgainstReference = 0, moreDecimalsThanAsked = 0;
    let firstFailure = '';
    for (let i = 0; i < N; i++) {
      // a unit price with up to 4 decimals (price tiers are numeric(10,4)), a discount with 2 (numeric(5,2)), a quantity
      const priceMinor = BigInt(int(r, 1, 99_999_999));         // 0.0001 … 9,999.9999
      const pctMinor = BigInt(int(r, 0, 10_000));                // 0.00% … 100.00%
      const qty = int(r, 1, 100_000);
      const places = int(r, 0, 3);                               // JPY 0, most 2, KWD 3

      const price = decimal(minorText(priceMinor, 4));
      const pct = decimal(minorText(pctMinor, 2));
      // the quote's way: price × (1 − pct/100), rounded to the currency's places; total = unit × quantity
      const unit = roundDecimal(mulDecimal(price, subDecimal(decimal('1'), mulDecimal(pct, decimal('0.01')))), places);
      const total = mulDecimal(unit, fromInteger(qty));

      // the reference, by fractions
      const refUnitMinor = qRoundMinor(qMul(qOf(priceMinor, 4), norm(10_000n - pctMinor, 10_000n)), places);
      const refUnit = canon(minorText(refUnitMinor, places));
      const refTotal = canon(minorText(refUnitMinor * BigInt(qty), places));
      checked++;
      if (unit !== refUnit || total !== refTotal) {
        wrongAgainstReference++;
        if (!firstFailure) firstFailure = `price ${price} less ${pct}% at ${places} places: got ${unit} / ${total}, reference ${refUnit} / ${refTotal}`;
      }
      if ((unit.split('.')[1]?.length ?? 0) > places) moreDecimalsThanAsked++;

    }
    // The output the owner asked to see.
    console.log(`A1 property test: ${checked.toLocaleString('en')} random quotes (unit price to 4 decimals, discount to 2, ` +
      `quantity 1–100,000, rounded at 0–3 places); wrong against the exact-fraction reference: ${wrongAgainstReference}; ` +
      `more decimals than the currency allows: ${moreDecimalsThanAsked}.`);
    expect(firstFailure).toBe('');
    expect([wrongAgainstReference, moreDecimalsThanAsked]).toEqual([0, 0]);
  }, 300_000);

  it('the same million inputs through floating point, as the old code did, are NOT all exact — the test can fail', () => {
    // A negative control on the method itself: the reference must catch the defect it is here to catch.
    const r = mulberry32(20261022);
    let wrong = 0;
    for (let i = 0; i < 1_000_000; i++) {
      const priceMinor = int(r, 1, 99_999_999), pctMinor = int(r, 0, 10_000); int(r, 1, 100_000); const places = int(r, 0, 3);
      if (places !== 2) continue;
      const float = Number(((priceMinor / 10_000) * (1 - pctMinor / 10_000)).toFixed(2));
      const ref = Number(minorText(qRoundMinor(qMul(qOf(BigInt(priceMinor), 4), norm(10_000n - BigInt(pctMinor), 10_000n)), 2), 2));
      if (float !== ref) wrong++;
    }
    expect(wrong).toBeGreaterThan(0);
  }, 300_000);

  it('the arithmetic itself: commutative, associative and exact where it should be', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 20_000; i++) {
      const a = decimal(minorText(BigInt(int(r, -9_999_999, 9_999_999)), int(r, 0, 4)));
      const b = decimal(minorText(BigInt(int(r, -9_999_999, 9_999_999)), int(r, 0, 4)));
      const c = decimal(minorText(BigInt(int(r, -9_999_999, 9_999_999)), int(r, 0, 4)));
      expect(addDecimal(a, b)).toBe(addDecimal(b, a));
      expect(mulDecimal(a, b)).toBe(mulDecimal(b, a));
      expect(addDecimal(addDecimal(a, b), c)).toBe(addDecimal(a, addDecimal(b, c)));
      expect(subDecimal(addDecimal(a, b), b)).toBe(a);
      expect(Math.sign(compareDecimal(a, b))).toBe(-Math.sign(compareDecimal(b, a)));
    }
    const x: Decimal = decimal('0.1');
    expect(addDecimal(addDecimal(x, x), x)).toBe('0.3');   // 0.1 + 0.1 + 0.1 is 0.30000000000000004 in floating point
  });
});
