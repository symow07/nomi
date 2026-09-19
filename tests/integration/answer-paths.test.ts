import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant } from './tenant.js';

/**
 * N1 — the measurement is only worth something if it reaches the row.
 *
 * Postgres proves what the parity suite cannot: that a turn's label and cost
 * are stored, that a label nobody defined is refused by the table itself, and
 * that a turn recorded the old way still records — saying nothing about itself.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd600000-0000-4000-8000-${RUN}0001`;

d('N1 · who answered, on the row (requires DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  let conv = '';

  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };
  const record = async (messageId: string, measure?: Record<string, unknown>) => {
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return tx((t) => tenantRepos(t, bid.value).audit.recordTurn({
      messageId, conversationId: conv as never, stateBefore: {}, input: { text: 'x' }, analysis: null,
      retrieved: null, decision: {}, quoteId: null, promptVersion: null, modelId: 'claude-haiku-4-5', latencyMs: 12,
      ...(measure ? { measure: measure as never } : {}),
    }));
  };
  const row = (messageId: string) => tx(async (t) => (await sql<{
    answer_path: string | null; llm_calls: number | null; input_tokens: number | null; output_tokens: number | null; analyser_avoidable: boolean | null;
  }>`select answer_path, llm_calls, input_tokens, output_tokens, analyser_avoidable from turns where message_id = ${messageId}`.execute(t)).rows[0]);

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    conv = await tx(async (t) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'Answer Paths Test Co') on conflict (id) do nothing`.execute(t);
      const client = (await sql<{ id: string }>`
        insert into clients (business_id, phone, display_name) values (${BIZ}, ${`+8613${RUN}`}, 'Ahmed') returning id::text as id`.execute(t)).rows[0]!.id;
      return (await sql<{ id: string }>`
        insert into conversations (business_id, client_id, channel, phase)
        values (${BIZ}, ${client}::uuid, 'whatsapp', 'warm_intake') returning id::text as id`.execute(t)).rows[0]!.id;
    });
  }, 60_000);

  afterAll(async () => { await db?.destroy(); });

  it('a measured turn keeps who worded it, what it cost, and whether the first call bought anything', async () => {
    await record(`n1-${RUN}-a`, { path: 'taught_answer', analyserAvoidable: true, llmCalls: 1, inputTokens: 1480, outputTokens: 96 });
    expect(await row(`n1-${RUN}-a`)).toEqual({
      answer_path: 'taught_answer', llm_calls: 1, input_tokens: 1480, output_tokens: 96, analyser_avoidable: true,
    });
  });

  it('a turn recorded the old way still records, and says nothing about itself', async () => {
    await record(`n1-${RUN}-b`);
    expect(await row(`n1-${RUN}-b`)).toEqual({
      answer_path: null, llm_calls: null, input_tokens: null, output_tokens: null, analyser_avoidable: null,
    });
  });

  it('a label nobody defined is refused by the table, not by good manners', async () => {
    await expect(record(`n1-${RUN}-c`, { path: 'magic', analyserAvoidable: false, llmCalls: 0, inputTokens: 0, outputTokens: 0 }))
      .rejects.toThrow(/turns_answer_path_check/);
  });
});
