import { describe, it, expect } from 'vitest';
import { computeQuote } from '../../src/core/commerce/quote.js';
import { guardNumerals, currencyBeside, asciiDigits } from '../../src/core/safety/numerals.js';
import { extractQuantity } from '../../src/core/conversation/understand.js';
import { guardFallbackReply } from '../../src/core/conversation/templates.js';
import { detectSignals } from '../../src/core/scoring/detect.js';
import { HIGH_VALUE } from '../../src/core/scoring/signals.js';
import { CURRENCIES, currencySymbol, symbolIsCode, type Currency, type Money } from '../../src/core/types/money.js';
import type { Quote } from '../../src/core/types/commerce.js';
import { product, tiers, policy, emptyState } from './fixtures.js';

/**
 * CUR, part one (the owner's decision, 2026-09-30: one currency per workspace,
 * no conversion) — THE SEND PATH KNOWS EVERY CURRENCY before any workspace can
 * price in one. What is pinned:
 *   · a price is sourced only in the currency it was worked out in — "$12" for
 *     a quote of AED 12 is refused, the customer's own figure in their own
 *     money is not;
 *   · "Rp 150.000" and "R$ 1.250,50" are the figures they say, for a quote in
 *     rupiah or reais — and ONLY for one: "$1.250" stays 1.25 for dollars;
 *   · "₹500", "Rp 5000" and "150 reais" are prices, never quantities;
 *   · "high value" is sized in each currency's own figures, never converted;
 *   · the stand-in reply never says a code twice around one figure.
 */

const inCurrency = (c: Currency, m: Money): Money => ({ amount: m.amount, currency: c });
const quoteIn = (c: Currency, scale = 1, quantity = 5_000): Quote => {
  const r = computeQuote({
    product: product(),
    tiers: tiers().map((t) => ({ ...t, unitPrice: inCurrency(c, { ...t.unitPrice, amount: t.unitPrice.amount * scale }) })),
    policy: policy({ floorPrice: { amount: 0.35 * scale, currency: c } }),
    rules: [], quantity,
  });
  if (!r.ok) throw new Error(`fixture: ${JSON.stringify(r.error)}`);
  return r.value;
};
const state = emptyState({ quantity: { value: 5_000, unit: 'pcs' } });
const guard = (reply: string, quote: Quote, clientText = '') => guardNumerals({ reply, quote, state, clientText });

describe('CUR · every currency a workspace can sell in', () => {
  it('the eight, each with its own sign', () => {
    expect([...CURRENCIES].sort()).toEqual(['AED', 'BRL', 'CNY', 'IDR', 'INR', 'MXN', 'SAR', 'USD']);
    expect(CURRENCIES.map(currencySymbol)).toEqual(['$', '￥', 'AED ', 'SAR ', 'R$', 'MX$', '₹', 'Rp ']);
    expect(symbolIsCode('AED')).toBe(true);
    expect(symbolIsCode('USD')).toBe(false);
  });
});

describe('CUR · a price is sourced only in its own currency', () => {
  const aed = quoteIn('AED');   // 0.45 a piece, 2250 in all

  it('the right figure in the right money passes', () => {
    for (const reply of ['That is AED 0.45 each, AED 2250 in total.', 'السعر 0.45 درهم للقطعة، والمجموع 2250 درهم.', '0.45 dirhams each.']) {
      expect(guard(reply, aed).ok, reply).toBe(true);
    }
  });

  it('the right figure in the wrong money is refused — in any script', () => {
    for (const reply of ['That is $0.45 each.', 'Total: 2250 USD.', 'Only 2250 euros.', '合计2250元', 'المجموع 2250 ريال', '€0.45 each']) {
      const r = guard(reply, aed);
      expect(r.ok, reply).toBe(false);
    }
  });

  it('the customer\'s own figure in their own money may be said back', () => {
    expect(guard('You mentioned a budget of $2250 — our price is AED 2250 in total.', aed, 'my budget is $2250').ok).toBe(true);
  });

  it('a figure beside no money at all is judged as before', () => {
    expect(guard('For 5,000 pieces, 0.45 each.', aed).ok).toBe(true);
    expect(guard('For 5,000 pieces, 0.29 each.', aed).ok).toBe(false);
  });

  it('$ is the dollar AND the peso; R$ is never read as $; MX$ is the peso', () => {
    expect(guard('$0.45 each.', quoteIn('MXN')).ok).toBe(true);
    expect(guard('MX$0.45 each.', quoteIn('MXN')).ok).toBe(true);
    expect(guard('R$ 0,45 cada.', quoteIn('BRL')).ok).toBe(true);
    expect(guard('R$0.45 each.', quoteIn('USD')).ok).toBe(false);
    expect(guard('MX$0.45 each.', quoteIn('USD')).ok).toBe(false);
    expect(guard('US$0.45 each.', quoteIn('MXN')).ok).toBe(false);
  });

  it('dollars stay as they were: every reply that passed for a dollar quote still does', () => {
    const usd = quoteIn('USD');
    for (const reply of ['For 5,000 pcs the unit price is $0.45, total $2250. Lead time 25 days.', '$0.45 USD each, 2,250 dollars in all.', 'US$0.45 each.']) {
      expect(guard(reply, usd).ok, reply).toBe(true);
    }
  });

  it('a mark is read only right beside the figure', () => {
    const t = asciiDigits('We ship to the UAE. Price: 0.45 each.');
    expect(currencyBeside(t, [t.indexOf('0.45'), t.indexOf('0.45') + 4])).toBeNull();
    expect(currencyBeside('try 3 colours', [4, 5])).toBeNull();   // "try" is a word, not the lira
  });
});

