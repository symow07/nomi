import { describe, it, expect } from 'vitest';
import { renderPrivacy, renderCookies, renderLegalTerms, renderRefunds, renderDataDeletion, type LegalFacts } from '../../src/api/web/legal.js';
import { renderClosed } from '../../src/api/web/erasure.js';
import { notFoundPage } from '../../src/api/web/proof.js';
import { loginPage, signupPage } from '../../src/api/web/layout.js';
import { DEFAULT_PROCESSOR, HOSTING } from '../../src/core/legal/processors.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { linkedCss } from './linked-css.js';

/**
 * UI correction Block 8, the tester's findings at 0b7491af:
 *  - 44 px is BOTH dimensions. The sign-up's list of problems held each link 44 px high but only as wide as its word:
 *    «البلد» (country) was 22 × 44, «العمر» 26 × 44. Every link standing on its own line — the list of problems, the
 *    door's lone links, the public pages' rows of links — is now at least 44 × 44 in every language, a one-word label
 *    included. The words stay where they were (the box grows toward the line's end).
 *  - The language menu's button took the browser's own focus ring (blue, `auto`) on the door, where the stylesheet's
 *    ring rule names a, button, input, select and textarea but not summary. The frame's ring is ink: the menu's button
 *    now draws it, on the door and on every public page. Every other summary on the door (the code page's "Send me a
 *    new code") takes the same ring.
 *  The guard, now measuring width too, found three more of the same: the door's foot links ("Privacy" 43 px) and the
 *  legal contents list's one-word entries ("Why" 31 px, «لماذا» 28, «الإلغاء» 35). Held here as well.
 * Fails at 0b7491af; passes on head.
 */
const FACTS: LegalFacts = { processor: DEFAULT_PROCESSOR, hosting: HOSTING };
const rule = (css: string, sel: string): string => {
  const i = css.indexOf(sel);
  return i < 0 ? '' : css.slice(i, css.indexOf('}', i) + 1);
};

describe('Block 8 fix · a lone link is 44 px wide as well as high', () => {
  it('the sign-up’s list of problems and the door’s lone links, in every language', () => {
    for (const l of LOCALES) {
      const problems = signupPage({ locale: l, path: '/signup', mode: 'open', passwordMin: 10, values: {}, problems: { country: 'x', age: 'y' } });
      expect(problems, l).toContain('<li><a href="#su-country">');
      const r = rule(linkedCss(problems), '.login .err li a');
      expect(r, l).toContain('min-height:44px');
      expect(r, l).toContain('min-width:44px');
      // One rule for the door's lone links: the same selector list carries the width.
      expect(r, l).toMatch(/^\.login \.err li a \{/);
      const all = rule(linkedCss(problems), '.login .other a, .forgot a, .login .solo a, .login .err li a {');
      expect(all, l).toContain('min-width:44px');
      const foot = rule(linkedCss(problems), '.login .foot a { display:');
      expect(foot, l).toContain('min-height:44px');
      expect(foot, l).toContain('min-width:44px');
    }
  });

  it('the public pages’ rows of links, in every language', () => {
    for (const l of LOCALES) {
      const pages = [
        renderPrivacy(l, 'privacy@example.test', FACTS), renderCookies(l, 'privacy@example.test', FACTS),
        renderLegalTerms(l, 'privacy@example.test'), renderRefunds(l, 'privacy@example.test', { trialDays: 14 }),
        renderDataDeletion(l, 'privacy@example.test'), renderClosed(l), notFoundPage(l, 'proof'),
      ];
      for (const html of pages) {
        const r = rule(html, '.solo a {');
        expect(r, l).toContain('min-height:44px');
        expect(r, l).toContain('min-width:44px');
      }
      // The contents list (pages long enough to have one): each entry, a one-word title included.
      for (const html of pages.slice(0, 5).filter((h) => h.includes('class="legal-toc"'))) {
        expect(rule(html, '.legal-toc a{'), l).toContain('min-width:44px');
      }
      expect(renderPrivacy(l, 'privacy@example.test', FACTS), l).toContain('class="legal-toc"');
    }
  });
});

describe('Block 8 fix · the language menu’s button is focused in ink', () => {
  const RING = /\.langmenu > summary:focus-visible \{ outline:2px solid var\(--color-ink\); outline-offset:2px; \}/;
  it('on the door (its sheet is the app’s, whose ring rule leaves summary out)', () => {
    for (const l of LOCALES) {
      expect(linkedCss(loginPage({ locale: l, path: '/login' })), l).toMatch(RING);
      expect(linkedCss(signupPage({ locale: l, path: '/signup', mode: 'open', passwordMin: 10, values: {} })), l).toMatch(RING);
      expect(linkedCss(loginPage({ locale: l, path: '/login' })), l)
        .toContain('body.door summary:focus-visible { outline:2px solid var(--color-ink); outline-offset:2px; }');
    }
  });
  it('on the public pages', () => {
    for (const l of LOCALES) {
      for (const html of [renderPrivacy(l, 'privacy@example.test', FACTS), renderClosed(l)]) {
        expect(html, l).toContain('<details class="langmenu">');
        expect(html, l).toMatch(RING);
      }
    }
  });
});
