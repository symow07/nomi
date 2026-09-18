import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hashPassword, verifyPassword, PASSWORD_MIN, PASSWORD_MAX } from '../../src/security/password.js';
import { signupModeFrom, validateSignup, normalizeEmail } from '../../src/core/owner/signup.js';
import { makeThrottle, callerKey } from '../../src/api/web/throttle.js';
import { loginPage, signupPage } from '../../src/api/web/layout.js';
import { renderAccount } from '../../src/api/web/account.js';
import { PUBLIC_ROUTES } from '../../src/api/web/app.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * A1 — a factory signs itself up and signs in as itself.
 *
 * What is pinned here is what must stay true at the door: a password cannot be
 * read back, the page does not say which addresses have an account, a stranger
 * cannot make a tenant on an installation that has not agreed to it, and the
 * only way a tenant is made is the one definer function.
 */

const opts = (mode: 'open' | 'invite' | 'closed') => ({ mode, passwordMin: PASSWORD_MIN, passwordMax: PASSWORD_MAX });
const good = {
  factory: ' Atlas Canvas ', name: ' Mei ', email: ' Mei@Atlas.Example ', password: 'correct horse battery', invite: '',
  kind: 'manufacturer', sells: '  Custom   canvas bags ', country: 'ma', website: 'atlas.example', teamSize: '2-5',
  channels: ['whatsapp', 'carrier-pigeon', 'whatsapp', 'email'],
};
const profile = { kind: 'manufacturer', sells: 'Custom canvas bags', country: 'MA', website: 'https://atlas.example', teamSize: '2-5', channels: ['whatsapp', 'email'] };
const INVITE = '0b6c2f3a-1d4e-4f5a-8b9c-0d1e2f3a4b5c';

