import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { runDigits } from './tenant.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';
import type { Transcriber } from '../../src/llm/transcribe.js';
import type { VisionDescriber, PageTranscriber } from '../../src/llm/ports.js';

/**
 * T7 — COMPLETE METERING (the one-month build order, 2026-09-29), through the
 * production composition: a signed webhook → pg-boss → the real worker, and
 * the real web routes. Only the paid accounts are fakes.
 *
 * `usage_ledger` is the pricing dataset nobody can backfill. Each test reads
 * what one message added to it and holds it to what was actually called:
 *
 *   · a text turn adds one turn and exactly the calls and tokens the turn
 *     recorded about itself;
 *   · a voice note adds its transcription, a customer's photo its look —
 *     calls and tokens, never a second turn;
 *   · a turn that fails AFTER its model calls still adds what it paid for —
 *     and is counted as a turn once, when it is kept;
 *   · a catalogue photo adds its page read (even one refused as cut off);
 *     a live Practice turn is on the practice tenant's ledger;
 *   · every row is on the ledger's day, UTC.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_DATABASE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd770000-0000-4000-8000-${RUN}0001`;
const SHOP = `dd770000-0000-4000-8000-${RUN}0002`;
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

type Db = import('../../src/db/client.js').Db;
type Tx = import('../../src/db/client.js').Tx;
type Ledger = { turns: number; calls: number; input: number; output: number; utc: boolean };

/**
 * The inbound queue is shared with every earlier file's leftovers, and the
 * worker takes one job per poll (pg-boss's default, 2 s): in the full run a
 * message has waited 24 s behind another tenant's dozen. A test waits for ITS
 * OWN turn, long enough for that, so nothing of it lands in the next test.
 */
const QUEUE_WAIT_MS = 90_000;
const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = QUEUE_WAIT_MS): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};
const inTenant = async <R>(db: Db, biz: string, fn: (tx: Tx) => Promise<R>): Promise<R> => {
  const { withTenantTx } = await import('../../src/db/client.js');
  const { parseBusinessId } = await import('../../src/core/types/ids.js');
  const b = parseBusinessId(biz); if (!b.ok) throw new Error('fixture');
  return withTenantTx(db, b.value, fn);
};
/** Everything on one business's ledger, and whether every row is on the UTC day. */
const ledgerOf = (db: Db, biz: string): Promise<Ledger> => inTenant(db, biz, (tx) => sql<Ledger>`
  select coalesce(sum(turns), 0)::int as turns, coalesce(sum(llm_calls), 0)::int as calls,
         coalesce(sum(input_tokens), 0)::int as input, coalesce(sum(output_tokens), 0)::int as output,
         coalesce(bool_and(day = (now() at time zone 'UTC')::date), true) as utc
    from usage_ledger where business_id = ${biz}::uuid`.execute(tx).then((r) => r.rows[0]!));
const minus = (a: Ledger, b: Ledger) => ({
  turns: a.turns - b.turns, calls: a.calls - b.calls, input: a.input - b.input, output: a.output - b.output,
});

