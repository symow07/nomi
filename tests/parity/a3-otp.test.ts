import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  newOtpCode, otpHash, mintPendingOtp, readPendingOtp, mintKnownDevice, isKnownDevice, maskEmail,
  PENDING_TTL_MS, DEVICE_TTL_MS, OTP_TTL_SECONDS,
} from '../../src/security/otp.js';
import { systemSmtpConfigFrom, systemMailer } from '../../src/channels/email/systemMail.js';
import { verifyPage } from '../../src/api/web/layout.js';
import { PUBLIC_ROUTES } from '../../src/api/web/app.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * A3 — a six-digit code by e-mail, when an account is made and when a browser
 * we have not seen signs in. What is pinned: the code cannot be read back, a
 * token minted for one purpose is never good for another, and WITHOUT A SENDER
 * NOTHING ASKS FOR A CODE — a product that demands a code it cannot send locks
 * everyone out.
 */

const SECRET = 's'.repeat(40);
const root = fileURLToPath(new URL('../../', import.meta.url));

describe('A3 · the six digits', () => {
  it('always six, including the ones that start with zero', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) { const c = newOtpCode(); expect(c).toMatch(/^\d{6}$/); seen.add(c); }
    expect(seen.size).toBeGreaterThan(380);
    expect(OTP_TTL_SECONDS).toBe(600);
  });

  it('WHAT IS STORED IS BOUND TO THE ADDRESS AND THE PURPOSE — a code is good for one thing only', () => {
    const h = otpHash(SECRET, 'mei@atlas.example', 'signup', '012345');
    expect(h).not.toContain('012345');
    expect(otpHash(SECRET, ' MEI@Atlas.Example ', 'signup', '012 345'), 'as she might type it').toBe(h);
    expect(otpHash(SECRET, 'mei@atlas.example', 'device', '012345')).not.toBe(h);
    expect(otpHash(SECRET, 'omar@bolt.example', 'signup', '012345')).not.toBe(h);
    expect(otpHash('another-installation-secret-000000000000', 'mei@atlas.example', 'signup', '012345')).not.toBe(h);
  });
});

describe('A3 · the two cookies', () => {
  const NOW = 1_800_000_000_000;
  const pending = { id: '0b6c2f3a-1d4e-4f5a-8b9c-0d1e2f3a4b5c', email: 'mei@atlas.example', purpose: 'signup' as const };

  it('the waiting cookie says WHICH code, never the code, and lasts as long as a new one may be asked for', () => {
    const token = mintPendingOtp(SECRET, pending, NOW);
    expect(readPendingOtp(SECRET, token, NOW)).toEqual(pending);
    expect(readPendingOtp(SECRET, token, NOW + PENDING_TTL_MS + 1)).toBeNull();
    expect(readPendingOtp('x'.repeat(40), token, NOW), 'another installation\'s').toBeNull();
    expect(readPendingOtp(SECRET, `${token}x`, NOW)).toBeNull();
    expect(readPendingOtp(SECRET, undefined, NOW)).toBeNull();
  });

  it('A TOKEN MINTED FOR ONE PURPOSE IS NEVER GOOD FOR ANOTHER', () => {
    const device = mintKnownDevice(SECRET, 'login-1', NOW);
    expect(readPendingOtp(SECRET, device, NOW)).toBeNull();
    expect(isKnownDevice(SECRET, mintPendingOtp(SECRET, pending, NOW), pending.id, NOW)).toBe(false);
  });

  it('"a browser we have seen" is for ONE login, for 180 days', () => {
    const token = mintKnownDevice(SECRET, 'login-1', NOW);
    expect(isKnownDevice(SECRET, token, 'login-1', NOW)).toBe(true);
    expect(isKnownDevice(SECRET, token, 'login-2', NOW), 'someone else signing in on her laptop is still asked').toBe(false);
    expect(isKnownDevice(SECRET, token, 'login-1', NOW + DEVICE_TTL_MS + 1)).toBe(false);
    expect(isKnownDevice(SECRET, undefined, 'login-1', NOW)).toBe(false);
  });

  it('the address is shown so she recognises it, not so a bystander can read it', () => {
    expect(maskEmail('mei@atlas.example')).toBe('m••@atlas.example');
    expect(maskEmail('alexandra.long@atlas.example')).toBe('a••••••@atlas.example');
    expect(maskEmail('nonsense')).toBe('nonsense');
  });
});

