import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant } from './tenant.js';

/**
 * G19 · M51.2 — her ceiling reaches TODAY.
 *
 * The send gate's half of this rule is tests/integration/budget.test.ts: over
 * the ceiling, with the policy set to pause, she stops. This is the other half,
 * the one that was missing — the warning that arrives BEFORE the stop.
 *
 * The verdict comes from `core/budget.ts`, the numbers from `usage_ledger` and
 * `tenant_budgets`, and the send gate reads exactly the same pair. Only Postgres
 * can show that the loader reads her row, in her timezone, and that a tenant who
 * set no ceiling is told nothing rather than warned about a default.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd191000-0000-4000-8000-${RUN}0001`;
const QUIET = `dd191000-0000-4000-8000-${RUN}0002`;

d('G19 · the budget warning reaches Today (requires DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;

  const tx = async <T>(biz: string, fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(biz); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };
  const snapshot = async (biz: string) => {
    const { loadOperationsSnapshot } = await import('../../src/api/web/operations.js');
    return loadOperationsSnapshot(db, biz, 'today', 'meta');
  };

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    for (const [id, name] of [[BIZ, 'Budget Factory'], [QUIET, 'No Ceiling Factory']] as const) {
      await tx(id, (t) => sql`insert into businesses (id, name) values (${id}, ${name})
                              on conflict (id) do nothing`.execute(t));
    }
    await tx(BIZ, async (t) => {
      await sql`insert into tenant_budgets (business_id, daily_llm_calls, daily_tokens, soft_warn_pct, on_exceeded)
                values (${BIZ}, 100, 1000000, 80, 'pause')
                on conflict (business_id) do update set daily_llm_calls = 100, on_exceeded = 'pause'`.execute(t);
      // 84 of her 100 calls, dated in HER day, not the server's.
      await sql`insert into usage_ledger (business_id, day, llm_calls, input_tokens, output_tokens, turns)
                values (${BIZ}, (now() at time zone 'Asia/Shanghai')::date, 84, 1000, 500, 84)
                on conflict (business_id, day) do update set llm_calls = 84`.execute(t);
    });
  }, 60_000);

  afterAll(async () => { await db?.destroy(); });

  it('past her soft-warn line, Today carries the percentage and what her setting does', async () => {
    const s = await snapshot(BIZ);
    expect(s.budget).toEqual({ pctUsed: 84, stops: true });
  });

  it('a tenant who set NO ceiling is told nothing — absence is not a default', async () => {
    const s = await snapshot(QUIET);
    expect(s.budget).toBeNull();
  });

  it('below the line she set, nothing is said', async () => {
    await tx(BIZ, (t) => sql`update usage_ledger set llm_calls = 12
                              where business_id = ${BIZ} and day = (now() at time zone 'Asia/Shanghai')::date`.execute(t));
    expect((await snapshot(BIZ)).budget).toBeNull();
  });

  it('and past 100% it still speaks — the day she most needs to know', async () => {
    await tx(BIZ, (t) => sql`update usage_ledger set llm_calls = 140
                              where business_id = ${BIZ} and day = (now() at time zone 'Asia/Shanghai')::date`.execute(t));
    expect((await snapshot(BIZ)).budget).toEqual({ pctUsed: 100, stops: true });
  });

  it('it is a notice, not attention: it never turns a quiet day into a work list', async () => {
    const s = await snapshot(BIZ);
    expect(s.budget).not.toBeNull();
    expect(s.hasAttention).toBe(false);
  });
});
