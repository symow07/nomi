import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { runDigits } from './tenant.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';

/**
 * Q1 — THE ANALYSER SEES WHAT WAS SAID BEFORE (the one-month build order,
 * 2026-09-29), against Postgres: the repository's own query, and the whole way
 * through the production worker (a signed webhook → pg-boss → the worker → the
 * turn), where the batch's own messages must not come back as their history.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd710000-0000-4000-8000-${RUN}0001`;
const OTHER = `dd710000-0000-4000-8000-${RUN}0002`;

type Db = import('../../src/db/client.js').Db;
type Tx = import('../../src/db/client.js').Tx;

const inTenant = async <R>(db: Db, biz: string, fn: (tx: Tx) => Promise<R>): Promise<R> => {
  const { withTenantTx } = await import('../../src/db/client.js');
  const { parseBusinessId } = await import('../../src/core/types/ids.js');
  const b = parseBusinessId(biz); if (!b.ok) throw new Error('fixture');
  return withTenantTx(db, b.value, fn);
};
/** The same wait the metering test explains: the queue is shared with earlier files' leftovers. */
const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 90_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

d('Q1 · the repository reads the history (requires DATABASE_URL)', () => {
  let db: Db;
  let conv = '';

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    for (const [id, name] of [[BIZ, 'History Shop'], [OTHER, 'Another Shop']] as const) {
      await inTenant(db, id, (x) => sql`insert into businesses (id, name) values (${id}, ${name}) on conflict (id) do nothing`.execute(x));
    }
    conv = await inTenant(db, BIZ, async (x) => {
      const client = (await sql<{ id: string }>`insert into clients (business_id, phone, display_name)
        values (${BIZ}, ${`+97154${runDigits(RUN, 6)}`}, 'Maya') returning id::text as id`.execute(x)).rows[0]!.id;
      const c = (await sql<{ id: string }>`insert into conversations (business_id, client_id, channel)
        values (${BIZ}, ${client}::uuid, 'whatsapp') returning id::text as id`.execute(x)).rows[0]!.id;
      // Oldest first, a minute apart; each row: [direction, text, transcription, external id, duplicate]
      const rows: [string, string | null, string | null, string | null, boolean][] = [
        ['inbound', 'the very first message', null, 'w-1', false],
        ['outbound', 'Hello! How can we help?', null, null, false],
        ['inbound', 'Do you make canvas totes?', null, 'w-3', false],
        ['inbound', 'Do you make canvas totes?', null, 'w-3b', true],          // a duplicate delivery
        ['outbound', 'Yes — 12oz natural or black.', null, null, false],
        ['inbound', '', 'natural, please, the twelve ounce one', 'w-5', false],  // a voice note: its transcript
        ['outbound', 'x'.repeat(1500), null, null, false],                     // a pasted list
        ['inbound', 'and with a zip?', null, 'w-7', false],
        ['inbound', 'how much for 500?', null, 'w-9', false],                  // this turn's batch
        ['inbound', 'delivered to Dubai', null, 'w-10', false],                // this turn's batch
      ];
      for (let i = 0; i < rows.length; i++) {
        const [dir, text, heard, ext, dup] = rows[i]!;
        await sql`insert into messages (conversation_id, direction, input_type, text_content, transcription, external_id, is_duplicate, sent_at)
          values (${c}::uuid, ${dir}, ${heard ? 'voice_transcribed' : 'text'}, ${text}, ${heard}, ${ext}, ${dup},
                  now() - make_interval(mins => ${rows.length - i}))`.execute(x);
      }
      return c;
    });
  }, 60_000);
  afterAll(async () => { await db?.destroy(); });

  it('the six before this turn, both sides, oldest first; no duplicate; a voice note by its transcript; a long one cut', async () => {
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    const got = await inTenant(db, BIZ, (x) => tenantRepos(x, b.value).conversations.recentMessages(conv as never, {
      limit: 6, excluding: ['w-10', 'w-9', 'w-10'],
    }));
    expect(got).toEqual([
      { direction: 'outbound', text: 'Hello! How can we help?' },
      { direction: 'inbound', text: 'Do you make canvas totes?' },
      { direction: 'outbound', text: 'Yes — 12oz natural or black.' },
      { direction: 'inbound', text: 'natural, please, the twelve ounce one' },
      { direction: 'outbound', text: 'x'.repeat(1000) },
      { direction: 'inbound', text: 'and with a zip?' },
    ]);
  });

  it('another business sees none of it', async () => {
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const o = parseBusinessId(OTHER); if (!o.ok) throw new Error('fixture');
    expect(await inTenant(db, OTHER, (x) => tenantRepos(x, o.value).conversations.recentMessages(conv as never, { limit: 6, excluding: [] })))
      .toEqual([]);
  });
});

