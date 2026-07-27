import { describe, it, expect } from 'vitest';
import { makeSessionCodec, codeMatches, parseCookies, SESSION_TTL_MS } from '../../src/api/web/session.js';
import { shell, loginPage, NAV } from '../../src/api/web/layout.js';

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

/* ── Shell layout: owner language, nav, escaping ─────────────────────────── */
describe('M9 · command-center shell', () => {
  it('renders the shell with nav and the active item highlighted', () => {
    const html = shell({ title: 'x', active: 'inbox', employeeName: '小雅', avatar: '👩‍💼', bodyHtml: '<p>hi</p>' });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('小雅 的工作台');
    for (const n of NAV) expect(html).toContain(n.label);   // all sections present
    expect(html).toContain('class="active"');
    expect(html).toContain('<p>hi</p>');
    expect(html).toContain('/logout');
  });

  it('nav uses owner language — no technical or AI vocabulary', () => {
    const labels = NAV.map((n) => n.label).join(' ');
    for (const banned of ['AI', 'model', 'LLM', 'token', 'dashboard', 'API', '模型', '人工智能']) {
      expect(labels).not.toContain(banned);
    }
  });

  it('login page has a password form and no data leakage', () => {
    const html = loginPage({ error: '密码不对' });
    expect(html).toContain('name="code"');
    expect(html).toContain('method="post"');
    expect(html).toContain('密码不对');
  });

  it('escapes employee name to prevent injection', () => {
    const html = shell({ title: 't', active: 'home', employeeName: '<img src=x>', avatar: '👩‍💼', bodyHtml: '' });
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('&lt;img src=x&gt;');
  });
});
