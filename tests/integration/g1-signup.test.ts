import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import Fastify from 'fastify';
import { offlineModels } from '../pipeline/fakes.js';
import { PASSING_BOT_CHECK } from './signUpWithCode.js';

/**
 * G1 — A STRANGER SIGNS UP, end to end: the real composition, real Postgres,
 * and a mailbox that records what would have been sent.
 *
 *   · Without the terms ticked, nothing is sent and nothing is made.
 *   · With them: a code, then the workspace — recorded as made by sign-up,
 *     under the version of the terms she saw — and the operator is told.
 *   · Past the cohort cap, sign-up says it is full and makes nothing.
 *   · Open sign-up with no sender to mail codes reads as closed.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const PILOT = `a1990000-0000-4000-8000-${RUN}0001`;
const OPERATOR = `operator-${RUN}@nomi.example`;
const ABOUT = { kind: 'brand', sells: 'Leather bags', country: 'AE', website: 'https://saffron.example', teamSize: '2-5' };
const A = { factory: `Saffron Leather ${RUN}`, name: 'Huda', email: `huda-${RUN}@saffron.example`, password: `saffron-password-${RUN}`, ...ABOUT };
const B = { ...A, factory: `Second Shop ${RUN}`, email: `second-${RUN}@shop.example`, terms: 'on', age: '34' };
const C = { ...A, factory: `Late Shop ${RUN}`, email: `late-${RUN}@shop.example`, terms: 'on', age: '34' };

d('G1 · a stranger signs up (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  let admin: pg.Client;
  const outbox: { to: string; subject: string; text: string }[] = [];
  const errorAlerts: { to: string; subject: string; text: string }[] = [];
  const form = (url: string, fields: Record<string, string>, cookie = '') => prod.app.inject({
    method: 'POST', url, headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': `203.0.113.${RUN.charCodeAt(1) % 200}`, ...(cookie ? { cookie } : {}) },
    payload: new URLSearchParams(fields).toString(),
  });
  const otpCookie = (r: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat(r.headers['set-cookie'] as string | string[] ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_otp=')) ?? '';

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    // The operator: the installation's business, with an owner who signs in by e-mail.
    await admin.query(`insert into businesses (id, name, owner_locale) values ($1, $2, 'en') on conflict (id) do nothing`, [PILOT, `G1 Pilot ${RUN}`]);
    const person = (await admin.query(`insert into people (business_id, name, is_owner) values ($1, 'Operator', true) returning id`, [PILOT])).rows[0].id;
    await admin.query(`insert into logins (business_id, person_id, email, password_hash) values ($1, $2, $3, 'scrypt$never-used')`, [PILOT, person, OPERATOR]);
    // Room for exactly one more self-serve workspace.
    const n = (await admin.query(`select count(*)::int as n from businesses where signed_up_at is not null and practice_of is null`)).rows[0].n;
    process.env['PILOT_BUSINESS_ID'] = PILOT;
    process.env['OWNER_ACCESS_CODE'] = `g1-${RUN}`;
    process.env['SIGNUP_MODE'] = 'open';
    process.env['SIGNUP_CAP'] = String(n + 1);
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    // The messaging composition, as production runs: the daily jobs' workers start there.
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'g1-verify-token-0001',
      CREDENTIAL_KEY: 'b'.repeat(64), PORT: 0, PUBLIC_BASE_URL: 'https://nomi.test',
    }, {
      adapter: whatsappSimulator([], { tag: `g1${RUN}` }).adapter, media: {},
      models: offlineModels(), logger: false,
      // The installation's own error alerts go to the same operator by the same
      // sender: the suite fails on purpose elsewhere, and a held one can be
      // released while this file runs (found 2026-10-01 on CI's second pass).
      // They are kept apart — this file is about sign-up mail.
      // BOT — a passing check, and no database limits: this file signs many up within the hour.
      botCheck: PASSING_BOT_CHECK, signupGuard: null,
      systemMail: { from: 'no-reply@nomi.test', send: async (m) => {
        (m.subject === t('en', 'notify.app_error.subject') ? errorAlerts : outbox).push(m); return { ok: true };
      } },
    } as Parameters<typeof buildProduction>[1]);
  }, 90_000);
  afterAll(async () => {
    for (const k of ['SIGNUP_MODE', 'SIGNUP_CAP']) delete process.env[k];
    await admin?.end(); await prod?.close();
  });

  it('WITHOUT THE TERMS TICKED, nothing is sent and nothing is made', async () => {
    const r = await form('/signup', A);
    expect(r.statusCode).toBe(400);
    expect(r.body).toContain(t('en', 'signup.problem.terms_missing'));
    expect(outbox).toHaveLength(0);
  });

  it('AGE: under 18, the sign-up is refused before anything is sent or made; that browser is told for a day, whatever it types next', async () => {
    const young = { ...A, factory: `Young Shop ${RUN}`, email: `young-${RUN}@shop.example`, terms: 'on', age: '15' };
    // its own address, so the hour's sign-up limit for this file's address is not spent here
    const post = (fields: Record<string, string>, cookie = '') => prod.app.inject({
      method: 'POST', url: '/signup', payload: new URLSearchParams(fields).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '198.51.100.7', ...(cookie ? { cookie } : {}) },
    });
    const r = await post(young);
    expect(r.statusCode).toBe(403);
    expect(r.body).toContain(t('en', 'signup.problem.age_under'));
    expect(r.body).not.toContain('action="/signup"');                    // no form to answer again
    const told = ([] as string[]).concat(r.headers['set-cookie'] as string | string[] ?? []).find((c) => c.startsWith('yf_age_told=')) ?? '';
    expect(told).toMatch(/^yf_age_told=1; Max-Age=86400; Path=\/signup; HttpOnly; SameSite=Lax/);
    const cookie = told.split(';')[0]!;
    // the same browser, older now: still refused; and the page itself says so
    expect((await post({ ...young, age: '34' }, cookie)).statusCode).toBe(403);
    const page = await prod.app.inject({ method: 'GET', url: '/signup', headers: { cookie } });
    expect(page.statusCode).toBe(403);
    expect(page.body).toContain(t('en', 'signup.problem.age_under'));
    // nothing was sent, nothing was made
    expect(outbox).toHaveLength(0);
    expect((await admin.query(`select 1 from businesses where name = $1`, [young.factory])).rowCount).toBe(0);
  });

  it('WITH THEM: a code, then the workspace — made by sign-up, under the terms she saw — and the operator is told', async () => {
    const { TERMS_VERSION } = await import('../../src/api/web/legal.js');
    const r = await form('/signup', { ...A, terms: 'on', age: '34' });
    expect([r.statusCode, r.headers['location']]).toEqual([302, '/verify']);
    const code = outbox.at(-1)!.subject.match(/\d{6}/)![0];
    // Another stranger asks while the last place is still free…
    const late = await form('/signup', C);
    expect([late.statusCode, late.headers['location']]).toEqual([302, '/verify']);
    const lateCode = outbox.at(-1)!.subject.match(/\d{6}/)![0];
    const ok = await form('/verify', { code }, otpCookie(r));
    expect(ok.statusCode, ok.body.slice(0, 200)).toBe(302);
    // …and comes back with the code after it was taken: counted again, under the lock, and nothing made.
    const full = await form('/verify', { code: lateCode }, otpCookie(late));
    expect(full.statusCode).toBe(400);
    expect(full.body).toContain(t('en', 'signup.error.full'));
    expect((await admin.query(`select 1 from businesses where name = $1`, [C.factory])).rowCount).toBe(0);
    const made = (await admin.query(`select signed_up_at, terms_version, terms_accepted_at, owner_adult_at from businesses where name = $1`, [A.factory])).rows[0];
    expect(made.signed_up_at).not.toBeNull();
    expect(made.owner_adult_at).not.toBeNull();                         // AGE — that the age passed, and when; never the age
    expect(made.terms_version).toBe(TERMS_VERSION);
    expect(made.terms_accepted_at).not.toBeNull();
    const told = await (async () => {
      for (let i = 0; i < 50; i++) {
        const m = outbox.find((x) => x.to === OPERATOR);
        if (m) return m;
        await new Promise((res) => setTimeout(res, 100));
      }
      return undefined;
    })();
    expect(told?.subject).toBe(t('en', 'notify.signup_new.subject'));
    expect(told?.text).toBe([
      t('en', 'notify.signup_new', { business: A.factory, kind: t('en', 'business.kind.brand'), country: 'AE' }),
      t('en', 'notify.signup_new.sells', { sells: 'Leather bags' }),
      t('en', 'notify.signup_new.website', { website: 'https://saffron.example' }),
    ].join('\n'));
    // The day's list has her in it.
    const since = (await admin.query(`select name from signups_since(now() - interval '1 hour')`)).rows.map((x) => x.name);
    expect(since).toContain(A.factory);
  });

  it('THE DAILY LIST has her in it, and reaches the operator by e-mail through the real alert worker', async () => {
    const { QUEUES } = await import('../../src/queue/boss.js');
    const { signupDigestAlert } = await import('../../src/pipeline/signupDigest.js');
    const job = await signupDigestAlert(prod.db, PILOT, new Date());
    expect(job?.signups?.map((s) => s.business)).toContain(A.factory);
    // A day later she is not on it.
    const later = await signupDigestAlert(prod.db, PILOT, new Date(Date.now() + 25 * 3_600_000));
    expect(later?.signups?.map((s) => s.business) ?? []).not.toContain(A.factory);
    // The cron's own job is throttled to one a day (and a leftover from an
    // earlier run may already have used it), so the list goes straight to the
    // alert queue: the same worker, the same mail. Two things about the
    // database must not decide it (found 2026-10-01): the digest names the
    // day's OLDEST 25, and a database other runs signed up on today has more —
    // so the list sent is hers alone; and jobs an earlier file left on the
    // queue run one per poll ahead of it — so it goes first.
    await prod.boss.send(QUEUES.notify, { ...job!, signups: job!.signups!.filter((s) => s.business === A.factory) }, { priority: 10 });
    const line = `${A.factory} (${t('en', 'business.kind.brand')}, AE)`;
    let digest: { to: string; subject: string; text: string } | undefined;
    for (let i = 0; i < 100 && !digest; i++) {
      digest = outbox.find((x) => x.to === OPERATOR && x.subject === t('en', 'notify.signup_digest.subject') && x.text.includes(line));
      if (!digest) await new Promise((res) => setTimeout(res, 100));
    }
    expect(digest, 'the digest was mailed').toBeDefined();
  }, 30_000);

  it('PAST THE COHORT CAP, sign-up says it is full and makes nothing', async () => {
    const before = outbox.length;
    const r = await form('/signup', B);
    expect(r.statusCode).toBe(403);
    expect(r.body).toContain(t('en', 'signup.error.full'));
    expect(outbox.length, 'no code is sent for a place there is not').toBe(before);
    expect((await admin.query(`select 1 from businesses where name = $1`, [B.factory])).rowCount).toBe(0);
  });

  it('OPEN SIGN-UP WITH NO SENDER to mail codes reads as closed', async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const db = createDb(DATABASE_URL!);
    const app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: PILOT, accessCode: `g1-other-${RUN}`, sessionSecret: 'a-test-session-secret-of-sufficient-length',
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', signupMode: 'open',
      secureCookie: false, messagingEnabled: false, kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const page = await app.inject({ method: 'GET', url: '/signup' });
    expect(page.body).toContain(t('en', 'signup.closed'));
    expect(page.body).not.toContain('name="terms"');
    const tried = await app.inject({ method: 'POST', url: '/signup', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ ...B, email: `third-${RUN}@shop.example` }).toString() });
    expect(tried.statusCode).toBe(403);
    await app.close(); await db.destroy();
  });
});
