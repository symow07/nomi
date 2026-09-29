import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loginPage, forgotPasswordPage } from '../../src/api/web/layout.js';
import { PUBLIC_ROUTES } from '../../src/api/web/app.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { isEmailShape } from '../../src/core/owner/signup.js';

/**
 * PWR (0084) — "e-mail me a link": the door's parts no database is needed
 * for. The flow itself — a link mailed, a password chosen with it, the same
 * words for an address with no login, three an hour — is
 * tests/integration/password-recovery.test.ts.
 */

const MIGRATION = readFileSync(fileURLToPath(new URL('../../migrations/0084_login_recovery.sql', import.meta.url)), 'utf8');

describe('PWR · the door', () => {
  it('offers the link only where the installation sends mail', () => {
    for (const l of LOCALES) {
      expect(loginPage({ locale: l, path: '/login', recoveryOn: true }), l).toContain(`<a href="/login/forgot">${t(l, 'login.forgot')}</a>`);
      expect(loginPage({ locale: l, path: '/login' }), l).not.toContain('/login/forgot');
    }
  });

  it('asks for the address, says how long the link works, and says the same thing once asked', () => {
    for (const l of LOCALES) {
      const page = forgotPasswordPage({ locale: l, path: '/login/forgot', minutes: 60 });
      expect(page, l).toContain('<form method="post" action="/login/forgot">');
      expect(page, l).toContain(t(l, 'forgot.lead', { minutes: 60 }));
      const sent = forgotPasswordPage({ locale: l, path: '/login/forgot', minutes: 60, sent: 'sara@example.com' });
      expect(sent, l).toContain(t(l, 'forgot.sent', { email: 'sara@example.com', minutes: 60 }));
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
