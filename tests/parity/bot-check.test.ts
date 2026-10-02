import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  botCheckConfigFrom, botCheckRequest, botCheckFrom, limitedDomainOf, BOT_CHECK_WIDGET, SIGNUP_GUARD, type BotCheckFetch,
} from '../../src/api/web/botCheck.js';
import { signupModeInForce } from '../../src/core/owner/signup.js';
import { signupPage } from '../../src/api/web/layout.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * BOT (0114; decision 36) — the bot check, the mode in force, the domain
 * limit's exemptions, the page. Over Postgres and the production composition:
 * tests/integration/bot-check.test.ts.
 */

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const SECRET = 'bot-secret-not-real-0001';
const CFG = { provider: 'turnstile' as const, siteKey: 'site-key-0001', secret: SECRET };

describe('BOT · the check, from three variables or none', () => {
  it('none is none, quietly; all three is a check', () => {
    expect(botCheckConfigFrom({})).toBeNull();
    expect(botCheckConfigFrom({ BOT_CHECK_PROVIDER: 'HCaptcha', BOT_CHECK_SITE_KEY: 'site-key-0001', BOT_CHECK_SECRET: SECRET }))
      .toEqual({ provider: 'hcaptcha', siteKey: 'site-key-0001', secret: SECRET });
  });
  it('half-set is no check, and says which part; a site key that would need escaping is refused', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(botCheckConfigFrom({ BOT_CHECK_PROVIDER: 'recaptcha', BOT_CHECK_SITE_KEY: 'site-key-0001', BOT_CHECK_SECRET: SECRET })).toBeNull();
    expect(botCheckConfigFrom({ BOT_CHECK_PROVIDER: 'turnstile', BOT_CHECK_SITE_KEY: 'a"><script>', BOT_CHECK_SECRET: SECRET })).toBeNull();
    expect(botCheckConfigFrom({ BOT_CHECK_PROVIDER: 'turnstile', BOT_CHECK_SITE_KEY: 'site-key-0001' })).toBeNull();
    expect(warn.mock.calls.map((c) => String(c[0])).join(' ')).toMatch(/BOT_CHECK_PROVIDER.*BOT_CHECK_SITE_KEY.*BOT_CHECK_SECRET/s);
    warn.mockRestore();
  });
  it('each provider\'s request: its own address, the secret only in the body, the caller only when known', () => {
    const r = botCheckRequest(CFG, 'tok', '203.0.113.9');
    expect(r.url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(Object.fromEntries(new URLSearchParams(r.body))).toEqual({ secret: SECRET, response: 'tok', remoteip: '203.0.113.9' });
    expect(botCheckRequest({ ...CFG, provider: 'hcaptcha' }, 'tok', 'unknown').url).toBe('https://api.hcaptcha.com/siteverify');
    expect(new URLSearchParams(botCheckRequest(CFG, 'tok', 'unknown').body).has('remoteip')).toBe(false);
    expect(r.url).not.toContain(SECRET);
  });
  it('a person only on `success: true`; everything else — a no, an error, a timeout, an empty token — is a refusal', async () => {
    const seen: { url: string; signal?: AbortSignal }[] = [];
    const answer = (status: number, body: unknown): BotCheckFetch => async (url, init) => {
      seen.push({ url, ...(init.signal ? { signal: init.signal } : {}) });
      return { ok: status === 200, json: async () => body };
    };
    expect(await botCheckFrom(CFG, answer(200, { success: true })).verify('tok', '1.2.3.4')).toBe(true);
    expect(seen.at(-1)!.signal, 'the provider has five seconds').toBeDefined();
    expect(await botCheckFrom(CFG, answer(200, { success: false })).verify('tok', '1.2.3.4')).toBe(false);
    expect(await botCheckFrom(CFG, answer(200, { success: 'true' })).verify('tok', '1.2.3.4')).toBe(false);
    expect(await botCheckFrom(CFG, answer(500, { success: true })).verify('tok', '1.2.3.4')).toBe(false);
    expect(await botCheckFrom(CFG, async () => { throw new Error('timeout'); }).verify('tok', '1.2.3.4')).toBe(false);
    const before = seen.length;
    expect(await botCheckFrom(CFG, answer(200, { success: true })).verify('', '1.2.3.4')).toBe(false);
    expect(seen.length, 'an empty token never reaches the provider').toBe(before);
  });
});