d('Q1 · through the production worker (requires DATABASE_URL)', () => {
  const SHOP = `dd710000-0000-4000-8000-${RUN}0003`;
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  const analyzer = new FakeAnalyzer();
  analyzer.next = {
    language: { detected: 'en', replyIn: 'en' },
    intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
    recommendedPhase: 'clarification',
  };
  const post = (w: { rawBody: string; headers: Record<string, string> }) =>
    prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: w.rawBody,
      headers: { 'content-type': 'application/json', ...w.headers } });
  const asked = (text: string) => until(async () => {
    const i = analyzer.texts.indexOf(text);
    return i === -1 ? undefined : analyzer.histories[i]!;
  }, `the analyser to be asked "${text}"`);

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb } = await import('../../src/db/client.js');
    sim = whatsappSimulator([], { tag: `q1${RUN}` });
    const setup = createDb(DATABASE_URL!);
    await inTenant(setup, SHOP, async (t) => {
      await sql`insert into businesses (id, name, engine) values (${SHOP}, 'History Worker Shop', 'service') on conflict (id) do nothing`.execute(t);
      await sql`update businesses set batch_debounce_ms = 300, batch_max_window_ms = 1000 where id = ${SHOP}`.execute(t);
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
                values (${SHOP}, 'whatsapp', ${sim.phoneNumberId}, 'sim-test', 'service')`.execute(t);
    });
    await setup.destroy();
    process.env['PILOT_BUSINESS_ID'] = SHOP;
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'q1-verify-token-xx', CREDENTIAL_KEY: 'd'.repeat(64), PORT: 0,
    }, { adapter: sim.adapter, logger: false, media: {}, models: { analyzer, replyWriter: new FakeReplyWriter() } });
  }, 60_000);
  afterAll(async () => { await prod?.close(); });

  it('a second message is read with the first as its history — and never with itself', async () => {
    const from = `9718${runDigits(RUN, 6)}1`;
    expect((await post(sim.inboundText({ from, text: 'Do you make canvas totes?' }))).statusCode).toBe(200);
    expect(await asked('Do you make canvas totes?')).toEqual([]);
    expect((await post(sim.inboundText({ from, text: 'How much for 500 of those?' }))).statusCode).toBe(200);
    expect(await asked('How much for 500 of those?')).toEqual([{ direction: 'inbound', text: 'Do you make canvas totes?' }]);
  }, 200_000);

  it('two messages sent together are answered as one — and neither is its own history', async () => {
    const from = `9718${runDigits(RUN, 6)}2`;
    expect((await post(sim.inboundText({ from, text: 'Hi there' }))).statusCode).toBe(200);
    expect(await asked('Hi there')).toEqual([]);
    // Within the tenant's 300 ms batching window: one turn answers both.
    const [a, b] = [sim.inboundText({ from, text: 'I need tote bags' }), sim.inboundText({ from, text: 'about 500 pieces' })];
    expect((await post(a)).statusCode).toBe(200);
    expect((await post(b)).statusCode).toBe(200);
    const history = await until(async () => {
      const i = analyzer.texts.findIndex((t) => t.includes('I need tote bags') && t.includes('about 500 pieces'));
      return i === -1 ? undefined : analyzer.histories[i]!;
    }, 'the batch to be read as one message');
    expect(history).toEqual([{ direction: 'inbound', text: 'Hi there' }]);
  }, 200_000);
});
