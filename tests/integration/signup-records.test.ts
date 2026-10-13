import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { offlineModels } from '../pipeline/fakes.js';
import { PASSING_BOT_CHECK } from './signUpWithCode.js';
import { dropQueuedWork } from './tenant.js';

/**
 * D1 (the data-protection audit, 2026-10-12; 0137) — A SIGN-UP IS NOT KEPT.
 *
 * A sign-up waits in `login_codes` with its whole form, the password hash
 * included, until its code comes back. Through the real composition and
 * Postgres:
 *   · finished: the form is handed back once, and the row keeps none of it;
 *   · unfinished: the form is kept while the code is open, and the form and
 *     the address go an hour after it expired (`login_codes_forget`, daily);
 *   · closing the workspace: every sign-up row for its address goes blank;
 *   · the funnel still counts them: the rows stay, with nothing in them.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const PILOT = `d1a50000-0000-4000-8000-${RUN}0001`;
const ABOUT = { kind: 'brand', sells: 'Leather goods', country: 'MA', currency: 'USD', website: '', teamSize: '1', terms: 'on', age: '34' };
const A = { factory: `Kept Not ${RUN}`, name: 'Lina', email: `lina-${RUN}@signup.example`, password: `signup-password-${RUN}`, ...ABOUT };
const B = { ...A, factory: `Left Half ${RUN}`, name: 'Omar', email: `omar-${RUN}@signup.example` };

d('D1 · a sign-up is not kept (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let admin: pg.Client;
  const outbox: { to: string; subject: string; text: string }[] = [];
  const started = new Date();
  let session = '';
  let finished = '';

  const form = (url: string, fields: Record<string, string>, cookie = '') => prod.app.inject({
    method: 'POST', url, headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
    payload: new URLSearchParams(fields).toString(),
  });
  const row = async (id: string) => (await admin.query<{ form: boolean; address: string; used: boolean; hash: boolean }>(
    `select payload is not null as form, email as address, consumed_at is not null as used,
            coalesce(payload->>'passwordHash', '') like 'scrypt$%' as hash
       from login_codes where id = $1`, [id])).rows[0]!;
  const newest = async (email: string) => (await admin.query<{ id: string }>(
    `select id::text as id from login_codes where email = $1 and purpose = 'signup' order by created_at desc limit 1`, [email])).rows[0]!.id;
  const forget = async () => Number((await admin.query<{ n: string }>(`select login_codes_forget()::text as n`)).rows[0]!.n);

  beforeAll(async () => {
    process.env['PILOT_BUSINESS_ID'] = PILOT;
    process.env['OWNER_ACCESS_CODE'] = `d1-${RUN}`;
    process.env['SIGNUP_MODE'] = 'open';
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    await admin.query(`insert into businesses (id, name) values ($1, $2) on conflict (id) do nothing`, [PILOT, `Signup Pilot ${RUN}`]);
    const { buildProduction } = await import('../../src/main.js');
    prod = await buildProduction({
      provider: 'disabled', DATABASE_URL: DATABASE_URL!,
      ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'd1-verify-token-0001',
      CREDENTIAL_KEY: 'b'.repeat(64), PORT: 0, PUBLIC_BASE_URL: 'https://nomi.test',
    }, {
      models: offlineModels(),
      logger: false,
      botCheck: PASSING_BOT_CHECK, signupGuard: null,
      systemMail: { from: 'no-reply@nomi.test', send: async (m) => { outbox.push(m); return { ok: true }; } },
    });
  }, 90_000);

  afterAll(async () => {
    delete process.env['SIGNUP_MODE'];
    if (prod) await dropQueuedWork(prod, [PILOT]);
    await admin?.end();
    await prod?.close();
  });

  it('FINISHED: the code that made the workspace hands its form back once, and the row keeps none of it', async () => {
    const asked = await form('/signup', A);
    expect([asked.statusCode, asked.headers['location']]).toEqual([302, '/verify']);
    finished = await newest(A.email);
    expect(await row(finished), 'while the code waits, the form waits with it').toMatchObject({ form: true, hash: true, used: false });

    const pending = ([] as string[]).concat(asked.headers['set-cookie'] as string | string[] ?? [])
      .map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_otp=')) ?? '';
    const code = outbox.at(-1)!.subject.match(/\d{6}/)![0];
    const ok = await form('/verify', { code }, pending);
    // Phase 3b (the owner, 2026-10-13): a new workspace lands on Getting started, the one path — no longer My business.
    expect([ok.statusCode, ok.headers['location']]).toEqual([302, '/app/guide']);
    session = ([] as string[]).concat(ok.headers['set-cookie'] as string | string[] ?? [])
      .map((c) => c.split(';')[0]!).filter((c) => c.startsWith('yf_session=')).join('; ');
    expect(session).not.toBe('');
    expect((await admin.query(`select 1 from businesses where name = $1`, [A.factory])).rowCount, 'the form made the workspace').toBe(1);
    expect(await row(finished), 'and is not kept').toMatchObject({ form: false, hash: false, used: true, address: A.email });
  });

  it('UNFINISHED: kept while its code is open; its form AND address go an hour after the code expired', async () => {
    expect((await form('/signup', B)).statusCode).toBe(302);
    const left = await newest(B.email);
    await forget();
    expect(await row(left), 'an open code keeps its form: she may still type it').toMatchObject({ form: true, hash: true, address: B.email });

    await admin.query(`update login_codes set expires_at = now() - interval '2 hours' where id = $1`, [left]);
    expect(await forget()).toBeGreaterThanOrEqual(1);
    expect(await row(left)).toMatchObject({ form: false, hash: false, address: '' });
    expect(await forget(), 'forgotten once; nothing left to forget').toBe(0);
  });

  it('A REPLACED CODE: its form goes with the rest once it has expired; the newer one still waits', async () => {
    const C = { ...B, factory: `Twice ${RUN}`, email: `twice-${RUN}@signup.example` };
    expect((await form('/signup', C)).statusCode).toBe(302);
    const first = await newest(C.email);
    expect((await form('/signup', C)).statusCode).toBe(302);
    const second = await newest(C.email);
    expect(second).not.toBe(first);
    await admin.query(`update login_codes set expires_at = now() - interval '2 hours' where id = $1`, [first]);
    await forget();
    expect(await row(first)).toMatchObject({ form: false, address: '' });
    expect(await row(second), 'the open one is untouched').toMatchObject({ form: true, address: C.email });
  });

  it('CLOSING THE WORKSPACE leaves no sign-up row for its address: the finished one, and one never finished', async () => {
    // An earlier attempt with the same address, still open when the workspace closes.
    const earlier = (await admin.query<{ id: string }>(
      `insert into login_codes (email, purpose, code_hash, payload, expires_at)
       values ($1, 'signup', 'not-a-code', $2::jsonb, now() + interval '10 minutes') returning id::text as id`,
      [A.email, JSON.stringify({ factory: A.factory, passwordHash: 'scrypt$not$real' })])).rows[0]!.id;

    const closed = await form('/app/settings/data/close', { name: A.factory, asked: '1' }, session);
    expect([closed.statusCode, closed.headers['location']], closed.body.slice(0, 200)).toEqual([302, '/closed']);
    expect((await admin.query(`select 1 from businesses where name = $1`, [A.factory])).rowCount).toBe(0);

    expect(await row(finished)).toMatchObject({ form: false, address: '' });
    expect(await row(earlier)).toMatchObject({ form: false, hash: false, address: '' });
    expect((await admin.query(`select 1 from login_codes where email = $1`, [A.email])).rowCount, 'nothing names the address').toBe(0);
  });

  it('THE FUNNEL STILL COUNTS THEM: the rows stay, with nothing in them', async () => {
    const r = (await admin.query<{ forms: number; codes_used: number }>(
      `select forms, codes_used from signup_forms_since($1)`, [started])).rows[0]!;
    // A, B, C twice, and the earlier attempt inserted above; one came back with its code.
    expect({ forms: Number(r.forms), used: Number(r.codes_used) }).toEqual({ forms: 5, used: 2 });
  });

  it('IT RUNS ONCE A DAY, in both modes', async () => {
    const s = (await admin.query<{ cron: string }>(`select cron from pgboss.schedule where name = 'ops.signup_expiry'`)).rows[0];
    expect(s?.cron).toBe('45 3 * * *');
  });
});
