import { describe, it, expect } from 'vitest';
import { messages, type MessageKey } from '../../src/core/owner/i18n/messages.js';
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
      expect(html.replace(/<style>[\s\S]*?<\/style>/, ''), l).not.toContain('%');
      expect(html.toLowerCase(), l).not.toContain('token');
      expect(html.toLowerCase(), l).not.toContain('stack');
      expect(html, l).not.toMatch(/<script/);
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
