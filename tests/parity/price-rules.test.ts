import { describe, it, expect } from 'vitest';
import { usd } from '../../src/core/types/money.js';
import { readFile } from 'node:fs/promises';
import {
  validatePriceRules, priceRuleChanges, type PriceRules,
} from '../../src/core/commerce/priceRules.js';
import { computeQuote } from '../../src/core/commerce/quote.js';
import { renderPriceRules, type PriceRulesView } from '../../src/api/web/priceRules.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { product, tiers } from './fixtures.js';

/**
 * M29 — the owner's own price rules.
 *
 * The product's central claim is that she "quotes within the owner's own price
 * rules". Until this milestone those rules were fabricated by the importer:
 * floor = the list price, max discount 0, ask-above 0 — which says she will
 * never take a cent off and has been granted no authority, and the owner said
 * neither. `quote.ts` was clamping correctly against numbers nobody had
 * written.
 */

const RULES: PriceRules = { floor: usd(0.35), maxDiscountPct: 10, askAbovePct: 7 };

// ── the answers are the owner's, and unanswered is a state ───────────────────

describe('M29 · nothing is inferred', () => {
  it('accepts a complete, coherent set of answers', () => {
    const r = validatePriceRules({ floor: '0.35', maxDiscountPct: '10', askAbovePct: '7' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(RULES);
  });

  it('an unanswered question is an error, never a default', () => {
    // The whole defect in one assertion: there is no "sensible default" for
    // what the owner would accept. Silence must not become a number.
    for (const field of ['floor', 'maxDiscountPct', 'askAbovePct'] as const) {
      const input = { floor: '0.35', maxDiscountPct: '10', askAbovePct: '7', [field]: '' };
      const r = validatePriceRules(input);
      expect(r.ok, field).toBe(false);
      if (!r.ok) expect(r.errors[field]).toBe('missing');
    }
  });

  it('rejects a floor of zero — "free" is not a price rule', () => {
    const r = validatePriceRules({ floor: '0', maxDiscountPct: '10', askAbovePct: '7' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.floor).toBe('floor_not_positive');
  });

  it('rejects percentages outside 0–100', () => {
    for (const bad of ['-1', '101']) {
      const r = validatePriceRules({ floor: '0.35', maxDiscountPct: bad, askAbovePct: '7' });
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.errors.maxDiscountPct).toBe('pct_out_of_range');
    }
  });

  it('rejects "ask me above 10%" when she may only ever give 7%', () => {
    // A question that can never be asked. My own M20.5 fixture carried exactly
    // this inversion (max 5 / ask 10), the sentence it produced read perfectly
    // plausibly, and it shipped green.
    const r = validatePriceRules({ floor: '0.35', maxDiscountPct: '7', askAbovePct: '10' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.askAbovePct).toBe('ask_above_max');
  });

  it('rejects a floor above the product’s own list price', () => {
    // quote.ts refuses `below_floor` rather than selling at a loss, so this
    // silently makes the product unquotable. Caught before she creates it.
    const r = validatePriceRules({ floor: '0.90', maxDiscountPct: '10', askAbovePct: '7', listPrice: usd(0.45) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.floor).toBe('floor_above_list');
  });

  it('reports every problem at once, so she fixes the form in one pass', () => {
    const r = validatePriceRules({ floor: 'abc', maxDiscountPct: '200', askAbovePct: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['askAbovePct', 'floor', 'maxDiscountPct']);
  });
});

// ── a change is a change ─────────────────────────────────────────────────────

describe('M29 · an edit supersedes, and reads as a change', () => {
  it('names each field that moved, with where it moved from', () => {
    const c = priceRuleChanges(RULES, { floor: usd(0.30), maxDiscountPct: 15, askAbovePct: 7 });
    expect(c).toEqual({
      floor: { from: 0.35, to: 0.30 },
      maxDiscountPct: { from: 10, to: 15 },
    });
    expect(c.askAbovePct).toBeUndefined();          // unchanged is not a change
  });

  it('the first answer records from: null — it came from nowhere, not from a default', () => {
    const c = priceRuleChanges(null, RULES);
    expect(c.floor).toEqual({ from: null, to: 0.35 });
  });

  it('re-submitting the same answers is not an edit', () => {
    expect(priceRuleChanges(RULES, RULES)).toEqual({});
  });
});

// ── what it does to a real quote ─────────────────────────────────────────────

describe('M29 · the same engine, before and after the owner grants authority', () => {
  const quoteAt = (policy: PriceRules | null, quantity: number) => computeQuote({
    product: product(),
    tiers: tiers(),
    policy: policy && {
      businessId: 'b' as never, productId: 'p' as never,
      floorPrice: policy.floor, maxDiscountPct: policy.maxDiscountPct,
      humanRequiredAbovePct: policy.askAbovePct,
    },
    rules: [{ businessId: 'b' as never, priority: 1, condition: { qtyGte: 1 },
              action: { kind: 'discount_pct', value: 12 } }],
    quantity,
  });

  it('the importer’s invented rule gives her NO authority at all', () => {
    // What every imported product used to carry: floor = the price on the line,
    // authority 0. At the entry quantity the discount is clamped to nothing.
    const entry = tiers()[0]!.unitPrice;                       // 0.50 at 1000
    const r = quoteAt({ floor: entry, maxDiscountPct: 0, askAbovePct: 0 }, 1000);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.discountPct).toBe(0);
      expect(r.value.appliedRules.join(' ')).toContain('clamped_to_authority:0');
    }
  });

  it('and worse: that invented floor makes her own volume tiers unquotable', () => {
    // The consequence nobody would have predicted from reading the importer.
    // floor = the 1000-unit price (0.50), but the 20000-unit tier is 0.38 — so
    // her best customer gets a REFUSAL, not a price. The engine is right to
    // refuse; the rule it is obeying was never hers.
    const r = quoteAt({ floor: tiers()[0]!.unitPrice, maxDiscountPct: 0, askAbovePct: 0 }, 20000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('below_floor');
  });

  it('once the owner grants 10%, the same buyer gets a real discount', () => {
    // Her own answers: floor 0.30 against the 0.38 tier, so 10% off (0.342)
    // clears the floor and she gets the full authority she was granted.
    const r = quoteAt({ floor: usd(0.30), maxDiscountPct: 10, askAbovePct: 7 }, 20000);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.discountPct).toBe(10);                       // her ceiling, not the rule's 12
      expect(r.value.appliedRules.join(' ')).toContain('clamped_to_authority:10');
      expect(r.value.unitPrice.amount).toBeGreaterThanOrEqual(0.30);
      expect(r.value.requiresHuman).toBe(true);                   // 10% > her 7% ask-above
    }
  });

  it('her floor still holds — authority is not permission to sell at a loss', () => {
    // 90% off 0.38 is 0.038; her floor is 0.36, so the price stops there.
    const r = quoteAt({ floor: usd(0.36), maxDiscountPct: 90, askAbovePct: 5 }, 20000);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.unitPrice).toEqual(usd(0.36));
      expect(r.value.appliedRules.join(' ')).toContain('clamped_to_floor:0.36');
    }
  });

  it('quote.ts was not touched — the defect was never in the clamping', async () => {
    const src = await readFile(new URL('../../src/core/commerce/quote.ts', import.meta.url), 'utf8');
    for (const word of ['priceRules', 'validatePriceRules', 'savePriceRules'])
      expect(src.includes(word), `quote.ts references ${word}`).toBe(false);
  });
});

