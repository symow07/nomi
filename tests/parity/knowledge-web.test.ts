import { describe, it, expect } from 'vitest';
import {
  renderKnowledgeIndex, renderProductKnowledge, certRows, CERTS_HOME,
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
    // Phase 9 (V1-373) — the certifications are switched where they all are —
    // since the warmth run's phase 9, My business › What you promise customers
    // (w4-products-knowledge-02); this product's page says which are on, and leads there.
    expect(html).not.toContain('action="/app/knowledge/cert"');
    expect(html).toContain(t('en', 'knowledge.cert.onHere', { list: 'CE marking' }));
    expect(html).toContain(`href="${CERTS_HOME}"`);
    // The panel itself writes claims_policy; CE is on, in words and with its mark.
    const all = certRows('en', index.certs ?? [], 12);
    expect(all).toContain('action="/app/knowledge/cert"');
    expect(all).toMatch(/<b><bdi>CE marking<\/bdi><\/b> <span class="pill ok">On<\/span>/);   // isolated: a code inside Arabic words (surface walk)
    expect(all).toContain('value="FDA"');   // an off cert is still offered
  });

  it('correct/archive forms carry the product id for the redirect', () => {
    const html = renderProductKnowledge(product, 'en', null);
    // both the correct textarea form and the archive form ship productId=p1
    expect((html.match(/name="productId" value="p1"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('localizes which certifications are on + zh/ar chrome', () => {
    expect(renderKnowledgeIndex(index, 'zh')).toContain(t('zh', 'knowledge.cert.onHere', { list: t('zh', 'claim.CE') }));
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
  // The warmth run, phase 9 (w4-products-knowledge-02) — the switches live on My business ›
  // What you promise customers, which is about the whole business (`certRows`, drawn there).
  const all: KnowledgeIndex = { products: [], business: [], certs: ['CE'], appliesToProducts: 12 };
  const rows = (l: (typeof LOCALES)[number] = 'en') => certRows(l, all.certs ?? [], 12);

  it('says plainly that certifications cover the whole catalogue', () => {
    expect(renderKnowledgeIndex(all, 'en')).toContain('These certifications are on for everything you sell: CE marking.');
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
    const html = rows();
    expect(html).toContain('for all 12 of your products');
    expect(html).toContain('onclick="return confirm(this.dataset.confirm)"');
  });

  it('turning one OFF is confirmed too — she stops confirming it to anyone', () => {
    const html = rows();
    expect(html).toContain('Turn off CE marking for all 12 of your products?');   // CE is on
    expect(html).toContain('Turn on FDA approval for all 12 of your products?');   // FDA is not
    // A name inside the question is not capitalised mid-sentence; an initialism keeps its capitals.
    expect(html).toContain('Turn on food-safe materials for all 12 of your products?');
    expect(rows('fr')).toContain('Désactiver marquage CE pour vos 12 produits');
    expect(rows('fr')).toContain('Activer sans BPA pour vos 12 produits');
  });

  it('the knowledge page switches nothing: it says which are on and leads to the one place they are switched', () => {
    const html = renderKnowledgeIndex(all, 'en');
    expect(html).not.toContain('action="/app/knowledge/cert"');
    expect(html).toContain(`href="${CERTS_HOME}"`);
  });

  it('reads in every locale', () => {
    for (const l of LOCALES) {
      const html = rows(l);
      expect(html).toContain('12');                       // the real count, every locale
      if (l !== 'en') expect(html).not.toContain('all 12 of your products');
    }
  });
});
