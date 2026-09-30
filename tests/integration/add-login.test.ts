import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { offlineModels } from '../pipeline/fakes.js';

/**
 * 0078 — tools/add-login.mjs, run for real against Postgres, and the login it
 * makes signed in to through the production composition's own door.
 *
 * The case it exists for: a workspace that EXISTS and has no login (the pilot's,
 * provisioned before logins existed), and an owner whose only login is lost.
 * What is proved: the rows are the ones sign-up makes; the password is chosen on
 * the link, never on a command line; the link works once; and every refusal the
 * tool promises changes nothing.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const RUN = randomUUID().slice(0, 8);
const PILOT = `add10000-0000-4000-8000-${RUN}0001`;   // the environment's business, as in production
const OLD = `add10000-0000-4000-8000-${RUN}0002`;     // exists, has an owner on record, no login (Westlake's shape)
const BARE = `add10000-0000-4000-8000-${RUN}0003`;    // made by provision-factory: no owner on record
const OFF = `add10000-0000-4000-8000-${RUN}0004`;     // switched off
const COPY = `add10000-0000-4000-8000-${RUN}0005`;    // OLD's practice copy (0086)
const SANDBOX = '5a4d0000-0000-4000-8000-0000000000b1';
const OWNER = { email: `owner-${RUN}@westlake.example`, password: `westlake-password-${RUN}` };
const SIGNUP = { factory: `Signed Up ${RUN}`, name: 'Sara', email: `sara-${RUN}@signed.example`, password: `signed-password-${RUN}`,
  kind: 'manufacturer', sells: 'Canvas bags', country: 'MA', website: '', teamSize: '2-5' };

type Run = { code: number | null; out: string; err: string };
const tool = (args: string[], url = MIGRATE_URL): Run => {
  const r = spawnSync(process.execPath, ['tools/add-login.mjs', ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: 120_000,
    env: { ...process.env, MIGRATE_DATABASE_URL: url ?? '', PUBLIC_BASE_URL: 'https://nomi.test' },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
/** The one token the tool printed, out of its link. */
const tokenOf = (r: Run): string => {
  const m = /https:\/\/nomi\.test\/login\/set-password\?t=([A-Za-z0-9_-]{43})\s/.exec(r.out);
  if (!m) throw new Error(`no link in: ${r.out}\n${r.err}`);
  return m[1]!;
};

