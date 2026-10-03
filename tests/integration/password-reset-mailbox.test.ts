import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import { offlineModels } from '../pipeline/fakes.js';

/**
 * PWR2 — HOW THE RESET MAIL LEAVES, in the production composition: no test
 * sender (`overrides.systemMail` is not passed), the deployment's variables as
 * production has them (2026-10-04: SYSTEM_SMTP_* set, MAIL_PROVIDER unset), and
 * the network a recorder.
 *
 * Production's host blocks every SMTP port (Railway's plan; A3.1), so SMTP here
 * points at a closed local port. The mail must still leave — over HTTPS,
 * through the operator's connected Gmail mailbox (the Gmail API), from the
 * address sign-in codes come from (SYSTEM_SMTP_FROM), counted under the daily
 * caps (0112) — and only ever to the login's own address.
 *
 * Then the same with a dedicated sender set (MAIL_PROVIDER, decision 36): the
 * mail goes to that provider's HTTPS API instead. And a mailbox that refuses
 * (the grant revoked) with SMTP blocked: nothing leaves, and the operator's
 * error list says so.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const OPS = `a6c00000-0000-4000-8000-${RUN}0001`;
const SHOP = `a6c00000-0000-4000-8000-${RUN}0002`;
const DOMAIN = `nomi-${RUN}.test`;
const SYSTEM = `lily@${DOMAIN}`;
const OWNER = `owner-${RUN}@mailbox.example`;
const SECOND = `second-${RUN}@mailbox.example`;
const THIRD = `third-${RUN}@mailbox.example`;
const CREDENTIAL_KEY = 'c'.repeat(64);

type Call = { url: string; body: string; headers: Record<string, string> };

/** The raw message Gmail was handed: its headers, and its text decoded. */
function readRaw(raw: string): { headers: Record<string, string>; text: string } {
  const mime = Buffer.from(raw, 'base64url').toString('utf8');
  const at = mime.indexOf('\r\n\r\n');
  const headers: Record<string, string> = {};
  for (const line of mime.slice(0, at).split('\r\n')) {
    const i = line.indexOf(': ');
    headers[line.slice(0, i).toLowerCase()] = line.slice(i + 2)
      .replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, b: string) => Buffer.from(b, 'base64').toString('utf8'));
  }
  return { headers, text: Buffer.from(mime.slice(at + 4).replace(/\r\n/g, ''), 'base64').toString('utf8') };
}

