import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { runDigits } from './tenant.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';

/**
 * "Wants a person" — "manager" split by whose manager it is (2026-09-28),
 * through the PRODUCTION composition: a signed WhatsApp webhook, the real
 * worker, Postgres.
 *
 *   · The buyer's own manager — "my manager approved it", "我们经理会确认价格",
 *     "مديري وافق على السعر" — is answered as usual: nobody is pulled in.
 *   · The seller's — "I want to speak to your manager", "let me talk to someone
 *     in charge" — still hands off, with the ordinary sentence and the ordinary
 *     alert.
 *   · The deletion hand-off still fires as before when a buyer's own manager is
 *     named in the same breath: silent, written down, its own alert.
 *
 * Nothing goes out alone before the zh/ar disclosure review (rule 1), so the
 * answers and the hand-off sentence are DRAFTS here; what matters is whose
 * turn it is.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd800000-0000-4000-8000-${RUN}0001`;
const ANSWER = 'Thanks — I will prepare the PI.';

type Tx = import('../../src/db/client.js').Tx;

const bidOf = async (raw: string) => {
  const { parseBusinessId } = await import('../../src/core/types/ids.js');
  const b = parseBusinessId(raw); if (!b.ok) throw new Error('fixture'); return b.value;
};
/** Patience: the suite's files share one database and its queues (see deletion-handoff.test.ts). */
const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 90_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

const n = (i: number) => `9719${runDigits(RUN, 6)}${i}`;
const THEIR_OWN = [
  { lang: 'en', from: n(1), text: 'My manager approved it, please send the PI' },
  { lang: 'zh', from: n(2), text: '我们经理会确认价格' },
  { lang: 'ar', from: n(3), text: 'مديري وافق على السعر' },
] as const;
const THE_SELLERS = [
  { from: n(4), text: 'I want to speak to your manager' },
  { from: n(5), text: 'Let me talk to someone in charge' },
] as const;
const DELETION = { from: n(6), text: 'My manager says: please delete my data' };

