import { describe, it, expect } from 'vitest';
import { renderProductList, renderProductDetail, type ProductListItem, type ProductDetail } from '../../src/api/web/products.js';
import { renderProof, type ProofView } from '../../src/api/web/proof.js';
import { sellsByQuantity } from '../../src/core/owner/sellingStyle.js';
import { BUSINESS_KINDS } from '../../src/core/owner/business.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import { usd } from '../../src/core/types/money.js';

/**
 * RT — WHAT A SHOP'S PAGES STATE. A business that sells by quantity (bulk)
 * keeps 0081's line on every product — "no minimum" where there is none — and
 * the quantity a price starts at. A shop, a brand or an agency states a single
 * price as the price and a minimum only where one is set; the customer's price
 * page shows no band for a single price. A workspace with no kind is bulk.
 */

const item = (over: Partial<ProductListItem> = {}): ProductListItem => ({
  id: 'p1', name: 'Rose lip oil', nameZh: null, sku: 'RL-1', moq: null, unit: 'item',
  entryQty: 1, entryPrice: usd(12), learned: true, status: 'learned', imageMatchable: false, isActive: true,
  ...over,
} as ProductListItem);
const detail = (over: Partial<ProductDetail> = {}): ProductDetail => ({
  currency: 'USD',
  id: 'p1', name: 'Rose lip oil', nameZh: null, sku: 'RL-1', category: null, unit: 'item', moq: null,
  leadTimeDays: null, customizable: false, learned: true, status: 'learned', imageMatchable: false, isActive: true,
  tiers: [{ minQty: 1, maxQty: null, unitPrice: usd(12) }], aliases: [], images: [], recentQuotes: [],
  ...over,
} as ProductDetail);
const PROOF: ProofView = {
  seller: 'Rose Oil Studio', productName: 'Rose lip oil', sku: 'RL-1',
  quantity: 1, unit: 'item', unitPrice: usd(12), total: usd(12),
  tier: { minQty: 1, maxQty: null }, moq: null, leadTimeDays: null, certifications: [], taught: [],
  issuedAt: new Date('2026-10-01T02:00:00Z'), locale: 'en',
};

describe('RT · who sells by quantity', () => {
  it('makers, exporters and wholesalers — and a workspace with no kind; nobody else', () => {
    expect(BUSINESS_KINDS.filter(sellsByQuantity)).toEqual(['manufacturer', 'trading', 'wholesale']);
    expect(sellsByQuantity(null)).toBe(true);
  });
});

describe('RT · a shop\'s pages, in every language', () => {
  for (const locale of LOCALES) {
    const l = locale as Locale;
    const moq = esc(t(l, 'product.list.moq'));
    const none = esc(t(l, 'product.noMinimum'));
    it(`${l} · the list: the price is the price, no minimum line; a set minimum is shown`, () => {
      const shop = renderProductList([item()], l, null, undefined, 'brand');
      expect(shop).not.toContain(moq);
      expect(shop).not.toContain(none);
      expect(renderProductList([item({ moq: 3 })], l, null, undefined, 'brand')).toContain(moq);
      // Bulk, unchanged: "1 pcs: $12.00 · Min. order: No minimum".
      const bulk = renderProductList([item({ unit: 'pcs' })], l, null, undefined, 'manufacturer');
      expect(bulk).toContain(moq);
      expect(bulk).toContain(none);
      expect(renderProductList([item({ unit: 'pcs' })], l)).toContain(none);
    });
    it(`${l} · the product's page: no minimum line for a shop, 0081's line for bulk`, () => {
      expect(renderProductDetail(detail({ businessKind: 'online_shop' }), l)).not.toContain(`${moq}</span> ${none}`);
      expect(renderProductDetail(detail({ businessKind: 'online_shop', moq: 3 }), l)).toContain(`${moq}</span>`);
      expect(renderProductDetail(detail({ businessKind: 'wholesale' }), l)).toContain(`${moq}</span> ${none}`);
      expect(renderProductDetail(detail(), l)).toContain(`${moq}</span> ${none}`);
    });
    it(`${l} · the customer's price page: no band for a single price, no minimum where none`, () => {
      const band = esc(t(l, 'proof.fact.tier'));
      const min = esc(t(l, 'proof.fact.moq'));
      const shop = renderProof({ ...PROOF, sellerKind: 'brand', locale: l });
      expect(shop).not.toContain(band);
      expect(shop).not.toContain(min);
      // Two bands, or a minimum, are stated for a shop too.
      expect(renderProof({ ...PROOF, sellerKind: 'brand', tier: { minQty: 10, maxQty: null }, locale: l })).toContain(band);
      expect(renderProof({ ...PROOF, sellerKind: 'brand', moq: 3, locale: l })).toContain(min);
      const bulk = renderProof({ ...PROOF, locale: l });
      expect(bulk).toContain(band);
      expect(bulk).toContain(min);
    });
  }
});

describe('RT · the lead-time writer', () => {
  it('the owner\'s form asks for the days, says what empty means, and shows what is set', () => {
    for (const locale of LOCALES) {
      const l = locale as Locale;
      const page = renderProductDetail(detail({ leadTimeDays: 5 }), l);
      expect(page, l).toMatch(/<input name="leadTime" inputmode="numeric" value="5"/);
      expect(page, l).toContain(esc(t(l, 'product.edit.leadTime')));
      expect(page, l).not.toMatch(/\bproduct\.edit\.leadTime/);
    }
    expect(renderProductDetail(detail(), 'en')).toMatch(/<input name="leadTime" inputmode="numeric" value=""/);
    // Staff see no form (rule 11).
    expect(renderProductDetail(detail(), 'en', null, {}, {}, { isOwner: false }))
      .not.toContain('name="leadTime"');
  });
});
