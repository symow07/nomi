import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { randomUUID, randomInt } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * CC-10 — IF THE APP THROWS AT 3 A.M., SOMEBODY LEARNS — ONCE.
 *
 * Over Postgres and the real web error handler: a route that throws is one
 * `app_errors` row and ONE operator e-mail (the fake mailer, as in
 * backup-watch.test.ts); the same error again is a count, not an e-mail; a
 * different one is an e-mail; a secret in its message reaches neither the row
 * nor the e-mail; and the hourly limit holds — the seventh alert of an hour
 * waits, and is counted ("and N more") in the next, or sent by the sweep.
 *
 * TIME IS THE TEST'S OWN. The rule is about hours, and the table is shared by
 * everything that runs against this database, so the recorder is handed a
 * clock in a random hour far in the future: only this run's alerts are in its
 * window, and six hours pass in a line. The error NAMES carry the run id, so
 * no earlier run's row is this run's.
 *
 * And through real pg-boss: a job handler that fails is recorded by the
 * wrapper startWorker installs, and the alert job commits with the row that
 * claimed it — or neither does.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().replace(/-/g, '').slice(0, 8);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MIN = 60_000;
const H = 60 * MIN;
const SECRET_IN_ENV = `the-known-secret-${RUN}`;

type Db = import('../../src/db/client.js').Db;
type NotifyJob = import('../../src/queue/boss.js').NotifyJob;
type Row = { fingerprint: string; where: string; name: string; message: string; frame: string | null; route: string | null;
  count: string; business_id: string | null; last_alerted_at: Date | null; alert_held_at: Date | null };

