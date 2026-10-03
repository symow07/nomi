import { describe, it, expect } from 'vitest';
import { messages, t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { cssVariables } from '../../src/core/owner/css.js';
import {
  renderSite, SITE_CSS, parseSiteHosts, SITE_HOSTS_SHAPE, hostOf, isAppPath, appAddress, siteHostsInForce,
} from '../../src/api/web/site.js';
import { validateEnv } from '../../src/main.js';

/**
 * Phase 5 — what the public site may say, and how it is drawn.
 *
 * The truth rules are the product's: no price, no trial, no number nobody
 * measured, no channel that is not wired. They are held here over the copy
 * itself (`site.*` in every locale) and over the page as a visitor gets it.
 */

const siteKeys = (l: (typeof LOCALES)[number]) =>
  (Object.keys(messages[l]) as MessageKey[]).filter((k) => k.startsWith('site.'));
const siteCopy = (l: (typeof LOCALES)[number]) => siteKeys(l).map((k) => [k, messages[l][k]] as const);

const page = (locale: (typeof LOCALES)[number], noindex = false) => renderSite({
  locale, path: noindex ? '/site' : '/', contact: 'hello@example.test', signIn: 'https://app.example.test/login', noindex,
});

describe('Phase 5 · the site copy', () => {
  it('every site.* key is in all three locales, and none is empty', () => {
    const en = siteKeys('en');
    expect(en.length).toBeGreaterThan(5);
    for (const l of LOCALES) {
      expect(siteKeys(l), l).toEqual(en);
      for (const [k, v] of siteCopy(l)) expect(v.trim().length, `${l} ${k}`).toBeGreaterThan(0);
    }
  });

  it('names no price, currency, trial, discount figure or percentage', () => {
    const banned = /[0-9٠-٩$€£¥￥%]|percent|per month|\/mo\b|\bfree\b|\btrial\b|pricing|plans?\b|试用|免费|月费|套餐|价格方案|百分|تجربة|مجان|اشتراك|بالمئة|٪/i;
    for (const l of LOCALES) {
      const bad = siteCopy(l).filter(([, v]) => banned.test(v));
      expect(bad.map(([k, v]) => `${l} ${k}: ${v}`)).toEqual([]);
    }
  });

  it('claims no channel the product does not serve (WeChat is not wired)', () => {
    for (const l of LOCALES) {
      const bad = siteCopy(l).filter(([, v]) => /wechat|weixin|微信|وي ?تشات|rednote|小红书|tiktok|抖音/i.test(v));
      expect(bad.map(([k, v]) => `${l} ${k}: ${v}`)).toEqual([]);
    }
  });

  it('names the four channels that are wired, and says none is sent alone without the owner', () => {
    const en = siteCopy('en').map(([, v]) => v).join(' ');
    for (const c of ['WhatsApp', 'Instagram', 'Messenger', 'e-mail']) expect(en).toContain(c);
    expect(en).toMatch(/lowest price you set/);
  });

  it('never says {name}: a stranger would read "your assistant" as a name', () => {
    for (const l of LOCALES) expect(siteCopy(l).filter(([, v]) => v.includes('{')).map(([k]) => `${l} ${k}`)).toEqual([]);
  });
});

describe('Phase 5 · the page', () => {
  it('is marked for the production gate, and in the visitor’s language and direction', () => {
    for (const l of LOCALES) {
      const html = page(l);
      expect(html).toContain('data-surface="site"');
      expect(html).toContain(`<html lang="${l}" dir="${l === 'ar' ? 'rtl' : 'ltr'}">`);
      expect(html).toContain('class="langsw"');
      expect(html).toContain('href="/privacy"');
      expect(html).toContain('href="/terms"');
      expect(html).toContain('href="https://app.example.test/login"');
      expect(html).not.toContain('noindex');
    }
    expect(page('en', true)).toMatch(/<meta name="robots" content="noindex/);
  });

  it('carries one stylesheet, and its own rules hold no raw colour and no literal size', () => {
    const html = page('en');
    expect(html.match(/<style/g)?.length).toBe(1);
    expect(html).toContain(SITE_CSS);
    expect(html).toContain(cssVariables());
    const own = SITE_CSS;
    expect(own).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(own).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch|color-mix)\(/);
    expect(own).not.toMatch(/font-size:\s*\d/);
    for (const physical of ['margin-left', 'margin-right', 'padding-left', 'padding-right', 'text-align:left', 'text-align:right'])
      expect(own.includes(physical), physical).toBe(false);
  });

  it('ships no word the owner surface scans for, in markup, rules or comments', () => {
    // The public document's base rules carry `text-size-adjust:100%` (every
    // legal page does); what the site adds — its rules and its markup — none.
    expect(SITE_CSS).not.toContain('%');
    for (const l of LOCALES) {
      const html = page(l);
      // A mail link's subject and text are percent-encoded by the address itself — not a figure anyone reads.
      expect(html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/href="mailto:[^"]*"/g, ''), l).not.toContain('%');
      expect(html.toLowerCase(), l).not.toContain('token');
      expect(html.toLowerCase(), l).not.toContain('stack');
      expect(html, l).not.toMatch(/<script/);
    }
  });

  it('holds every section, the four channels and the invitation, in every locale', () => {
    for (const l of LOCALES) {
      const html = page(l);
      for (const id of ['site-how', 'site-yours', 'site-channels', 'site-who', 'site-invite'])
        expect(html, `${l} ${id}`).toContain(`id="${id}"`);
      expect(html.split('</li>').length - 1, l).toBeGreaterThanOrEqual(3 + 4);
      expect(html.match(/<ul class="site-channels">([\s\S]*?)<\/ul>/)![1]!.match(/<li>/g)?.length, l).toBe(4);
      expect(html, l).toContain('href="/data-deletion"');
      expect(html.match(/mailto:hello@example\.test/g)?.length, l).toBeGreaterThanOrEqual(2);
      // No price-looking figure anywhere a visitor reads.
      expect(html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]*>/g, ' '), l).not.toMatch(/[$€£¥￥]\s*\d/);
    }
  });

  it('draws no invitation line where there is no address', () => {
    const html = renderSite({ locale: 'en', path: '/', contact: null, signIn: '/login', noindex: false });
    expect(html).not.toContain('mailto:');
    expect(html).toContain('data-surface="site"');
  });

  it('escapes the address it is given', () => {
    const html = renderSite({ locale: 'en', path: '/', contact: 'a"b@example.test', signIn: '/login', noindex: false });
    expect(html).not.toContain('a"b@');
  });
});