d('T7 · every paid call is on the ledger — the worker (requires DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  let admin: Db | null = null;

  const analyzer = new FakeAnalyzer();
  analyzer.next = {
    language: { detected: 'en', replyIn: 'en' },
    intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
    recommendedPhase: 'clarification',
  };
  const replyWriter = new FakeReplyWriter();
  replyWriter.replies = ['Yes, we make canvas bags.'];
  let transcriptions = 0;
  const transcriber: Transcriber = async () => {
    transcriptions++;
    return { ok: true, text: 'Do you make canvas bags?', language: 'english' };
  };
  let looks = 0;
  const vision: VisionDescriber = {
    async describe() {
      looks++;
      return {
        searchText: 'canvas tote bag', attributes: ['canvas', 'tote bag'],
        promptVersion: 'test@1', modelId: 'fake-vision', usage: { inputTokens: 700, outputTokens: 40 },
      };
    },
  };

  const ledger = () => ledgerOf(prod.db, BIZ);
  const post = (w: { rawBody: string; headers: Record<string, string> }) =>
    prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: w.rawBody,
      headers: { 'content-type': 'application/json', ...w.headers } });
  const wamidOf = (w: { payload: unknown }) =>
    (w.payload as { entry: { changes: { value: { messages: { id: string }[] } }[] }[] })
      .entry[0]!.changes[0]!.value.messages[0]!.id;
  /** What the turn recorded about itself (0060) — the ledger must agree with it. */
  const turnOf = (wamid: string) => until(() => inTenant(prod.db, BIZ, (tx) => sql<{ calls: number; input: number; output: number }>`
    select llm_calls as calls, input_tokens as input, output_tokens as output from turns where message_id = ${wamid}`
    .execute(tx).then((r) => r.rows[0])), `the turn for ${wamid}`);
  const settled = (before: Ledger, turns: number, calls: number) =>
    until(async () => { const l = await ledger(); return l.turns - before.turns >= turns && l.calls - before.calls >= calls ? l : undefined; },
      'the ledger to catch up');

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator, SIM_MEDIA_BASE } = await import('../../src/channels/whatsapp/simulator.js');
    const { whatsappAudioFetcher, whatsappMediaFetcher } = await import('../../src/channels/whatsapp/media.js');
    const { createDb } = await import('../../src/db/client.js');
    sim = whatsappSimulator([], { tag: `t7${RUN}` });
    const setup = createDb(DATABASE_URL!);
    await inTenant(setup, BIZ, async (t) => {
      await sql`insert into businesses (id, name, engine) values (${BIZ}, 'Metered Shop', 'service')
                on conflict (id) do nothing`.execute(t);
      // Short batching for this tenant only (day-one.test.ts explains why).
      await sql`update businesses set batch_debounce_ms = 300, batch_max_window_ms = 1000 where id = ${BIZ}`.execute(t);
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
                values (${BIZ}, 'whatsapp', ${sim.phoneNumberId}, 'sim-test', 'service')`.execute(t);
    });
    await setup.destroy();
    if (MIGRATE_DATABASE_URL) admin = createDb(MIGRATE_DATABASE_URL);
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    const media = { baseUrl: SIM_MEDIA_BASE, apiKey: 'sim', fetchImpl: sim.mediaFetch };
    prod = await buildProduction({
      provider: 'meta',
      DATABASE_URL: DATABASE_URL!,
      ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok',
      META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765',
      META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0',
      WEBHOOK_VERIFY_TOKEN: 't7-verify-token-xx',
      CREDENTIAL_KEY: 'c'.repeat(64),
      PORT: 0,
    }, {
      adapter: sim.adapter, logger: false,
      media: { transcriber, audio: whatsappAudioFetcher(media), image: whatsappMediaFetcher(media) },
      models: { analyzer, replyWriter, vision },
    });
  }, 60_000);

  afterAll(async () => {
    if (admin) {
      await sql.raw(`drop trigger if exists t7_refuse_${RUN} on turns`).execute(admin).catch(() => {});
      await sql.raw(`drop function if exists t7_refuse_${RUN}()`).execute(admin).catch(() => {});
      await admin.destroy();
    }
    await prod?.close();
  });

  it('a text turn: one turn, and exactly the calls and tokens the turn recorded — on the UTC day', async () => {
    const before = await ledger();
    const w = sim.inboundText({ from: `9717${runDigits(RUN, 6)}1`, text: 'Hello, do you make canvas bags?' });
    expect((await post(w)).statusCode).toBe(200);
    const turn = await turnOf(wamidOf(w));
    expect(turn.calls).toBeGreaterThan(0);
    const after = await settled(before, 1, turn.calls);
    expect(minus(after, before)).toEqual({ turns: 1, calls: turn.calls, input: turn.input, output: turn.output });
    expect(after.utc).toBe(true);
  }, 200_000);

  it('a voice note: its transcription is a call on the ledger, beside the turn — not a second turn', async () => {
    const before = await ledger();
    const heard = transcriptions;
    const w = sim.inboundAudio({ from: `9717${runDigits(RUN, 6)}2` });
    expect((await post(w)).statusCode).toBe(200);
    const turn = await turnOf(wamidOf(w));
    expect(transcriptions).toBe(heard + 1);
    const after = await settled(before, 1, turn.calls + 1);
    expect(minus(after, before)).toEqual({ turns: 1, calls: turn.calls + 1, input: turn.input, output: turn.output });
  }, 200_000);

  it('a customer\'s photo: looking at it is a call, with its tokens — not a second turn', async () => {
    const before = await ledger();
    const seen = looks;
    const w = sim.inboundImage({ from: `9717${runDigits(RUN, 6)}3`, caption: 'this one?' });
    expect((await post(w)).statusCode).toBe(200);
    const turn = await turnOf(wamidOf(w));
    expect(looks).toBe(seen + 1);
    const after = await settled(before, 1, turn.calls + 1);
    expect(minus(after, before)).toEqual({ turns: 1, calls: turn.calls + 1, input: turn.input + 700, output: turn.output + 40 });
  }, 200_000);

  it('a turn that fails after its model calls is still paid for — and counted as a turn once, when it is kept', async () => {
    if (!admin) return;           // needs the admin role to make one commit fail
    // The turn's own row refuses to be written — for this business only — so
    // the turn's transaction rolls back after the model has been asked.
    await sql.raw(`create or replace function t7_refuse_${RUN}() returns trigger language plpgsql as $$
      begin raise exception 'T7 test: this turn does not commit'; end $$`).execute(admin);
    await sql.raw(`create trigger t7_refuse_${RUN} before insert on turns for each row
      when (new.business_id = '${BIZ}'::uuid) execute function t7_refuse_${RUN}()`).execute(admin);
    const before = await ledger();
    const asked = analyzer.calls;
    const w = sim.inboundText({ from: `9717${runDigits(RUN, 6)}4`, text: 'What is your price for 500 totes?' });
    expect((await post(w)).statusCode).toBe(200);

    // The first attempt paid and did not commit: its calls are on the ledger, no turn is.
    const failed = await until(async () => {
      const l = await ledger();
      return analyzer.calls > asked && l.calls > before.calls ? l : undefined;
    }, 'the failed attempt\'s calls on the ledger');
    expect(failed.turns).toBe(before.turns);
    expect(failed.input).toBeGreaterThan(before.input);
    expect(await inTenant(prod.db, BIZ, (tx) => sql<{ n: number }>`
      select count(*)::int as n from turns where message_id = ${wamidOf(w)}`.execute(tx).then((r) => r.rows[0]!.n))).toBe(0);

    // The queue retries; this time it is kept — one turn, and every attempt's calls.
    await sql.raw(`drop trigger t7_refuse_${RUN} on turns`).execute(admin);
    const turn = await until(() => inTenant(prod.db, BIZ, (tx) => sql<{ calls: number }>`
      select llm_calls as calls from turns where message_id = ${wamidOf(w)}`.execute(tx).then((r) => r.rows[0])),
      'the retried turn');
    const after = await settled(before, 1, (failed.calls - before.calls) + turn.calls);
    expect(after.turns - before.turns).toBe(1);
    expect(after.calls - before.calls).toBe((failed.calls - before.calls) + turn.calls);
  }, 300_000);
});

d('T7 · every paid call is on the ledger — the owner\'s pages (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: Db;
  let cookie = '';
  let cutOff = false;
  const SANDBOX = '5a4d0000-0000-4000-8000-0000000000b1';
  const reader: PageTranscriber = {
    transcribe: async () => ({
      text: 'Canvas tote  CT-1  $2.40  MOQ 500', unreadable: false, cutOff,
      promptVersion: 'test', modelId: 'test', usage: { inputTokens: 900, outputTokens: 300 },
    }),
  };
  const analyzer = new FakeAnalyzer();
  analyzer.next = {
    language: { detected: 'en', replyIn: 'en' },
    intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
    recommendedPhase: 'clarification',
  };
  const replyWriter = new FakeReplyWriter();

  const BOUNDARY = '----nomiMeterTest';
  const shoot = () => app.inject({
    method: 'POST', url: '/app/products/add/photo',
    headers: { cookie, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    payload: Buffer.concat([
      Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="page"; filename="p.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      Buffer.from('not-really-a-jpeg'),
      Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
    ]),
  });

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { resetSandbox } = await import('../../src/api/web/sandbox.js');
    const { sandboxSeedSql } = await import('../../src/demo/sandbox.js');
    db = createDb(DATABASE_URL!);
    await inTenant(db, SHOP, (x) => sql`insert into businesses (id, name, owner_locale) values (${SHOP}, 'Metered Pages', 'en')
      on conflict (id) do nothing`.execute(x));
    // Practice: emptied the way the owner empties it, then seeded (conversation-landing.test.ts's recipe).
    await resetSandbox({ db, businessId: SANDBOX, now: () => new Date() }).catch(() => {});
    await inTenant(db, SANDBOX, async (x) => {
      for (const stmt of sandboxSeedSql().split(';')) {
        const s = stmt.trim();
        if (!s || s.replace(/--.*$/gm, '').trim() === '') continue;
        await sql.raw(s).execute(x);
      }
    });
    process.env['PILOT_BUSINESS_ID'] = SHOP;
    app = Fastify({ logger: false });
    const code = `t7-${RUN}`;
    registerWebApp(app, {
      db, businessId: SHOP, accessCode: code, sessionSecret: 'a-test-session-secret-of-sufficient-length',
      employeeName: 'Lily', avatar: '👩‍💼', secureCookie: false, factsTtlMs: 0,
      provider: 'disabled', messagingEnabled: false, kickOutbound: async () => {}, kickDrive: async () => {},
      pageTranscriber: reader, sandboxBusinessId: SANDBOX, analyzer, replyWriter,
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    cookie = String((await app.inject({ method: 'POST', url: '/login', payload: `code=${code}`, headers: FORM }))
      .headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 60_000);

  afterAll(async () => {
    if (db) {
      const { resetSandbox } = await import('../../src/api/web/sandbox.js');
      await resetSandbox({ db, businessId: SANDBOX, now: () => new Date() }).catch(() => {});
    }
    await app?.close(); await db?.destroy();
  });

  it('a catalogue photo: the page read is a call with its tokens — and a read refused as cut off was paid for too', async () => {
    const before = await ledgerOf(db, SHOP);
    expect((await shoot()).statusCode).toBe(200);
    const once = await ledgerOf(db, SHOP);
    expect(minus(once, before)).toEqual({ turns: 0, calls: 1, input: 900, output: 300 });
    cutOff = true;
    const refused = await shoot();
    cutOff = false;
    expect(refused.body).toContain('two photos');
    expect(minus(await ledgerOf(db, SHOP), once)).toEqual({ turns: 0, calls: 1, input: 900, output: 300 });
    expect(once.utc).toBe(true);
  });

  it('a live Practice turn is on the practice tenant\'s ledger; a scripted one costs nothing', async () => {
    const before = await ledgerOf(db, SANDBOX);
    const [a0, w0] = [analyzer.calls, replyWriter.calls];
    const r = await app.inject({ method: 'POST', url: '/app/sandbox/message', headers: { cookie, ...FORM },
      payload: new URLSearchParams({ mode: 'live', text: 'do you have canvas bags?' }).toString() });
    expect(r.statusCode).toBe(302);
    // What the fakes were asked, at the fakes' own prices (tests/pipeline/fakes.ts).
    const [a, w] = [analyzer.calls - a0, replyWriter.calls - w0];
    expect(a).toBeGreaterThan(0);
    const live = await ledgerOf(db, SANDBOX);
    expect(minus(live, before)).toEqual({ turns: 1, calls: a + w, input: 500 * a + 300 * w, output: 120 * a + 80 * w });
    await app.inject({ method: 'POST', url: '/app/sandbox/message', headers: { cookie, ...FORM },
      payload: new URLSearchParams({ mode: 'scripted', text: 'and in blue?' }).toString() });
    expect(minus(await ledgerOf(db, SANDBOX), live)).toEqual({ turns: 0, calls: 0, input: 0, output: 0 });
  });
});
