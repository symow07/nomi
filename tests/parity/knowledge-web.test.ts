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
  certs: ['CE'], appliesToProducts: 12,
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
      // CC-20 — the knowledge page has ONE title: its first half draws it, with
      // the lede (renderKnowledgeOps). This half printed the same title again.
      expect(html).not.toContain('<h1');
      expect(html).not.toContain(t(l, 'knowledge.intro'));
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
    // Phase 9 (V1-373) — the certifications are switched where they all are, the
    // knowledge page; this product's page says which are on, and leads there.
    expect(html).not.toContain('action="/app/knowledge/cert"');
    expect(html).toContain(t('en', 'knowledge.cert.onHere', { list: 'CE marking' }));
    expect(html).toContain('href="/app/knowledge#certs"');
    // The panel itself writes claims_policy; CE is on, in words and with its mark.
    const all = renderKnowledgeIndex(index, 'en');
    expect(all).toContain('action="/app/knowledge/cert"');
    expect(all).toMatch(/<b>CE marking<\/b> <span class="pill ok">On<\/span>/);
    expect(all).toContain('value="FDA"');   // an off cert is still offered
  });

  it('correct/archive forms carry the product id for the redirect', () => {
    const html = renderProductKnowledge(product, 'en', null);
    // both the correct textarea form and the archive form ship productId=p1
    expect((html.match(/name="productId" value="p1"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('localizes the certifications hint + zh/ar chrome', () => {
    expect(renderKnowledgeIndex(index, 'zh')).toContain(t('zh', 'knowledge.cert.hint'));
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
  // Phase 9 (V1-373) — the switches live on the knowledge page, which is about the whole business.
  const all: KnowledgeIndex = { products: [], business: [], certs: ['CE'], appliesToProducts: 12 };

  it('says plainly that certifications cover the whole catalogue', () => {
    expect(renderKnowledgeIndex(all, 'en')).toContain('These apply to everything you sell — all 12 of your products.');
    expect(renderProductKnowledge(d, 'en', null)).toContain('These certifications are on for everything you sell: CE marking.');
  });

  it('and that taught facts do not — the two scopes read differently', () => {
    const html = renderProductKnowledge(d, 'en', null);
    expect(html).toContain(t('en', 'knowledge.taught.title'));
    expect(html).toContain('used only when a customer asks about Canvas tote');
    // Both scopes are named on the same screen, so neither can be assumed.
    expect(html).toContain('everything you sell');
  });

  it('a catalogue-wide change is confirmed', () => {
    const html = renderKnowledgeIndex(all, 'en');
    expect(html).toContain('for all 12 of your products');
    expect(html).toContain('onclick="return confirm(this.dataset.confirm)"');
  });

  it('turning one OFF is confirmed too — she stops confirming it to anyone', () => {
    const html = renderKnowledgeIndex(all, 'en');
    expect(html).toContain('Turn off CE marking for all 12 of your products?');   // CE is on
    expect(html).toContain('Turn on FDA approval for all 12 of your products?');   // FDA is not
  });

  it('states the default-deny rule without claiming a scope', () => {
    expect(renderKnowledgeIndex(all, 'en'))
      .toContain('Anything not turned on here is refused, however a customer asks.');
  });

  it('reads in every locale', () => {
    for (const l of LOCALES) {
      const html = renderKnowledgeIndex(all, l);
      expect(html).toContain('12');                       // the real count, every locale
      if (l !== 'en') expect(html).not.toContain('everything you sell');
    }
  });
});