/**
 * Phase 9 — the site against the merged defect list (docs/UI-AUDIT-V2.md, "site").
 */
describe('Phase 9 · the site says one thing, the product\'s way', () => {
  const text = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ');

  it('one rule for sending alone, and what earns it (V1-016, V1-025, public-missed-17)', () => {
    for (const l of LOCALES) expect(Object.keys(messages[l]), l).not.toContain('site.first.drafts');
    // w4-public-09 — the same rule, as a lead, its three conditions and what still waits.
    expect(t('en', 'site.yours.alone.body')).toMatch(/You may let greetings and questions go alone once:$/);
    expect(t('en', 'site.yours.alone.named')).toBe('you have named your assistant');
    expect(t('en', 'site.yours.alone.practice')).toBe('you have done the checks in Practice');
    expect(t('en', 'site.yours.alone.record')).toMatch(/went out unchanged, across several customers and days$/);
    expect(t('en', 'site.yours.alone.after')).toMatch(/^Anything with a price still waits/);
    expect(t('zh', 'site.yours.alone.body')).not.toContain('赢得');
    // the invitation is said once (V1-027)
    expect(t('en', 'site.invite.body')).not.toMatch(/by invitation/);
    // "we read every new workspace" (V1-017)
    expect(t('en', 'site.first.assisted')).not.toMatch(/\bread\b/);
  });

  it('the example is the product\'s draft card in its words, with no buttons that do nothing (V1-018, public-new-01, public-missed-04)', () => {
    for (const l of LOCALES) {
      const html = page(l);
      const card = html.slice(html.indexOf('<figure'), html.indexOf('</figure>'));
      expect(card, l).toContain(`<span class="site-as" aria-hidden="true">✦</span> ${esc(t(l, 'card.drafted'))}`);
      expect(card, l).toContain(`<span class="site-draft-tag">${esc(t(l, 'card.waiting'))}</span>`);
      expect(card, l).not.toContain('site-fake');
      expect(card, l).not.toMatch(/<(button|a)\b/);
      expect(card, l).toContain(`<p class="site-acts">${esc(t(l, 'site.example.acts'))}</p>`);
      // one filled button: the hero's; the same act lower down is outlined
      expect(html.match(/class="site-go"/g)?.length, l).toBe(1);
      expect(html.match(/class="site-go site-go-2"/g)?.length, l).toBe(1);
    }
    expect(SITE_CSS).toContain('.site-draft-tag::before { content:"○"; content:"○" / "";');
  });

  it('the header keeps Sign in beside the name; the pill has its own row on a phone (V1-019)', () => {
    const html = page('es');
    expect(html).toMatch(/<header class="site-top">\s*<a class="site-brand"[\s\S]*?<\/a>\s*<a class="site-signin"[^>]*>[^<]+<\/a>\s*<div class="site-lang"><div class="langsw"/);
    // wider than what is left beside the name on a phone, so it takes the next row and fills it
    expect(SITE_CSS).toContain('.site-lang { flex:1 0 20rem; }');
    expect(SITE_CSS.indexOf('.site-lang { flex:0 0 auto; order:1; margin-inline-start:auto; }'))
      .toBeGreaterThan(SITE_CSS.indexOf('@media (min-width: 48rem)'));
    expect(SITE_CSS.indexOf('@media (min-width: 48rem)')).toBeGreaterThan(0);
  });

  it('the mail asks with a subject and the questions; e-mail never breaks at its hyphen; one numeral system (public-missed-02, V1-023, V1-028)', () => {
    for (const l of LOCALES) {
      const html = page(l);
      expect(html, l).toContain(`href="mailto:hello@example.test?subject=${esc(encodeURIComponent(t(l, 'site.invite.subject')))}&amp;body=${esc(encodeURIComponent(t(l, 'site.invite.mailBody')))}"`);
    }
    expect(text(page('en'))).not.toMatch(/\be-mail/i);
    expect(text(page('en'))).toContain('e\u2011mail');
    expect(SITE_CSS).not.toContain('arabic-indic');
  });

  it('the foot is the policies, its deletion link says it is for customers; no space after a full-width colon (V1-029, public-missed-06, public-missed-08)', () => {
    for (const l of LOCALES) {
      const foot = page(l).slice(page(l).indexOf('<footer'));
      expect(foot, l).toContain(`<a href="/data-deletion">${esc(t(l, 'site.foot.deletion'))}</a>`);
      expect(foot, l).not.toContain('https://app.example.test/login');
    }
    expect(page('zh')).toContain(`${esc(t('zh', 'site.invite.write'))}<a href="mailto:`);
    expect(page('en')).toContain(`${esc(t('en', 'site.invite.write'))} <a href="mailto:`);
  });
});

