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
  certs: ['CE'],
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
