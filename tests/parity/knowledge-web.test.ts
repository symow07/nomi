import { describe, it, expect } from 'vitest';
import {
  renderKnowledgeIndex, renderProductKnowledge,
  type KnowledgeIndex, type ProductKnowledge,
} from '../../src/api/web/knowledge.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';

const index: KnowledgeIndex = {
  products: [{ id: 'p1', name: 'Non-woven bag', count: 2 }],
  business: [{ id: 'b1', kind: 'restriction', label: 'Export', content: 'No sales to individuals.', source: 'owner_confirmed' }],
};

const product: ProductKnowledge = {
  productId: 'p1', productName: 'Non-woven bag',
  items: [
    { id: 'k1', kind: 'specification', label: 'Dimensions', content: '38 x 40 cm', source: 'owner_confirmed' },
    { id: 'k2', kind: 'faq', label: 'What colors?', content: 'Red, blue, white.', source: 'owner_corrected' },
  ],
  certs: ['CE'], appliesToProducts: 12,
};

describe('M13 · knowledge UI (localized renderer)', () => {
  it('index lists products + a business section + a teach form, in en/zh/ar', () => {
    for (const l of LOCALES) {
      const html = renderKnowledgeIndex(index, l);
      expect(html).toContain(t(l, 'knowledge.title'));
      expect(html).toContain('href="/app/knowledge/p1"');       // product deep link
      expect(html).toContain('Non-woven bag');                  // product name (data)
      expect(html).toContain(t(l, 'knowledge.business'));
      expect(html).toContain('No sales to individuals.');       // business-level item
      expect(html).toContain('action="/app/knowledge/teach"');  // teach form
    }
  });

  it('product page renders items, kind + source labels, correct/archive, and taught certs', () => {
    const html = renderProductKnowledge(product, 'en', null);
    expect(html).toContain('Dimensions');
    expect(html).toContain('38 x 40 cm');
    expect(html).toContain(t('en', 'knowledge.kind.specification'));
    expect(html).toContain(t('en', 'knowledge.kind.faq'));
    expect(html).toContain(t('en', 'knowledge.source.owner_corrected'));   // "You corrected"
    expect(html).toContain('action="/app/knowledge/correct"');
    expect(html).toContain('action="/app/knowledge/archive"');
    // certifications panel writes claims_policy; CE is on
    expect(html).toContain('action="/app/knowledge/cert"');
    expect(html).toMatch(/class="cert on"[^>]*>✓ CE/);
    expect(html).toContain('value="FDA"');   // an off cert is still offered
  });

  it('correct/archive forms carry the product id for the redirect', () => {
    const html = renderProductKnowledge(product, 'en', null);
    // both the correct textarea form and the archive form ship productId=p1
    expect((html.match(/name="productId" value="p1"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('localizes the certifications hint + zh/ar chrome', () => {
    expect(renderProductKnowledge(product, 'zh', null)).toContain(t('zh', 'knowledge.cert.hint'));
    expect(renderProductKnowledge(product, 'ar', null)).toContain(t('ar', 'knowledge.cert.title'));
  });
});

/**
 * M22 (F-03) — the owner must know what Lily is allowed to say, and TO WHOM.
 *
 * `claims_policy` has no product_id: a certification is authorised for the whole
 * business. It was rendered under one product's name with the hint "Only
 * certifications turned on here may be stated to buyers", which reads as though
 * it applied to that product alone. An owner tapping CE while looking at her
 * canvas tote was authorising it for her entire catalogue.
 *
 * The storage is deliberately unchanged: making claims per-product would change
 * the safety core's data model and the guard's lookup. What changes is that the
 * product stops implying a scope it never had.
 */
describe('M22 (F-03) · claims scope is stated, not implied', () => {
  const d: ProductKnowledge = {
    productId: 'p1', productName: 'Canvas tote',
    items: [], certs: ['CE'], appliesToProducts: 12,
  };

  it('says plainly that certifications cover the whole catalogue', () => {
    const html = renderProductKnowledge(d, 'en', null);
    expect(html).toContain('These apply to everything you sell — all 12 of your products, not only this one.');
  });

  it('and that taught facts do not — the two scopes read differently', () => {
    const html = renderProductKnowledge(d, 'en', null);
    expect(html).toContain(t('en', 'knowledge.taught.title'));
    expect(html).toContain('used only when a buyer asks about Canvas tote');
    // Both scopes are named on the same screen, so neither can be assumed.
    expect(html.indexOf('everything you sell')).toBeLessThan(html.indexOf('only when a buyer asks about'));
  });

  it('a catalogue-wide change is confirmed, from a page showing one product', () => {
    const html = renderProductKnowledge(d, 'en', null);
    expect(html).toContain('for all 12 of your products');
    expect(html).toContain('onclick="return confirm(this.dataset.confirm)"');
  });

  it('turning one OFF is confirmed too — she stops confirming it to anyone', () => {
    const html = renderProductKnowledge(d, 'en', null);
    expect(html).toContain('Turn off CE for all 12 of your products?');   // CE is on
    expect(html).toContain('Turn on FDA for all 12 of your products?');   // FDA is not
  });

  it('states the default-deny rule without claiming a scope', () => {
    expect(renderProductKnowledge(d, 'en', null))
      .toContain('Anything not turned on here is refused, however a buyer asks.');
  });

  it('reads in every locale', () => {
    for (const l of LOCALES) {
      const html = renderProductKnowledge(d, l, null);
      expect(html).toContain('12');                       // the real count, every locale
      if (l !== 'en') expect(html).not.toContain('everything you sell');
    }
  });
});