d('"wants a person": the buyer’s own manager is not a hand-off (requires DATABASE_URL)', { timeout: 120_000 }, () => {
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  const analyzer = new FakeAnalyzer();
  analyzer.next = {
    language: { detected: 'en', replyIn: 'en' },
    intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
    recommendedPhase: 'clarification',
  };
  const replyWriter = new FakeReplyWriter();
  replyWriter.replies = [ANSWER];

  const q = async <T>(fn: (tx: Tx) => Promise<T>) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(prod.db, await bidOf(BIZ), fn);
  };
  const post = (w: { rawBody: string; headers: Record<string, string> }) =>
    prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: w.rawBody,
      headers: { 'content-type': 'application/json', ...w.headers } });
  const convOf = (wa: string) => until(() => q((tx) => sql<{ id: string }>`
    select c.id::text as id from conversations c
      join client_channels cc on cc.client_id = c.client_id and cc.channel = 'whatsapp'
     where cc.channel_user_id = ${wa} and c.is_active limit 1`.execute(tx).then((r) => r.rows[0]?.id)), `conversation of ${wa}`);
  /** Whose turn it is, and what it left: the reason, the words waiting to go, the record. */
  const state = (conv: string) => q((tx) => sql<{
    assigned: string | null; signals: string[]; drafts: string[]; asks: number; path: string | null;
  }>`
    select c.assigned_to as assigned,
           coalesce((select array_agg(s.kind order by s.kind) from conversation_signals s
                      where s.conversation_id = c.id and s.resolved_at is null), '{}') as signals,
           coalesce((select array_agg(dd.draft_text order by dd.created_at) from drafts dd
                      where dd.conversation_id = c.id), '{}') as drafts,
           (select count(*)::int from deletion_asks a where a.conversation_id = c.id) as asks,
           (select t.answer_path from turns t where t.conversation_id = c.id order by t.created_at desc limit 1) as path
      from conversations c where c.id = ${conv}::uuid`.execute(tx).then((r) => r.rows[0]!));
  const alertsFor = async (conv: string, kind: string) => {
    const { QUEUES } = await import('../../src/queue/boss.js');
    return (await sql<{ n: number }>`
      select count(*)::int as n from pgboss.job
       where name = ${QUEUES.notify} and data->>'kind' = ${kind} and data->>'conversationId' = ${conv}`
      .execute(prod.db)).rows[0]!.n;
  };

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    sim = whatsappSimulator([], { tag: `psn${RUN}` });
    const setup = createDb(DATABASE_URL!);
    await withTenantTx(setup, await bidOf(BIZ), async (t) => {
      await sql`insert into businesses (id, name, engine) values (${BIZ}, 'Person Request', 'service')
                on conflict (id) do nothing`.execute(t);
      await sql`update businesses set batch_debounce_ms = 300, batch_max_window_ms = 1000 where id = ${BIZ}`.execute(t);
      await sql`insert into channels (business_id, kind, status, display_phone, connected_at)
                values (${BIZ}, 'whatsapp', 'connected', '+86 579****0077', now())`.execute(t);
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
                values (${BIZ}, 'whatsapp', ${sim.phoneNumberId}, 'sim-test', 'service')`.execute(t);
    });
    await setup.destroy();
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    prod = await buildProduction({
      provider: 'meta',
      DATABASE_URL: DATABASE_URL!,
      ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok',
      META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765',
      META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0',
      WEBHOOK_VERIFY_TOKEN: 'psn-verify-token-xx',
      CREDENTIAL_KEY: 'b'.repeat(64),
      PORT: 0,
    }, { adapter: sim.adapter, logger: false, models: { analyzer, replyWriter } });
  }, 60_000);
  afterAll(async () => { await prod?.close(); });

  for (const m of THEIR_OWN) {
    it(`${m.lang} · their own manager — answered as usual: ${JSON.stringify(m.text)}`, async () => {
      expect((await post(sim.inboundText({ from: m.from, text: m.text }))).statusCode).toBe(200);
      const conv = await convOf(m.from);
      await until(async () => ((await state(conv)).drafts.length > 0 ? true : undefined), 'the answer');
      const s = await state(conv);
      expect(s.assigned).toBeNull();                       // still the assistant's
      expect(s.signals).not.toContain('human_requested');
      expect(s.path).toBe('model');
      expect(s.drafts).toEqual([ANSWER]);
      expect(await alertsFor(conv, 'handoff')).toBe(0);
    });
  }

  for (const m of THE_SELLERS) {
    it(`the seller's side — still hands off, with the ordinary sentence: ${JSON.stringify(m.text)}`, async () => {
      const { HANDOFF_REPLY } = await import('../../src/core/conversation/templates.js');
      expect((await post(sim.inboundText({ from: m.from, text: m.text }))).statusCode).toBe(200);
      const conv = await convOf(m.from);
      await until(async () => ((await state(conv)).assigned !== null ? true : undefined), 'the hand-off');
      const s = await state(conv);
      expect(s.assigned).toBe('unclaimed');
      expect(s.signals).toContain('human_requested');
      expect(s.path).toBe('handoff');
      expect(s.drafts).toEqual([HANDOFF_REPLY]);
      expect(s.asks).toBe(0);
      await until(async () => ((await alertsFor(conv, 'handoff')) > 0 ? true : undefined), 'the ordinary alert');
    });
  }

  it('the deletion hand-off still fires as before, with their own manager named in the same breath', async () => {
    expect((await post(sim.inboundText({ from: DELETION.from, text: DELETION.text }))).statusCode).toBe(200);
    const conv = await convOf(DELETION.from);
    await until(async () => ((await state(conv)).assigned !== null ? true : undefined), 'the hand-off');
    const s = await state(conv);
    expect(s.assigned).toBe('unclaimed');
    expect(s.signals).toEqual(['deletion_requested']);    // not "asked for a person" as well
    expect(s.path).toBe('silent');
    expect(s.drafts).toEqual([]);
    expect(s.asks).toBe(1);
    await until(async () => ((await alertsFor(conv, 'deletion_requested')) > 0 ? true : undefined), 'its own alert');
    expect(await alertsFor(conv, 'handoff')).toBe(0);
  });
});