d('CC-10 · errors are written down, and the operator hears of each once (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: Db;
  let app: FastifyInstance;
  let OPERATOR = '';
  const EMAIL = `operator-${RUN}@example.com`;
  // A random hour between the years 2100 and 2900: this run's own stretch of time.
  const T0 = Date.UTC(2100 + randomInt(0, 800), randomInt(0, 12), 1 + randomInt(0, 27), randomInt(0, 24));
  let clock = new Date(T0);
  const at = (ms: number) => { clock = new Date(T0 + ms); };

  const queued: NotifyJob[] = [];
  const mailbox: { to: string; subject: string; text: string }[] = [];
  const mail = { send: async (m: { to: string; subject: string; text: string }) => { mailbox.push(m); return { ok: true as const }; } };
  const adapter = { sendText: async () => ({ ok: true as const, providerMessageId: 'x' }) };
  let reporter: import('../../src/worker/appErrors.js').ErrorReporting;

  /** What the notify worker does with each queued job. */
  const deliverQueued = async () => {
    const { deliverOwnerAlert } = await import('../../src/pipeline/notify.js');
    for (const job of queued.splice(0)) await deliverOwnerAlert({ db, adapter, mail }, job);
  };
  const hit = async (url: string) => {
    const r = await app.inject({ method: 'GET', url });
    await reporter.idle();
    await deliverQueued();
    return r;
  };
  const row = async (name: string): Promise<Row | undefined> => (await sql<Row>`
    select fingerprint, "where", name, message, frame, route, count::text as count, business_id::text as business_id,
           last_alerted_at, alert_held_at
      from app_errors where name = ${name}`.execute(db)).rows[0];
  const boom = (k: string) => `Boom${RUN}${k}`;

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { provisionAccount } = await import('../../src/db/accounts.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { makeErrorReporter, appErrorNotifyJob } = await import('../../src/worker/appErrors.js');
    db = createDb(DATABASE_URL!);
    // The operator's workspace: whoever runs the installation, with a sign-in address.
    const r = await provisionAccount(db, {
      factory: `Error Alert Co ${RUN}`, language: 'en', ownerName: 'Operator', email: EMAIL,
      passwordHash: 'scrypt$16384$8$1$c2FsdA$aGFzaA', invite: null, inviteRequired: false,
      profile: { kind: 'retail', sells: 'lamps', country: 'AE', website: null, teamSize: '1', channels: [] },
    });
    if (r.code !== 'created') throw new Error(`provision: ${r.code}`);
    OPERATOR = r.businessId;

    reporter = makeErrorReporter({
      db, now: () => clock, knownSecrets: [SECRET_IN_ENV],
      // What startWorker's sink queues, collected here and delivered like the notify worker would.
      enqueue: async (a) => { queued.push(appErrorNotifyJob(OPERATOR, a)); },
    });
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: OPERATOR, accessCode: `code-${RUN}`, sessionSecret: 'a-test-session-secret-of-sufficient-length',
      employeeName: 'Lily', secureCookie: false, factsTtlMs: 0, provider: 'disabled', messagingEnabled: false,
      kickOutbound: async () => {}, reportError: reporter.report,
    } as unknown as Parameters<typeof registerWebApp>[1]);
    // Test-only routes on the same root instance, so the app's own error handler answers them.
    app.get('/test-boom', async (req) => {
      const k = (req.query as { k?: string }).k ?? 'A';
      throw Object.assign(new Error(`kaboom ${k} in run ${RUN}`), { name: boom(k) });
    });
    app.get('/test-secret', async () => {
      // Fake values, shaped only enough to meet the patterns.
      throw Object.assign(new Error(`upstream said Bearer fakebearer${RUN}0123456789 password=hunter2 key ${SECRET_IN_ENV}`), { name: boom('Secret') });
    });
    app.get('/test-refusal', async () => { throw Object.assign(new Error(`refused on purpose ${RUN}`), { statusCode: 400 }); });
    await app.ready();
  }, 60_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('a route that throws: a 500, ONE app_errors row, ONE operator e-mail', async () => {
    at(0);
    const r = await hit('/test-boom?k=A');
    expect(r.statusCode).toBe(500);
    const a = await row(boom('A'));
    expect(a).toMatchObject({ where: 'web', route: 'GET /test-boom', count: '1', message: `kaboom A in run ${RUN}` });
    expect(a!.frame).toMatch(/^tests\/integration\/app-errors\.test\.ts:\d+$/);
    expect(a!.last_alerted_at?.getTime()).toBe(T0);
    expect(mailbox).toHaveLength(1);
    expect(mailbox[0]!.to).toBe(EMAIL);
    expect(mailbox[0]!.subject).toBe(t('en', 'notify.app_error.subject'));
    expect(mailbox[0]!.text.startsWith(t('en', 'notify.app_error'))).toBe(true);
    expect(mailbox[0]!.text).toContain('web · GET /test-boom');
    expect(mailbox[0]!.text).toContain(`${boom('A')}: kaboom A in run ${RUN}`);
    expect(mailbox[0]!.text).toContain(`#${a!.fingerprint.slice(0, 12)}`);
  });

  it('the same error again within six hours is a count, not a second e-mail', async () => {
    at(1 * MIN);
    await hit('/test-boom?k=A');
    at(5 * H + 59 * MIN);
    await hit('/test-boom?k=A');
    expect((await row(boom('A')))!.count).toBe('3');
    expect(mailbox).toHaveLength(1);
  });

  it('a different error is an e-mail of its own', async () => {
    at(2 * MIN);
    await hit('/test-boom?k=B');
    expect(mailbox).toHaveLength(2);
    expect(mailbox[1]!.text).toContain(`${boom('B')}: kaboom B`);
  });

  it('a secret in the message reaches neither the row nor the e-mail', async () => {
    at(3 * MIN);
    await hit('/test-secret');
    const s = await row(boom('Secret'));
    expect(mailbox).toHaveLength(3);
    for (const text of [s!.message, mailbox[2]!.text]) {
      expect(text).toContain('[redacted]');
      expect(text).not.toContain('hunter2');
      expect(text).not.toContain(`fakebearer${RUN}`);
      expect(text).not.toContain(SECRET_IN_ENV);
    }
  });

  it('a refusal the code MEANT (a 4xx) is not an error', async () => {
    const r = await hit('/test-refusal');
    expect(r.statusCode).toBe(400);
    const n = (await sql<{ n: number }>`select count(*)::int as n from app_errors where message like ${`%refused on purpose ${RUN}%`}`.execute(db)).rows[0]!.n;
    expect(n).toBe(0);
  });

  it('SIX an hour: the seventh waits, and the next alert counts it — "and N more"', async () => {
    for (const [i, k] of ['C', 'D', 'E'].entries()) { at((4 + i) * MIN); await hit(`/test-boom?k=${k}`); }
    expect(mailbox).toHaveLength(6);                       // A, B, Secret, C, D, E — the hour is full
    at(7 * MIN); await hit('/test-boom?k=F');
    at(8 * MIN); await hit('/test-boom?k=G');
    expect(mailbox).toHaveLength(6);
    expect((await row(boom('F')))!.alert_held_at?.getTime()).toBe(T0 + 7 * MIN);
    expect((await row(boom('G')))!.alert_held_at).not.toBeNull();
    // A's alert (T0) leaves the hour's window: one slot.
    at(61 * MIN); await hit('/test-boom?k=H');
    expect(mailbox).toHaveLength(7);
    expect(mailbox[6]!.text).toContain(`${boom('H')}: kaboom H`);
    expect(mailbox[6]!.text).toContain(t('en', 'notify.app_error.more', { count: 2 }));
    expect((await row(boom('F')))!.alert_held_at).toBeNull();
    expect((await row(boom('G')))!.alert_held_at).toBeNull();
  });

  it('six hours after its last alert, the same error is news again — with its count', async () => {
    at(6 * H + 1 * MIN);
    await hit('/test-boom?k=A');
    expect(mailbox).toHaveLength(8);
    expect(mailbox[7]!.text).toContain(`${boom('A')}: kaboom A`);
    expect(mailbox[7]!.text).toContain('Times so far: 4.');
  });

  it('when the flood has STOPPED, the sweep sends the held alert once the hour has room — and only once', async () => {
    const T1 = 30 * H;
    for (let i = 1; i <= 6; i++) { at(T1 + i * MIN); await hit(`/test-boom?k=P${i}`); }
    expect(mailbox).toHaveLength(14);
    at(T1 + 7 * MIN); await hit('/test-boom?k=Q');
    expect(mailbox).toHaveLength(14);
    at(T1 + 30 * MIN); await reporter.releaseHeld(); await deliverQueued();
    expect(mailbox).toHaveLength(14);                      // the hour is still full
    at(T1 + 62 * MIN); await reporter.releaseHeld(); await deliverQueued();
    expect(mailbox).toHaveLength(15);
    expect(mailbox[14]!.text).toContain(`${boom('Q')}: kaboom Q`);
    at(T1 + 67 * MIN); await reporter.releaseHeld(); await deliverQueued();
    expect(mailbox).toHaveLength(15);
  });

  it('AT ONCE: three new errors contest the hour’s last slot — one alert, two held; a burst of one error is one alert', async () => {
    const { makeErrorReporter, appErrorNotifyJob } = await import('../../src/worker/appErrors.js');
    const T3 = 80 * H;
    const jobs: NotifyJob[] = [];
    const concurrent = (ms: number) => makeErrorReporter({
      db, now: () => new Date(T0 + ms), maxInFlight: 50,
      enqueue: async (a) => { jobs.push(appErrorNotifyJob(OPERATOR, a)); },
    });
    const err = (k: string) => Object.assign(new Error(`at once ${k}`), { name: boom(k) });
    const five = concurrent(T3);
    for (const k of ['R1', 'R2', 'R3', 'R4', 'R5']) await five.report(err(k), 'web');
    await five.idle();
    expect(jobs).toHaveLength(5);
    const race = concurrent(T3 + MIN);
    await Promise.all(['S1', 'S2', 'S3'].map((k) => race.report(err(k), 'web')));
    await race.idle();
    expect(jobs).toHaveLength(6);                                   // one slot, one winner
    const held = await Promise.all(['S1', 'S2', 'S3'].map(async (k) => (await row(boom(k)))!.alert_held_at !== null));
    expect(held.filter(Boolean)).toHaveLength(2);

    const burst = concurrent(T3 + 2 * H);
    await Promise.all(Array.from({ length: 20 }, () => burst.report(err('Burst'), 'web')));
    await burst.idle();
    expect((await row(boom('Burst')))!.count).toBe('20');           // every occurrence counted…
    expect(jobs.filter((j) => j.appError?.name === boom('Burst'))).toHaveLength(1);   // …one alert
  }, 30_000);

  it('operator data: invisible inside a workspace, and the app role cannot erase it', async () => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(OPERATOR); if (!b.ok) throw new Error('fixture');
    const pattern = `Boom${RUN}%`;
    const inside = await withTenantTx(db, b.value, (tx) =>
      sql<{ n: number }>`select count(*)::int as n from app_errors where name like ${pattern}`.execute(tx));
    expect(inside.rows[0]!.n).toBe(0);
    const outside = await sql<{ n: number }>`select count(*)::int as n from app_errors where name like ${pattern}`.execute(db);
    expect(outside.rows[0]!.n).toBeGreaterThan(10);
    await expect(sql`delete from app_errors where name like ${pattern}`.execute(db)).rejects.toThrow(/permission denied/);
  });

  it('tools/errors.mjs finds an alert’s reference', async () => {
    const a = await row(boom('A'));
    const out = execFileSync('node', ['tools/errors.mjs', '--ref', `#${a!.fingerprint.slice(0, 12)}`], {
      cwd: ROOT, encoding: 'utf8', env: { ...process.env, MIGRATE_DATABASE_URL: MIGRATE_URL! },
    });
    expect(out).toContain(`${boom('A')}: kaboom A in run ${RUN}`);
    expect(out).toContain('×4');
    expect(out).toContain('GET /test-boom');
    expect(out).toContain(`#${a!.fingerprint.slice(0, 12)}`);
  });

  describe('through real pg-boss', () => {
    let boss: import('pg-boss').PgBoss;
    const JOBS = `test.app-errors.${RUN}`;
    const ALERTS = `test.app-error-alerts.${RUN}`;

    beforeAll(async () => {
      const { PgBoss } = await import('pg-boss');
      boss = new PgBoss({ connectionString: DATABASE_URL!, schema: 'pgboss', schedule: false, supervise: false });
      boss.on('error', () => {});
      await boss.start();
      await boss.createQueue(JOBS, { retryLimit: 0 });
      await boss.createQueue(ALERTS, {});
    }, 60_000);

    afterAll(async () => {
      await boss?.offWork(JOBS).catch(() => {});
      await boss?.deleteQueue(JOBS).catch(() => {});
      await boss?.deleteQueue(ALERTS).catch(() => {});
      await boss?.stop({ graceful: false }).catch(() => {});
    });

    it('a job handler that fails is recorded as worker:<queue>, with its business, by the wrapper startWorker installs', async () => {
      const { makeErrorReporter, reportJobFailures } = await import('../../src/worker/appErrors.js');
      const live = makeErrorReporter({ db, enqueue: null });
      reportJobFailures(boss, live.report);
      await boss.work(JOBS, async () => { throw Object.assign(new Error(`job failed ${RUN}`), { name: `JobBoom${RUN}` }); });
      await boss.send(JOBS, { businessId: OPERATOR });
      let found: Row | undefined;
      for (let i = 0; i < 60 && !found; i++) {
        await new Promise((r) => setTimeout(r, 250));
        await live.idle();
        found = await row(`JobBoom${RUN}`);
      }
      expect(found).toMatchObject({ where: `worker:${JOBS}`, business_id: OPERATOR, message: `job failed ${RUN}` });
    }, 30_000);

    it('the alert job commits WITH the row that claimed it — and when the transaction fails, neither exists', async () => {
      const { makeErrorReporter, appErrorAlertsTo } = await import('../../src/worker/appErrors.js');
      // startWorker's own sink, pointed at a private queue so no other worker can take the job first.
      const toPrivateQueue = { send: (_name: string, data: object, opts: object) => boss.send(ALERTS, data, opts) };
      const sink = appErrorAlertsTo(toPrivateQueue as never, OPERATOR);
      const jobsFor = async (name: string) => (await sql<{ n: number }>`
        select count(*)::int as n from pgboss.job where name = ${ALERTS} and data->'appError'->>'name' = ${name}`.execute(db)).rows[0]!.n;
      const T2 = 50 * H;

      const ok = makeErrorReporter({ db, now: () => new Date(T0 + T2), enqueue: sink });
      await ok.report(Object.assign(new Error('queued with its row'), { name: `Queued${RUN}` }), 'web');
      await ok.idle();
      expect(await jobsFor(`Queued${RUN}`)).toBe(1);
      expect((await row(`Queued${RUN}`))!.last_alerted_at).not.toBeNull();

      const failing = makeErrorReporter({
        db, now: () => new Date(T0 + T2 + MIN), log: () => {},
        enqueue: async (a, tx) => { await sink(a, tx); throw new Error('the transaction fails after the send'); },
      });
      await failing.report(Object.assign(new Error('rolled back'), { name: `RolledBack${RUN}` }), 'web');
      await failing.idle();
      expect(await jobsFor(`RolledBack${RUN}`)).toBe(0);
      expect(await row(`RolledBack${RUN}`)).toBeUndefined();
    }, 30_000);
  });
});
