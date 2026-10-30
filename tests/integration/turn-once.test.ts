import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { seedRunTenant, RUN_BIZ, RUN_NS, runPhone } from './tenant.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';
import type { Analyzer, VisionDescriber } from '../../src/llm/ports.js';

/**
 * B24 (audit batch 5, 2026-10-31) — ONE MESSAGE, ONE TURN, through the production composition:
 *
 *   · TWO PROCESSES, ONE BATCH. A deploy's overlap runs two workers (FAIR's one-per-workspace limit is per process).
 *     Both read the same waiting lines before either holds the conversation's lock; the second used to wait for the
 *     lock and then answer them again — a second model call, a second draft. Now the second finds them answered,
 *     under the lock, and runs nothing.
 *   · A PHOTO'S JOB RETRIED after its turn committed (the queue's send after it failed, a deploy stopped the worker)
 *     used to look at the photo again and run a whole second turn: its job carries no lines to find answered. Now a
 *     recorded turn for its message ends the job before anything is paid for.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 30_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

/** The model, held inside its first analysis until the test lets it go. */
class HeldAnalyzer extends FakeAnalyzer {
  holdNext = false;
  inside: (() => void) | null = null;
  release: (() => void) | null = null;
  override async analyze(input?: Parameters<Analyzer['analyze']>[0]) {
    if (this.holdNext) {
      this.holdNext = false;
      const gate = new Promise<void>((r) => { this.release = r; });
      this.inside?.();
      await gate;
    }
    return super.analyze(input);
  }
}

