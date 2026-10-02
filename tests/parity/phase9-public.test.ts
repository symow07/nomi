import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { loginPage, signupPage, setPasswordPage, errorPage, esc } from '../../src/api/web/layout.js';
import { registerWebApp } from '../../src/api/web/app.js';
import { renderPrivacy } from '../../src/api/web/legal.js';
import { DEFAULT_PROCESSOR, HOSTING } from '../../src/core/legal/processors.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { messages, t } from '../../src/core/owner/i18n/messages.js';
import { linkedCss } from './linked-css.js';

/**
 * PHASE 9 — the public pages against the merged defect list (docs/UI-AUDIT.md,
 * §2): the door, the access code, sign-up, a spent link, a wrong address, the
 * policies. Each block names the findings it holds; each assertion fails on
 * the page as it was at 29e5e5a.
 */

const between = (html: string, a: string, b: string) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));

describe('the door says one thing, the site\'s way (V1-032, V1-035, V1-038–V1-040, V1-046, public-missed-10)', () => {
  for (const l of LOCALES) {
    it(`${l} · a heading for the task, the button its word, the site's mark and tagline, a foot of real places`, () => {
      const html = loginPage({ locale: l, path: '/login' });
      expect(html).toContain(`<title>Nomi · ${esc(t(l, 'login.title'))}</title>`);
      expect(html).toContain(`<h1>${esc(t(l, 'login.title'))}</h1>`);
      expect(html).toContain(`<button type="submit">${esc(t(l, 'login.submit'))}</button>`);
      expect(html).toMatch(/<div class="brand"><svg class="mark"/);
      expect(t(l, 'login.brandTagline')).not.toMatch(/employee|员工|موظف|emplead|employé/i);
      expect(html).toContain(`<nav class="foot" aria-label="Nomi"><a href="/site">${esc(t(l, 'door.site'))}</a><a href="/privacy">${esc(t(l, 'legal.privacyLink'))}</a><a href="/terms">${esc(t(l, 'legal.termsLink'))}</a></nav>`);
      expect(Object.keys(messages[l])).not.toContain('login.footer');
    });
  }
  it('en · one name for signing in: the tab, the heading, the button; the way back names no other', () => {
    expect([t('en', 'login.title'), t('en', 'login.submit'), t('en', 'site.signIn')]).toEqual(['Sign in', 'Sign in', 'Sign in']);
    expect(t('en', 'login.withEmail')).not.toMatch(/sign in|log in|enter/i);
    expect(t('en', 'login.brandTagline')).toBe('An assistant that answers your customers');
  });
});

describe('the access code card says what the code is (V1-041, V1-043, V1-044)', () => {
  for (const l of LOCALES) {
    it(`${l} · a heading, where the code comes from, how it differs from an invitation; shown as typed`, () => {
      const html = loginPage({ locale: l, path: '/login?with=code', withCode: true });
      expect(html).toContain(`<h1>${esc(t(l, 'login.code.title'))}</h1>`);
      expect(html).toContain(`<p class="lead">${esc(t(l, 'login.code.lead'))}</p>`);
      expect(html).toMatch(/<input id="login-code" type="text" name="code" required autocomplete="off" autocapitalize="characters"/);
      expect(html).toContain('action="/login?with=code"');
    });
  }
  it('zh · 访问码, never 密码 for the code; the button is 登录, not 进入…进入', () => {
    expect([t('zh', 'login.passwordLabel'), t('zh', 'login.codeToggle'), t('zh', 'login.error')].join('')).not.toContain('密码');
    expect(t('zh', 'login.submit')).toBe('登录');
    expect(t('zh', 'login.code.title')).not.toMatch(/进入.*进入/);
  });
});

describe('sign-in by invitation says so (V1-033)', () => {
  for (const l of LOCALES) {
    it(`${l} · open: "new here"; invite: "have an invitation"; closed: no link`, () => {
      expect(loginPage({ locale: l, path: '/login', signupMode: 'open' })).toContain(`<a href="/signup">${esc(t(l, 'login.toSignup'))}</a>`);
      expect(loginPage({ locale: l, path: '/login', signupMode: 'invite' })).toContain(`<a href="/signup">${esc(t(l, 'login.toSignup.invite'))}</a>`);
      expect(loginPage({ locale: l, path: '/login', signupMode: 'closed' })).not.toContain('href="/signup"');
    });
  }
});

