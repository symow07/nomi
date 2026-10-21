import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeQuote } from '../../src/core/commerce/quote.js';
import { guardNumerals } from '../../src/core/safety/numerals.js';
import { readTypedAmount } from '../../src/core/commerce/amount.js';
import { parsePriceLines } from '../../src/core/onboard/catalogImport.js';
import { currencyOfCountry } from '../../src/core/owner/currencies.js';
import { CURRENCIES, MINOR_UNITS, moneyOf, roundMoney, scaleMoney, type Currency } from '../../src/core/types/money.js';
import { decimal, fromInteger, mulDecimal } from '../../src/core/types/decimal.js';
import type { Quote } from '../../src/core/types/commerce.js';
import { product, tiers, policy, emptyState } from './fixtures.js';

/**
 * A1.3 (Phase 5, 0168) — the Moroccan dirham, the euro and the pound sterling join the eight, for the books (D4 is
 * Morocco's). Each currency's minor unit comes from ISO 4217. A workspace still sells in one of them, and nothing
 * converts except at a rate the owner stated.
 */

/**
 * ISO 4217, List One (SIX Financial Information, the maintenance agency), the "Minor unit" column, checked by hand
 * for each code: USD 2, CNY 2, AED 2, SAR 2, BRL 2, MXN 2, INR 2, IDR 2, MAD 2, EUR 2, GBP 2.
 */
const ISO_4217_MINOR: Readonly<Record<string, number>> = {
  USD: 2, CNY: 2, AED: 2, SAR: 2, BRL: 2, MXN: 2, INR: 2, IDR: 2, MAD: 2, EUR: 2, GBP: 2,
};

const quoteIn = (c: Currency, scale: number): Quote => {
  const r = computeQuote({
    product: product(),
    tiers: tiers().map((t) => ({ ...t, unitPrice: { ...scaleMoney(t.unitPrice, fromInteger(scale)), currency: c } })),
    policy: policy({ floorPrice: moneyOf(mulDecimal(decimal('0.35'), fromInteger(scale)), c) }),
    rules: [], quantity: 5_000,
  });
  if (!r.ok) throw new Error(`fixture: ${JSON.stringify(r.error)}`);
  return r.value;
};
const state = emptyState({ quantity: { value: 5_000, unit: 'pcs' } });
const ok = (reply: string, quote: Quote) => guardNumerals({ reply, quote, state, clientText: '' }).ok;

