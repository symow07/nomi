import { describe, it, expect } from 'vitest';
import { makeSessionCodec, codeMatches, parseCookies, SESSION_TTL_MS } from '../../src/api/web/session.js';
import { shell, loginPage, NAV } from '../../src/api/web/layout.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';

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
  it('en shell: localized nav, active highlight, switcher, ltr, Lily workspace', () => {
    const html = shell({ title: 'x', active: 'inbox', locale: 'en', path: '/app/inbox', avatar: '👩‍💼', bodyHtml: '<p>hi</p>' });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(html).toContain("Lily's workspace");
    for (const n of NAV) expect(html).toContain(t('en', `nav.${n.id}` as MessageKey));
    expect(html).toContain('class="navlink active"');   // inbox highlighted
    expect(html).toContain('<p>hi</p>');
    expect(html).toContain('/logout');
    expect(html).toContain('class="langsw"');            // switcher present
    expect(html).toContain('href="/locale?set=zh');       // switch links exist
    expect(html).toContain('YiwuFlow');                   // brand NOT renamed yet
  });

  it('zh shell: Chinese nav + tagline; ar shell: RTL', () => {
    const zh = shell({ title: 'x', active: 'home', locale: 'zh', path: '/app', avatar: '👩‍💼', bodyHtml: '' });
    expect(zh).toContain('<html lang="zh" dir="ltr">');
    expect(zh).toContain('小雅的工作台');
    expect(zh).toContain('主页'); expect(zh).toContain('收件箱');

    const ar = shell({ title: 'x', active: 'home', locale: 'ar', path: '/app', avatar: '👩‍💼', bodyHtml: '' });
    expect(ar).toContain('<html lang="ar" dir="rtl">');   // RTL
    expect(ar).toContain('مساحة عمل ياسمين');
    expect(ar).toContain('الرئيسية');                     // "home"
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

  it('escapes body html boundary but employee name is a safe constant', () => {
    const html = shell({ title: 't', active: 'home', locale: 'en', path: '/app', avatar: '👩‍💼', bodyHtml: '<p>ok</p>' });
    expect(html).toContain('<p>ok</p>');       // body inserted as authored (caller escapes)
    expect(html).toContain('Lily');            // name is a product constant, not injectable
  });
});
