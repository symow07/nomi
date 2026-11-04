import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sql } from 'kysely';
import { offlineModels } from '../pipeline/fakes.js';

/**
 * PROGRESS "A flake to watch" — a stop that outlasted 45 s, four times in CI, always in password-recovery's afterAll,
 * never reproduced and never measured. What could wait that long is known from the code: `Pool.end()` waits for every
 * connection lent out and has no limit of its own. So: a connection that is never given back, through the production
 * composition. Before each step of `close()` had a limit this stop did not end at all.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

d('a stop never waits for ever (requires DATABASE_URL)', { timeout: 60_000 }, () => {
  let prod: import('../../src/main.js').Production;

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    prod = await buildProduction({
      provider: 'disabled', DATABASE_URL: DATABASE_URL!,
      ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'stop-verify-token-01',
      CREDENTIAL_KEY: 'c'.repeat(64), PORT: 0, PUBLIC_BASE_URL: 'https://nomi.test',
    }, { models: offlineModels(), logger: false });
  }, 45_000);
  afterAll(async () => { await prod?.close(); });

  it('a connection nobody gives back: the stop goes on without it, and says which step it left and what was lent', async () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => {});   // this one is meant: no warning on the run's page
    let giveBack!: () => void;
    const until = new Promise<void>((done) => { giveBack = done; });
    let lent!: () => void;
    const holding = new Promise<void>((done) => { lent = done; });
    const held = prod.db.transaction().execute(async (tx) => {
      await sql`select 1`.execute(tx);
      lent();
      await until;
    });
    await holding;
    try {
      const began = Date.now();
      const out = await Promise.race([
        prod.close().then(() => 'stopped' as const),
        new Promise<'still waiting'>((done) => { setTimeout(() => done('still waiting'), 20_000); }),
      ]);
      expect(out).toBe('stopped');
      expect(Date.now() - began).toBeLessThan(20_000);
      const lines = said.mock.calls.map((c) => String(c[0]));
      expect(lines.filter((l) => l.includes('[stop] gave up on pool') && l.includes('app pool 1 lent'))).toHaveLength(1);
    } finally {
      giveBack();
      await held.catch(() => {});
      said.mockRestore();
    }
  });
});