describe('Phase 5 · which host is the site', () => {
  it('parses SITE_HOSTS: trimmed, lower-cased, empties dropped', () => {
    expect(parseSiteHosts(' NomiDoes.com, www.nomidoes.com ,')).toEqual(['nomidoes.com', 'www.nomidoes.com']);
    expect(parseSiteHosts(undefined)).toEqual([]);
  });

  it('the boot accepts host names only', () => {
    expect(SITE_HOSTS_SHAPE('nomidoes.com,www.nomidoes.com')).toBe(true);
    for (const bad of ['https://nomidoes.com', 'nomidoes.com:443', 'nomidoes.com/x', 'localhost', ',', 'a b.com'])
      expect(SITE_HOSTS_SHAPE(bad), bad).toBe(false);
  });

  it('validateEnv refuses a malformed SITE_HOSTS and carries a good one', () => {
    const base = {
      DATABASE_URL: 'postgres://x', WEBHOOK_VERIFY_TOKEN: 'v'.repeat(16), CREDENTIAL_KEY: 'a'.repeat(64),
      ANTHROPIC_API_KEY: 'k'.repeat(24), LEGAL_CONTACT_EMAIL: 'privacy@example.com',
    };
    const bad = validateEnv({ ...base, SITE_HOSTS: 'https://nomidoes.com' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.problems.join(' ')).toContain('SITE_HOSTS');
    const good = validateEnv({ ...base, SITE_HOSTS: 'nomidoes.com,www.nomidoes.com' });
    expect(good.ok && good.cfg.SITE_HOSTS).toBe('nomidoes.com,www.nomidoes.com');
    const none = validateEnv(base);
    expect(none.ok && none.cfg.SITE_HOSTS).toBeUndefined();
  });

  it('reads the host without its port, in any case', () => {
    expect(hostOf('WWW.NomiDoes.com:443')).toBe('www.nomidoes.com');
    expect(hostOf(undefined)).toBe('');
  });

  it('never counts the app’s own host as the site', () => {
    expect([...siteHostsInForce(['nomidoes.com', 'app.nomidoes.com'], 'https://app.nomidoes.com')]).toEqual(['nomidoes.com']);
    expect([...siteHostsInForce(['nomidoes.com'], null)]).toEqual(['nomidoes.com']);
  });

  it('knows the app’s addresses, and nothing that merely starts like one', () => {
    for (const u of ['/app', '/app/', '/app/inbox?x=1', '/login', '/login?next=/app', '/signup', '/verify', '/verify/resend'])
      expect(isAppPath(u), u).toBe(true);
    for (const u of ['/', '/apple', '/privacy', '/site', '/locale?set=zh&next=/app', '/loginx', '/p/abc'])
      expect(isAppPath(u), u).toBe(false);
  });

  it('builds the app address from PUBLIC_BASE_URL, or gives none', () => {
    expect(appAddress('https://app.nomidoes.com/', '/app?x=1')).toBe('https://app.nomidoes.com/app?x=1');
    expect(appAddress(null, '/app')).toBeNull();
  });
});

describe('SITE · the button follows sign-up as it stands (opening step 4)', () => {
  for (const l of LOCALES) {
    it(`${l} · open: "start your workspace" to sign-up, and no invitation; closed or by invitation: the invitation`, () => {
      const open = renderSite({ locale: l, path: '/', contact: 'hello@example.test', signIn: 'https://app.example.test/login',
        signUp: 'https://app.example.test/signup', noindex: false });
      expect(open).toContain(`<a class="site-go" href="https://app.example.test/signup">${esc(t(l, 'site.cta.signup'))}</a>`);
      expect(open).toContain(esc(t(l, 'site.signup.title')));
      expect(open).toContain(esc(t(l, 'site.first.open')));
      expect(open).not.toContain(esc(t(l, 'site.cta.invite')));
      expect(open).not.toContain(esc(t(l, 'site.first.invite')));
      const invite = page(l);
      expect(invite).toContain(esc(t(l, 'site.cta.invite')));
      expect(invite).not.toContain('/signup');
    });
  }
  it('open with no contact address: the sign-up section stands, without the address line', () => {
    const html = renderSite({ locale: 'en', path: '/', contact: null, signIn: '/login', signUp: '/signup', noindex: false });
    expect(html).toContain('href="/signup"');
    expect(html).not.toContain('mailto:');
  });
});