describe('A1 · a password is kept so that it cannot be read back', () => {
  it('the stored string says how it was made, and only its own password opens it', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(stored).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]{16,}\$[A-Za-z0-9_-]{40,}$/);
    expect(stored).not.toContain('correct');
    expect(await verifyPassword('correct horse battery', stored)).toBe(true);
    expect(await verifyPassword('correct horse batterz', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('two people with the same password do not share a stored string', async () => {
    expect(await hashPassword('same same same')).not.toBe(await hashPassword('same same same'));
  });

  it('A ROW CANNOT ASK THE PROCESS FOR A GIGABYTE, and a row that cannot be read opens nothing', async () => {
    for (const stored of [
      '', 'plain', 'sha256$abc', 'scrypt$999999999$8$1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA',
      'scrypt$32768$8$1$$', 'scrypt$32768$8$1$c2FsdA', 'scrypt$x$y$z$a$b',
    ]) expect(await verifyPassword('anything at all', stored), stored).toBe(false);
  });
});

describe('A1 · who may create a workspace', () => {
  it('AN INSTALLATION THAT HAS NOT DECIDED IS INVITE-ONLY — strangers cost it practice runs', () => {
    expect(signupModeFrom(undefined)).toBe('invite');
    expect(signupModeFrom('')).toBe('invite');
    expect(signupModeFrom('yes')).toBe('invite');
    expect(signupModeFrom(' OPEN ')).toBe('open');
    expect(signupModeFrom('closed')).toBe('closed');
  });

  it('trims what she typed, lower-cases the address, and keeps the password exactly', () => {
    const v = validateSignup(good, opts('open'));
    expect(v).toEqual({ ok: true, value: { factory: 'Atlas Canvas', name: 'Mei', email: 'mei@atlas.example', password: 'correct horse battery', invite: null, profile } });
    expect(normalizeEmail('  A@B.Co ')).toBe('a@b.co');
  });

  it('names the field that is wrong, one sentence each', () => {
    const v = validateSignup({ ...good, factory: ' ', name: '', email: 'not-an-address', password: 'short' }, opts('open'));
    expect(v).toEqual({ ok: false, problems: { factory: 'factory_missing', name: 'name_missing', email: 'email_invalid', password: 'password_short' } });
    expect(validateSignup({ ...good, password: 'x'.repeat(PASSWORD_MAX + 1) }, opts('open'))).toMatchObject({ problems: { password: 'password_long' } });
    expect(validateSignup({ ...good, password: 'MEI@atlas.example' }, opts('open'))).toMatchObject({ problems: { password: 'password_is_email' } });
  });

  it('an invitation is asked for only where invitations are the rule', () => {
    expect(validateSignup(good, opts('invite'))).toMatchObject({ ok: false, problems: { invite: 'invite_missing' } });
    expect(validateSignup({ ...good, invite: 'not-a-ticket' }, opts('invite'))).toMatchObject({ ok: false, problems: { invite: 'invite_missing' } });
    expect(validateSignup({ ...good, invite: INVITE.toUpperCase() }, opts('invite'))).toMatchObject({ ok: true, value: { invite: INVITE } });
    expect(validateSignup(good, opts('open'))).toMatchObject({ ok: true });
  });
});

describe('A1 · how often the door may be tried', () => {
  it('allows its allowance, refuses the next, and forgets after the window', () => {
    const th = makeThrottle({ max: 3, windowMs: 1000 });
    expect([th.allow('a', 0), th.allow('a', 1), th.allow('a', 2), th.allow('a', 3)]).toEqual([true, true, true, false]);
    expect(th.allow('b', 3), 'another caller is not punished').toBe(true);
    expect(th.allow('a', 1500)).toBe(true);
  });

  it('a flood of different callers cannot grow it without bound', () => {
    const th = makeThrottle({ max: 1, windowMs: 1000, maxKeys: 10 });
    for (let i = 0; i < 1000; i++) th.allow(`k${i}`, i);
    expect(th.allow('k0', 999), 'the oldest was forgotten, so it is allowed again').toBe(true);
  });

  it('THE CALLER IS THE LAST HOP, which a client cannot forge', () => {
    expect(callerKey('6.6.6.6, 203.0.113.9', '10.0.0.1')).toBe('203.0.113.9');
    expect(callerKey(['1.1.1.1', '198.51.100.7'], '10.0.0.1')).toBe('198.51.100.7');
    expect(callerKey(undefined, '10.0.0.1')).toBe('10.0.0.1');
    expect(callerKey('', undefined)).toBe('unknown');
  });
});

describe('A1 · the two pages a stranger may see', () => {
  it('the door asks for an e-mail and a password first, and keeps the access code one tap away', () => {
    const html = loginPage({ locale: 'en', path: '/login' });
    expect(html).toContain('name="email"');
    expect(html).toContain('autocomplete="current-password"');
    expect(html).toMatch(/<details>[\s\S]*name="code"[\s\S]*<\/details>/);
    expect(html).toContain('href="/signup"');
    expect(loginPage({ locale: 'en', path: '/login', signupOpen: false })).not.toContain('href="/signup"');
  });

  it('a wrong access code opens the access-code part and says so THERE', () => {
    const html = loginPage({ locale: 'en', path: '/login', error: true });
    expect(html).toMatch(/<details open>[\s\S]*role="alert"[\s\S]*name="code"/);
    expect(html.split(t('en', 'login.error')).length - 1).toBe(1);
  });

  it('a wrong password keeps the address she typed and never echoes a password', () => {
    const html = loginPage({ locale: 'en', path: '/login', problem: 'password', email: 'mei@atlas.example' });
    expect(html).toContain('value="mei@atlas.example"');
    expect(html).toContain(t('en', 'login.errorPassword'));
    expect(html).not.toMatch(/name="password"[^>]*value=/);
  });

  it('SIGN-UP NEVER ECHOES THE PASSWORD, and escapes what it does echo', () => {
    const html = signupPage({
      locale: 'en', path: '/signup', mode: 'open', passwordMin: PASSWORD_MIN,
      values: { factory: '<b>Atlas</b>', name: 'Mei', email: 'mei@atlas.example' },
      problems: { password: 'Use at least 10 characters.' },
    });
    expect(html).toContain('&lt;b&gt;Atlas&lt;/b&gt;');
    expect(html).not.toContain('<b>Atlas</b>');
    expect(html).not.toMatch(/name="password"[^>]*value=/);
    expect(html).not.toContain('name="invite"');
    expect(html).toContain('autocomplete="new-password"');
  });

  it('asks for the invitation only in invite mode, prefilled from her link', () => {
    const html = signupPage({ locale: 'zh', path: '/signup', mode: 'invite', passwordMin: PASSWORD_MIN, values: { invite: INVITE } });
    expect(html).toContain(`name="invite" value="${INVITE}"`);
  });

  it('CLOSED MEANS NO FORM AT ALL, in every language, and says who to write to when there is someone', () => {
    for (const locale of ['en', 'zh', 'ar'] as const) {
      const html = signupPage({ locale, path: '/signup', mode: 'closed', passwordMin: PASSWORD_MIN, contact: 'hello@nomi.example' });
      expect(html).not.toContain('<form');
      expect(html).toContain(t(locale, 'signup.closed'));
      expect(html).toContain('hello@nomi.example');
      expect(html).toContain(`dir="${locale === 'ar' ? 'rtl' : 'ltr'}"`);
    }
  });

  it('both are public by decision, with a reason a stranger could read', () => {
    const signup = PUBLIC_ROUTES.filter((r) => r.url === '/signup').map((r) => r.method).sort();
    expect(signup).toEqual(['GET', 'POST']);
    for (const r of PUBLIC_ROUTES.filter((x) => x.url === '/signup')) expect(r.why.length).toBeGreaterThan(30);
  });
});

describe('A1 · "how do I sign in?"', () => {
  it('shows HER address and changes the password only against the one she has now', () => {
    const html = renderAccount({ email: 'mei@atlas.example', passwordMin: PASSWORD_MIN }, 'en', null, 'Settings');
    expect(html).toContain('mei@atlas.example');
    expect(html).toMatch(/name="current"[^>]*autocomplete="current-password"/);
    expect(html).toMatch(/name="next"[^>]*autocomplete="new-password"/);
  });

  it('someone who came in with an access code is told there is nothing to change, not given a form that cannot work', () => {
    const html = renderAccount({ email: null, passwordMin: PASSWORD_MIN }, 'en', null, 'Settings');
    expect(html).not.toContain('<form');
    expect(html).toContain(t('en', 'account.codeOnly'));
  });
});

describe('A1 · the tenant is made in ONE place', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const migration = readFileSync(`${root}migrations/0055_accounts.sql`, 'utf8');

  it('THE APPLICATION ROLE CANNOT TOUCH INVITATIONS — it may only ask yes or no, and spend one while creating', () => {
    expect(migration).toMatch(/revoke all on signup_invites from nomi_app/);
    expect(migration).not.toMatch(/grant[^;]*on signup_invites/i);
  });

  it('every question asked before a tenant is known is a definer function closed to the public', () => {
    for (const fn of ['login_lookup', 'login_record', 'person_for_code', 'invite_is_open', 'provision_account', 'live_business_ids']) {
      expect(migration, fn).toMatch(new RegExp(`create or replace function ${fn}\\(`));
      expect(migration, fn).toMatch(new RegExp(`revoke all on function ${fn}\\([^)]*\\) from public`));
      expect(migration, fn).toMatch(new RegExp(`grant execute on function ${fn}\\([^)]*\\) to nomi_app`));
    }
    expect(migration.match(/security definer set search_path = public/g)?.length).toBe(6);
  });

  it('no route inserts a business by itself', () => {
    const app = readFileSync(`${root}src/api/web/app.ts`, 'utf8');
    expect(app).not.toMatch(/insert into businesses/i);
    expect(app).toContain('provisionAccount(');
  });
});
