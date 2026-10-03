import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loginPage, forgotPasswordPage, setPasswordPage } from '../../src/api/web/layout.js';
import { PUBLIC_ROUTES } from '../../src/api/web/app.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { isEmailShape } from '../../src/core/owner/signup.js';
import { withoutIsolates, unisolatedFigures } from './isolates.js';

/**
 * PWR (0084) — "e-mail me a link": the door's parts no database is needed
 * for. The flow itself — a link mailed, a password chosen with it, the same
 * words for an address with no login, three an hour — is
 * tests/integration/password-recovery.test.ts.
 */

const MIGRATION = readFileSync(fileURLToPath(new URL('../../migrations/0084_login_recovery.sql', import.meta.url)), 'utf8');
const PROVEN = readFileSync(fileURLToPath(new URL('../../migrations/0129_login_email_proven.sql', import.meta.url)), 'utf8');
const APP = readFileSync(fileURLToPath(new URL('../../src/api/web/app.ts', import.meta.url)), 'utf8');
/** The body of one route in app.ts, from its registration to the next one. */
const routeBody = (method: 'get' | 'post', url: string): string => {
  const at = APP.indexOf(`app.${method}('${url}'`);
  if (at === -1) throw new Error(`no ${method} ${url}`);
  const next = APP.slice(at + 10).search(/\n  app\.(get|post)\(/);
  return APP.slice(at, next === -1 ? undefined : at + 10 + next);
};

describe('PWR · the door', () => {
  it('offers the link only where the installation sends mail', () => {
    for (const l of LOCALES) {
      expect(loginPage({ locale: l, path: '/login', recoveryOn: true }), l).toContain(`<a href="/login/forgot">${t(l, 'login.forgot')}</a>`);
      expect(loginPage({ locale: l, path: '/login' }), l).not.toContain('/login/forgot');
    }
  });

  it('asks for the address, says how long the link works, and says the same thing once asked', () => {
    for (const l of LOCALES) {
      const page = withoutIsolates(forgotPasswordPage({ locale: l, path: '/login/forgot', minutes: 60 }));
      expect(page, l).toContain('<form method="post" action="/login/forgot">');
      expect(page, l).toContain(t(l, 'forgot.lead', { minutes: 60 }));
      const sent = withoutIsolates(forgotPasswordPage({ locale: l, path: '/login/forgot', minutes: 60, sent: 'sara@example.com' }));
      // PWR2 — the address in its own isolate, inside the sentence.
      expect(sent, l).toContain(t(l, 'forgot.sent', { email: '<bdi>sara@example.com</bdi>', minutes: 60 }));
      expect(sent, l).not.toContain('<form');
    }
    // the words themselves never say whether the address has a login
    expect(t('en', 'forgot.sent', { email: 'x@y.com', minutes: 60 })).toMatch(/^If x@y\.com signs in/);
  });

  it('a refusal is said as one', () => {
    const bad = forgotPasswordPage({ locale: 'en', path: '/login/forgot', minutes: 60, problem: 'email', email: 'nope' });
    expect(bad).toContain(`<div class="err" role="alert">${t('en', 'signup.problem.email_invalid')}</div>`);
    expect(bad).toContain('value="nope"');
    expect(forgotPasswordPage({ locale: 'en', path: '/login/forgot', minutes: 60, problem: 'slow' })).toContain(t('en', 'login.slow'));
  });

  it('the mail carries the link, how long it works, and what to do if it was not you — in each language', () => {
    for (const l of LOCALES) {
      const body = t(l, 'forgot.mail.body', { email: 'sara@example.com', link: 'https://app.nomidoes.com/login/set-password?t=abc', minutes: 60 });
      expect(body, l).toContain('https://app.nomidoes.com/login/set-password?t=abc');
      expect(body, l).toContain('sara@example.com');
      expect(body, l).toContain('60');
    }
  });

  it('PWR2 — the page reads the same for any address: no markup says whether it signs in here', () => {
    for (const l of LOCALES) {
      const a = forgotPasswordPage({ locale: l, path: '/login/forgot', minutes: 60, sent: 'owner@shop.example' });
      const b = forgotPasswordPage({ locale: l, path: '/login/forgot', minutes: 60, sent: 'nobody@else.example' });
      expect(a.replaceAll('owner@shop.example', '@'), l).toBe(b.replaceAll('nobody@else.example', '@'));
    }
    // …and the route that answers decides nothing before it answers: every
    // `await` in POST /login/forgot is inside the work left to run after the
    // reply (the one `void (async () => …)()`), so neither the words nor the
    // time can depend on the address.
    const body = routeBody('post', '/login/forgot');
    const before = body.slice(0, body.indexOf('void (async () => {'));
    const tail = body.slice(body.indexOf('})();'));
    const after = tail.slice(0, tail.indexOf('\n  });'));
    expect(body).toContain('void (async () => {');
    expect(before).not.toMatch(/\bawait\b/);
    expect(after).not.toMatch(/\bawait\b/);
    expect(after).toMatch(/^\}\)\(\);\s*return html\(reply, 200, forgot\(req, \{ sent: email \}\)\);/);
  });

  it('PWR2 — an access code is not mailed: the form, the answer and the page without mail say who gives a new one', () => {
    for (const l of LOCALES) {
      const line = `<p class="caption muted">${t(l, 'forgot.codes')}</p>`;
      expect(forgotPasswordPage({ locale: l, path: '/login/forgot', minutes: 60 }), l).toContain(line);
      expect(forgotPasswordPage({ locale: l, path: '/login/forgot', minutes: 60, sent: 'x@y.com' }), l).toContain(line);
      expect(forgotPasswordPage({ locale: l, path: '/login/forgot', minutes: 60, mailOff: true }), l).toContain(line);
    }
  });

  it('PWR2 — without system mail the page asks for nothing and says who sets a new password', () => {
    for (const l of LOCALES) {
      const off = forgotPasswordPage({ locale: l, path: '/login/forgot', minutes: 60, mailOff: true, contact: 'hello@nomi.example' });
      expect(off, l).not.toContain('<form');
      expect(off, l).toContain('<a href="mailto:hello@nomi.example"><bdi>hello@nomi.example</bdi></a>');
      const [head] = t(l, 'forgot.off.write', { email: '\u0000' }).split('\u0000');
      expect(off, l).toContain(head!.replaceAll('’', '’'));
      const bare = forgotPasswordPage({ locale: l, path: '/login/forgot', minutes: 60, mailOff: true });
      expect(bare, l).toContain(t(l, 'forgot.off.ask'));
      expect(bare, l).not.toContain('mailto:');
    }
  });

  it('PWR2 — right to left: every figure and the address isolated on the Arabic pages', () => {
    const pages = [
      forgotPasswordPage({ locale: 'ar', path: '/login/forgot', minutes: 60 }),
      forgotPasswordPage({ locale: 'ar', path: '/login/forgot', minutes: 60, sent: 'sara2@example.com' }),
      forgotPasswordPage({ locale: 'ar', path: '/login/forgot', minutes: 60, mailOff: true, contact: 'team1@nomi.example' }),
      setPasswordPage({ locale: 'ar', path: '/login/set-password', passwordMin: 10, passwordMax: 200, link: { token: 'T'.repeat(43), email: 'o9@shop.example' } }),
    ];
    for (const p of pages) {
      expect(p).toContain('dir="rtl"');
      expect(unisolatedFigures(p)).toEqual([]);
    }
    expect(pages[1]).toContain('<bdi>sara2@example.com</bdi>');
    expect(pages[3]).toContain('<bdi>o9@shop.example</bdi>');
    // the sentence itself is not wrapped whole — its direction is the page's
    expect(pages[1]).not.toMatch(/<p class="lead" role="status"><bdi>/);
  });

  it('PWR2 — both mails in five languages: subject, the address, the link alone on its line, what to do if it was not you', () => {
    const link = 'https://app.nomidoes.com/login/set-password?t=abc&l=xx';
    const subjects = new Set<string>();
    for (const l of LOCALES) {
      subjects.add(t(l, 'forgot.mail.subject'));
      const body = t(l, 'forgot.mail.body', { email: 'sara@example.com', link, minutes: 60 });
      expect(body.split('\n'), l).toContain(link);
      const done = t(l, 'setpw.changed.mail.body', { email: 'sara@example.com', forgot: 'https://app.nomidoes.com/login/forgot' });
      expect(done, l).toContain('sara@example.com');
      expect(done.split('\n'), l).toContain('https://app.nomidoes.com/login/forgot');
      expect(t(l, 'setpw.changed.mail.contact', { contact: 'team@nomi.example' }), l).toMatch(/^\n\n.*team@nomi\.example$/s);
      expect(t(l, 'setpw.changed.mail.subject').length, l).toBeGreaterThan(5);
    }
    expect(subjects.size, 'each language its own subject').toBe(LOCALES.length);
    // The route isolates the address inside the Arabic mail and names the language in the link.
    const post = routeBody('post', '/login/forgot');
    expect(post).toContain("text: mailT(locale, 'forgot.mail.body', { email: show.isolate(locale, to), link, minutes: RECOVERY_MINUTES })");
    expect(post).toContain("subject: mailT(locale, 'forgot.mail.subject')");
    expect(post).toContain('/login/set-password?t=${token}&l=${locale}');
  });

  it('PWR2 — a failed mail is written down for the operator; a cap that held it is not a failure', () => {
    const post = routeBody('post', '/login/forgot');
    expect(post).toContain("if (!refusedByCap(mailed)) reportDoorMail('recovery', mailed.error);");
    expect(APP).toContain("e.name = 'DoorMailFailed';");
    // the address never reaches app_errors
    expect(APP).toMatch(/const reason = error\.replace\(\/\[\^\\s@<>"'\]\+@\[\^\\s@<>"'\]\+\/g, '<address>'\)/);
  });

  it('PWR2 — the link needs the installation\'s own address: never one built from the request', () => {
    expect(APP).toContain('const recoveryOn = Boolean(codeMail) && Boolean(deps.publicBaseUrl);');
    expect(routeBody('post', '/login/forgot')).not.toMatch(/req\.(hostname|host|headers\.host)/);
  });

  it('both routes are listed as public, with their reasons', () => {
    for (const method of ['GET', 'POST'] as const) {
      expect(PUBLIC_ROUTES.find((r) => r.method === method && r.url === '/login/forgot')?.why, method).toMatch(/PWR/);
    }
  });

  it('the address check is sign-up\'s own', () => {
    expect(isEmailShape('sara@example.com')).toBe(true);
    expect(isEmailShape('not-an-address')).toBe(false);
    expect(isEmailShape('a@b.c')).toBe(false);
  });
});

describe('PWR2 · a link only to an address that answered (0129)', () => {
  it('the request asks for a proven address; spending a link proves it; the app may only set it', () => {
    expect(PROVEN).toContain('alter table logins add column if not exists email_verified_at timestamptz;');
    expect(PROVEN).toContain('and l.archived_at is null and l.email_verified_at is not null');
    expect(PROVEN).toContain('email_verified_at = coalesce(email_verified_at, now())');
    expect(PROVEN).toContain('grant execute on function login_email_proven(uuid) to nomi_app;');
    expect(PROVEN).toMatch(/update logins set email_verified_at = now\(\)\s+where id = p_login and archived_at is null and email_verified_at is null/);
    // what the database already knew: a code typed back, a link that set the password, an operator's link
    expect(PROVEN).toContain('from login_codes c where c.email = l.email and c.consumed_at is not null');
    expect(PROVEN).toContain("s.made_by <> 'recovery'");
    // the rest of 0084's rules stand
    expect(PROVEN).toContain(">= 3 then");
    expect(PROVEN).toContain('join businesses b on b.id = l.business_id and b.is_active');
  });

  it('a code typed back on /verify proves the address — on sign-up and on a new browser', () => {
    const verify = routeBody('post', '/verify');
    expect(verify.match(/await markLoginEmailProven\(deps\.db, login\.loginId\)/g)).toHaveLength(2);
  });

  it('saving a new password ends every other session at once, and says so to the address', () => {
    const save = routeBody('post', '/login/set-password');
    expect(save).toContain('liveness.evict(livenessKey(who.businessId, who.person.id));');
    expect(save).toContain("subject: mailT(locale, 'setpw.changed.mail.subject')");
    expect(save).toContain('keepSetLink(reply, null);');
  });
});

describe('PWR · the database keeps the rules (0084)', () => {
  it('three an hour per login, the newest link works, a digest only, the app role may only ask', () => {
    expect(MIGRATION).toContain(">= 3 then");
    expect(MIGRATION).toContain("interval '1 hour'");
    expect(MIGRATION).toContain('update login_setups set used_at = now() where login_id = v_login and used_at is null;');
    expect(MIGRATION).toContain("p_token_hash !~ '^[0-9a-f]{64}$'");
    expect(MIGRATION).toContain('security definer');
    expect(MIGRATION).toContain('grant execute on function login_setup_request(text, text, integer) to nomi_app;');
    expect(MIGRATION).toContain('join businesses b on b.id = l.business_id and b.is_active');
  });
});
