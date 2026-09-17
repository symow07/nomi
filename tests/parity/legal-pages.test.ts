import { describe, it, expect } from 'vitest';
import { renderPrivacy, renderDataDeletion, renderLegalTerms } from '../../src/api/web/legal.js';
import { PUBLIC_ROUTES } from '../../src/api/web/app.js';
import { LOCALES, dirOf } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';

/**
 * The legal pages — what a stranger may read about what is kept, and how to
 * have it removed. Meta fetches both before an app may go live, so a page
 * that failed to render, or rendered behind a login, would keep Instagram
 * messages from ever arriving. The wording itself is bound by the catalogue
 * scan in owner-language.test.ts, like every other string.
 */

const TITLE = {
  privacy: 'legal.privacy.title', 'data-deletion': 'legal.deletion.title', terms: 'legal.terms.title',
} as const;
const pages = (email: string | null) => [
  ['privacy', renderPrivacy] as const, ['data-deletion', renderDataDeletion] as const, ['terms', renderLegalTerms] as const,
].map(([name, render]) => ({ name, html: (l: (typeof LOCALES)[number]) => render(l, email) }));

describe('Legal pages · what a stranger may read', () => {
  it('ALL THREE ARE DECLARED PUBLIC — Meta reads them before the app may go live', () => {
    const gets = PUBLIC_ROUTES.filter((r) => r.method === 'GET').map((r) => r.url);
    expect(gets).toEqual(expect.arrayContaining(['/privacy', '/data-deletion', '/terms']));
  });

  it('render in all three locales, in the right direction, with no script and nothing fetched', () => {
    for (const { name, html } of pages(null)) {
      for (const l of LOCALES) {
        const h = html(l);
        expect(h, `${name} ${l}`).toContain(`<html lang="${l}" dir="${dirOf(l)}">`);
        expect(h).toContain(esc(t(l, TITLE[name])));
        expect(h).not.toContain('<script');
        expect(h).not.toContain('<link');
        // Indexable, unlike the proof and unsubscribe pages: a policy nobody
        // can find is not one.
        expect(h).not.toContain('noindex');
      }
    }
    expect(renderPrivacy('ar', null)).toContain('dir="rtl"');
  });

  it('the address is the installation\'s, and its absence is not a blank', () => {
    for (const { html } of pages('privacy@nomidoes.test')) {
      expect(html('en')).toContain('href="mailto:privacy@nomidoes.test"');
    }
    for (const { html } of pages(null)) {
      const h = html('en');
      expect(h).not.toContain('mailto:');
      expect(h).toContain(esc(t('en', 'legal.contact.same')));
    }
  });

  it('each page links to the others, and each says when it was last changed', () => {
    expect(renderPrivacy('zh', null)).toContain('href="/data-deletion"');
    expect(renderPrivacy('zh', null)).toContain('href="/terms"');
    expect(renderDataDeletion('zh', null)).toContain('href="/privacy"');
    expect(renderLegalTerms('zh', null)).toContain('href="/privacy"');
    for (const { html } of pages(null)) expect(html('en')).toContain(esc(t('en', 'legal.updated')));
  });

  it('the terms are the business\'s, and say the people who write in are not bound by them', () => {
    expect(renderLegalTerms('en', null)).toContain(esc(t('en', 'legal.terms.intro')));
    expect(t('en', 'legal.terms.intro')).toContain('privacy page');
  });

  it('what is promised is what the operator can keep: a request, thirty days, a confirmation', () => {
    // The deletion page names the same window docs/LEGAL.md tells the
    // operator to meet. Changing one without the other is the lie this pins.
    expect(t('en', 'legal.deletion.step2')).toContain('30 days');
    expect(t('zh', 'legal.deletion.step2')).toContain('30 天');
    expect(t('ar', 'legal.deletion.step2')).toContain('30 يومًا');
  });
});
