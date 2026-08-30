import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant } from './tenant.js';

/**
 * M51.2 — one budget rule, and the tested copy is the one that runs.
 *
 * `checkBudget` was pure, tested and never called, while `db/channels.ts`
 * re-implemented its pause rule in SQL inside the lateral that feeds the send
 * gate — the same policy in two places, one enforced and one merely tested.
 *
 * These assert the rule through the REAL query against REAL rows, because the
 * duplication was invisible to every test that existed: both copies agreed,
 * and agreement is exactly what makes a duplicate survive.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd512000-0000-4000-8000-${RUN}0001`;

d('M51.2 · the budget gate (requires DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  let convId = '';

  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };

  /** The real send context, through the real query. */
  const paused = async (): Promise<boolean> => {
    const { channelStore } = await import('../../src/db/channels.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return tx(async (t) => {
      const { ctx } = await channelStore(t, bid.value).load(convId);
      return ctx.paused;
    });
  };

  const setUsage = (calls: number, tokens: number) => tx((t) => sql`
    insert into usage_ledger (business_id, day, llm_calls, input_tokens, output_tokens)
    values (${BIZ}, (now() at time zone 'Asia/Shanghai')::date, ${calls}, ${tokens}, 0)
    on conflict (business_id, day) do update
      set llm_calls = excluded.llm_calls, input_tokens = excluded.input_tokens,
          output_tokens = excluded.output_tokens
  `.execute(t));

  const setBudget = (onExceeded: 'pause' | 'throttle') => tx((t) => sql`
    insert into tenant_budgets (business_id, daily_llm_calls, daily_tokens, soft_warn_pct, on_exceeded)
    values (${BIZ}, 100, 100000, 80, ${onExceeded})
    on conflict (business_id) do update set on_exceeded = excluded.on_exceeded
  `.execute(t));

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    convId = await tx(async (t) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'Budget Test Factory')
                on conflict (id) do nothing`.execute(t);
      const client = (await sql<{ id: string }>`
        insert into clients (business_id, phone, display_name)
        values (${BIZ}, ${`+8613${RUN}`}, 'Ahmed') returning id::text as id`.execute(t)).rows[0]!.id;
      return (await sql<{ id: string }>`
        insert into conversations (business_id, client_id, channel, phase)
        values (${BIZ}, ${client}::uuid, 'whatsapp', 'warm_intake') returning id::text as id
      `.execute(t)).rows[0]!.id;
    });
  }, 60_000);

  afterAll(async () => { await db?.destroy(); });

  it('NO BUDGET ROW IS NOT PAUSED — absence is "she set no ceiling"', async () => {
    expect(await paused()).toBe(false);
  });

  it('under the ceiling she keeps working', async () => {
    await setBudget('pause');
    await setUsage(50, 40_000);
    expect(await paused()).toBe(false);
  });

  it('OVER THE CEILING, with the policy set to pause, she stops', async () => {
    await setUsage(120, 40_000);
    expect(await paused()).toBe(true);
  });

  it('either axis alone is enough — calls OR tokens', async () => {
    await setUsage(50, 150_000);
    expect(await paused()).toBe(true);
  });

  it('OVER THE CEILING WITH THE POLICY SET TO THROTTLE, she does NOT stop', async () => {
    // The distinction the SQL copy also made — and the one most likely to
    // drift, because it is the only place the POLICY and the USAGE meet.
    await setBudget('throttle');
    await setUsage(120, 150_000);
    expect(await paused()).toBe(false);
  });

  it('and the answer is `checkBudget`s, not the query’s', async () => {
    const { checkBudget } = await import('../../src/core/budget.js');
    // The same inputs the row now supplies, through the pure rule: if these
    // two ever disagree, the duplication is back.
    expect(checkBudget({ llmCalls: 120, tokens: 150_000 },
      { dailyLlmCalls: 100, dailyTokens: 100_000, softWarnPct: 80, onExceeded: 'pause' }).kind)
      .toBe('pause');
    expect(checkBudget({ llmCalls: 120, tokens: 150_000 },
      { dailyLlmCalls: 100, dailyTokens: 100_000, softWarnPct: 80, onExceeded: 'throttle' }).kind)
      .toBe('throttle');
  });

  it('THE RULE LIVES IN ONE PLACE — the query no longer decides', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/db/channels.ts', import.meta.url), 'utf8');
    expect(src).toContain('checkBudget(');
    // The SQL supplies numbers now. A boolean computed in the lateral is the
    // duplicate returning.
    expect(src).not.toMatch(/\) as paused/);
    expect(src).not.toMatch(/b\.on_exceeded = 'pause'/);
  });
});
