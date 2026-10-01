import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import Fastify from 'fastify';
import { offlineModels } from '../pipeline/fakes.js';

/**
 * BOT (0114; decision 36) — THE SIGN-UP'S GUARDS, on the production
 * composition and real Postgres, with production's limits (SIGNUP_GUARD):
 *
 *   · a bot check before anything is spent — no token, or one the provider
 *     refuses, sends nothing; open without a check reads as invite;
 *   · the operator's switch in the database, read on every request;
 *   · per caller and per company domain, in the database — a second process
 *     (a deploy) still refuses; a public provider's domain is never counted;
 *   · invitations listed and revoked by the operator's tool.
 *
 * The provider itself is never called: the check here passes one token only.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const PILOT = `b0700000-0000-4000-8000-${RUN}0001`;
const PERSON = 'person-token';
const FIELD = 'cf-turnstile-response';
const ABOUT = { kind: 'brand', sells: 'Candles', country: 'AE', website: '', teamSize: '1', terms: 'on' };
const caller = (n: number) => `2001:db8:${RUN.slice(0, 4)}:${RUN.slice(4)}::${n.toString(16)}`;
const shop = (n: number, domain = `acme-${RUN}.example`) =>
  ({ ...ABOUT, factory: `Bot Check ${RUN} ${n}`, name: 'Rania', email: `rania-${n}-${RUN}@${domain}`, password: `bot-check-password-${RUN}` });
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

d('BOT · the sign-up\'s guards (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  let admin: pg.Client;
  const outbox: { to: string; subject: string; text: string }[] = [];
  const asked: string[] = [];
  const check = {
    provider: 'turnstile' as const, siteKey: 'site-key-for-tests-01',
    verify: async (token: string) => { asked.push(token); return token === PERSON; },
  };
  const form = (url: string, fields: Record<string, string>, from: string, cookie = '') => prod.app.inject({
    method: 'POST', url, headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': from, ...(cookie ? { cookie } : {}) },
    payload: new URLSearchParams(fields).toString(),
  });
  const otpCookie = (r: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat(r.headers['set-cookie'] as string | string[] ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_otp=')) ?? '';
  const setSwitch = (mode: string | null) => admin.query(`update signup_settings set mode = $1, set_by = 'bot-check test' where id`, [mode]);

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    await admin.query(`insert into businesses (id, name, owner_locale) values ($1, $2, 'en') on conflict (id) do nothing`, [PILOT, `BOT Pilot ${RUN}`]);
    await setSwitch(null);
    process.env['PILOT_BUSINESS_ID'] = PILOT;
    process.env['OWNER_ACCESS_CODE'] = `bot-${RUN}`;
    process.env['SIGNUP_MODE'] = 'open';
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'bot-verify-token-0001',
      CREDENTIAL_KEY: 'c'.repeat(64), PORT: 0, PUBLIC_BASE_URL: 'https://nomi.test',
    }, {
      adapter: whatsappSimulator([], { tag: `bot${RUN}` }).adapter, media: {}, models: offlineModels(), logger: false,
      // Production's limits (no `signupGuard` here); only the provider is replaced.
      botCheck: check,
      systemMail: { from: 'no-reply@nomi.test', send: async (m) => {
        if (m.subject !== t('en', 'notify.app_error.subject')) outbox.push(m);
        return { ok: true };
      } },
    } as Parameters<typeof buildProduction>[1]);
  }, 90_000);
  afterAll(async () => {
    await setSwitch(null);
    for (const k of ['SIGNUP_MODE']) delete process.env[k];
    await admin?.end(); await prod?.close();
  });

  it('THE PAGE draws the provider\'s widget and its script, and says why it needs script', async () => {
    const page = await prod.app.inject({ method: 'GET', url: '/signup' });
    expect(page.body).toContain(`<div class="cf-turnstile" data-sitekey="${check.siteKey}"></div>`);
    expect(page.body).toContain('<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>');
    expect(page.body).toContain(t('en', 'signup.botcheck.noscript'));
    expect(page.body).not.toContain('name="invite"');
  });

  it('NO TOKEN, OR ONE THE PROVIDER REFUSES: nothing is mailed and no code waits', async () => {
    const before = outbox.length;
    for (const [n, token] of [[1, ''], [2, 'a-script']] as const) {
      const r = await form('/signup', { ...shop(n), ...(token ? { [FIELD]: token } : {}) }, caller(n));
      expect(r.statusCode).toBe(400);
      expect(r.body).toContain(t('en', 'signup.error.botcheck'));
      expect((await admin.query(`select 1 from login_codes where email = $1`, [shop(n).email])).rowCount).toBe(0);
    }
    expect(outbox.length).toBe(before);
    expect(asked).toContain('a-script');
  });

  it('A PERSON\'S TOKEN: the code goes, as before', async () => {
    const r = await form('/signup', { ...shop(3), [FIELD]: PERSON }, caller(3));
    expect([r.statusCode, r.headers['location']]).toEqual([302, '/verify']);
    expect(outbox.at(-1)!.to).toBe(shop(3).email);
  });

  it('THE OPERATOR\'S SWITCH is read on every request: closed at once, then invite, then the deployment\'s again', async () => {
    await setSwitch('closed');
    expect((await prod.app.inject({ method: 'GET', url: '/signup' })).body).toContain(t('en', 'signup.closed'));
    expect((await form('/signup', { ...shop(4), [FIELD]: PERSON }, caller(4))).statusCode).toBe(403);
    await setSwitch('invite');
    expect((await prod.app.inject({ method: 'GET', url: '/signup' })).body).toContain('name="invite"');
    await setSwitch(null);
    expect((await prod.app.inject({ method: 'GET', url: '/signup' })).body).not.toContain('name="invite"');
  });

  it('PER CALLER, IN THE DATABASE: five tries an hour — and a second process (a deploy) still refuses the sixth', async () => {
    const from = caller(0x100);
    for (let i = 0; i < 5; i++) expect((await form('/signup', { ...shop(0x100 + i) }, from)).statusCode).toBe(400);
    // The process's own limit refuses the sixth here, as before 0114…
    expect((await form('/signup', { ...shop(0x105), [FIELD]: PERSON }, from)).statusCode).toBe(429);
    // …and a fresh process, with no memory of this caller, refuses it too.
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { createDb } = await import('../../src/db/client.js');
    const { SIGNUP_GUARD } = await import('../../src/api/web/botCheck.js');
    const db = createDb(DATABASE_URL!);
    const other = Fastify({ logger: false });
    registerWebApp(other, {
      db, businessId: PILOT, accessCode: `bot-other-${RUN}`, sessionSecret: 'a-test-session-secret-of-sufficient-length',
      signupMode: 'open', botCheck: check, signupGuard: SIGNUP_GUARD,
      systemMail: { from: 'no-reply@nomi.test', send: async (m: { to: string; subject: string; text: string }) => { outbox.push(m); return { ok: true as const }; } },
      secureCookie: false, messagingEnabled: false, kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await other.ready();
    const before = outbox.length;
    const again = await other.inject({ method: 'POST', url: '/signup', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': from },
      payload: new URLSearchParams({ ...shop(0x106), [FIELD]: PERSON }).toString() });
    expect(again.statusCode).toBe(429);
    expect(again.body).toContain(t('en', 'signup.error.slow'));
    expect(outbox.length).toBe(before);
    // Kept only as a hash.
    expect((await admin.query(`select 1 from signup_throttles where kind = 'caller' and key_hash = $1`, [sha(from)])).rowCount).toBe(1);
    await other.close(); await db.destroy();
  });

  it('PER COMPANY DOMAIN: ten codes an hour, then none — a resend included; a public provider\'s domain is never counted', async () => {
    const pending: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await form('/signup', { ...shop(0x200 + i, `firm-${RUN}.example`), [FIELD]: PERSON }, caller(0x200 + i));
      expect([r.statusCode, r.headers['location']], r.body.slice(0, 200)).toEqual([302, '/verify']);
      pending.push(otpCookie(r));
    }
    const before = outbox.length;
    const full = await form('/signup', { ...shop(0x20a, `firm-${RUN}.example`), [FIELD]: PERSON }, caller(0x20a));
    expect(full.statusCode).toBe(429);
    expect(full.body).toContain(t('en', 'verify.error.slow'));
    const resend = await form('/verify/resend', {}, caller(0x20b), pending[0]!);
    expect(resend.statusCode).toBe(429);
    expect(outbox.length, 'nothing more to that domain').toBe(before);
    // Another company's domain, and a public provider's address, still go.
    expect((await form('/signup', { ...shop(0x20c, `other-${RUN}.example`), [FIELD]: PERSON }, caller(0x20c))).statusCode).toBe(302);
    expect((await form('/signup', { ...shop(0x20d, 'gmail.com'), [FIELD]: PERSON }, caller(0x20d))).statusCode).toBe(302);
    expect((await admin.query(`select 1 from signup_throttles where kind = 'domain' and key_hash = $1`, [sha('gmail.com')])).rowCount).toBe(0);
  });

  it('OPEN WITHOUT A CHECK reads as invite: only an invitation can make Nomi send a code', async () => {
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { createDb } = await import('../../src/db/client.js');
    const db = createDb(DATABASE_URL!);
    const bare = Fastify({ logger: false });
    registerWebApp(bare, {
      db, businessId: PILOT, accessCode: `bot-bare-${RUN}`, sessionSecret: 'a-test-session-secret-of-sufficient-length',
      signupMode: 'open',
      systemMail: { from: 'no-reply@nomi.test', send: async () => ({ ok: true as const }) },
      secureCookie: false, messagingEnabled: false, kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await bare.ready();
    const page = await bare.inject({ method: 'GET', url: '/signup' });
    expect(page.body).toContain('name="invite"');
    expect(page.body).not.toContain('cf-turnstile');
    await bare.close(); await db.destroy();
  });

  it('INVITATIONS: the operator lists them by their first eight characters and takes one back; it opens nothing after', async () => {
    // @ts-expect-error — the operator tool, plain JS on purpose (tools/ is not type-checked).
    const { listInvitations, revokeInvitation } = await import('../../tools/lib/operator.mjs');
    const id = (await admin.query(`insert into signup_invites (note) values ($1) returning id::text as id`, [`bot ${RUN}`])).rows[0].id as string;
    const listed = (await listInvitations(admin)).find((r: { ref: string }) => r.ref === id.slice(0, 8));
    expect(listed).toMatchObject({ state: 'open', note: `bot ${RUN}` });
    expect(JSON.stringify(await listInvitations(admin, { all: true }))).not.toContain(id);
    expect(await revokeInvitation(admin, { ref: id.slice(0, 7), by: 'test' })).toBe('invalid');
    expect(await revokeInvitation(admin, { ref: id.slice(0, 8), by: '' })).toBe('invalid');
    expect(await revokeInvitation(admin, { ref: 'ffffffff-ffff', by: 'test' })).toBe('none');
    expect(await revokeInvitation(admin, { ref: id.slice(0, 8), by: 'bot-check test' })).toBe('revoked');
    expect(await revokeInvitation(admin, { ref: id.slice(0, 8), by: 'bot-check test' })).toBe('not_open');
    expect((await admin.query(`select invite_is_open($1::uuid) as open`, [id])).rows[0].open).toBe(false);
    expect((await listInvitations(admin, { all: true })).find((r: { ref: string }) => r.ref === id.slice(0, 8))).toMatchObject({ state: 'revoked', revokedBy: 'bot-check test' });
    // In invite mode, the revoked ticket sends nothing.
    await setSwitch('invite');
    const before = outbox.length;
    const r = await form('/signup', { ...shop(0x300), invite: id, [FIELD]: PERSON }, caller(0x300));
    expect(r.statusCode).toBe(400);
    expect(r.body).toContain(t('en', 'signup.error.invite_not_open'));
    expect(outbox.length).toBe(before);
    await setSwitch(null);
  });

  it('THE APP cannot read or write the switch or the counts: only the functions', async () => {
    const { sql } = await import('kysely');
    const { createDb } = await import('../../src/db/client.js');
    const db = createDb(DATABASE_URL!);
    for (const stmt of [sql`update signup_settings set mode = 'open'`, sql`select * from signup_throttles`,
      sql`delete from signup_throttles`, sql`update signup_invites set revoked_at = now()`]) {
      await expect(stmt.execute(db)).rejects.toThrow(/permission denied/);
    }
    await db.destroy();
  });
});
