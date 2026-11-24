import { describe, it, expect } from 'vitest';
import { loginPage, signupPage, setPasswordPage, forgotPasswordPage, verifyPage, errorPage } from '../../src/api/web/layout.js';
import { renderPrivacy, renderCookies, renderLegalTerms, renderRefunds, renderDataDeletion, type LegalFacts } from '../../src/api/web/legal.js';
import { renderUnsubscribe, renderUnsubscribed } from '../../src/api/web/unsubscribe.js';
import { notFoundPage } from '../../src/api/web/proof.js';
import { renderClosed } from '../../src/api/web/erasure.js';
import { DEFAULT_PROCESSOR, HOSTING } from '../../src/core/legal/processors.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { cssVariables } from '../../src/core/owner/css.js';
import { DESIGN_TOKENS, PUBLIC_TOKENS } from '../../src/core/owner/tokens.js';
import { linkedCss } from './linked-css.js';

/**
 * UI correction Block 8 · audit F42 — ONE calm frame for the public and sign-in pages (2026-11-24).
 *
 * Before: the door opened on a centred language pill over a 72 px seal, with the accent magenta for the focus ring and
 * the chosen language; the public documents (legal, unsubscribe, link-not-working, closed) kept the 84cb4580 palette
 * and their own magenta ring, and some (unsubscribe, a chat link that does not work) had no top line at all.
 * Now: one quiet top line (the mark, the name, the language menu at the end), the signed-in app's palette, ink for the
 * ring, a link's line and the chosen language, and every link that does not work says what to do instead. The site is
 * not part of this (F45 deferred; site-bytes.test.ts holds it byte for byte).
 */
const FACTS: LegalFacts = { processor: DEFAULT_PROCESSOR, hosting: HOSTING };
const doors = (l: (typeof LOCALES)[number]) => ({
  login: loginPage({ locale: l, path: '/login' }),
  code: loginPage({ locale: l, path: '/login', withCode: true }),
  signup: signupPage({ locale: l, path: '/signup', mode: 'open', passwordMin: 10 }),
  setpw: setPasswordPage({ locale: l, path: '/login/set-password', passwordMin: 10, passwordMax: 200, link: { token: 'x', email: 'a@example.com' } }),
  gone: setPasswordPage({ locale: l, path: '/login/set-password', passwordMin: 10, passwordMax: 200, link: null }),
  forgot: forgotPasswordPage({ locale: l, path: '/login/forgot', minutes: 30 }),
  verify: verifyPage({ locale: l, path: '/verify', maskedEmail: 'a***@example.com', purpose: 'signup' }),
  notfound: errorPage({ locale: l, path: '/nope', kind: 'notfound' }),
});
const documents = (l: (typeof LOCALES)[number]) => ({
  privacy: renderPrivacy(l, null, FACTS), cookies: renderCookies(l, null, FACTS), terms: renderLegalTerms(l, null),
  refunds: renderRefunds(l, null, { trialDays: null }), deletion: renderDataDeletion(l, null),
  unsubscribe: renderUnsubscribe({ businessId: 'b', channel: 'email', identity: 'someone@example.com', locale: l }, 'tok'), unsubscribed: renderUnsubscribed(l), closed: renderClosed(l),
  proofGone: notFoundPage(l, 'proof'), proformaGone: notFoundPage(l, 'proforma'), unsubscribeGone: notFoundPage(l, 'unsubscribe'),
});

describe('Block 8 · F42 — one public and sign-in frame', () => {
  it('every door opens on one quiet top line: whose door, and a language menu that does not lead the page', () => {
    for (const l of LOCALES) for (const [what, html] of Object.entries(doors(l))) {
      expect(html, `${l} ${what}`).toContain('<body class="door">');
      expect(html, `${l} ${what}`).toMatch(/<header class="door-top"><div class="brand"><svg class="mark"[\s\S]*?<\/div><details class="langmenu"><summary>/);
      expect(html, `${l} ${what}`).not.toContain('class="top-sw"');
      // The page's task is its landmark; the five languages are still there, behind the menu.
      expect(html, `${l} ${what}`).toContain('<main class="card">');
      for (const o of LOCALES) expect(html, `${l} ${what} ${o}`).toContain(`/locale?set=${o}&next=`);
    }
  });

  it('the door is themed like the signed-in app: ink for the ring, a link and the chosen language; the seal keeps its accent', () => {
    const css = linkedCss(loginPage({ locale: 'en', path: '/login' }));
    expect(css).toContain('body.door { --color-brand:var(--color-ink);');
    expect(css).toContain('body.door .mark { --color-brand:var(--color-cue); }');
    expect(css).toContain('.langmenu > .langsw a.on { background:var(--color-sand); color:var(--color-ink); font-weight:600; }');
    expect(css).toMatch(/\.login \.card \{ padding:var\(--space-32\); background:var\(--color-surface\)/);
  });

  it('the public documents share the frame: the app palette inside the page, an ink ring, nothing to fetch', () => {
    for (const l of LOCALES) for (const [what, html] of Object.entries(documents(l))) {
      expect(html, `${l} ${what}`).toContain('<body class="pub">');
      expect(html, `${l} ${what}`).toContain(cssVariables(DESIGN_TOKENS));
      expect(html, `${l} ${what}`).not.toContain(cssVariables(PUBLIC_TOKENS));
      expect(html, `${l} ${what}`).toContain(':focus-visible { outline:2px solid var(--color-ink); outline-offset:2px; }');
      expect(html, `${l} ${what}`).toContain('body.pub { --color-brand:var(--color-ink);');
      expect(html, `${l} ${what}`).not.toContain('<link');
      expect(html, `${l} ${what}`).not.toContain('<script');
      // One top line on every one of them, the mark and the name leading to the site.
      expect(html, `${l} ${what}`).toMatch(/<header class="pub-top"><a class="pub-brand" href="\/site"><svg class="mark"/);
    }
    // Where a page offers languages, it is the same quiet menu, never the pill at the top.
    expect(renderPrivacy('ar', null, FACTS)).toMatch(/<\/a><details class="langmenu"><summary>/);
  });

  it('a link that does not work says how to go on, in every language', () => {
    for (const l of LOCALES) {
      for (const kind of ['proof', 'proforma'] as const) expect(notFoundPage(l, kind)).toContain(t(l, `public.notFound.${kind}.next`).slice(0, 6));
      expect(t(l, 'chat.goneNext').length, l).toBeGreaterThan(40);
      if (l !== 'en') expect(t(l, 'chat.goneNext'), l).not.toBe(t('en', 'chat.goneNext'));
    }
  });
});
