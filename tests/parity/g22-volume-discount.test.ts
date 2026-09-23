import { describe, it, expect } from 'vitest';
import { renderPriceRules, type PriceRulesView, type VolumeDiscount } from '../../src/api/web/priceRules.js';
import { computeQuote } from '../../src/core/commerce/quote.js';
import { usd } from '../../src/core/types/money.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, ASSISTANT_FALLBACK } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import type { Product, PricingPolicy, NegotiationRule } from '../../src/core/types/commerce.js';
import type { ProductId, BusinessId } from '../../src/core/types/ids.js';

/**
 * G22 — she can say when she will come down on price.
 *
 * `computeQuote` derives a discount from `negotiation_rules` and from nowhere
 * else. No owner surface had ever written that table, so `discountPct` was
 * always zero — which made two of her own rules describe events that could not
 * happen: "never more than 8% off" was a ceiling on nothing, and "above 5% off
 * she asks you first", which G7a turned into a real hold, could never fire.
 *
 * Found by the pre-pilot walkthrough: scenario 7 had to insert the row by hand
 * to rehearse a discount at all. That is the tell — a rehearsal that has to
 * reach into the database is rehearsing something the owner cannot do.
 */

const BIZ = 'b1' as BusinessId;
const PID = 'p1' as ProductId;

const view = (over: Partial<PriceRulesView> = {}): PriceRulesView => ({
  businessDefault: { floor: usd(0.30), maxDiscountPct: 8, askAbovePct: 5 },
  products: [{
    productId: 'p1', sku: 'ZX-100', name: 'Canvas tote', nameZh: '帆布袋',
    listPrice: usd(1.05), own: null, inheritsDefault: true, isActive: true,
  }],
  unanswered: 0,
  volume: [],
  ...over,
});

const discount = (over: Partial<VolumeDiscount> = {}): VolumeDiscount => ({
  id: 'r1', productId: null, productLabel: null, minQty: 10_000, discountPct: 3, asksFirst: false, ...over,
});

const product: Product = {
  id: PID, businessId: BIZ, sku: 'ZX-100', name: 'Canvas tote',
  unit: 'pcs', moq: 500, leadTimeDays: 15, customizable: false,
};
const tiers = [{ productId: PID, minQty: 500, maxQty: null, unitPrice: usd(1.00) }];
const policy: PricingPolicy = {
  businessId: BIZ, productId: null, floorPrice: usd(0.30), maxDiscountPct: 8, humanRequiredAbovePct: 5,
};
const rule = (value: number, qtyGte = 10_000): NegotiationRule => ({
  businessId: BIZ, priority: 100, condition: { qtyGte }, action: { kind: 'discount_pct', value },
});

describe('G22 · the page says whether she may come down at all', () => {
  it('with no rule written, it says she never offers one — the truth it never said', () => {
    const html = renderPriceRules(view(), 'en');
    expect(html).toContain(esc(t('en', 'prices.volume.none', { name: ASSISTANT_FALLBACK.en })));
    expect(html).toContain('action="/app/factory/prices/volume"');
  });

  it('a rule reads as her own sentence, with the quantity and the product', () => {
    const html = renderPriceRules(view({ volume: [discount({ productLabel: 'Canvas tote', productId: 'p1' })] }), 'en');
    expect(html).toContain(esc(t('en', 'prices.volume.row', { product: 'Canvas tote', qty: '10,000', pct: 3 })));
    expect(html).toContain('/app/factory/prices/volume/r1/archive');
  });

  it('and one past her ask-me line says so, because that is what will happen', () => {
    const html = renderPriceRules(view({ volume: [discount({ discountPct: 7, asksFirst: true })] }), 'en');
    expect(html).toContain(esc(t('en', 'prices.volume.asksFirst', { name: ASSISTANT_FALLBACK.en })));
    // …and one inside it does not claim she will ask
    const inside = renderPriceRules(view({ volume: [discount({ discountPct: 3 })] }), 'en');
    expect(inside).not.toContain(esc(t('en', 'prices.volume.asksFirst', { name: ASSISTANT_FALLBACK.en })));
  });

  it('the refusals are her own numbers, in every locale', () => {
    for (const locale of LOCALES) {
      const html = renderPriceRules(view(), locale, null, {}, {}, { discountPct: 'above_max' });
      expect(html, locale).toContain(esc(t(locale, 'prices.volume.error.above_max')));
      const none = renderPriceRules(view(), locale, null, {}, {}, { discountPct: 'no_limits' });
      expect(none, locale).toContain(esc(t(locale, 'prices.volume.error.no_limits')));
      expect(html, locale).not.toMatch(/prices\.volume\.[a-z.]+/);
    }
  });
});

describe('G22 · and the engine was always ready for it', () => {
  it('a rule she writes is the discount a buyer gets', () => {
    const q = computeQuote({ product, tiers, quantity: 10_000, policy, rules: [rule(3)] });
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    expect(q.value.discountPct).toBe(3);
    expect(q.value.unitPrice.amount).toBeCloseTo(0.97, 4);
    expect(q.value.requiresHuman).toBe(false);          // 3% is inside her ask line
  });

  it('below her quantity, nothing comes off', () => {
    const q = computeQuote({ product, tiers, quantity: 5_000, policy, rules: [rule(3)] });
    expect(q.ok && q.value.discountPct).toBe(0);
  });

  it('past her ask-me line it is HELD, which is the promise G7a made real', () => {
    const q = computeQuote({ product, tiers, quantity: 10_000, policy, rules: [rule(7)] });
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    expect(q.value.discountPct).toBe(7);
    expect(q.value.requiresHuman).toBe(true);
  });

  it('and her ceiling still clamps a rule that got past the form', () => {
    // The form refuses one above her maximum; the engine refuses it again, and
    // this is the order that matters — the guard is not the form.
    const q = computeQuote({ product, tiers, quantity: 10_000, policy, rules: [rule(30)] });
    expect(q.ok && q.value.discountPct).toBe(8);
  });
});
