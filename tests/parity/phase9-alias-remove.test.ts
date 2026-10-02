import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { usd } from '../../src/core/types/money.js';
import { renderProductDetail, type ProductDetail } from '../../src/api/web/products.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import { flashTone } from '../../src/core/owner/flashTone.js';

/**
 * Phase 9 (V1-313) — a name customers use can be taken off a product (0122).
 * The product's own names are not offered: every edit writes them back, and a
 * product found by no name cannot be quoted. It asks first, and it is the
 * owner's, as the product's other facts are.
 */
const detail = (over: Partial<ProductDetail> = {}): ProductDetail => ({
  currency: 'USD', id: 'de300000-0000-4000-8000-000000000101', name: 'Canvas Tote Bag', nameZh: '帆布袋', sku: 'ZX-100',
  category: null, unit: 'pcs', moq: 500, leadTimeDays: 15, customizable: false, learned: true, status: 'learned',
  isActive: true, imageMatchable: true, tiers: [{ minQty: 500, maxQty: null, unitPrice: usd(1.05) }],
  aliases: ['Canvas Tote Bag', 'tote bag', '帆布袋', 'حقيبة قماش'], images: [], recentQuotes: [], ...over,
});
const form = (html: string): string => /<form method="post" action="\/app\/products\/[^"]+\/names\/remove"[\s\S]*?<\/form>/.exec(html)?.[0] ?? '';

describe('Phase 9 · a name customers use, taken off a product', () => {
  it('offers the customers\' names only, never the product\'s own, and asks first — in every language', () => {
    for (const l of LOCALES) {
      const f = form(renderProductDetail(detail(), l));
      expect(f, l).not.toBe('');
      expect(f, l).toContain('<option value="tote bag">tote bag</option>');
      expect(f, l).toContain('<option value="حقيبة قماش">');
      expect(f, l).not.toContain('value="Canvas Tote Bag"');
      expect(f, l).not.toContain('value="帆布袋"');
      expect(f, l).toContain('onclick="return confirm(this.dataset.confirm)"');
      expect(f, l).toContain(esc(t(l, 'product.alias.remove.button')));
    }
  });
  it('is the owner\'s: a colleague sees the names, not the control; nothing to take off, no control', () => {
    const colleague: Parameters<typeof renderProductDetail>[5] = { isOwner: false };
    expect(form(renderProductDetail(detail(), 'en', null, {}, {}, colleague))).toBe('');
    expect(form(renderProductDetail(detail({ aliases: ['Canvas Tote Bag', '帆布袋'] }), 'en'))).toBe('');
  });
  it('the outcome is said in its own tone; the database does the taking, through one function', () => {
    expect(flashTone('product.alias.removed')).toBe('ok');
    expect(flashTone('product.alias.notRemoved')).toBe('bad');
    const sql = readFileSync(new URL('../../migrations/0122_alias_remove.sql', import.meta.url), 'utf8');
    expect(sql).toContain('security definer');
    expect(sql).toContain('p.business_id = current_business_id()');
    expect(sql).toContain('lower(pa.alias) <> lower(p.name)');
    expect(sql).not.toMatch(/grant\s+delete/i);
  });
});