describe('CUR · Brazil and Indonesia write their figures their way', () => {
  it('"Rp 150.000" is 150000 for a quote in rupiah', () => {
    const idr = quoteIn('IDR', 300_000, 5_000);   // 135,000 a piece at the 5,000 tier
    const unit = idr.unitPrice.amount;
    const dotted = unit.toLocaleString('de-DE');   // "135.000"
    expect(guard(`Harganya Rp ${dotted} per buah.`, idr).ok).toBe(true);
    expect(guard(`Harganya Rp ${(unit + 1000).toLocaleString('de-DE')} per buah.`, idr).ok).toBe(false);
  });

  it('"R$ 1.250,50" is 1250.50 for a quote in reais', () => {
    const brl = quoteIn('BRL', 2779, 5_000);   // 0.45 × 2779 = 1250.55 a piece
    const unit = brl.unitPrice.amount;
    const [whole, cents] = unit.toFixed(2).split('.');
    const written = `R$ ${Number(whole).toLocaleString('de-DE')},${cents}`;
    expect(guard(`Custa ${written} cada.`, brl).ok, written).toBe(true);
  });

  it('only for them: "$1.250" is 1.25 for a dollar quote, and refused', () => {
    const usd = quoteIn('USD', 2779, 5_000);
    expect(guard('That is $1.250 each.', usd).ok).toBe(false);
  });

  it('the dotted figure must still be in the right money', () => {
    const idr = quoteIn('IDR', 300_000, 5_000);
    expect(guard(`That is $${idr.unitPrice.amount.toLocaleString('de-DE')} each.`, idr).ok).toBe(false);
  });
});

describe('CUR · a price is never read as a quantity', () => {
  it('in every currency a workspace can sell in', () => {
    for (const t of ['I want to pay ₹500', 'budget Rp 5000', 'I need it for Rs. 500', 'I can pay 150 reais', 'I want 500 rupees worth',
      'order for AED 300', 'I need it under 200 pesos', 'I want to pay SAR 400']) {
      expect(extractQuantity(t), t).toBeNull();
    }
  });
  it('and a quantity is still a quantity', () => {
    expect(extractQuantity('I need 500 pcs')).toEqual({ value: 500, unit: 'pcs' });
    expect(extractQuantity('I want 300 pieces for AED 900')).toEqual({ value: 300, unit: 'pcs' });
  });
});

describe('CUR · "high value" in each currency\'s own figures', () => {
  it('an order of 10 rupiah a piece is not large; one past the rupiah line is', () => {
    const signalsFor = (c: Currency, unit: number, qty: number) => detectSignals({
      text: `I need ${qty} pcs`, analysis: null, state: emptyState({ quantity: { value: qty, unit: 'pcs' } }),
      unitPrice: { amount: unit, currency: c },
    } as Parameters<typeof detectSignals>[0]).map((s) => s.kind);
    expect(signalsFor('IDR', 10_000, 10)).not.toContain('high_value');           // Rp 100,000: a small order
    expect(signalsFor('IDR', 10_000, 6_000)).toContain('high_value');            // Rp 60,000,000
    expect(signalsFor('USD', 1, 4_000)).toContain('high_value');                  // $4,000, as before
    expect(signalsFor('USD', 1, 2_000)).not.toContain('high_value');
  });
  it('every currency has its lines, the very large above the large', () => {
    for (const c of CURRENCIES) expect(HIGH_VALUE[c].veryLarge, c).toBeGreaterThan(HIGH_VALUE[c].large);
  });
});

describe('CUR · the stand-in reply', () => {
  it('never says a code twice around one figure, and passes its own guard', () => {
    for (const c of ['USD', 'AED', 'IDR', 'MXN'] as const) {
      const q = quoteIn(c);
      const reply = guardFallbackReply(q, null);
      // "AED 0.45 AED" was the defect: the code, then the figure, then the code again.
      expect(reply, reply).not.toMatch(new RegExp(`${c} [\\d.,]+ ${c}`));
      expect(guard(reply, q).ok, reply).toBe(true);
    }
  });
});
