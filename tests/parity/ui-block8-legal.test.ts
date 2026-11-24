import { describe, it, expect } from 'vitest';
import { renderPrivacy, renderCookies, renderLegalTerms, renderRefunds, renderDataDeletion, type LegalFacts } from '../../src/api/web/legal.js';
import { DEFAULT_PROCESSOR, HOSTING } from '../../src/core/legal/processors.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * UI correction Block 8 · audit F42 — the legal pages are read, not only stored (2026-11-24).
 *
 * Before: a long page (privacy runs to ten sections) gave no way to reach a section but scrolling, and no section
 * could be linked to; the cookie table broke words to fit a phone ("Ho w lon g it last s", "min utes").
 * Now: each long page lists its sections before the first, every section can be linked to, and the cookie table
 * keeps words whole — a labelled block per cookie on a phone, its labels the table's own headings. The legal text is
 * unchanged word for word in every language: proven outside the tests by a before/after visible-text diff of the five
 * pages in the five languages (docs/design/ui-correction/block8; the builder's report), since a test cannot read
 * cfc71dca. Here: every heading is still written as it was (`<h2>…</h2>`), so the pins on the text still hold.
 */
const FACTS: LegalFacts = { processor: DEFAULT_PROCESSOR, hosting: HOSTING };
const long = (l: (typeof LOCALES)[number]) => ({
  privacy: renderPrivacy(l, 'privacy@example.com', FACTS), terms: renderLegalTerms(l, 'privacy@example.com'),
  refunds: renderRefunds(l, 'billing@example.com', { trialDays: 14 }), deletion: renderDataDeletion(l, 'privacy@example.com'),
});

describe('Block 8 · F42 — the legal pages', () => {
  it('a long page lists its sections first, each a link that lands on its heading, in every language', () => {
    for (const l of LOCALES) for (const [what, html] of Object.entries(long(l))) {
      const nav = /<nav class="legal-toc" aria-labelledby="legal-toc-title">([\s\S]*?)<\/nav>/.exec(html)?.[1];
      expect(nav, `${l} ${what}`).toBeTruthy();
      expect(nav, `${l} ${what}`).toContain(`>${t(l, 'legal.contents')}</p>`);
      const links = [...nav!.matchAll(/<li><a href="#([a-z0-9-]+)">([^<]+)<\/a><\/li>/g)];
      const headings = [...html.matchAll(/<h2(?: id="[^"]+")?>([^<]+)<\/h2>/g)].map((m) => m[1]);
      expect(links.map((m) => m[2]), `${l} ${what}`).toEqual(headings);
      for (const [, id] of links) expect(html.match(new RegExp(`id="${id}"`, 'g')), `${l} ${what} #${id}`).toHaveLength(1);
      // The list sits inside the document, before its first section, never inside a heading or the text.
      expect(html.indexOf('<nav class="legal-toc"'), `${l} ${what}`).toBeLessThan(html.indexOf('<h2'));
      expect(html.indexOf('<nav class="legal-toc"'), `${l} ${what}`).toBeGreaterThan(html.indexOf('</h1>'));
    }
    // A short page has nothing to list.
    expect(renderCookies('en', null, FACTS)).not.toContain('<nav class="legal-toc"');
  });

  it('the cookie table keeps words whole, and on a phone labels each value with its own heading', () => {
    for (const l of LOCALES) {
      const html = renderCookies(l, null, FACTS);
      expect(html, l).not.toMatch(/table\.cookies th, table\.cookies td \{[^}]*overflow-wrap:anywhere/);
      expect(html, l).toMatch(/table\.cookies th, table\.cookies td \{[^}]*overflow-wrap:break-word/);
      expect(html, l).toContain('table.cookies td:nth-child(3) { white-space:nowrap; }');
      expect(html, l).toMatch(/@media \(max-width: 40rem\) \{\s*table\.cookies, table\.cookies tbody, table\.cookies tr, table\.cookies td \{ display:block; \}/);
      for (const [n, key] of [[1, 'name'], [2, 'purpose'], [3, 'lifetime']] as const) {
        const label = JSON.stringify(t(l, `legal.privacy.cookies.${key}`));
        // Shown on the screen, kept out of what a screen reader announces (it hears the table's own header).
        expect(html, `${l} ${key}`).toContain(`table.cookies td:nth-child(${n})::before { content:${label}; content:${label} / ""; }`);
      }
      // The table's markup is what it was: its headings are the column headers.
      expect(html, l).toContain(`<th scope="col">${t(l, 'legal.privacy.cookies.lifetime')}</th>`);
    }
  });
});