// ── the owner's own words ────────────────────────────────────────────────────

const view = (over: Partial<PriceRulesView> = {}): PriceRulesView => ({
  volume: [],
  businessDefault: null,
  products: [{
    productId: 'p1', sku: 'BAG-001', name: 'Canvas tote', nameZh: null,
    listPrice: usd(0.45), own: null, inheritsDefault: false, isActive: false,
  }],
  unanswered: 1,
  ...over,
});

describe('M29 · questions, not a form', () => {
  it('asks the three questions in the owner’s language, in every locale', () => {
    for (const l of LOCALES) {
      const html = renderPriceRules(view(), l);
      for (const k of ['prices.q.floor', 'prices.q.maxDiscount', 'prices.q.askAbove'] as const)
        expect(html, `${l}/${k}`).toContain(t(l, k as MessageKey, { name: 'Lily' }).slice(0, 12));
    }
  });

  it('never uses our vocabulary for her business', () => {
    for (const l of LOCALES) {
      const html = renderPriceRules(view({
        businessDefault: RULES,
        products: [{ productId: 'p1', sku: 'S', name: 'N', nameZh: null, listPrice: usd(0.45),
          own: RULES, inheritsDefault: false, isActive: true }],
        unanswered: 0,
      }), l).replace(/<style>[\s\S]*?<\/style>/g, '');
      for (const banned of ['policy', 'threshold', 'authority', 'floor price', 'margin',
                            '策略', '阈值', '权限'])
        expect(html.toLowerCase().includes(banned.toLowerCase()), `${l}: "${banned}"`).toBe(false);
    }
  });

  it('a product with no stated limit says she cannot quote it — not that it is fine', () => {
    const html = renderPriceRules(view(), 'en');
    expect(html).toContain('cannot quote this one');
    expect(html).not.toContain('ready');
  });

  it('a rejected answer keeps what she typed and says what is wrong', () => {
    const html = renderPriceRules(view(), 'en', null, { askAbovePct: 'ask_above_max' });
    expect(html).toContain('you would never be asked');
  });

  it('shows real counts, never a score', () => {
    const html = renderPriceRules(view({ unanswered: 3, volume: [] }), 'en').replace(/<style>[\s\S]*?<\/style>/g, '');
    for (const banned of ['score', 'rating', 'grade', '%complete', 'of 3 done'])
      expect(html.toLowerCase().includes(banned.toLowerCase())).toBe(false);
  });
});

