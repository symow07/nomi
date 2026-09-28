import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SANDBOX_BUSINESS_ID } from '../../src/demo/sandbox.js';
import { SETUP_TOKEN, setupTokenHash } from '../../src/security/setupLink.js';
import { setPasswordPage, loginPage } from '../../src/api/web/layout.js';
import { PUBLIC_ROUTES } from '../../src/api/web/app.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * 0078 — tools/add-login.mjs writes the rows sign-up writes, and the door has a
 * page to choose the password on. What needs no database is held here; the
 * tool run for real, and the login signed in to, is
 * tests/integration/add-login.test.ts.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p: string) => readFileSync(`${ROOT}${p}`, 'utf8');
const TOOL = read('tools/add-login.mjs');
const constant = (src: string, name: string) => new RegExp(`const ${name} = ([^;]+);`).exec(src)?.[1]?.trim();
const run = (args: string[], env: Record<string, string>) => {
  const r = spawnSync(process.execPath, ['tools/add-login.mjs', ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: 30_000,
    env: { PATH: process.env['PATH'] ?? '', ...env },
  });
  return { code: r.status, err: r.stderr, out: r.stdout };
};
// Nothing listens here: a refusal that tried to connect first would say so.
const NOWHERE = 'postgresql://nobody@127.0.0.1:9/none';

describe('the rows are the ones sign-up writes', () => {
  it('the same scrypt parameters as src/security/password.ts', () => {
    const pw = read('src/security/password.ts');
    for (const name of ['N', 'R', 'P', 'KEY_LEN', 'SALT_LEN']) {
      expect(constant(TOOL, name), name).toBeDefined();
      expect(constant(TOOL, name), name).toBe(constant(pw, name));
    }
    expect(TOOL).toContain('`scrypt$${N}$${R}$${P}$${salt.toString(\'base64url\')}$${key.toString(\'base64url\')}`');
    expect(TOOL).toContain(".normalize('NFKC')");
  });

  it("the same e-mail shape check and normal form as sign-up", () => {
    const signup = read('src/core/owner/signup.ts');
    expect(constant(TOOL, 'EMAIL')).toBe(constant(signup, 'EMAIL'));
    expect(TOOL).toContain("const normalizeEmail = (raw) => raw.trim().toLowerCase();");
    expect(signup).toContain('export const normalizeEmail = (raw: string): string => raw.trim().toLowerCase();');
  });

  it('the same link digest the door looks the link up by, and a token the door accepts', () => {
    const token = 'A'.repeat(43);
    expect(setupTokenHash(token)).toBe(createHash('sha256').update(token, 'utf8').digest('hex'));
    expect(TOOL).toContain("createHash('sha256').update(token, 'utf8').digest('hex')");
    expect(TOOL).toContain("randomBytes(32).toString('base64url')");
    // 32 bytes in base64url are 43 characters — the door's own check.
    expect(SETUP_TOKEN.test(Buffer.alloc(32, 7).toString('base64url'))).toBe(true);
  });

  it("the sandbox it refuses is the sandbox", () => {
    expect(TOOL).toContain(`const SANDBOX_BUSINESS_ID = '${SANDBOX_BUSINESS_ID}';`);
  });
});

describe('it refuses before it touches anything', () => {
  it('without admin access it does not start', () => {
    const r = run(['7dc89f42-852e-465a-920f-8af170dc83cd', 'owner@example.com'], {});
    expect(r.code).toBe(2);
    expect(r.err).toContain('MIGRATE_DATABASE_URL is required');
  });

  it('takes no password on the command line', () => {
    const r = run(['7dc89f42-852e-465a-920f-8af170dc83cd', 'owner@example.com', '--password', 'hunter22hunter'], { MIGRATE_DATABASE_URL: NOWHERE });
    expect(r.code).toBe(2);
    expect(r.err).toContain('Unknown option --password');
    expect(TOOL).not.toMatch(/--password|process\.env\.[A-Z_]*PASSWORD/);
  });

  it("refuses the practice sandbox, a bad id, and an address sign-up would not accept", () => {
    const sandbox = run([SANDBOX_BUSINESS_ID, 'owner@example.com'], { MIGRATE_DATABASE_URL: NOWHERE });
    expect(sandbox.code).toBe(1);
    expect(sandbox.err).toContain('practice sandbox');
    expect(run(['not-a-uuid', 'owner@example.com'], { MIGRATE_DATABASE_URL: NOWHERE }).code).toBe(2);
    expect(run(['7dc89f42-852e-465a-920f-8af170dc83cd', 'owner@nowhere'], { MIGRATE_DATABASE_URL: NOWHERE }).code).toBe(2);
    expect(run(['7dc89f42-852e-465a-920f-8af170dc83cd', 'owner@example.com', '--replace', '--reset'], { MIGRATE_DATABASE_URL: NOWHERE }).code).toBe(2);
  });
});

describe('the page the link opens', () => {
  const link = { token: 'T'.repeat(43), email: 'owner@westlake.example' };
  const page = (locale: 'en' | 'zh' | 'ar', l: typeof link | null, problem: 'short' | 'mismatch' | null = null) =>
    setPasswordPage({ locale, path: '/login/set-password', passwordMin: 10, passwordMax: 200, link: l, problem });

  it('in every language: which account, a new password twice, the token only in a hidden field', () => {
    for (const locale of ['en', 'zh', 'ar'] as const) {
      const html = page(locale, link);
      expect(html, locale).toContain(`<html lang="${locale}"`);
      expect(html, locale).toContain(locale === 'ar' ? 'dir="rtl"' : 'dir="ltr"');
      expect(html, locale).toContain('<bdi>');
      expect(html, locale).toContain(link.email);
      expect(html, locale).toContain(t(locale, 'setpw.title'));
      expect(html.match(/autocomplete="new-password"/g), locale).toHaveLength(2);
      expect(html, locale).toContain(`<input type="hidden" name="t" value="${link.token}" />`);
      expect(html.split(link.token).length - 1, `${locale}: the token appears once`).toBe(1);
      expect(html, locale).toContain('action="/login/set-password"');
    }
  });

  it('a link that is not good says one thing, whatever the reason, and offers the door', () => {
    for (const locale of ['en', 'zh', 'ar'] as const) {
      const html = page(locale, null);
      expect(html, locale).toContain(t(locale, 'setpw.gone'));
      expect(html, locale).not.toContain('<form');
      expect(html, locale).toContain('href="/login"');
    }
  });

  it('says what is wrong with the password, as an alert', () => {
    expect(page('en', link, 'short')).toContain(`role="alert">${t('en', 'setpw.problem.short', { n: 10 })}`);
    expect(page('ar', link, 'mismatch')).toContain(t('ar', 'setpw.problem.mismatch'));
  });

  it('the sign-in page says the password is saved, with the e-mail filled in', () => {
    const html = loginPage({ locale: 'zh', path: '/login', email: link.email, notice: t('zh', 'login.passwordSet') });
    expect(html).toContain(`role="status">${t('zh', 'login.passwordSet')}`);
    expect(html).toContain(`value="${link.email}"`);
  });

  it('both addresses are declared public, with their reason', () => {
    for (const method of ['GET', 'POST'] as const) {
      const route = PUBLIC_ROUTES.find((r) => r.method === method && r.url === '/login/set-password');
      expect(route, method).toBeDefined();
      expect(route!.why.length, method).toBeGreaterThan(20);
    }
  });
});