describe('A3 · the installation\'s own sender', () => {
  it('ALL FIVE OR NONE — a half-set sender is no sender', () => {
    expect(systemSmtpConfigFrom({})).toBeNull();
    const full = { SYSTEM_SMTP_HOST: 'smtp.gmail.com', SYSTEM_SMTP_PORT: '465', SYSTEM_SMTP_USER: 'no-reply@nomi.example', SYSTEM_SMTP_PASSWORD: 'app-password', SYSTEM_SMTP_FROM: 'No-Reply@Nomi.Example' };
    expect(systemSmtpConfigFrom(full)).toEqual({ host: 'smtp.gmail.com', port: 465, user: 'no-reply@nomi.example', password: 'app-password', from: 'no-reply@nomi.example' });
    for (const missing of Object.keys(full)) {
      if (missing === 'SYSTEM_SMTP_PORT') continue; // has a default
      expect(systemSmtpConfigFrom({ ...full, [missing]: '' }), missing).toBeNull();
    }
    expect(systemSmtpConfigFrom({ ...full, SYSTEM_SMTP_FROM: 'not-an-address' })).toBeNull();
  });

  it('never reads a business\'s outreach settings, and carries none of a business\'s headers', () => {
    const src = readFileSync(`${root}src/channels/email/systemMail.ts`, 'utf8');
    expect(src).not.toMatch(/env\['SMTP_/);
    expect(src).not.toMatch(/List-Unsubscribe/);
    expect(src).toMatch(/tag: null/);
    const mail = systemMailer({ host: 'localhost', port: 2525, user: 'u', password: 'p', from: 'no-reply@nomi.example' });
    expect(mail.from).toBe('no-reply@nomi.example');
    expect(typeof mail.send).toBe('function');
  });
});

describe('A3 · the page', () => {
  it('asks for the code the way a phone can fill it in, and shows the address masked', () => {
    const html = verifyPage({ locale: 'en', path: '/verify', maskedEmail: 'm••@atlas.example', purpose: 'signup' });
    expect(html).toContain('autocomplete="one-time-code"');
    expect(html).toContain('inputmode="numeric"');
    expect(html).toContain('m••@atlas.example');
    expect(html).toContain('action="/verify/resend"');
    expect(html).toContain('href="/signup"');
  });

  it('a new browser is told WHY it is being asked, and goes back to the door, not to sign-up', () => {
    const html = verifyPage({ locale: 'en', path: '/verify', maskedEmail: 'm••@atlas.example', purpose: 'device', error: t('en', 'verify.error.wrong') });
    expect(html).toContain('This browser is new to us');
    expect(html).toContain('role="alert"');
    expect(html).toContain('href="/login"');
  });

  it('in every language, right to left where it is', () => {
    for (const locale of ['en', 'zh', 'ar'] as const) {
      const html = verifyPage({ locale, path: '/verify', maskedEmail: 'm••@a.example', purpose: 'signup' });
      expect(html).toContain(t(locale, 'verify.title'));
      expect(html).toContain(`dir="${locale === 'ar' ? 'rtl' : 'ltr'}"`);
      expect(t(locale, 'otp.mail.subject', { code: '012345' })).toContain('012345');
      expect(t(locale, 'otp.mail.body', { code: '012345' })).toContain('012345');
    }
  });
});

describe('A3 · the rules that make it safe', () => {
  const app = readFileSync(`${root}src/api/web/app.ts`, 'utf8');
  const migration = readFileSync(`${root}migrations/0058_login_codes.sql`, 'utf8');

  it('WITHOUT A SENDER NOTHING ASKS FOR A CODE', () => {
    expect(app).toMatch(/const otpOn = Boolean\(deps\.systemMail\);/);
    expect(app).toMatch(/if \(otpOn\) \{[\s\S]{0,400}sendCode\(reply, locale, wanted\.email, 'signup'/);
    expect(app).toMatch(/if \(otpOn && !isKnownDevice\(/);
  });

  it('nothing becomes a tenant until the code comes back — the waiting sign-up holds a HASH, never a password', () => {
    expect(app).toMatch(/passwordHash: await hashPassword\(v\.value\.password\),[\s\S]{0,700}if \(otpOn\)/);
    const verify = app.slice(app.indexOf("app.post('/verify',"), app.indexOf("app.post('/verify/resend'"));
    expect(verify).toMatch(/redeemOtp\([\s\S]*provisionAccount\(deps\.db, p\)/);
    expect(verify.indexOf('redeemOtp(')).toBeLessThan(verify.indexOf('provisionAccount('));
    expect(app).not.toMatch(/console\.(log|warn|error)\([^)]*\bcode\b/);
  });

  it('a sender that is down does not lock an owner out of her own business', () => {
    expect(app).toMatch(/if \(sent === 'sent'\) return reply\.redirect\('\/verify'\);\s*if \(sent === 'slow'\) return refuse\(429, 'slow'\);\s*\}\s*return signIn\(/);
  });

  it('THE LIMITS LIVE IN THE DATABASE — and the application role cannot touch the table', () => {
    expect(migration).toMatch(/revoke all on login_codes from nomi_app/);
    expect(migration).not.toMatch(/grant[^;]*on login_codes/i);
    expect(migration).toMatch(/interval '1 hour'\) >= 6/);
    expect(migration).toMatch(/v\.attempts > 5/);
    for (const fn of ['otp_issue', 'otp_reissue', 'otp_redeem']) {
      expect(migration, fn).toMatch(new RegExp(`revoke all on function ${fn}\\([^)]*\\) from public`));
      expect(migration, fn).toMatch(new RegExp(`grant execute on function ${fn}\\([^)]*\\) to nomi_app`));
    }
  });

  it('the three addresses are public by decision', () => {
    const verify = PUBLIC_ROUTES.filter((r) => r.url.startsWith('/verify')).map((r) => `${r.method} ${r.url}`).sort();
    expect(verify).toEqual(['GET /verify', 'POST /verify', 'POST /verify/resend']);
  });
});

describe('A3 · a host that blocks SMTP still sends the code', () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

  it('production tries the operator\'s connected mailbox (HTTPS) BEFORE SMTP, and only the mailbox she named', () => {
    const main = read('src/main.ts');
    const mailbox = main.indexOf("{ name: 'mailbox', mailer: mailboxSystemMailer(");
    const smtp = main.indexOf("{ name: 'smtp', mailer: systemMailer(systemSmtp) }");
    expect(mailbox).toBeGreaterThan(-1);
    expect(smtp).toBeGreaterThan(mailbox);
    expect(main).toMatch(/system: \{ from: systemSmtp\.from, onlyMailbox: systemSmtp\.user \}/);
    expect(main).toMatch(/parseBusinessId\(PILOT_BUSINESS_ID\)/);
  });

  it('a business\'s own mail keeps its verified-domain check: only `system` skips it', () => {
    const t = read('src/channels/email/accountTransport.ts');
    expect(t).toMatch(/if \(deps\.system\) \{[\s\S]*?\} else \{[\s\S]*?not on the verified sending domain/);
  });

  it('a send that fails says why in the log, and never the address or the code', () => {
    const app = read('src/api/web/app.ts');
    expect(app).toMatch(/reply\.log\.warn\(\{ reason: mailed\.error, purpose \}, 'system mail could not be sent'\)/);
  });
});
