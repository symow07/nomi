import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loginPage, signupPage, setPasswordPage, errorPage, esc, inviteMailto, gapAfter, FACE_CSS } from '../../src/api/web/layout.js';
import { renderSite, SITE_CSS } from '../../src/api/web/site.js';
import { renderPrivacy, renderDataDeletion, renderLegalTerms } from '../../src/api/web/legal.js';
import { notFoundPage } from '../../src/api/web/proof.js';
import { DEFAULT_PROCESSOR, HOSTING } from '../../src/core/legal/processors.js';
import { initialOf, tintOf } from '../../src/api/web/faces.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { linkedCss } from './linked-css.js';

/**
 * The fix wave (2026-10-03) — the public pages against the re-audit's list
 * (docs/UI-AUDIT.md §2, w4-public-03 to -14). Each block names the finding it
 * holds; each assertion fails on the pages as they were at 8482b10.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
const site = (l: Locale) => renderSite({ locale: l, path: '/', contact: 'hello@example.test', signIn: '/login', noindex: false });
const rule = (css: string, selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  return at < 0 ? '' : css.slice(at, css.indexOf('}', at) + 1);
};

describe('w4-public-03 · the site\'s example shows a face, and the assistant\'s words on its wash', () => {
  it('the customer is drawn by the product\'s face renderer, a blue initial, beside their name, in every locale', () => {
    for (const l of LOCALES) {
      const html = site(l);
      const card = html.slice(html.indexOf('<figure'), html.indexOf('</figure>'));
      const initial = initialOf(t(l, 'site.example.from'))!;
      expect(initial, l).toBeTruthy();
      expect(card, l).toContain(`<span class="site-who"><span class="face face-s t${tintOf('site-example-customer')}" aria-hidden="true"><span class="face-i">${esc(initial)}</span></span><span>${esc(t(l, 'site.example.from'))}</span></span>`);
      // a coloured initial, nothing fetched: the site arrives whole
      expect(card, l).not.toContain('<img');
    }
    // a blue, never the magenta of the assistant's words beside it
    expect(tintOf('site-example-customer')).toBe(8);
  });

  it('the face\'s rules arrive with the page, from the one place they are written', () => {
    expect(site('en')).toContain(FACE_CSS);
    expect(FACE_CSS).toContain('.face { position:relative;');
    expect(SITE_CSS).not.toMatch(/\.face[\s.{-]/);
    // still drawn by the shell: the same text, now named once
    expect(read('src/api/web/layout.ts')).toContain('\n${FACE_CSS}\n  .face-link {');
  });

  it('the draft sits on the assistant\'s wash, as the assistant\'s words do in a conversation', () => {
    expect(rule(SITE_CSS, '.site-draft .site-bubble')).toBe('.site-draft .site-bubble { background:var(--color-assistant-wash); }');
  });
});

describe('w4-public-04 · a field, a list and a button have a control\'s corner, not a card\'s', () => {
  it('on the door', () => {
    const css = linkedCss(loginPage({ locale: 'en', path: '/login' }));
    for (const sel of ['input', 'button', 'select']) {
      const r = css.match(new RegExp(`\\n  ${sel} \\{[^}]*\\}`))?.[0] ?? '';
      expect(r, sel).toContain('border-radius:var(--radius-control)');
      expect(r, sel).not.toContain('--radius-card');
    }
  });
  it('on the site', () => {
    expect(rule(SITE_CSS, '.site-go')).toContain('border-radius:var(--radius-control)');
    expect(rule(SITE_CSS, '.site-go')).not.toContain('--radius-card');
  });
});

describe('w4-public-05, -06 · no space after a full-width stop or question mark', () => {
  it('the rule: none after 。？！：, one after anything else', () => {
    for (const s of ['已经有工作台？', '在发给你的邀请链接里。', '我们的地址：', '好！']) expect(gapAfter(s), s).toBe('');
    for (const s of ['Already have a workspace?', 'لديك مساحة عمل بالفعل؟', 'Vous avez déjà un espace de travail ?']) expect(gapAfter(s), s).toBe(' ');
  });
  it('zh: the site\'s member line and the sign-up hint; en keeps its space', () => {
    expect(site('zh')).toContain(`<span class="site-member">${esc(t('zh', 'site.hero.member'))}<a href="/login">`);
    expect(site('en')).toContain(`<span class="site-member">${esc(t('en', 'site.hero.member'))} <a href="/login">`);
    const ask = (l: Locale) => esc(t(l, 'signup.inviteAsk', { email: '\u0000' })).split('\u0000')[0]!;
    const hint = (l: Locale) => signupPage({ locale: l, path: '/signup', mode: 'invite', passwordMin: 10, contact: 'hello@example.test' });
    expect(hint('zh')).toContain(`${esc(t('zh', 'signup.inviteHint'))}${ask('zh')}`);
    expect(hint('en')).toContain(`${esc(t('en', 'signup.inviteHint'))} ${ask('en')}`);
  });
});

describe('w4-public-07 · a button whose label wraps keeps it in the middle, in even lines', () => {
  it('the site\'s buttons', () => {
    const r = rule(SITE_CSS, '.site-go');
    for (const d of ['justify-content:center', 'text-align:center', 'text-wrap:balance']) expect(r, d).toContain(d);
  });
});

describe('w4-public-08 · never four or more in a row', () => {
  it('no grid on the site lays out four columns or more, at any width', () => {
    const counts = [...SITE_CSS.matchAll(/grid-template-columns:repeat\((\d+)/g)].map((m) => Number(m[1]));
    expect(counts.length).toBeGreaterThan(0);
    for (const n of counts) expect(n).toBeLessThan(4);
    expect(SITE_CSS).toContain('.site-channels { grid-template-columns:repeat(2, minmax(0, 1fr)); }');
  });
});

describe('w4-public-09 · "What goes out alone" is its conditions as a list, no sentence an essay', () => {
  const ALONE = ['site.yours.alone.body', 'site.yours.alone.named', 'site.yours.alone.practice', 'site.yours.alone.record', 'site.yours.alone.after'] as const;
  it('the card draws a lead, the three conditions as a list, then what still waits — in every locale', () => {
    for (const l of LOCALES) {
      const html = site(l);
      const card = html.slice(html.indexOf(`<h3>${esc(t(l, 'site.yours.alone.title'))}</h3>`));
      const k = (key: MessageKey) => esc(t(l, key)).replace(/(^|[^\p{L}])([eE])-mail/gu, '$1$2‑mail');
      expect(card, l).toMatch(new RegExp(`^<h3>[^<]+</h3><p>[^<]+</p><ul class="site-when">(<li>[^<]+</li>){3}</ul><p>[^<]+</p></div>`));
      for (const key of ALONE) expect(card, `${l} ${key}`).toContain(k(key));
    }
  });
  it('no sentence in the card runs past 25 words (50 characters in Chinese)', () => {
    for (const l of LOCALES) {
      for (const key of ALONE) {
        const sentences = t(l, key).split(l === 'zh' ? /[。：；]/ : /[.:;؛]\s|[.:;]$/).map((s) => s.trim()).filter(Boolean);
        for (const s of sentences) {
          if (l === 'zh') expect(s.length, `${l} ${key}: ${s}`).toBeLessThanOrEqual(50);
          else expect(s.split(/\s+/).length, `${l} ${key}: ${s}`).toBeLessThanOrEqual(25);
        }
      }
    }
  });
  it('the three cards stack, one to a row, each as tall as its words', () => {
    expect(SITE_CSS).not.toMatch(/\.site-cards \{ grid-template-columns:repeat/);
    expect(rule(SITE_CSS, '.site-cards')).toContain('max-width:var(--measure-prose)');
  });
});

describe('w4-public-10 · the door\'s heading leaves no word alone', () => {
  it('balanced, in the door\'s sheet', () => {
    expect(linkedCss(loginPage({ locale: 'es', path: '/login?with=code', withCode: true }))).toContain('.login h1 { text-wrap:balance; }');
  });
});

describe('w4-public-11 · ar: the access code card says «الدخول» once', () => {
  it('the heading, the label, the lead and the door to it call the code رمز الوصول', () => {
    expect(t('ar', 'login.code.title')).toBe('تسجيل الدخول برمز الوصول');
    expect(t('ar', 'login.code.title').match(/الدخول/g)?.length).toBe(1);
    expect(t('ar', 'login.passwordLabel')).toBe('رمز الوصول');
    expect(t('ar', 'login.code.lead')).not.toContain('رمز الدخول');
    expect(t('ar', 'login.code.lead')).toContain('رمز الوصول');
    expect(t('ar', 'login.codeToggle')).toBe('لديّ رمز وصول');
  });
});

describe('w4-public-12 · ar: no «لـ» left before a Latin name', () => {
  it('the not-found door\'s link to the site', () => {
    expect(t('ar', 'error.toSite')).toBe('الانتقال إلى صفحة Nomi الرئيسية');
    expect(t('ar', 'error.toSite')).not.toMatch(/لـ\s*[A-Za-z]/);
    expect(errorPage({ locale: 'ar', path: '/x', kind: 'notfound' })).toContain(esc(t('ar', 'error.toSite')));
  });
});

describe('w4-public-13 · sign-up asks for an invitation with the same prepared mail as the site', () => {
  it('the same subject and questions, in every locale', () => {
    for (const l of LOCALES) {
      const href = `href="${esc(inviteMailto(l, 'hello@example.test'))}"`;
      expect(href, l).toContain('?subject=');
      expect(href, l).toContain('&amp;body=');
      expect(site(l), l).toContain(href);
      expect(signupPage({ locale: l, path: '/signup', mode: 'invite', passwordMin: 10, contact: 'hello@example.test' }), l).toContain(href);
    }
  });
});

describe('w4-public-14 · every public tab says the page first, then Nomi; the home page is Nomi itself', () => {
  const title = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
  it('the doors, the policies and the dead links, in every locale', () => {
    const facts = { processor: DEFAULT_PROCESSOR, hosting: HOSTING };
    for (const l of LOCALES) {
      const pages: Record<string, string> = {
        login: loginPage({ locale: l, path: '/login' }),
        code: loginPage({ locale: l, path: '/login?with=code', withCode: true }),
        signup: signupPage({ locale: l, path: '/signup', mode: 'open', passwordMin: 10 }),
        setpw: setPasswordPage({ locale: l, path: '/login/set-password', passwordMin: 10, passwordMax: 200, link: null }),
        notFound: errorPage({ locale: l, path: '/x', kind: 'notfound' }),
        privacy: renderPrivacy(l, null, facts),
        deletion: renderDataDeletion(l, null),
        terms: renderLegalTerms(l, null),
        unsubscribeBad: notFoundPage(l, 'unsubscribe'),
        proofBad: notFoundPage(l, 'proof'),
      };
      for (const [name, html] of Object.entries(pages)) {
        expect(title(html), `${l} ${name}`).toMatch(/^.+ · Nomi$/);
        expect(title(html), `${l} ${name}`).not.toMatch(/^Nomi ·/);
      }
      // The site's front page is Nomi's own: its name, then what it is.
      expect(title(site(l)), l).toBe(esc(t(l, 'site.title')));
      expect(t(l, 'site.title'), l).toMatch(/^Nomi — /);
    }
  });
});
