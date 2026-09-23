import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { makeSessionCodec, codeMatches, parseCookies, SESSION_TTL_MS } from '../../src/api/web/session.js';
import { shell, loginPage, NAV } from '../../src/api/web/layout.js';
import { registerWebApp } from '../../src/api/web/app.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { withAssistantName, assistantName } from '../../src/api/web/say.js';

/**
 * M17.3 — the session cookie CONTRACT as it is actually emitted. The codec is
 * unit-tested below; what was never checked is the header the browser receives,
 * and specifically that `Secure` is set when the app runs in production. These
 * routes (login/logout/locale) touch no database, so a stub `db` is enough.
 */
const appWith = (secureCookie: boolean) => {
  const app = Fastify({ logger: false });
  registerWebApp(app, {
    db: {} as never,
    sessionSecret: 'x'.repeat(64),
    accessCode: 'let-me-in',
    businessId: 'de300000-0000-4000-8000-0000000000b1',
    employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled',
    secureCookie,
    kickOutbound: async () => {},
    resolveDns: async () => ({ spf: [], dkim: [], dmarc: [] }),
  });
  return app;
};
const login = (app: ReturnType<typeof appWith>, code = 'let-me-in') =>
  app.inject({ method: 'POST', url: '/login', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: `code=${code}` });