d('B24 · one message, one turn — two processes, and a retried photo (requires DATABASE_URL)', { timeout: 120_000 }, () => {
  let prod: import('../../src/main.js').Production;
  let second: Awaited<ReturnType<typeof import('../../src/worker/main.js')['startWorker']>> | null = null;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  const analyzer = new HeldAnalyzer();
  analyzer.next = {
    language: { detected: 'en', replyIn: 'en' },
    intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
    recommendedPhase: 'clarification', wantsPerson: false,
  };
  const replyWriter = new FakeReplyWriter();
  replyWriter.replies = ['Yes, we make bamboo cutting boards.'];
  let looked = 0;
  const vision: VisionDescriber = {
    async describe() {
      looked++;
      return { searchText: 'bamboo cutting board', attributes: ['bamboo'], promptVersion: 'test@1', modelId: 'fake-vision', usage: { inputTokens: 1, outputTokens: 1 } };
    },
  };

  const post = (w: { rawBody: string; headers: Record<string, string> }) =>
    prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: w.rawBody, headers: { 'content-type': 'application/json', ...w.headers } });
  const wamidOf = (w: { payload: unknown }) =>
    (w.payload as { entry: { changes: { value: { messages: { id: string }[] } }[] }[] }).entry[0]!.changes[0]!.value.messages[0]!.id;
  const tenant = async <T>(fn: (tx: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(RUN_BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(prod.db, bid.value, fn);
  };
  const conversationOf = (wamid: string) => until(() => tenant((tx) => sql<{ id: string }>`
    select conversation_id::text as id from messages where external_id = ${wamid}`.execute(tx).then((r) => r.rows[0]?.id)), 'the message');
  /** Everything the assistant produced in the conversation: drafts, and replies queued to go alone. */
  const answers = (conversationId: string) => tenant((tx) => sql<{ n: number }>`
    select (select count(*) from drafts where conversation_id = ${conversationId}::uuid)::int
         + (select count(*) from outbound_messages where conversation_id = ${conversationId}::uuid and origin = 'employee')::int as n`
    .execute(tx).then((r) => r.rows[0]!.n));
  const idle = (conversationId: string) => until(async () => {
    const r = await sql<{ n: number }>`select count(*)::int as n from pgboss.job where name = 'message.inbound' and state in ('created', 'retry', 'active')
      and data->>'conversationId' = ${conversationId}`.execute(prod.db);
    return r.rows[0]!.n === 0 ? true : undefined;
  }, 'the queue to be empty for the conversation');

  beforeAll(async () => {
    await seedRunTenant();
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator, SIM_MEDIA_BASE } = await import('../../src/channels/whatsapp/simulator.js');
    const { whatsappMediaFetcher } = await import('../../src/channels/whatsapp/media.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    sim = whatsappSimulator([], { tag: `${RUN_NS}b24` });
    const setup = createDb(DATABASE_URL!);
    const bid = parseBusinessId(RUN_BIZ); if (!bid.ok) throw new Error('fixture');
    await withTenantTx(setup, bid.value, (tx) => sql`
      insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
      values (${RUN_BIZ}, 'whatsapp', ${sim.phoneNumberId}, 'sim-test', 'service')
      on conflict (channel, external_ref) do nothing`.execute(tx));
    await setup.destroy();
    const media = { baseUrl: SIM_MEDIA_BASE, apiKey: 'sim', fetchImpl: sim.mediaFetch };
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'b24-verify-token-xx', CREDENTIAL_KEY: 'a'.repeat(64), PORT: 0,
    }, { adapter: sim.adapter, logger: false, media: { image: whatsappMediaFetcher(media) }, models: { analyzer, replyWriter, vision } });
  }, 60_000);

  afterAll(async () => {
    analyzer.release?.();
    if (second) { await second.boss.stop({ graceful: true, timeout: 10_000 }).catch(() => {}); await second.db.destroy().catch(() => {}); }
    await prod?.close();
  });

  it('two processes holding the same batch: the second finds it answered under the lock — the lines answered once', async () => {
    const { startWorker } = await import('../../src/worker/main.js');
    // The second process: the same database and queue, the same scripted model.
    second = await startWorker({ DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid' }, {}, { analyzer, replyWriter, vision });

    const LINE = 'Do you make bamboo cutting boards?';
    try {
      analyzer.holdNext = true;
      const inside = new Promise<void>((r) => { analyzer.inside = r; });
      const from = runPhone('971500009947');
      const w = sim.inboundText({ from, text: LINE });
      expect((await post(w)).statusCode).toBe(200);
      const conversationId = await conversationOf(wamidOf(w));
      // One process is inside the batch's turn, holding the conversation's lock, its line not yet marked answered.
      await inside;
      // A photo from the same customer, now. Its job takes no lock before it reads the lines still waiting (a photo
      // answers them first: flushPendingText), so the other process reads THIS batch as unanswered and then waits for
      // the lock — exactly the two-process race, made certain.
      const photo = sim.inboundImage({ from, caption: null });
      expect((await post(photo)).statusCode).toBe(200);
      // This conversation's own lock (lockConversation: hashtextextended(id, 0)), asked for and not granted — never
      // pg-boss's advisory locks, which come and go on their own.
      await until(async () => {
        const r = await sql<{ n: number }>`select count(*)::int as n from pg_locks
          where locktype = 'advisory' and not granted and objsubid = 1
            and ((classid::bigint << 32) | objid::bigint) = hashtextextended(${conversationId}, 0)`.execute(prod.db);
        return r.rows[0]!.n > 0 ? true : undefined;
      }, 'the second process to wait for the conversation\'s lock');
      analyzer.release!();
      await idle(conversationId);
      // The line went to the model once; the conversation has two answers — the line's and the photo's — never three.
      expect(analyzer.texts.filter((t) => t === LINE)).toHaveLength(1);
      expect(await answers(conversationId)).toBe(2);
    } finally {
      // The second process leaves, pass or fail: every job after this is production's own, which can see photos.
      analyzer.release?.();
      await second!.boss.stop({ graceful: true, timeout: 10_000 }).catch(() => {});
      await second!.db.destroy().catch(() => {});
      second = null;
    }
  });

  it('the audit\'s polish item · Stop pressed while the model writes: no draft — the turn is the hold\'s, handed to a person', async () => {
    const LINE = 'Can you do these in walnut?';
    analyzer.holdNext = true;
    const inside = new Promise<void>((r) => { analyzer.inside = r; });
    const w = sim.inboundText({ from: runPhone('971500009949'), text: LINE });
    expect((await post(w)).statusCode).toBe(200);
    const conversationId = await conversationOf(wamidOf(w));
    await inside;                       // the hold was read, the turn began, the model is writing…
    await tenant((tx) => sql`update businesses set assistant_stopped_at = now() where id = ${RUN_BIZ}::uuid`.execute(tx));
    try {
      analyzer.release!();
      await idle(conversationId);
      expect(await answers(conversationId)).toBe(0);
      const signals = await tenant((tx) => sql<{ kind: string }>`select kind from conversation_signals
        where conversation_id = ${conversationId}::uuid and resolved_at is null`.execute(tx).then((r) => r.rows.map((x) => x.kind)));
      expect(signals).toContain('assistant_stopped');
      const turn = await tenant((tx) => sql<{ kind: string; reason: string; waiting: number }>`
        select t.decision->'action'->>'kind' as kind, t.decision->'action'->>'reason' as reason,
               (select count(*) from message_fragments f where f.conversation_id = ${conversationId}::uuid and f.processed_in is null)::int as waiting
          from turns t where t.conversation_id = ${conversationId}::uuid`.execute(tx).then((r) => r.rows[0]));
      expect(turn).toEqual({ kind: 'held', reason: 'assistant_stopped', waiting: 0 });
    } finally {
      await tenant((tx) => sql`update businesses set assistant_stopped_at = null where id = ${RUN_BIZ}::uuid`.execute(tx));
    }
  });

  it('a photo\'s job delivered again after its turn committed: nothing is looked at again, nothing answered twice', async () => {
    looked = 0;
    const { QUEUES, inboundGroup } = await import('../../src/queue/boss.js');
    const w = sim.inboundImage({ from: runPhone('971500009948'), caption: null });
    expect((await post(w)).statusCode).toBe(200);
    const wamid = wamidOf(w);
    const conversationId = await conversationOf(wamid);
    await until(async () => ((await answers(conversationId)) > 0 ? true : undefined), 'an answer to the photo');
    await idle(conversationId);
    expect(looked).toBe(1);
    const calls = analyzer.calls;
    // The retry: the very job the webhook queued, once more.
    const job = (await sql<{ data: Record<string, unknown> }>`select data from pgboss.job where name = 'message.inbound'
      and data->>'messageId' = ${wamid} order by created_on limit 1`.execute(prod.db)).rows[0]!.data;
    const id = await prod.boss.send(QUEUES.inbound, job, { group: inboundGroup(RUN_BIZ) });
    await until(async () => {
      const r = await sql<{ state: string }>`select state from pgboss.job where id = ${id}::uuid`.execute(prod.db);
      return r.rows[0]?.state === 'completed' ? true : undefined;
    }, 'the retried job to complete');
    expect(looked).toBe(1);
    expect(analyzer.calls).toBe(calls);
    expect(await answers(conversationId)).toBe(1);
  });
});
