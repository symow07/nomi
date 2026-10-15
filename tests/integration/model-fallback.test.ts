import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';

/**
 * 0166 — the fallback, over Postgres (the owner, 2026-10-15: "Build a FALLBACK provider behind a flag: the system
 * fails over when the primary times out or refuses, and says so in the logs and on /health"). The real check over two
 * providers, the real record and its month of history, and the reading /health and the heartbeat share. Only the
 * providers are faked; every case is rolled back, as in model-health.test.ts.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

class Rollback extends Error {}
const timeout = () => Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' });
const CONFIGURED = {
  provider: 'DeepSeek', model: 'deepseek-flash',
  fallback: { provider: 'Anthropic', model: 'claude-haiku-5-5' },
};

d('0166 · the fallback, checked and shown (requires DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  const inTx = async (fn: (tx: import('../../src/db/client.js').Db) => Promise<void>) => {
    await db.transaction().execute(async (tx) => { await fn(tx as never); throw new Rollback(); })
      .catch((e: unknown) => { if (!(e instanceof Rollback)) throw e; });
  };

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
  });
  afterAll(async () => { await db?.destroy(); });

  it('the primary dead, the fallback answering: serving "fallback" while it is on, "none" while it is off — and the breaker opens', async () => {
    await inTx(async (tx) => {
      const { modelHealth } = await import('../../src/pipeline/modelHealth.js');
      const { readModelView } = await import('../../src/db/modelChecks.js');
      const states: string[] = [];
      const h = modelHealth({
        db: tx, log: () => {},
        providers: [
          { role: 'primary', provider: 'DeepSeek', model: 'deepseek-flash', ask: async () => { throw timeout(); } },
          { role: 'fallback', provider: 'Anthropic', model: 'claude-haiku-5-5', ask: async () => ({ tokens: 9 }) },
        ],
        onState: (role, state) => states.push(`${role}:${state}`),
      });
      await h.check();
      expect(states).toEqual(['primary:not_answering', 'fallback:answering']);
      expect(await readModelView(tx, { ...CONFIGURED, fallbackOn: true })).toMatchObject({
        model: 'not_answering', reason: 'timeout', fallback: 'answering', fallbackOn: true, serving: 'fallback',
      });
      expect(await readModelView(tx, { ...CONFIGURED, fallbackOn: false })).toMatchObject({ fallback: 'answering', fallbackOn: false, serving: 'none' });
      // No fallback configured: "off", and nobody serves while the primary is down.
      expect(await readModelView(tx, { provider: 'DeepSeek', model: 'deepseek-flash' })).toMatchObject({ fallback: 'off', serving: 'none' });
    });
  });

  it('every check is kept, both providers, and kept no longer than thirty days', async () => {
    await inTx(async (tx) => {
      const { modelHealth } = await import('../../src/pipeline/modelHealth.js');
      let t = Date.parse('2026-10-15T00:00:00Z');
      const h = modelHealth({
        db: tx, log: () => {}, now: () => new Date(t),
        providers: [
          { role: 'primary', provider: 'DeepSeek', model: 'deepseek-flash', ask: async () => { throw timeout(); } },
          { role: 'fallback', provider: 'Anthropic', model: 'claude-haiku-5-5', ask: async () => ({ tokens: 9 }) },
        ],
      });
      await sql`delete from model_check_log`.execute(tx);
      await h.check();
      t += 5 * 60_000;
      await h.check();
      const kept = (await sql<{ role: string; state: string; n: number }>`
        select role, state, count(*)::int as n from model_check_log group by role, state order by role`.execute(tx)).rows;
      expect(kept).toEqual([{ role: 'fallback', state: 'answering', n: 2 }, { role: 'primary', state: 'not_answering', n: 2 }]);
      t += 31 * 24 * 3_600_000;
      await h.check();
      expect((await sql<{ n: number }>`select count(*)::int as n from model_check_log`.execute(tx)).rows[0]!.n).toBe(2);
    });
  });
});
