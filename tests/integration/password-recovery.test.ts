import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import { offlineModels } from '../pipeline/fakes.js';

/**
 * PWR (0084) — "e-mail me a link", end to end: the real composition, real
 * Postgres, and a mailbox that records what would have been sent, so the test
 * opens the link the way the owner would.
 *
 *   · an owner who forgot the password asks on the door, gets a link, chooses a
 *     new password with it (0078's page), and signs in with it;
 *   · the door says the same words, with the same status, for an address that
 *     has no login — and mails nothing;
 *   · three links an hour per login; the newest is the one that works;
 *   · a switched-off workspace or an archived login gets nothing;
 *   · only the link's digest is stored.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const PILOT = `a4c00000-0000-4000-8000-${RUN}0001`;
const SHOP = `a4c00000-0000-4000-8000-${RUN}0002`;
const OFF = `a4c00000-0000-4000-8000-${RUN}0003`;
const OWNER = `owner-${RUN}@recover.example`;
const GONE = `gone-${RUN}@recover.example`;
const QUIET = `quiet-${RUN}@recover.example`;

d('PWR · a forgotten password, by e-mail (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let prod: import('../../src/main.js').Production;
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  let admin: pg.Client;
  const outbox: { to: string; subject: string; text: string }[] = [];

  const form = (url: string, fields: Record<string, string>, headers: Record<string, string> = {}) => prod.app.inject({
    method: 'POST', url, headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    payload: new URLSearchParams(fields).toString(),
  });
  /** Ask for a link as a distinct caller each time, so the per-caller limit is not what is tested. */
  let caller = 0;
  const ask = (email: string) => form('/login/forgot', { email }, { 'x-forwarded-for': `203.0.113.${++caller}` });
  const settle = () => new Promise((r) => setTimeout(r, 400));   // the mail leaves after the reply
  const linkIn = (text: string): string => {
    const m = /https:\/\/nomi\.test\/login\/set-password\?t=([A-Za-z0-9_-]{43})/.exec(text);
    if (!m) throw new Error(`no link in: ${text}`);
    return m[1]!;
  };
  const openLinks = async (email: string) => (await admin.query(
    `select count(*)::int as n from login_setups s join logins l on l.id = s.login_id
      where l.email = $1 and s.used_at is null and s.expires_at > now()`, [email])).rows[0].n as number;

  beforeAll(async () => {
    process.env['PILOT_BUSINESS_ID'] = PILOT;
    process.env['OWNER_ACCESS_CODE'] = `pwr-${RUN}`;
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    const { hashPassword } = await import('../../src/security/password.js');
    const old = await hashPassword(`old-password-${RUN}`);
    for (const [id, name, active] of [[PILOT, `Pwr Pilot ${RUN}`, true], [SHOP, `Pwr Shop ${RUN}`, true], [OFF, `Pwr Off ${RUN}`, false]] as const) {
      await admin.query('insert into businesses (id, name, is_active) values ($1, $2, $3) on conflict (id) do nothing', [id, name, active]);
    }
    for (const [biz, email, archived] of [[SHOP, OWNER, false], [SHOP, GONE, true], [OFF, QUIET, false]] as const) {
      const person = (await admin.query(
        'insert into people (business_id, name, is_owner) values ($1, $2, $3) returning id', [biz, 'Sara', email === OWNER])).rows[0].id;
      // PWR2 (0129) — each address has answered a code: only such an address is mailed a link.
      await admin.query(`insert into logins (business_id, person_id, email, password_hash, archived_at, email_verified_at)
                         values ($1, $2, $3, $4, $5, now())`,
        [biz, person, email, old, archived ? new Date() : null]);
    }
    const { buildProduction } = await import('../../src/main.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    prod = await buildProduction({
      provider: 'disabled', DATABASE_URL: DATABASE_URL!,
      ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'pwr-verify-token-0001',
      CREDENTIAL_KEY: 'e'.repeat(64), PORT: 0, PUBLIC_BASE_URL: 'https://nomi.test',
    }, {
      models: offlineModels(), logger: false,
      systemMail: { from: 'no-reply@nomi.test', send: async (m) => { outbox.push(m); return { ok: true }; } },
    });
  }, 90_000);
  afterAll(async () => { await admin?.end(); await prod?.close(); });

  it('the door offers it, and the page asks for the address', async () => {
    const door = await prod.app.inject({ method: 'GET', url: '/login' });
    expect(door.body).toContain(`<a href="/login/forgot">${t('en', 'login.forgot')}</a>`);
    const page = await prod.app.inject({ method: 'GET', url: '/login/forgot' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<form method="post" action="/login/forgot">');
    expect(page.body).toContain(t('en', 'forgot.lead', { minutes: 60 }));
  });

  it('an owner asks, a link arrives, a new password is chosen with it — and signs in', async () => {
    const r = await ask(`  ${OWNER.toUpperCase()} `);
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain(t('en', 'forgot.sent', { email: `<bdi>${OWNER}</bdi>`, minutes: 60 }));
    await settle();
    expect(outbox).toHaveLength(1);
    const mail = outbox[0]!;
    expect(mail.to).toBe(OWNER);
    expect(mail.subject).toBe(t('en', 'forgot.mail.subject'));
    const token = linkIn(mail.text);
    // only the digest is kept
    const row = (await admin.query(
      `select s.token_hash, s.made_by, extract(epoch from s.expires_at - s.created_at)::int as secs
         from login_setups s join logins l on l.id = s.login_id where l.email = $1 order by s.created_at desc limit 1`, [OWNER])).rows[0];
    expect(row.token_hash).toBe(createHash('sha256').update(token, 'utf8').digest('hex'));
    expect(row.made_by).toBe('recovery');
    expect(row.secs).toBe(3600);

    const opened = await prod.app.inject({ method: 'GET', url: `/login/set-password?t=${token}` });
    expect(opened.statusCode).toBe(200);
    const saved = await form('/login/set-password', { t: token, password: `new-password-${RUN}`, repeat: `new-password-${RUN}` });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).toContain(t('en', 'login.passwordSet'));
    const signIn = await form('/login', { email: OWNER, password: `new-password-${RUN}` });
    expect([302, 303]).toContain(signIn.statusCode);
    expect(String(signIn.headers['location'])).not.toBe('/login');
    const old = await form('/login', { email: OWNER, password: `old-password-${RUN}` });
    expect(old.statusCode, 'the old password no longer opens the door').toBe(401);
    // PWR2 — and the address is told (after the reply), before the next test empties the box
    await settle();
    expect(outbox.filter((m) => m.subject === t('en', 'setpw.changed.mail.subject')).map((m) => m.to)).toEqual([OWNER]);
  });

  it('an address with no login, an archived login, a switched-off workspace: the same words and status — and no mail', async () => {
    outbox.length = 0;
    const known = await ask(OWNER);
    const pageFor = (html: string, email: string) => html.replaceAll(email, '{email}');
    for (const email of [`nobody-${RUN}@recover.example`, GONE, QUIET]) {
      const r = await ask(email);
      expect(r.statusCode, email).toBe(known.statusCode);
      expect(pageFor(r.body, email), email).toBe(pageFor(known.body, OWNER));
    }
    await settle();
    expect(outbox.map((m) => m.to)).toEqual([OWNER]);
    expect(await openLinks(GONE)).toBe(0);
    expect(await openLinks(QUIET)).toBe(0);
  });

  it('the newest link is the one that works; three an hour per login, whoever asks', async () => {
    outbox.length = 0;
    await admin.query(`delete from login_setups where made_by = 'recovery' and login_id in (select id from logins where email = $1)`, [OWNER]);
    await ask(OWNER); await settle();
    await ask(OWNER); await settle();
    expect(outbox).toHaveLength(2);
    const [first, second] = [linkIn(outbox[0]!.text), linkIn(outbox[1]!.text)];
    expect((await prod.app.inject({ method: 'GET', url: `/login/set-password?t=${first}` })).statusCode, 'the older link is closed').toBe(404);
    expect((await prod.app.inject({ method: 'GET', url: `/login/set-password?t=${second}` })).statusCode).toBe(200);
    await ask(OWNER); await settle();
    const fourth = await ask(OWNER); await settle();
    expect(fourth.statusCode, 'the door still says the same').toBe(200);
    expect(outbox, 'a fourth in the hour is not sent').toHaveLength(3);
  });

  it('a malformed address is said so; too many asks from one caller are slowed', async () => {
    const bad = await ask('not-an-address');
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toContain(t('en', 'signup.problem.email_invalid'));
    const same = { 'x-forwarded-for': '198.51.100.7' };
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await form('/login/forgot', { email: `x${i}-${RUN}@recover.example` }, same)).statusCode);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
  });
});