describe('A1.3 · the eleven currencies', () => {
  it('MAD, EUR and GBP are on the list, and every minor unit is ISO 4217\'s', () => {
    expect([...CURRENCIES].sort()).toEqual(['AED', 'BRL', 'CNY', 'EUR', 'GBP', 'IDR', 'INR', 'MAD', 'MXN', 'SAR', 'USD']);
    expect(MINOR_UNITS).toEqual(ISO_4217_MINOR);
    // rounding follows the currency's own minor unit, half away from zero
    for (const c of CURRENCIES) expect(roundMoney(moneyOf('10.005', c)).amount, c).toBe('10.01');
  });

  it('the database admits exactly these: every currency check of 0168 lists the same eleven, and no check is missed', () => {
    const sql = readFileSync(new URL('../../migrations/0168_more_currencies.sql', import.meta.url), 'utf8');
    const lists = [...sql.matchAll(/in \(([^)]*)\)/g)].map((m) => m[1]!.split(',').map((x) => x.trim().replace(/'/g, '')).sort());
    expect(lists.length).toBe(10);   // nine checks, owner_rates' with two columns
    for (const l of lists) expect(l).toEqual([...CURRENCIES].sort());
    // every check an earlier migration made with the old list is re-made here
    const before = ['0092_workspace_currency.sql', '0094_catalog_imports.sql']
      .map((f) => readFileSync(new URL(`../../migrations/${f}`, import.meta.url), 'utf8')).join('\n');
    const named = [...before.matchAll(/add constraint (\w+_currenc\w+)/g)].map((m) => m[1]!);
    for (const n of new Set(named)) expect(sql, n).toMatch(new RegExp(`add constraint ${n}\\b`));
    expect(sql).toMatch(/add constraint catalog_imports_currency_check\b/);
  });

  it('a country\'s own money: Morocco the dirham, the euro area the euro, the United Kingdom the pound', () => {
    expect(currencyOfCountry('MA')).toBe('MAD');
    for (const c of ['FR', 'DE', 'ES', 'IT', 'NL', 'BE', 'PT', 'IE', 'AT', 'FI', 'GR', 'HR']) expect(currencyOfCountry(c), c).toBe('EUR');
    expect(currencyOfCountry('GB')).toBe('GBP');
    expect(currencyOfCountry('CH')).toBeNull();   // the franc is not on the list: asked, never assumed
  });

  it('the owner\'s five ambiguous cases, in each of the three (A1, 2026-10-22): no meaning from the separator', () => {
    for (const c of ['MAD', 'EUR', 'GBP'] as const) {
      expect(readTypedAmount('1.250'), c).toBe('ambiguous');    // 1.25 or 1250: refused, never guessed
      expect(readTypedAmount('1,250'), c).toBe('ambiguous');
      expect(readTypedAmount('1 250'), c).toBe('1250');         // a space only ever groups
      expect(readTypedAmount('1.25'), c).toBe('1.25');
      expect(readTypedAmount('1,25'), c).toBe('1.25');
    }
  });
});

describe('A1.3 · the reply guard: a figure in the workspace\'s own money passes, in anyone else\'s it does not', () => {
  const mad = quoteIn('MAD', 10);    // 4.50 a piece at 5,000
  const eur = quoteIn('EUR', 1);     // 0.45
  const gbp = quoteIn('GBP', 1);     // 0.45

  it('the dirham', () => {
    expect(mad.unitPrice.amount).toBe('4.5');
    expect(ok('The price is 4.50 DH each.', mad)).toBe(true);
    expect(ok('The price is MAD 4.50 each.', mad)).toBe(true);
    expect(ok('السعر 4.50 درهم مغربي للقطعة.', mad)).toBe(true);
    expect(ok('السعر 4.50 درهم للقطعة.', mad)).toBe(true);
    expect(ok('The price is €4.50 each.', mad)).toBe(false);
    expect(ok('The price is $4.50 each.', mad)).toBe(false);
    expect(ok('السعر 4.50 درهم إماراتي للقطعة.', mad)).toBe(false);
  });
  it('the euro', () => {
    expect(ok('Le prix est de 0,45 € la pièce.', eur)).toBe(true);
    expect(ok('The price is €0.45 each.', eur)).toBe(true);
    expect(ok('The price is 0.45 euros each.', eur)).toBe(true);
    expect(ok('The price is £0.45 each.', eur)).toBe(false);
    expect(ok('The price is $0.45 each.', eur)).toBe(false);
    // A1 — a reply's figure counts only when it reads one way: "1.250 €" is never credited as 1250.
    const big = quoteIn('EUR', 2779);   // 1,250.55 a piece
    expect(ok('Le prix est de 1.250,55 € la pièce.', big)).toBe(true);
    expect(ok('Le prix est de 1 250,55 € la pièce.', big)).toBe(true);
    const even = quoteIn('EUR', 10_000);   // 4,500 a piece
    expect(even.unitPrice.amount).toBe('4500');
    expect(ok('Le prix est de 4.500,00 € la pièce.', even)).toBe(true);
    expect(ok('Le prix est de 4 500 € la pièce.', even)).toBe(true);
    expect(ok('Le prix est de 4500 € la pièce.', even)).toBe(true);
    expect(ok('Le prix est de 4.500 € la pièce.', even)).toBe(false);   // 4.5 or 4500: held for the owner, never sent
  });
  it('the pound', () => {
    expect(ok('The price is £0.45 each.', gbp)).toBe(true);
    expect(ok('The price is 0.45 GBP each.', gbp)).toBe(true);
    expect(ok('The price is €0.45 each.', gbp)).toBe(false);
    expect(ok('The price is 0.45 dirhams each.', gbp)).toBe(false);
  });
  it('and the UAE dirham is not Morocco\'s', () => {
    const aed = quoteIn('AED', 10);
    expect(ok('The price is AED 4.50 each.', aed)).toBe(true);
    expect(ok('The price is 4.50 dirhams each.', aed)).toBe(true);      // a bare dirham may be either
    expect(ok('The price is MAD 4.50 each.', aed)).toBe(false);
    expect(ok('السعر 4.50 درهم مغربي للقطعة.', aed)).toBe(false);
  });
});

describe('A1.3 · a price list read in the workspace\'s money', () => {
  const one = (line: string, c: Currency) => parsePriceLines(line, c)[0]!;

  it('a Moroccan list: dirhams are its own, Moroccan products are not foreign money', () => {
    expect(one('Huile d\'argan 250ml 120 DH', 'MAD')).toMatchObject({ price: { amount: '120', currency: 'MAD' } });
    expect(one('Huile d\'argan 250ml 120 DH', 'MAD').problem ?? null).toBeNull();
    expect(one('زيت أركان مغربي 120 درهم', 'MAD').problem ?? null).toBeNull();
    expect(one('Savon marocain 45 dirhams', 'MAD').problem ?? null).toBeNull();
    expect(one('Tajine 1.250,00 MAD', 'MAD')).toMatchObject({ price: { amount: '1250', currency: 'MAD' } });
    expect(one('Scarf €24', 'MAD').problem).toBe('other_currency');
  });
  it('a euro list and a pound list', () => {
    expect(one('Foulard 24,50 €', 'EUR')).toMatchObject({ price: { amount: '24.5', currency: 'EUR' } });
    expect(one('Foulard 24,50 €', 'EUR').problem ?? null).toBeNull();
    expect(one('Scarf £24.50', 'EUR').problem).toBe('other_currency');
    expect(one('Scarf £24.50', 'GBP')).toMatchObject({ price: { amount: '24.5', currency: 'GBP' } });
    expect(one('Scarf €24.50', 'GBP').problem).toBe('other_currency');
  });
  it('elsewhere, each of them is someone else\'s money — and "mad" in a product name is not the dirham', () => {
    expect(one('Soap 45 dirhams', 'USD').problem).toBe('other_currency');
    expect(one('Scarf 24 EUR', 'USD').problem).toBe('other_currency');
    expect(one('Scarf £24', 'AED').problem).toBe('other_currency');
    expect(one('Tray 120 MAD', 'AED').problem).toBe('other_currency');
    expect(one('Mad Hatter mug $12', 'USD').problem ?? null).toBeNull();
    expect(one('Soap 45 dirhams', 'AED').problem ?? null).toBeNull();   // the UAE's own word too
  });
});