describe('BOT · the mode in force', () => {
  it('the operator\'s switch wins; open needs a sender (else closed) and a check (else invite)', () => {
    const both = { mail: true, botCheck: true };
    expect(signupModeInForce(null, 'open', both)).toBe('open');
    expect(signupModeInForce('closed', 'open', both)).toBe('closed');
    expect(signupModeInForce('open', 'invite', both)).toBe('open');
    expect(signupModeInForce(null, 'open', { mail: true, botCheck: false })).toBe('invite');
    expect(signupModeInForce('open', 'closed', { mail: true, botCheck: false })).toBe('invite');
    expect(signupModeInForce(null, 'open', { mail: false, botCheck: true })).toBe('closed');
    expect(signupModeInForce(null, 'invite', { mail: false, botCheck: false })).toBe('invite');
  });
  it('asked on every request, and a read that fails leaves the deployment\'s mode', () => {
    const app = src('src/api/web/app.ts');
    expect(app).toContain('const set = await signupModeSet(deps.db).catch(() => null);');
    expect(app).not.toMatch(/const signupMode: SignupMode =/);
    for (const route of ["app.get('/signup'", "app.post('/signup'", "app.post('/login'", "app.post('/verify'"]) {
      const body = app.slice(app.indexOf(route), app.indexOf(route) + 400);
      expect(body, route).toContain('const signupMode = await signupModeNow();');
    }
  });
});

describe('BOT · the route', () => {
  const signup = (() => { const app = src('src/api/web/app.ts'); const at = app.indexOf("app.post('/signup'"); return app.slice(at, app.indexOf("app.post('/login'", at)); })();
  it('the check comes before the invitation, the slow hash and the code; the caller limit before all three', () => {
    const check = signup.indexOf('botCheck.verify(');
    expect(check).toBeGreaterThan(0);
    for (const later of ['inviteIsOpen(', 'hashPassword(', 'sendCode(']) expect(check, later).toBeLessThan(signup.indexOf(later));
    expect(signup.indexOf("claimSignupThrottle(deps.db, 'caller'")).toBeLessThan(check);
    expect(signup.indexOf('domainAllows(')).toBeLessThan(signup.indexOf('sendCode('));
  });
  it('a resend of a sign-up code counts against its domain too', () => {
    const app = src('src/api/web/app.ts');
    const resend = app.slice(app.indexOf("app.post('/verify/resend'"));
    expect(resend.indexOf("pending.purpose === 'signup' && !(await domainAllows(pending.email))")).toBeLessThan(resend.indexOf('reissueOtp('));
  });
  it('production composes the check from its variables and the database\'s limits', () => {
    const main = src('src/main.ts');
    expect(main).toContain('const botCheck = overrides?.botCheck ?? (() => { const c = botCheckConfigFrom(process.env); return c ? botCheckFrom(c) : null; })();');
    expect(main).toContain('signupGuard: overrides?.signupGuard === undefined ? SIGNUP_GUARD : overrides.signupGuard,');
    expect(SIGNUP_GUARD).toEqual({ attemptsPerCaller: 5, codesPerDomain: 10 });
  });
  it('the tables are not the app\'s: only the two functions', () => {
    const m = src('migrations/0114_signup_guard.sql');
    expect(m).toContain('revoke all on signup_settings from public, nomi_app;');
    expect(m).toContain('revoke all on signup_throttles from public, nomi_app;');
    expect(m).toContain('alter table signup_settings enable row level security;');
    expect(m).toContain('alter table signup_throttles enable row level security;');
  });
});

describe('BOT · the domain limit', () => {
  it('a company\'s domain is limited; a public provider\'s (one person per address) is not', () => {
    expect(limitedDomainOf('rania@Acme-Trading.example')).toBe('acme-trading.example');
    for (const a of ['someone@gmail.com', 'x@QQ.com', 'y@163.com', 'z@outlook.com', 'w@icloud.com']) expect(limitedDomainOf(a), a).toBeNull();
    expect(limitedDomainOf('no-at-sign')).toBeNull();
  });
});

describe('BOT · the page', () => {
  const widget = { ...BOT_CHECK_WIDGET.turnstile, siteKey: 'site-key-0001' };
  for (const l of LOCALES) {
    it(`${l} · the widget, its script and why it needs script — only when there is a check`, () => {
      const page = signupPage({ locale: l, path: '/signup', mode: 'open', passwordMin: 10, botCheck: widget });
      expect(page).toContain('<div class="cf-turnstile" data-sitekey="site-key-0001"></div>');
      expect(page).toContain('<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>');
      expect(page).toContain(t(l, 'signup.botcheck.noscript'));
      expect(page.indexOf('cf-turnstile')).toBeLessThan(page.indexOf('type="submit"'));
      const none = signupPage({ locale: l, path: '/signup', mode: 'open', passwordMin: 10 });
      // The door's one script (the busy button) is the product's own; no provider's script without a check.
      expect(none.replace(/<script src="\/assets\/live\.[0-9a-f]{16}\.js" defer><\/script>/, '')).not.toContain('<script');
      expect(none).not.toContain(t(l, 'signup.botcheck.noscript'));
    });
  }
});