describe('M17.3 · production session cookie contract', () => {
  it('production: the session cookie is HttpOnly, Secure, SameSite=Lax, Path=/, and expiring', async () => {
    const app = appWith(true);
    const res = await login(app);
    const c = String(res.headers['set-cookie']);
    expect(res.statusCode).toBe(302);
    expect(c).toContain('yf_session=');
    expect(c).toContain('HttpOnly');                       // not readable from JS
    expect(c).toContain('Secure');                         // never sent over plain http
    expect(c).toContain('SameSite=Lax');                   // blocks cross-site POST (CSRF)
    expect(c).toContain('Path=/');
    expect(c).toContain(`Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
    await app.close();
  });

  it('non-production drops ONLY Secure — every other protection stays on', async () => {
    const app = appWith(false);
    const c = String((await login(app)).headers['set-cookie']);
    expect(c).not.toContain('Secure');                     // so local http login works
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Lax');
    await app.close();
  });

  it('the cookie carries a signed token, never the access code or business data in clear', async () => {
    const app = appWith(true);
    const c = String((await login(app)).headers['set-cookie']);
    const token = c.split(';')[0]!.split('=').slice(1).join('=');
    expect(token).not.toContain('let-me-in');
    expect(token.split('.')).toHaveLength(2);               // payload.signature
    // the payload is signed: flipping one character invalidates it
    const codec = makeSessionCodec('x'.repeat(64));
    expect(codec.verify(token, Date.now())).not.toBeNull();
    // Flip the LAST character to one it is not: ~7% of tokens already end in
    // 'A', and appending 'A' to the truncated token would rebuild the original
    // byte-for-byte — a tamper test that silently tested nothing.
    const flipped = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    expect(flipped).not.toBe(token);
    expect(codec.verify(flipped, Date.now())).toBeNull();
    await app.close();
  });

  it('a wrong access code sets NO cookie at all', async () => {
    const app = appWith(true);
    const res = await login(app, 'wrong');
    expect(res.statusCode).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
    await app.close();
  });

  it('logout expires the cookie immediately (Max-Age=0) and keeps the flags', async () => {
    const app = appWith(true);
    const res = await app.inject({ method: 'GET', url: '/logout' });
    const c = String(res.headers['set-cookie']);
    expect(c).toContain('Max-Age=0');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('Secure');
    await app.close();
  });

  it('the language cookie is also Secure in production (and is not HttpOnly by design)', async () => {
    const app = appWith(true);
    const res = await app.inject({ method: 'GET', url: '/locale?set=zh&next=/login' });
    const c = String(res.headers['set-cookie']);
    expect(c).toContain('yf_locale=zh');
    expect(c).toContain('Secure');
    expect(c).toContain('SameSite=Lax');
    await app.close();
  });
});

/* ── Session codec: signed, expiring, tamper-proof ───────────────────────── */
describe('M9 · owner session codec', () => {
  const codec = makeSessionCodec('a'.repeat(64));
  const now = 1_000_000;

  it('round-trips a valid session', () => {
    const token = codec.sign({ businessId: 'biz-1', exp: now + SESSION_TTL_MS });
    expect(codec.verify(token, now)).toEqual({ businessId: 'biz-1', exp: now + SESSION_TTL_MS });
  });

  it('rejects a tampered payload or signature', () => {
    const token = codec.sign({ businessId: 'biz-1', exp: now + SESSION_TTL_MS });
    const [p, s] = token.split('.');
    expect(codec.verify(`${p}x.${s}`, now)).toBeNull();     // payload tampered
    expect(codec.verify(`${p}.${s}x`, now)).toBeNull();     // signature tampered
    expect(codec.verify('garbage', now)).toBeNull();
    expect(codec.verify(undefined, now)).toBeNull();
  });

  it('rejects an expired session and a foreign-key signature', () => {
    const expired = codec.sign({ businessId: 'biz-1', exp: now - 1 });
    expect(codec.verify(expired, now)).toBeNull();
    const other = makeSessionCodec('b'.repeat(64));
    const token = other.sign({ businessId: 'biz-1', exp: now + SESSION_TTL_MS });
    expect(codec.verify(token, now)).toBeNull();            // signed with a different secret
  });

  it('access code compare is length-safe and constant-time-ish', () => {
    expect(codeMatches('hunter2', 'hunter2')).toBe(true);
    expect(codeMatches('hunter2', 'hunter3')).toBe(false);
    expect(codeMatches('short', 'longer-code')).toBe(false);
    expect(codeMatches('', '')).toBe(false);                // empty never matches
  });

  it('parses cookie headers', () => {
    expect(parseCookies('yf_session=abc; other=1')).toEqual({ yf_session: 'abc', other: '1' });
    expect(parseCookies(undefined)).toEqual({});
  });
});

/* ── Shell layout: localized nav, RTL, switcher, escaping ─────────────────── */
describe('M9 + ADR-0008 · command-center shell', () => {
  it('en shell: localized nav, active highlight, switcher, ltr, the assistant\'s workspace', () => {
    const html = shell({ title: 'x', active: 'inbox', locale: 'en', path: '/app/inbox', avatar: '👩‍💼', bodyHtml: '<p>hi</p>' });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(html).toContain(t('en', 'app.tagline'));      // no name chosen: "Your assistant's workspace"
    const named = withAssistantName('Lily', () =>
      shell({ title: 'x', active: 'inbox', locale: 'en', path: '/app/inbox', avatar: '👩‍💼', bodyHtml: '' }));
    expect(named).toContain("Lily's workspace");
    for (const n of NAV) expect(html).toContain(t('en', `nav.${n.id}` as MessageKey));
    expect(html).toContain('class="navlink active"');   // inbox highlighted
    expect(html).toContain('<p>hi</p>');
    expect(html).toContain('/logout');
    expect(html).toContain('class="langsw"');            // switcher present
    expect(html).toContain('href="/locale?set=zh');       // switch links exist
    expect(html).toContain('Nomi');                       // Phase A: customer-facing brand
  });

  it('zh shell: Chinese nav + tagline; ar shell: RTL', () => {
    const zh = shell({ title: 'x', active: 'home', locale: 'zh', path: '/app', avatar: '👩‍💼', bodyHtml: '' });
    expect(zh).toContain('<html lang="zh" dir="ltr">');
    expect(zh).toContain(t('zh', 'app.tagline'));
    expect(zh).toContain('今天'); expect(zh).toContain('买家');   // M16.4c: nav matches the page it opens

    const ar = shell({ title: 'x', active: 'home', locale: 'ar', path: '/app', avatar: '👩‍💼', bodyHtml: '' });
    expect(ar).toContain('<html lang="ar" dir="rtl">');   // RTL
    expect(ar).toContain(t('ar', 'app.tagline'));
    expect(ar).toContain('اليوم');                        // Phase A: "today"
  });

  it('nav uses owner language — no technical/AI vocabulary in any locale', () => {
    for (const l of LOCALES) {
      const labels = NAV.map((n) => t(l, `nav.${n.id}` as MessageKey)).join(' ').toLowerCase();
      for (const banned of ['ai', 'model', 'llm', 'token', 'dashboard', 'api', '模型', '人工智能']) {
        const hit = /^[a-z ]+$/.test(banned) ? new RegExp(`\\b${banned}\\b`).test(labels) : labels.includes(banned);
        expect(hit, `${l}:${banned}`).toBe(false);
      }
    }
  });

  it('login page: localized form + error, switcher, RTL for ar', () => {
    const en = loginPage({ locale: 'en', path: '/login', error: true });
    expect(en).toContain('name="code"'); expect(en).toContain('method="post"');
    expect(en).toContain('Wrong code, please try again.');
    expect(en).toContain('Access code'); expect(en).toContain('class="langsw"');

    const zh = loginPage({ locale: 'zh', path: '/login', error: true });
    expect(zh).toContain('密码不对，再试一次。');

    const ar = loginPage({ locale: 'ar', path: '/login' });
    expect(ar).toContain('<html lang="ar" dir="rtl">');
    expect(ar).not.toContain('Wrong code');   // no error when not set
  });

  it('escapes body html boundary but the assistant name is escaped, not injectable', () => {
    const html = shell({ title: 't', active: 'home', locale: 'en', path: '/app', avatar: '👩‍💼', bodyHtml: '<p>ok</p>' });
    expect(html).toContain('<p>ok</p>');       // body inserted as authored (caller escapes)
    expect(html).toContain(assistantName('en'));   // no name chosen: the fallback label
    const hostile = withAssistantName('<img src=x>', () =>
      shell({ title: 't', active: 'home', locale: 'en', path: '/app', avatar: '👩‍💼', bodyHtml: '' }));
    expect(hostile).not.toContain('<img src=x>');  // a chosen name is data, never markup
    expect(hostile).toContain('&lt;img src=x&gt;');
  });
});
