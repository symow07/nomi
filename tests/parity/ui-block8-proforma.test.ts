import { describe, it, expect } from 'vitest';
import { usd } from '../../src/core/types/money.js';
import { renderProformaPage, type ProformaView } from '../../src/api/web/proforma.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

/**
 * UI correction Block 8 — the public proforma (/pi/:token, inventory 140, left to Block 8 by Block 5) is in the public
 * frame, like every public page but the site: the signed-in app's palette, ink focus, one sans. Its seller's name is no
 * longer in the serif (kept for a legal document's title alone). It still arrives complete with nothing to fetch, and
 * the document — its figures and words — is not changed: proforma-link.test.ts holds them in every language, and the
 * builder compared the served <main> byte for byte with cfc71dca. Fails at cfc71dca; passes on head.
 */
const VIEW: ProformaView = {
  locale: 'en', zone: 'Europe/Paris',
  seller: 'Maison Lumen', sellerAddress: '12 rue des Fleurs\n69002 Lyon',
  buyer: 'A. Customer', reference: '2026-0042', issuedAt: new Date('2026-11-20T09:00:00Z'),
  product: 'Linen shirt', sku: null, quantity: 3, unit: 'pcs',
  unitPrice: usd('40'), total: usd('120'), sampleCredit: null,
  incoterm: 'Delivered', paymentTerms: 'On receipt',
};

describe('Block 8 · the proforma in the public frame', () => {
  it('is drawn in the public frame, in every language', () => {
    for (const l of LOCALES) {
      const html = renderProformaPage({ ...VIEW, locale: l });
      expect(html, l).toContain('<body class="pub"><main class="pi">');
      expect(html, l).toMatch(/body\.pub \{ --color-brand:var\(--color-ink\);/);
    }
  });

  it('the seller’s name is in the one sans, and the page still needs nothing from outside', () => {
    for (const l of LOCALES) {
      const html = renderProformaPage({ ...VIEW, locale: l });
      const seller = /\.pi-seller \{[^}]*\}/.exec(html)?.[0] ?? '';
      expect(seller, l).toContain('font-size:var(--font-size-display)');
      expect(seller, l).not.toContain('font-family');
      expect(html, l).not.toContain('var(--font-voice)');
      expect(html, l).not.toMatch(/<link |<script|\ssrc=|url\(\s*["']?https?:/);
    }
  });
});
