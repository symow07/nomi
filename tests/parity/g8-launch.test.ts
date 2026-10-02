import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { renderSite } from '../../src/api/web/site.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';

/**
 * G8 — the site says what the first group is (invitation, drafts until
 * earned, read and helped by us) and nothing about a price (rule 12); the
 * go-live and acceptance docs exist and name the tools.
 */
describe('G8 · the site, for the first group', () => {
  for (const locale of LOCALES) {
    it(`${locale} · invitation, drafts until earned, assisted — and the button still asks for an invitation`, () => {
      const html = renderSite({ locale, path: '/', contact: 'hello@example.test', signIn: 'https://app.example.test/login', noindex: false });
      // Phase 9 (V1-016) — "drafts until earned" is said once, where it is explained: the card on what goes out alone.
      for (const k of ['site.first.title', 'site.first.invite', 'site.first.assisted', 'site.yours.alone.body'] as const) {
        expect(html, k).toContain(esc(t(locale, k)).replace(/(^|[^\p{L}])([eE])-mail/gu, '$1$2\u2011mail'));
      }
      expect(html).toContain(esc(t(locale, 'site.cta.invite')));
    });
  }
});

describe('G8 · the operator\'s documents', () => {
  it('the acceptance test, its checker, and the opening sequence', () => {
    const accept = readFileSync(new URL('../../docs/LAUNCH-ACCEPTANCE.md', import.meta.url), 'utf8');
    expect(accept).toContain('tools/acceptance-check.mjs');
    expect(accept).toContain('under **30 minutes**');
    expect(existsSync(new URL('../../tools/acceptance-check.mjs', import.meta.url))).toBe(true);
    const golive = readFileSync(new URL('../../docs/GO-LIVE.md', import.meta.url), 'utf8');
    for (const s of ['SIGNUP_MODE=invite', 'SIGNUP_CAP=20', 'META_APP_REVIEW=approved', 'docs/LAUNCH-ACCEPTANCE.md', 'tools/ops-flags.mjs']) expect(golive, s).toContain(s);
  });
});
