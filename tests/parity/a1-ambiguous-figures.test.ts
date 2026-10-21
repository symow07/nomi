import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readWrittenFigure } from '../../src/core/commerce/amount.js';
import { validatePriceRules } from '../../src/core/commerce/priceRules.js';
import { validateSamplePolicy } from '../../src/core/commerce/samples.js';
import { validateRate } from '../../src/core/commerce/exchange.js';
import { parsePriceLines } from '../../src/core/onboard/catalogImport.js';
import { editRow, readDiscount } from '../../src/core/onboard/importReview.js';
import { readTierEdits } from '../../src/api/web/products.js';
import { parseTotal } from '../../src/api/web/sandbox.js';
import { CURRENCIES } from '../../src/core/types/money.js';
import { decimal } from '../../src/core/types/decimal.js';
import { messages } from '../../src/core/owner/i18n/messages.js';
import type { ImportRow } from '../../src/core/onboard/importReview.js';

/**
 * A1 (the owner, 2026-10-22) — "do NOT infer meaning from the separator." An owner who types 1.250 meaning one and a
 * quarter must never get a price a thousand times too high, silently. Every box that takes money, and the price-list
 * reader, goes through ONE reader (src/core/commerce/amount.ts): a figure that reads one way is read; a figure that
 * reads two ways is refused, with a message naming both; nothing depends on the workspace's currency.
 *
 * The owner's cases: 1.250, 1,250, 1 250, 1.25, 1,25.
 */
const CASES = [
  ['1.250', 'ambiguous'], ['1,250', 'ambiguous'], ['1 250', '1250'], ['1.25', '1.25'], ['1,25', '1.25'],
] as const;
const NOW = new Date('2026-10-22T09:00:00Z');

describe('A1 · the owner\'s five cases, the same in every currency', () => {
  it('the one reader', () => {
    for (const [typed, read] of CASES) expect(readWrittenFigure(typed), typed).toBe(read);
  });
  it('a product\'s price for a larger order', () => {
    for (const c of CURRENCIES) for (const [typed, read] of CASES) {
      const r = readTierEdits([{ minQty: 2000, price: decimal('9') }], { '2000': typed }, null);
      expect(r, `${c} ${typed}`).toEqual(read === 'ambiguous' ? { ok: false, error: 'ambiguous' } : { ok: true, set: [{ minQty: 2000, price: read }] });
    }
  });
  it('her lowest price', () => {
    for (const c of CURRENCIES) for (const [typed, read] of CASES) {
      const r = validatePriceRules({ floor: typed, maxDiscountPct: '10', askAbovePct: '5', currency: c });
      if (read === 'ambiguous') expect(r, `${c} ${typed}`).toEqual({ ok: false, errors: { floor: 'ambiguous' } });
      else expect(r.ok && r.value.floor.amount, `${c} ${typed}`).toBe(read);
    }
  });
  it('a sample\'s price', () => {
    for (const c of CURRENCIES) for (const [typed, read] of CASES) {
      const r = validateSamplePolicy({ price: typed, creditedOnFirstOrder: false, currency: c, now: NOW });
      if (read === 'ambiguous') expect(r, `${c} ${typed}`).toEqual({ ok: false, error: 'ambiguous' });
      else expect(r.ok && r.value.price.amount, `${c} ${typed}`).toBe(read);
    }
  });
  it('her exchange rate ("15.000" for the rupiah was fifteen; now it is asked again)', () => {
    for (const [typed, read] of CASES) {
      const r = validateRate({ from: 'USD', to: 'IDR', rate: typed, now: NOW });
      if (read === 'ambiguous') expect(r, typed).toEqual({ ok: false, error: 'ambiguous' });
      else expect(r.ok && r.value.rate, typed).toBe(read);
    }
    expect(validateRate({ from: 'USD', to: 'IDR', rate: '15.000', now: NOW })).toEqual({ ok: false, error: 'ambiguous' });
    expect(validateRate({ from: 'USD', to: 'IDR', rate: '15000', now: NOW })).toMatchObject({ ok: true, value: { rate: '15000' } });
  });
  it('a price-list line: an ambiguous figure is never a price', () => {
    for (const c of CURRENCIES) for (const [typed, read] of CASES) {
      const p = parsePriceLines(`Canvas tote ${typed}`, c)[0];
      // In a line, a space separates figures ("size 1 250"): "1 250" is not read as one, so it is no price either.
      if (read === 'ambiguous' || typed.includes(' ')) expect(p?.price ?? null, `${c} ${typed}`).toBeNull();
      else expect(p?.price?.amount, `${c} ${typed}`).toBe(read);
    }
    // the rupiah's own way of writing, which the currency used to settle, is asked about too
    expect(parsePriceLines('Tas kanvas Rp 150.000', 'IDR')[0]?.price ?? null).toBeNull();
    expect(parsePriceLines('Tas kanvas Rp 150000', 'IDR')[0]?.price?.amount).toBe('150000');
  });
  it('her correction of an imported row, and her discount', () => {
    const row = { key: 'l1', line: 'Tote 9', name: 'Tote', price: decimal('9'), unit: 'pcs', moq: null } as unknown as ImportRow;
    for (const [typed, read] of CASES) {
      const e = editRow(row, { price: typed });
      if (read === 'ambiguous') expect(e.errors, typed).toEqual(['price_ambiguous']);
      else expect(e.row.price, typed).toBe(read);
    }
    expect(readDiscount('12,5')).toBe(12.5);
    expect(readDiscount('1.250')).toBe('invalid');
  });
  it('the practice total: a figure with two readings is no total', () => {
    for (const [typed, read] of CASES) expect(parseTotal(typed), typed).toBe(read === 'ambiguous' ? null : read);
  });
});

describe('A1 · the refusal says both readings, in all five languages, and the old rule is gone', () => {
  it('each box has the message, in each language, naming 1.250 and its two readings', () => {
    const keys = ['rate.flash.ambiguous', 'samples.flash.ambiguous', 'prices.error.ambiguous', 'product.edit.error.ambiguous', 'import.error.price_ambiguous'] as const;
    for (const l of ['en', 'zh', 'ar', 'es', 'fr'] as const) for (const k of keys) {
      const m = (messages[l] as Record<string, string>)[k] ?? '';
      expect(m, `${l} ${k}`).toContain('1.250');
      expect(m, `${l} ${k}`).toMatch(/1[.,]25\b/);
      expect(m, `${l} ${k}`).toContain('1250');
    }
  });
  it('no reader of what the owner types or imports looks at the currency to decide a separator', () => {
    for (const f of ['src/core/commerce/amount.ts', 'src/core/onboard/importReview.ts']) {
      expect(readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8'), f).not.toContain('DOT_THOUSANDS');
    }
    const imp = readFileSync(new URL('../../src/core/onboard/catalogImport.ts', import.meta.url), 'utf8');
    const reader = imp.slice(imp.indexOf('function readAmount('), imp.indexOf('function readAmount(') + 600);
    expect(reader).not.toContain('DOT_THOUSANDS');
    expect(reader).toContain('readWrittenFigure(');
  });
});