d('0078 · add-login gives a workspace that exists a login (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let prod: import('../../src/main.js').Production;
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  let admin: pg.Client;

  const form = (url: string, fields: Record<string, string>, cookie = '') => prod.app.inject({
    method: 'POST', url, headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
    payload: new URLSearchParams(fields).toString(),
  });
  const get = (url: string, cookie = '') => prod.app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });
  const sessionOf = (r: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat(r.headers['set-cookie'] as string | string[] ?? [])
      .map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=') && c !== 'yf_session=') ?? '';
  const signIn = (email: string, password: string) => form('/login', { email, password });
  const loginsOf = async (business: string) => (await admin.query(
    `select l.email, l.archived_at is not null as archived, p.name, p.is_owner
       from logins l join people p on p.id = l.person_id where l.business_id = $1 order by l.created_at`, [business])).rows;
  const counts = async () => (await admin.query(
    `select (select count(*)::int from logins) as logins, (select count(*)::int from people) as people,
            (select count(*)::int from login_setups) as links`)).rows[0];

  beforeAll(async () => {
    process.env['PILOT_BUSINESS_ID'] = PILOT;
    process.env['OWNER_ACCESS_CODE'] = `add-login-${RUN}`;
    process.env['SIGNUP_MODE'] = 'open';
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    await admin.query(`insert into businesses (id, name) values ($1, $2), ($3, $4), ($5, $6), ($7, $8) on conflict (id) do nothing`,
      [PILOT, `Pilot ${RUN}`, OLD, `Westlake ${RUN}`, BARE, `Bare ${RUN}`, OFF, `Off ${RUN}`]);
    await admin.query(`update businesses set is_active = false where id = $1`, [OFF]);
    await admin.query(`insert into businesses (id, name, practice_of) values ($1, $2, $3) on conflict (id) do nothing`, [COPY, `Westlake ${RUN}`, OLD]);
    // What 0035 gave every business that existed then: an owner on record, named after it.
    await admin.query(`insert into people (business_id, name, is_owner) values ($1, $2, true)`, [OLD, `Westlake ${RUN}`]);
    const { buildProduction } = await import('../../src/main.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    prod = await buildProduction({
      provider: 'disabled', DATABASE_URL: DATABASE_URL!,
      ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'add-login-verify-01',
      CREDENTIAL_KEY: 'a'.repeat(64), PORT: 0, PUBLIC_BASE_URL: 'https://nomi.test',
    }, { models: offlineModels(), logger: false });
    // A workspace made by signing up, for the comparison and the clash.
    const made = await form('/signup', SIGNUP);
    expect(made.statusCode, made.body.slice(0, 300)).toBe(302);
  }, 90_000);

  afterAll(async () => {
    delete process.env['SIGNUP_MODE'];
    await admin?.end();
    await prod?.close();
  });

  it('refuses, and changes nothing: no such business, the sandbox, a practice copy, switched off, not an admin', async () => {
    const before = await counts();
    const none = tool([randomUUID(), OWNER.email]);
    expect(none.code).toBe(1);
    expect(none.err).toMatch(/no business/);
    const sandbox = tool([SANDBOX, OWNER.email]);
    expect(sandbox.code).toBe(1);
    expect(sandbox.err).toMatch(/practice sandbox/);
    const copy = tool([COPY, OWNER.email]);
    expect(copy.code).toBe(1);
    expect(copy.err).toContain(`the practice copy of ${OLD}`);
    const off = tool([OFF, OWNER.email]);
    expect(off.code).toBe(1);
    expect(off.err).toMatch(/switched off/);
    const app = tool([OLD, OWNER.email], DATABASE_URL);
    expect(app.code).toBe(1);
    expect(app.err).toMatch(/filtered by row security/);
    expect(await counts()).toEqual(before);
  });

  it("refuses an e-mail another workspace signs in with, and names that workspace", async () => {
    const before = await counts();
    const r = tool([OLD, `  ${SIGNUP.email.toUpperCase()} `]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('another workspace');
    expect(r.err).toContain(SIGNUP.factory);
    expect(await counts()).toEqual(before);
  });

  let token = '';
  it('gives the owner on record a login — the rows sign-up makes, and no password anyone knows', async () => {
    const r = tool([OLD, `  ${OWNER.email.toUpperCase()}  `]);
    expect(r.code, r.err).toBe(0);
    token = tokenOf(r);
    expect(await loginsOf(OLD)).toEqual([{ email: OWNER.email, archived: false, name: `Westlake ${RUN}`, is_owner: true }]);
    // No second owner was made: the one on record has the login.
    expect((await admin.query(`select count(*)::int as n from people where business_id = $1`, [OLD])).rows[0].n).toBe(1);

    // The same shape as the login sign-up wrote for SIGNUP, column by column.
    const shape = async (email: string) => (await admin.query(
      `select split_part(password_hash, '$', 1) as kind, split_part(password_hash, '$', 2) as n,
              split_part(password_hash, '$', 3) as r, split_part(password_hash, '$', 4) as p,
              length(split_part(password_hash, '$', 5)) as salt, length(split_part(password_hash, '$', 6)) as key,
              failed_attempts, locked_until, last_login_at, archived_at,
              password_changed_at is not null as stamped, email = lower(btrim(email)) as normal
         from logins where email = $1`, [email])).rows[0];
    expect(await shape(OWNER.email)).toEqual(await shape(SIGNUP.email));

    // Only the link's digest is kept, and it lapses by itself.
    const link = (await admin.query(`select token_hash, expires_at, used_at, made_by from login_setups
       where login_id = (select id from logins where email = $1)`, [OWNER.email])).rows;
    expect(link).toHaveLength(1);
    expect(link[0].token_hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(link[0].used_at).toBeNull();
    expect(link[0].made_by).toBe('tools/add-login.mjs');
    const hours = (new Date(link[0].expires_at).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(71);
    expect(hours).toBeLessThanOrEqual(72);

    // Nothing signs in with it yet: the password was thrown away when it was hashed.
    expect((await signIn(OWNER.email, OWNER.password)).statusCode).toBe(401);
  });

  it('the link shows which account it is for, and opening it spends nothing', async () => {
    for (let i = 0; i < 2; i++) {
      const page = await get(`/login/set-password?t=${token}`);
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain(OWNER.email);
      expect(page.body).toContain(t('en', 'setpw.title'));
      expect(page.headers['referrer-policy']).toBe('no-referrer');
    }
    const bare = await get('/login/set-password');
    expect([bare.statusCode, bare.headers['location']], 'no link at all is the door').toEqual([302, '/login']);
    const bad = await get(`/login/set-password?t=${'x'.repeat(43)}`);
    expect(bad.statusCode).toBe(404);
    expect(bad.body).toContain(t('en', 'setpw.gone'));
  });

  it("holds the password to sign-up's rules, and a refused one spends nothing", async () => {
    const short = await form('/login/set-password', { t: token, password: 'short', repeat: 'short' });
    expect(short.statusCode).toBe(400);
    expect(short.body).toContain(t('en', 'setpw.problem.short', { n: 10 }));
    const twice = await form('/login/set-password', { t: token, password: OWNER.password, repeat: `${OWNER.password}x` });
    expect(twice.statusCode).toBe(400);
    expect(twice.body).toContain(t('en', 'setpw.problem.mismatch'));
    const mine = await form('/login/set-password', { t: token, password: OWNER.email, repeat: OWNER.email });
    expect(mine.statusCode).toBe(400);
    expect(mine.body).toContain(t('en', 'setpw.problem.is_email'));
    expect((await get(`/login/set-password?t=${token}`)).statusCode).toBe(200);
  });

  it('the owner chooses a password, then signs in on the ordinary door — and the link is spent', async () => {
    const saved = await form('/login/set-password', { t: token, password: OWNER.password, repeat: OWNER.password });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).toContain(t('en', 'login.passwordSet'));
    expect(saved.body).toContain(`value="${OWNER.email}"`);

    const door = await signIn(OWNER.email, OWNER.password);
    expect(door.statusCode).toBe(302);
    expect(door.headers['location']).toBe('/app');
    const today = await get('/app', sessionOf(door));
    expect(today.statusCode).toBe(200);
    expect(today.body).toContain(`Westlake ${RUN}`);

    const again = await form('/login/set-password', { t: token, password: 'another-password-9', repeat: 'another-password-9' });
    expect(again.statusCode).toBe(404);
    expect(again.body).toContain(t('en', 'setpw.gone'));
    expect((await signIn(OWNER.email, OWNER.password)).statusCode, 'the spent link changed nothing').toBe(302);
  });

  it("does not silently add a second login: says what is there, and changes nothing", async () => {
    const before = await counts();
    const r = tool([OLD, `second-${RUN}@westlake.example`]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('already has a login');
    expect(r.err).toContain(OWNER.email);
    expect(r.err).toContain('--replace');
    const same = tool([OLD, OWNER.email]);
    expect(same.code).toBe(1);
    expect(same.err).toContain('--reset');
    expect(await counts()).toEqual(before);
  });

  it('--reset: a fresh link for the same login; the old password works until the new one is saved', async () => {
    const first = tokenOf(tool([OLD, OWNER.email, '--reset']));
    const r = tool([OLD, OWNER.email, '--reset']);
    expect(r.code, r.err).toBe(0);
    const fresh = tokenOf(r);
    expect((await get(`/login/set-password?t=${first}`)).statusCode, 'a newer link closes the older one').toBe(404);
    expect((await signIn(OWNER.email, OWNER.password)).statusCode).toBe(302);
    const next = `westlake-new-password-${RUN}`;
    expect((await form('/login/set-password', { t: fresh, password: next, repeat: next })).statusCode).toBe(200);
    expect((await signIn(OWNER.email, OWNER.password)).statusCode).toBe(401);
    expect((await signIn(OWNER.email, next)).statusCode).toBe(302);
    OWNER.password = next;
  });

  it('--replace: the owner gets the new e-mail, the old one is archived and stops signing in', async () => {
    const moved = `moved-${RUN}@westlake.example`;
    const r = tool([OLD, moved, '--replace']);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain(`Archived: ${OWNER.email}`);
    expect(await loginsOf(OLD)).toEqual([
      { email: OWNER.email, archived: true, name: `Westlake ${RUN}`, is_owner: true },
      { email: moved, archived: false, name: `Westlake ${RUN}`, is_owner: true },
    ]);
    expect((await signIn(OWNER.email, OWNER.password)).statusCode).toBe(401);
    const pw = `moved-password-${RUN}`;
    expect((await form('/login/set-password', { t: tokenOf(r), password: pw, repeat: pw })).statusCode).toBe(200);
    expect((await signIn(moved, pw)).statusCode).toBe(302);
  });

  it('a workspace with no owner on record: asks who, then puts them on record the way sign-up does', async () => {
    const before = await counts();
    const email = `lina-${RUN}@bare.example`;
    const unnamed = tool([BARE, email]);
    expect(unnamed.code).toBe(1);
    expect(unnamed.err).toContain('--name');
    expect(await counts()).toEqual(before);

    const r = tool([BARE, email, '--name', '  Lina  ']);
    expect(r.code, r.err).toBe(0);
    expect(await loginsOf(BARE)).toEqual([{ email, archived: false, name: 'Lina', is_owner: true }]);
    const pw = `bare-password-${RUN}`;
    expect((await form('/login/set-password', { t: tokenOf(r), password: pw, repeat: pw })).statusCode).toBe(200);
    const door = await signIn(email, pw);
    expect(door.statusCode).toBe(302);
    expect((await get('/app', sessionOf(door))).statusCode).toBe(200);
  });

  it('to the application role the links do not exist', async () => {
    await expect(sql`select count(*) from login_setups`.execute(prod.db)).rejects.toThrow(/permission denied/);
    await expect(sql`update login_setups set used_at = null`.execute(prod.db)).rejects.toThrow(/permission denied/);
  });
});