// ── the importer stopped inventing ───────────────────────────────────────────

describe('M29 · the importer no longer writes a rule the owner did not give', () => {
  it('confirmImport touches pricing_policy nowhere', async () => {
    const src = await readFile(new URL('../../src/api/web/products.ts', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('export async function confirmImport'),
                         src.indexOf('export const importFlash'));
    // Asserted on the STATEMENT, not the word: the comment explaining why the
    // insert is gone mentions pricing_policy, and should.
    expect(fn).not.toMatch(/insert\s+into\s+pricing_policy/i);
    // and it marks nothing sellable on arrival BY ITSELF. D1 refined this on
    // purpose: a line is sellable on arrival only where HER OWN answer for
    // everything already covers it — read from her row, never a literal true,
    // and never a rule the import wrote (the assertion above still stands).
    expect(fn).toContain('is_active');
    expect(fn).toMatch(/price_usd_per_unit, currency, is_active\)[\s\S]*\$\{coveredByGeneral\(p\.price\)\}\)/);
    expect(fn).not.toMatch(/is_active\)[\s\S]{0,220},\s*true\)/);
    expect(fn).toMatch(/from pricing_policy[\s\S]{0,120}product_id is null/);
    expect(fn).toMatch(/price\.amount >= Number\(general\.floor\)/);
  });

  it('savePriceRules is the only writer of pricing_policy in the owner surface', async () => {
    const { readdir } = await import('node:fs/promises');
    const dir = new URL('../../src/api/web/', import.meta.url);
    const writers: string[] = [];
    for (const f of (await readdir(dir)).filter((x) => x.endsWith('.ts'))) {
      const src = await readFile(new URL(f, dir), 'utf8');
      if (/insert\s+into\s+pricing_policy/i.test(src)) writers.push(f);
    }
    expect(writers).toEqual(['priceRules.ts']);
  });
});
