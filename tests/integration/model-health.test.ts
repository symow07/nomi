import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';

/**
 * 0165 — the model's health is what a real call said (the owner, 2026-10-15: "/health reported 'answering' while
 * every single call failed. That is worse than the outage… FIX THE HEALTH CHECK FIRST").
 *
 * Over Postgres, with the real record (`model_checks`), the real check and the real reading `/health` and the
 * heartbeat share (`readModelView`). Only the provider is faked. `model_checks` is the installation's, one row per
 * role, so every case runs in a transaction that is rolled back: no other file ever sees a row from here.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

class Rollback extends Error {}
const timeout = () => Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' });

d('0165 · the model\'s health is what a real call said (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  /** The billing record (0128) is the app role's to read, not to write: the cases that set it use the admin role. */
  let admin: import('../../src/db/client.js').Db;

  /** One case, in a transaction rolled back at the end. */
  const inTx = async (fn: (tx: import('../../src/db/client.js').Db) => Promise<void>, on = db) => {
    await on.transaction().execute(async (tx) => { await fn(tx as never); throw new Rollback(); })
      .catch((e: unknown) => { if (!(e instanceof Rollback)) throw e; });
  };
  const health = async (tx: import('../../src/db/client.js').Db, providers: Parameters<typeof import('../../src/pipeline/modelHealth.js').modelHealth>[0]['providers'], clock?: () => Date) => {
    const { modelHealth } = await import('../../src/pipeline/modelHealth.js');
    return modelHealth({ db: tx, providers, log: () => {}, ...(clock ? { now: clock } : {}) });
  };
  const CONFIGURED = { provider: 'DeepSeek', model: 'deepseek-flash' };
  const view = async (tx: import('../../src/db/client.js').Db, at?: Date) =>
    (await import('../../src/db/modelChecks.js')).readModelView(tx, CONFIGURED, at);
  const provider = (ask: (() => Promise<{ tokens: number }>) | null) =>
    ({ role: 'primary' as const, provider: 'DeepSeek', model: 'deepseek-flash', ask });

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    admin = createDb(MIGRATE_URL!);
  });
  afterAll(async () => { await db?.destroy(); await admin?.destroy(); });

  it('THE DAY IT LIED — no billing refusal on record, every call times out: not answering, timeout (it said "answering")', async () => {
    await inTx(async (tx) => {
      const { providerRefusing } = await import('../../src/db/providerState.js');
      await sql`update provider_health set refusing_since = null, reason = null`.execute(tx);
      expect(await providerRefusing(tx)).toBe(false);          // what /health read before 0165: "answering"
      const h = await health(tx, [provider(async () => { throw timeout(); })]);
      await h.check();
      expect(await view(tx)).toMatchObject({ model: 'not_answering', reason: 'timeout', ms: null });
      const { modelServes } = await import('../../src/core/ops/modelHealth.js');
      expect(modelServes((await view(tx)).model)).toBe(false);   // the heartbeat pings /fail
    }, admin);
  });

  it('the check: answering in time, slow past five seconds, its tokens counted on the row and on no workspace', async () => {
    await inTx(async (tx) => {
      let t = Date.parse('2026-10-15T10:00:00Z');
      const clock = () => new Date(t);
      let delay = 700;
      const h = await health(tx, [provider(async () => { t += delay; return { tokens: 9 }; })], clock);
      await h.check();
      expect(await view(tx, clock())).toMatchObject({ model: 'answering', ms: 700 });
      delay = 6_000;
      await h.check();
      expect(await view(tx, clock())).toMatchObject({ model: 'slow', ms: 6_000 });
      const counted = (await sql<{ probes: string; probe_tokens: string }>`
        select probes::text, probe_tokens::text from model_checks where role = 'primary'`.execute(tx)).rows[0]!;
      expect(counted).toEqual({ probes: '2', probe_tokens: '18' });
      // Twelve minutes with nobody checking: unknown, never answering.
      expect((await view(tx, new Date(t + 12 * 60_000 + 1))).model).toBe('unknown');
    });
  });

  it('every real call: a timeout is written the moment it happens; the same state again is not rewritten within a minute; a 400 says nothing', async () => {
    await inTx(async (tx) => {
      let t = Date.parse('2026-10-15T11:00:00Z');
      const clock = () => new Date(t);
      const h = await health(tx, [provider(null)], clock);
      const call = h.callsOf('primary');
      const at = async () => (await sql<{ checked_at: Date; state: string; source: string }>`
        select checked_at, state, source from model_checks where role = 'primary'`.execute(tx)).rows[0];
      call({ ok: true, ms: 1_200 });
      await h.settled();
      expect((await view(tx, clock())).model).toBe('answering');
      t += 5_000;
      call({ ok: false, ms: 30_000, failure: 'timeout', status: null });
      await h.settled();
      expect(await at()).toMatchObject({ state: 'not_answering', source: 'call' });
      const first = (await at())!.checked_at.getTime();
      t += 10_000;
      call({ ok: false, ms: 30_000, failure: 'timeout', status: null });   // same state, within a minute
      call({ ok: false, ms: 200, failure: 'other', status: 400 });         // our request: nothing
      await h.settled();
      expect((await at())!.checked_at.getTime()).toBe(first);
      t += 61_000;
      call({ ok: true, ms: 2_000 });
      await h.settled();
      expect((await view(tx, clock())).model).toBe('answering');
    });
  });

  it('an older outcome never overwrites a newer one, and billing refusal on record still wins', async () => {
    await inTx(async (tx) => {
      const { recordModelCheck } = await import('../../src/db/modelChecks.js');
      const base = { role: 'primary' as const, provider: 'DeepSeek', model: 'deepseek-flash', reason: null, source: 'call' as const };
      await recordModelCheck(tx, { ...base, state: 'answering', ms: 900, at: new Date('2026-10-15T12:00:10Z') });
      await recordModelCheck(tx, { ...base, state: 'not_answering', ms: null, reason: 'timeout', at: new Date('2026-10-15T12:00:05Z') });
      expect((await view(tx, new Date('2026-10-15T12:01:00Z'))).model).toBe('answering');
      await sql`update provider_health set refusing_since = now(), reason = 'billing'`.execute(tx);
      expect((await view(tx, new Date('2026-10-15T12:01:00Z'))).model).toBe('refusing');
    }, admin);
  });

  it('a row about another provider or model says nothing about this one: unknown', async () => {
    await inTx(async (tx) => {
      const { recordModelCheck, readModelView } = await import('../../src/db/modelChecks.js');
      await recordModelCheck(tx, { role: 'primary', provider: 'DeepSeek', model: 'deepseek-flash', state: 'answering', ms: 800,
        reason: null, source: 'probe', at: new Date('2026-10-15T13:00:00Z') });
      const at = new Date('2026-10-15T13:01:00Z');
      expect((await readModelView(tx, CONFIGURED, at)).model).toBe('answering');
      expect((await readModelView(tx, { provider: 'Anthropic', model: 'claude-haiku-5-5' }, at)).model).toBe('unknown');
      expect((await readModelView(tx, { provider: 'DeepSeek', model: 'deepseek-chat' }, at)).model).toBe('unknown');
    });
  });
});
