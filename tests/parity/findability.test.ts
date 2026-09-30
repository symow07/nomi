import { describe, it, expect } from 'vitest';
import { usd } from '../../src/core/types/money.js';
import { cleanName, aliasRowsFor, parseCustomerNames, MAX_ALIAS_LENGTH, MAX_CUSTOMER_NAMES } from '../../src/core/onboard/aliases.js';
// @ts-expect-error — a tool helper, plain JS on purpose (the integration job runs tools without a build).
import * as toolCopy from '../../tools/lib/aliases.mjs';
import { renderProductDetail, renderProductList, type ProductDetail, type ProductListItem } from '../../src/api/web/products.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * T3 — FINDABILITY (the one-month build order, 2026-09-29): the parts no
 * database is needed for. That an imported product is found and quoted, that
 * a rename moves its name, and the backfill tool, are
 * tests/integration/findability.test.ts.
 */

describe('T3 · the names a product is found by', () => {
  it('cleaned to one space between words; empty is none', () => {
    expect(cleanName('  Canvas   tote\tbag \n')).toBe('Canvas tote bag');
    expect(cleanName('   ')).toBeNull();
    expect(cleanName(null)).toBeNull();
    // one form for the same letters (NFC): "é" typed two ways is one name
    expect(cleanName('Café mug')).toBe('Café mug');
  });

  it('each once whatever its case, marked by its script; one too long to match is left out', () => {
    expect(aliasRowsFor(['Canvas Tote', 'canvas tote', '帆布袋', 'حقيبة قماش', null, '', 'x'.repeat(MAX_ALIAS_LENGTH + 1)])).toEqual([
      { alias: 'Canvas Tote', language: 'und', aliasType: 'common' },
      { alias: '帆布袋', language: 'zh', aliasType: 'zh' },
      { alias: 'حقيبة قماش', language: 'ar', aliasType: 'ar' },
    ]);
  });

  it('the names customers use: one per line or split by a comma in any of the three scripts', () => {
    expect(parseCustomerNames('tote\nshopper, beach bag，帆布包、购物袋،حقيبة')).toEqual({
      ok: true, names: ['tote', 'shopper', 'beach bag', '帆布包', '购物袋', 'حقيبة'],
    });
    expect(parseCustomerNames('')).toEqual({ ok: true, names: [] });
    expect(parseCustomerNames(null)).toEqual({ ok: true, names: [] });
    expect(parseCustomerNames('Tote\ntote\nTOTE')).toEqual({ ok: true, names: ['Tote'] });
  });

  it('too long or too many is refused whole — never silently cut', () => {
    expect(parseCustomerNames(`tote\n${'x'.repeat(MAX_ALIAS_LENGTH + 1)}`)).toEqual({ ok: false, error: 'too_long' });
    const many = Array.from({ length: MAX_CUSTOMER_NAMES + 1 }, (_, i) => `name ${i}`).join('\n');
    expect(parseCustomerNames(many)).toEqual({ ok: false, error: 'too_many' });
    expect(parseCustomerNames(many.split('\n').slice(0, MAX_CUSTOMER_NAMES).join('\n'))).toMatchObject({ ok: true });
  });

  it('the backfill tool cleans names exactly as the app does (its copy runs without a build)', () => {
    const corpus: (string | null)[] = [
      'Canvas Tote', ' canvas  TOTE ', '帆布袋', '帆布袋 ', 'حقيبة قماش', 'Café mug', 'Café mug', 'Rose Face Serum 30 ml',
      'x'.repeat(MAX_ALIAS_LENGTH), 'x'.repeat(MAX_ALIAS_LENGTH + 1), '', '   ', null, 'İstanbul çanta', 'ISTANBUL ÇANTA', 'Straße', 'STRASSE',
    ];
    expect(toolCopy.aliasRowsFor(corpus)).toEqual(aliasRowsFor(corpus));
    for (let i = 0; i < corpus.length; i++) {
      expect(toolCopy.aliasRowsFor(corpus.slice(i)), `from ${i}`).toEqual(aliasRowsFor(corpus.slice(i)));
    }
    expect(toolCopy.MAX_ALIAS_LENGTH).toBe(MAX_ALIAS_LENGTH);
  });
});

const detail: ProductDetail = {
  currency: 'USD',
  id: 'p1', name: 'Canvas Tote Bag', nameZh: '帆布袋', sku: 'ZX-100', category: 'bags',
  unit: 'pcs', moq: 500, leadTimeDays: null, customizable: false, learned: true, status: 'learned', isActive: true, imageMatchable: true,
  tiers: [{ minQty: 1, maxQty: null, unitPrice: usd(2.4) }],
  aliases: ['Canvas Tote Bag', '帆布袋'], images: [], recentQuotes: [],
};

describe('T3 · the owner names the product, and sees whether customers can find it', () => {
  it('the edit form has the name, the Chinese name, and a box to add the names customers use', () => {
    for (const l of LOCALES) {
      const html = renderProductDetail(detail, l);
      expect(html, l).toContain(`<input name="name" dir="auto" value="Canvas Tote Bag" />`);
      expect(html, l).toContain(`<input name="nameZh" lang="zh" value="帆布袋" />`);
      expect(html, l).toContain('<textarea name="customerNames" rows="3" dir="auto"></textarea>');
      expect(html, l).toContain(t(l, 'product.edit.customerNames.hint'));
    }
  });

  it('a refused name is said at its field, and what was typed stays', () => {
    const html = renderProductDetail(detail, 'en', null, { customerNames: 'too_many', name: 'empty' }, { name: '', customerNames: 'a\nb' });
    expect(html).toContain(`<p class="perr" role="alert">${t('en', 'product.edit.error.too_many')}</p>`);
    expect(html).toContain(`<p class="perr" role="alert">${t('en', 'product.edit.error.empty')}</p>`);
    expect(html).toContain('<textarea name="customerNames" rows="3" dir="auto">a\nb</textarea>');
  });

  it('staff see the names, never the form (a product is the owner\'s)', () => {
    const html = renderProductDetail(detail, 'en', null, {}, {}, { isOwner: false });
    expect(html).not.toContain('name="customerNames"');
    expect(html).toContain('Canvas Tote Bag');
  });

  it('found by no name: the page says so, and the product is never shown as ready', () => {
    for (const l of LOCALES) {
      const html = renderProductDetail({ ...detail, aliases: [], status: 'not_findable' }, l);
      expect(html, l).toContain(t(l, 'product.detail.notFindable'));
      expect(html, l).toContain(`<span class="pill warn">${t(l, 'product.status.notFindable')}</span>`);
    }
    const found = renderProductDetail(detail, 'en');
    expect(found).not.toContain(t('en', 'product.detail.notFindable'));
    expect(found).not.toContain('pill warn');
    const list: ProductListItem[] = [{
      id: 'p1', name: 'Canvas Tote Bag', nameZh: null, sku: 'ZX-100', moq: 500, unit: 'pcs', entryQty: 500,
      entryPrice: usd(2.4), learned: true, status: 'not_findable', imageMatchable: false, isActive: true,
    }];
    expect(renderProductList(list, 'en')).toContain(t('en', 'product.status.notFindable'));
  });
});