describe('an empty sign-in field is answered by the page (V1-037)', () => {
  it('the form asks the page; the field that is empty is said under it, in every language', () => {
    for (const l of LOCALES) {
      const html = loginPage({ locale: l, path: '/login', problem: 'password_missing', email: 'a@b.test' });
      expect(html).toContain('<form method="post" action="/login" novalidate>');
      expect(html).toMatch(/id="login-password"[^>]*autofocus class="err-field" aria-invalid="true" aria-describedby="login-password-err"/);
      expect(html).toContain(`<div class="fld-err" id="login-password-err" role="alert">${esc(t(l, 'login.problem.password_missing'))}</div>`);
      expect(loginPage({ locale: l, path: '/login', problem: 'email_missing' }))
        .toContain(`<div class="fld-err" id="login-email-err" role="alert">${esc(t(l, 'login.problem.email_missing'))}</div>`);
    }
  });

  it('the route answers an empty e-mail or password before anything is looked up', async () => {
    const app = Fastify({ logger: false });
    registerWebApp(app, {
      db: {} as never, sessionSecret: 'x'.repeat(64), accessCode: 'let-me-in',
      businessId: 'de300000-0000-4000-8000-0000000000b1', employeeName: 'Lily', avatar: '', provider: 'disabled',
      secureCookie: false, kickOutbound: async () => {}, resolveDns: async () => ({ spf: [], dkim: [], dmarc: [] }),
    });
    const post = (payload: string) => app.inject({ method: 'POST', url: '/login', payload,
      headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    const noMail = await post('email=&password=secret');
    expect(noMail.statusCode).toBe(400);
    expect(noMail.body).toContain(esc(t('en', 'login.problem.email_missing')));
    expect(noMail.body).not.toContain('name="code"');
    const noPass = await post('email=a%40b.test&password=');
    expect(noPass.statusCode).toBe(400);
    expect(noPass.body).toContain(esc(t('en', 'login.problem.password_missing')));
    expect(noPass.body).toContain('value="a@b.test"');
    await app.close();
  });
});

describe('the door\'s sheet: one face, links that look like links, refusals at their edge, a busy button (V1-031, V1-034, V1-045, V1-049, V1-050, V1-053, public-missed-13, public-new-11)', () => {
  const css = linkedCss(loginPage({ locale: 'en', path: '/login' }));
  it('holds each rule', () => {
    expect(css).toContain('input, select, button, textarea { font-family:inherit; }');
    expect(css).toMatch(/\.login \.card a, \.login \.other a, \.login \.foot a \{ color:var\(--color-ink\); text-decoration:underline;/);
    expect(css).toContain('label.check.terms { display:flex; margin-bottom:var(--space-16); }');
    expect(css).toContain('.err-field { border-color:var(--color-warn); }');
    expect(css).toContain('button[aria-busy="true"]::after { content:"…";');
    // public-missed-09 — the pill is names, not underlined links, on the door and the site alike
    expect(css).toMatch(/\.langsw a \{[^}]*text-decoration:none; \}/);
  });
});

describe('sign-up: the invitation first, examples that are not cut, refusals that are found (V1-047, V1-048, V1-052, V1-055, V1-056, public-missed-12, public-missed-14)', () => {
  for (const l of LOCALES) {
    it(`${l} · the code first, with how to ask for one; the example under its field; the website's own example`, () => {
      const html = signupPage({ locale: l, path: '/signup', mode: 'invite', passwordMin: 10, contact: 'hello@example.test' });
      expect(html.indexOf('id="su-invite"')).toBeLessThan(html.indexOf('id="su-factory"'));
      expect(html).toMatch(/id="su-invite"[^>]*autofocus/);
      expect(html).toContain(esc(t(l, 'signup.inviteAsk', { email: '\u0000' })).replace('\u0000', '<a href="mailto:hello@example.test">hello@example.test</a>'));
      expect(between(html, 'id="su-sells"', '</div>')).toContain(`<div class="hint">${esc(t(l, 'signup.sells.hint'))}`);
      expect(html).not.toContain('placeholder="e.g.');
      expect(html).toContain(`placeholder="${esc(t(l, 'signup.website.placeholder'))}"`);
      if (l !== 'en') expect(t(l, 'signup.website.placeholder'), l).not.toContain('yourbusiness');
    });

    it(`${l} · refused: a list at the top that leads to each field, the cursor on the first, the field marked, the password's absence said`, () => {
      const html = signupPage({
        locale: l, path: '/signup', mode: 'invite', passwordMin: 10,
        values: { factory: 'Atlas', invite: 'X', website: 'nope' },
        problems: { website: 'w', terms: 'tt' },
      });
      expect(html).toContain(`<div class="err" role="alert">${esc(t(l, 'signup.problem.summary'))}<ul><li><a href="#su-website">${esc(t(l, 'signup.website'))}</a></li><li><a href="#su-terms">${esc(t(l, 'signup.termsLink'))}</a></li></ul></div>`);
      expect(html).toMatch(/id="su-website"[^>]*class="err-field" aria-invalid="true" aria-describedby="su-website-err" autofocus/);
      expect(html).not.toMatch(/id="su-factory"[^>]*autofocus/);
      expect(html).toMatch(/id="su-terms" type="checkbox"[^>]*class="err-field"/);
      expect(html).toContain(esc(t(l, 'signup.passwordAgain')));
      // a page that did not come back says nothing about the password
      expect(signupPage({ locale: l, path: '/signup', mode: 'open', passwordMin: 10 })).not.toContain(esc(t(l, 'signup.passwordAgain')));
    });
  }
  it('es · "si tienes uno"; the terms called what their page is called · zh · one "you" in the labels', () => {
    expect(t('es', 'signup.website')).toBe('Sitio web, si tienes uno');
    expect(t('es', 'signup.termsLink')).toBe(t('es', 'legal.termsLink'));
    expect(t('es', 'signup.terms')).toMatch(/^Acepto las \{terms\}/);
    expect(t('zh', 'signup.sells')).not.toContain('你们');
  });
});

describe('a spent choose-a-password link (V1-078, V1-079, V1-080)', () => {
  for (const l of LOCALES) {
    it(`${l} · says what happened, offers a new link or Nomi's team, and signing in only to whoever chose one`, () => {
      const base = { locale: l, path: '/login/set-password', passwordMin: 10, passwordMax: 200, link: null };
      const withMail = setPasswordPage({ ...base, recoveryOn: true, contact: 'hello@example.test' });
      expect(withMail).toContain(`<title>Nomi · ${esc(t(l, 'setpw.gone.title'))}</title>`);
      expect(withMail).toContain(`<h1>${esc(t(l, 'setpw.gone.title'))}</h1>`);
      expect(withMail).not.toContain(esc(t(l, 'setpw.title')));
      expect(withMail).toContain(`<a href="/login/forgot">${esc(t(l, 'setpw.gone.newLink'))}</a>`);
      expect(withMail).toContain(`<a href="/login">${esc(t(l, 'setpw.gone.signIn'))}</a>`);
      const noMail = setPasswordPage({ ...base, recoveryOn: false, contact: 'hello@example.test' });
      expect(noMail).toContain('<a href="mailto:hello@example.test">hello@example.test</a>');
      expect(noMail).not.toContain('/login/forgot');
    });
  }
  it('zh · no 直接登录', () => {
    for (const k of ['setpw.toLogin', 'setpw.gone.signIn'] as const) expect(t('zh', k)).not.toContain('直接登录');
  });
});

describe('a wrong address reads as one (V1-077)', () => {
  it('es and ar say it the way the language does', () => {
    expect(t('es', 'error.notfound.title')).toBe('No encontramos esta página');
    expect(t('ar', 'error.notfound.title')).toBe('لم يُعثر على هذه الصفحة');
    expect(errorPage({ locale: 'es', path: '/x', kind: 'notfound' })).toContain('<h1>No encontramos esta página</h1>');
  });
});

describe('the privacy page points at nothing it does not have (V1-057 in part, V1-061)', () => {
  it('"we" is said, and the replies are the business\'s, not "here"', () => {
    for (const l of LOCALES) {
      const html = renderPrivacy(l, null, { processor: DEFAULT_PROCESSOR, hosting: HOSTING });
      expect(html, l).toContain(esc(t(l, 'legal.privacy.ai')));
    }
    expect(t('en', 'legal.privacy.ai')).toMatch(/^When you write to a business that uses Nomi, its replies/);
    expect(t('zh', 'legal.privacy.ai')).not.toMatch(/^这里/);
    expect(t('ar', 'legal.privacy.ai')).not.toContain('هنا');
    expect(t('es', 'legal.privacy.ai')).not.toContain('de aquí');
    expect(t('fr', 'legal.privacy.ai')).not.toMatch(/^Ici/);
    expect(t('en', 'legal.privacy.intro')).toContain('“We” on this page is Nomi’s operator');
  });
});