d('PWR2 · the reset mail leaves over HTTPS (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 180_000 }, () => {
  let admin: pg.Client;
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  const calls: Call[] = [];
  let refresh: { status: number; body: unknown } = { status: 200, body: { access_token: `access-${RUN}`, expires_in: 3600 } };
  const saved: Record<string, string | undefined> = {};
  const ENV_KEYS = ['PILOT_BUSINESS_ID', 'OWNER_ACCESS_CODE', 'SYSTEM_SMTP_HOST', 'SYSTEM_SMTP_PORT', 'SYSTEM_SMTP_USER',
    'SYSTEM_SMTP_PASSWORD', 'SYSTEM_SMTP_FROM', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET',
    'MAIL_PROVIDER', 'MAIL_API_KEY', 'MAIL_FROM'] as const;

  const fakeFetch = async (url: string | URL, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const u = String(url);
    calls.push({ url: u, body: String(init?.body ?? ''), headers: init?.headers ?? {} });
    const answer = (status: number, body: unknown) => ({
      ok: status >= 200 && status < 300, status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    });
    if (u === 'https://oauth2.googleapis.com/token') return answer(refresh.status, refresh.body);
    if (u === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') return answer(200, { id: `g-${calls.length}` });
    if (u.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages/')) return answer(200, { payload: { headers: [] } });
    if (u === 'https://api.resend.com/emails') return answer(200, { id: `r-${calls.length}` });
    return answer(404, '');
  };

  const build = async () => {
    const { buildProduction } = await import('../../src/main.js');
    return buildProduction({
      provider: 'disabled', DATABASE_URL: DATABASE_URL!,
      ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'pwr2-mailbox-token-01',
      CREDENTIAL_KEY, PORT: 0, PUBLIC_BASE_URL: 'https://nomi.test',
    }, { models: offlineModels(), logger: false });
  };
  let caller = 0;
  const ask = (prod: import('../../src/main.js').Production, email: string) => prod.app.inject({
    method: 'POST', url: '/login/forgot', payload: new URLSearchParams({ email }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': `198.19.0.${++caller}` },
  });
  const until = async (ok: () => boolean | Promise<boolean>, ms = 5000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await ok()) return true; await new Promise((r) => setTimeout(r, 25)); }
    return ok();
  };
  const gmailSends = () => calls.filter((c) => c.url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send')
    .map((c) => readRaw((JSON.parse(c.body) as { raw: string }).raw));

  beforeAll(async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    Object.assign(process.env, {
      PILOT_BUSINESS_ID: OPS, OWNER_ACCESS_CODE: `pwr2-mailbox-${RUN}`,
      // as production has them: the system sender named, SMTP unreachable from the host
      SYSTEM_SMTP_HOST: '127.0.0.1', SYSTEM_SMTP_PORT: '9', SYSTEM_SMTP_USER: SYSTEM,
      SYSTEM_SMTP_PASSWORD: 'not-a-real-password', SYSTEM_SMTP_FROM: SYSTEM,
      GOOGLE_OAUTH_CLIENT_ID: `google-${RUN}.apps.googleusercontent.com`, GOOGLE_OAUTH_CLIENT_SECRET: 'g-secret',
    });
    for (const k of ['MAIL_PROVIDER', 'MAIL_API_KEY', 'MAIL_FROM'] as const) delete process.env[k];
    vi.stubGlobal('fetch', fakeFetch);

    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    const { hashPassword } = await import('../../src/security/password.js');
    const { encryptSecret, deriveKey, credentialFingerprint } = await import('../../src/security/credentials.js');
    for (const [id, name] of [[OPS, `Pwr2 Ops ${RUN}`], [SHOP, `Pwr2 Mailbox Shop ${RUN}`]] as const) {
      await admin.query('insert into businesses (id, name, is_active) values ($1, $2, true) on conflict (id) do nothing', [id, name]);
    }
    // The operator's connected Gmail mailbox, the one named as the system sender.
    await admin.query(
      `insert into mail_accounts (business_id, provider, address, refresh_token_ciphertext, fingerprint, scopes, connected_by)
       values ($1, 'google', $2, $3, $4, 'openid email https://www.googleapis.com/auth/gmail.send', 'test')`,
      [OPS, SYSTEM, encryptSecret(`refresh-${RUN}`, deriveKey(CREDENTIAL_KEY)), credentialFingerprint(`refresh-${RUN}`)]);
    const old = await hashPassword(`old-password-${RUN}`);
    for (const email of [OWNER, SECOND, THIRD]) {
      const person = (await admin.query('insert into people (business_id, name, is_owner) values ($1, $2, $3) returning id',
        [SHOP, email.split('-')[0], email === OWNER])).rows[0].id;
      await admin.query(`insert into logins (business_id, person_id, email, password_hash, email_verified_at) values ($1, $2, $3, $4, now())`,
        [SHOP, person, email, old]);
    }
  }, 90_000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    await admin?.end();
  });

  it("through the operator's Gmail mailbox (HTTPS), from the sign-in codes' address, to the login's own — SMTP never needed", async () => {
    const prod = await build();
    try {
      const r = await ask(prod, `  ${OWNER.toUpperCase()} `);
      expect(r.statusCode).toBe(200);
      expect(await until(() => gmailSends().length >= 1), 'a Gmail API send').toBe(true);
      // the access token came from the stored grant, over HTTPS
      const tokenCall = calls.find((c) => c.url === 'https://oauth2.googleapis.com/token')!;
      expect(new URLSearchParams(tokenCall.body).get('refresh_token')).toBe(`refresh-${RUN}`);
      const sendCall = calls.find((c) => c.url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send')!;
      expect(sendCall.headers['Authorization']).toBe(`Bearer access-${RUN}`);

      const mail = gmailSends()[0]!;
      expect(mail.headers['from']).toBe(SYSTEM);
      expect(mail.headers['to'], 'the login\'s own address, as stored').toBe(OWNER);
      expect(mail.headers['subject']).toBe(t('en', 'forgot.mail.subject'));
      expect(mail.headers['auto-submitted']).toBe('auto-generated');
      const link = /^https:\/\/nomi\.test\/login\/set-password\?t=([A-Za-z0-9_-]{43})&l=en$/m.exec(mail.text);
      expect(link, mail.text).not.toBeNull();
      // the link it carries is the one stored (as its digest), and it opens the page
      const digest = createHash('sha256').update(link![1]!, 'utf8').digest('hex');
      expect((await admin.query('select count(*)::int as n from login_setups where token_hash = $1', [digest])).rows[0].n).toBe(1);
      expect((await prod.app.inject({ method: 'GET', url: `/login/set-password?t=${link![1]}` })).statusCode).toBe(200);

      // counted under the daily caps, as a code is (the address only as its digest)
      const day = (await admin.query(`select sent from mail_sends where kind = 'code' and day = (now() at time zone 'UTC')::date
                                        and recipient_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`, [OWNER])).rows[0];
      expect(day?.sent).toBe(1);

      // saving a password: the "it was changed" mail leaves the same way
      const saved = await prod.app.inject({
        method: 'POST', url: '/login/set-password', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({ t: link![1]!, password: `new-password-${RUN}`, repeat: `new-password-${RUN}` }).toString(),
      });
      expect(saved.statusCode).toBe(200);
      expect(await until(() => gmailSends().length >= 2)).toBe(true);
      const told = gmailSends()[1]!;
      expect([told.headers['from'], told.headers['to'], told.headers['subject']])
        .toEqual([SYSTEM, OWNER, t('en', 'setpw.changed.mail.subject')]);
      // nothing went anywhere but Google
      expect(calls.every((c) => c.url.startsWith('https://oauth2.googleapis.com/') || c.url.startsWith('https://gmail.googleapis.com/'))).toBe(true);
    } finally {
      await prod.close();
    }
  });

  it('a mailbox that refuses, with SMTP blocked: nothing leaves, the door says the same, and the operator\'s list says why', async () => {
    refresh = { status: 400, body: { error: 'invalid_grant' } };
    calls.length = 0;
    const prod = await build();
    try {
      const since = (await admin.query('select now() as at')).rows[0].at as Date;
      const r = await ask(prod, SECOND);
      expect(r.statusCode).toBe(200);
      const row = async () => (await admin.query(
        `select message, route from app_errors where name = 'RecoveryMailFailed' and last_seen >= $1 order by last_seen desc limit 1`, [since])).rows[0];
      expect(await until(async () => Boolean(await row()), 15_000), 'written down').toBe(true);
      const e = await row();
      expect(e.route).toBe('POST /login/forgot');
      expect(e.message).toMatch(/^recovery mail could not be sent: mailbox: the mail account must be connected again · smtp: /);
      expect(e.message).not.toContain('@');
      expect(gmailSends()).toHaveLength(0);
    } finally {
      await prod.close();
      refresh = { status: 200, body: { access_token: `access-${RUN}`, expires_in: 3600 } };
      // the refusal marked the operator's mailbox; the next case does not use it
    }
  });

  it('with a dedicated sender set (MAIL_PROVIDER), the mail goes to that provider over HTTPS instead', async () => {
    Object.assign(process.env, { MAIL_PROVIDER: 'resend', MAIL_API_KEY: `re_test_${RUN}`, MAIL_FROM: `Nomi <no-reply@${DOMAIN}>` });
    calls.length = 0;
    const prod = await build();
    try {
      expect((await ask(prod, THIRD)).statusCode).toBe(200);
      expect(await until(() => calls.some((c) => c.url === 'https://api.resend.com/emails'))).toBe(true);
      const sent = JSON.parse(calls.find((c) => c.url === 'https://api.resend.com/emails')!.body) as { from: string; to: string[]; subject: string; text: string };
      expect(sent.from).toBe(`Nomi <no-reply@${DOMAIN}>`);
      expect(sent.to).toEqual([THIRD]);
      expect(sent.subject).toBe(t('en', 'forgot.mail.subject'));
      expect(sent.text).toMatch(/^https:\/\/nomi\.test\/login\/set-password\?t=[A-Za-z0-9_-]{43}&l=en$/m);
      expect(gmailSends(), 'the operator\'s mailbox carries operator mail only').toHaveLength(0);
    } finally {
      await prod.close();
      for (const k of ['MAIL_PROVIDER', 'MAIL_API_KEY', 'MAIL_FROM'] as const) delete process.env[k];
    }
  });
});
