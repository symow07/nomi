import { describe, it, expect } from 'vitest';
import { usd } from '../../src/core/types/money.js';
import { renderProof, notFoundPage, type ProofView } from '../../src/api/web/proof.js';
import { renderClosed } from '../../src/api/web/erasure.js';
import { renderPrivacy, renderCookies, renderLegalTerms, renderRefunds, renderDataDeletion, type LegalFacts } from '../../src/api/web/legal.js';
import { forgotPasswordPage, setPasswordPage, signupPage } from '../../src/api/web/layout.js';
import { DEFAULT_PROCESSOR, HOSTING } from '../../src/core/legal/processors.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { linkedCss } from './linked-css.js';

/**
 * UI correction Block 8 — what the guarantees probe found on head after F42/F43, fixed:
 *  - rule 38: on the proof page the seller, the product's name and the SKU are values ("Canvas Tote Bag 38x40cm" and
 *    "ZX-100" in an Arabic page), and so is each duration in the privacy page's cookie table ("7 أيام"): each in <bdi>.
 *    The words are unchanged (the builder's legal text diff is empty).
 *  - 44 px: a link standing on its own line on the door (ask for another link, e-mail me a new link), each line of the
 *    sign-up's list of problems, and the legal pages' links to the other pages are targets a thumb can hit. A link inside
 *    a sentence keeps WCAG 2.5.8's inline exception.
 * Fails at cfc71dca; passes on head.
 */
const VIEW: ProofView = {
  seller: 'Maison Lumen', productName: 'Canvas Tote Bag 38x40cm', sku: 'ZX-100',
  quantity: 20, unit: 'pcs', unitPrice: usd('12'), total: usd('240'),
  tier: null, moq: null, leadTimeDays: null, certifications: [], taught: [],
  issuedAt: new Date('2026-11-20T09:00:00Z'), locale: 'ar',
};
const FACTS: LegalFacts = { processor: DEFAULT_PROCESSOR, hosting: HOSTING };
const rule = (css: string, sel: string): string => {
  const i = css.indexOf(sel);
  return i < 0 ? '' : css.slice(i, css.indexOf('}', i) + 1);
};

describe('Block 8 · values isolated (rule 38)', () => {
  it('the proof page isolates the seller, the product and the SKU, in every language', () => {
    for (const l of LOCALES) {
      const html = renderProof({ ...VIEW, locale: l });
      expect(html, l).toContain('<div class="seller"><bdi>Maison Lumen</bdi></div>');
      expect(html, l).toContain('<h1><bdi>Canvas Tote Bag 38x40cm</bdi></h1>');
      expect(html, l).toContain('<div class="sku"><bdi>ZX-100</bdi></div>');
    }
  });

  it('each duration in the cookie table is isolated, in every language', () => {
    for (const l of LOCALES) {
      const table = /<table class="cookies">[\s\S]*?<\/table>/.exec(renderPrivacy(l, 'privacy@example.test', FACTS))?.[0] ?? '';
      const rows = [...table.matchAll(/<tr><td>[\s\S]*?<\/tr>/g)].map((m) => m[0]);
      expect(rows.length, l).toBeGreaterThan(0);
      for (const r of rows) expect(r, l).toMatch(/<td><bdi>[^<]+<\/bdi><\/td><\/tr>$/);
    }
  });
});

describe('Block 8 · a link on its own line is a 44 px target', () => {
  it('the door: ask for another link, e-mail me a new link, and the sign-up’s list of problems', () => {
    for (const l of LOCALES) {
      const sent = forgotPasswordPage({ locale: l, path: '/login/forgot', minutes: 60, sent: 'sara@example.com' });
      expect(sent, l).toContain(`<p class="solo"><a href="/login/forgot">${t(l, 'forgot.again')}</a></p>`);
      const gone = setPasswordPage({ locale: l, path: '/login/set-password', passwordMin: 10, passwordMax: 200, link: null, recoveryOn: true, contact: 'hello@example.test' });
      expect(gone, l).toContain('<p class="solo"><a href="/login/forgot">');
      // `.go` is the app's chevron, mirrored in RTL: a row named so on the door mirrored a whole Arabic line.
      expect(sent + gone, l).not.toContain('<p class="go">');
      const css = linkedCss(sent);
      for (const sel of ['.login .solo a', '.login .err li a']) expect(css, `${l} ${sel}`).toContain(sel);
      const r = rule(css, '.login .err li a');
      expect(r, l).toContain('min-height:44px');
      expect(r, l).toContain('display:inline-flex');
      const problems = signupPage({ locale: l, path: '/signup', mode: 'open', passwordMin: 10, values: {}, problems: { factory: 'x', email: 'y' } });
      expect(problems, l).toMatch(/<div class="err" role="alert">[^<]*<ul><li><a href="#[^"]+">/);
      expect(linkedCss(problems), l).toContain('.login .err li a');
    }
  });

  it('the legal pages, workspace closed and the link-not-working page: the row of links to the other pages', () => {
    for (const l of LOCALES) {
      const pages = [
        renderPrivacy(l, 'privacy@example.test', FACTS), renderCookies(l, 'privacy@example.test', FACTS),
        renderLegalTerms(l, 'privacy@example.test'), renderRefunds(l, 'privacy@example.test', { trialDays: 14 }),
        renderDataDeletion(l, 'privacy@example.test'), renderClosed(l), notFoundPage(l, 'proof'),
      ];
      for (const html of pages) {
        expect(rule(html, '.solo a {'), l).toContain('min-height:44px');
        for (const row of html.match(/<p>(?:<a href="\/[a-z-]+">[^<]+<\/a>(?: · )?)+<\/p>/g) ?? []) {
          expect.fail(`${l}: a row of legal links without its targets: ${row}`);
        }
      }
      expect(renderLegalTerms(l, null), l).toContain('<p class="solo"><a href="/privacy">');
    }
  });
});
