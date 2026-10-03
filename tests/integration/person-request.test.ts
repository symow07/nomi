import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { runDigits } from './tenant.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';
import type { Analysis } from '../../src/core/conversation/decide.js';

/**
 * "Wants a person", in two layers (2026-09-28), through the PRODUCTION
 * composition: a signed WhatsApp webhook, the real worker, Postgres.
 *
 *   · The buyer's own side — "my manager approved it" (layer 1's split),
 *     "someone in my team", "you can call me Ahmed", «شخص في شركتي» (layer 2:
 *     the analyser reads them and says no) — is answered as usual, in en / zh
 *     / ar. Nobody is pulled in.
 *   · The five the old list missed hand off from their words alone (layer 1):
 *     the ordinary sentence and alert, and the analyser is never asked.
 *   · A sentence only the meaning gives away hands off when the analyser says
 *     so (layer 2), with the ordinary sentence and alert.
 *   · An answer that cannot be read (`wantsPerson: null`) hands off as
 *     `not_answered`: nothing is drafted or sent; the ordinary alert.
 *   · A turn that gave up — its job in the dead letter queue — does the same.
 *   · The deletion hand-off fires as before: silent, written down, its own
 *     alert.
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

const n = (i: number) => `9719${runDigits(RUN, 5)}${String(i).padStart(2, '0')}`;
let next = 0;
const buyer = () => n(++next);

/** What the analyser answers when it reads a message as not asking for anyone. */
const reads = (wantsPerson: boolean | null): Analysis => ({
  language: { detected: 'en', replyIn: 'en' },
  intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
  recommendedPhase: 'clarification',
  wantsPerson,
});

const THEIR_OWN = [
  { lang: 'en', layer: 1, text: 'My manager approved it, please send the PI' },
  { lang: 'en', layer: 2, text: "I'll speak to someone in my team and get back to you" },
  { lang: 'en', layer: 2, text: 'Hi, you can call me Ahmed' },
  { lang: 'zh', layer: 1, text: '我们经理会确认价格' },
  { lang: 'zh', layer: 2, text: '我问一下经理再回复你' },
  { lang: 'ar', layer: 1, text: 'مديري وافق على السعر' },
  { lang: 'ar', layer: 2, text: 'أحتاج التحدث مع شخص في شركتي أولاً' },
] as const;
const LAYER_ONE = [
  'Can I talk to someone?',
  'I want to speak with a person',
  'أريد أحدًا يساعدني',
  '我要找你们经理',
  'أريد التحدث مع مديركم',
  // Yesterday's, still: the seller's manager and someone in charge.
  'I want to speak to your manager',
  'Let me talk to someone in charge',
] as const;
/** No word on any list gives it away; the analyser reads it as asking for a person. */
const MEANING_ONLY = 'Hello?? Is anybody actually reading these messages?';
/** The analyser is asked, and its answer cannot be read. */
const UNREADABLE = 'Do you sell human hair wigs?';
const DELETION = 'My manager says: please delete my data';

d('"wants a person", two layers, through production (requires DATABASE_URL)', { timeout: 120_000 }, () => {
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  const analyzer = new FakeAnalyzer();
  analyzer.next = reads(false);
  analyzer.byText.set(MEANING_ONLY, reads(true));
  analyzer.byText.set(UNREADABLE, reads(null));
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
    assigned: string | null; signals: string[]; drafts: string[]; asks: number; path: string | null; said: string[];
  }>`
    select c.assigned_to as assigned,
           coalesce((select array_agg(s.kind order by s.kind) from conversation_signals s
                      where s.conversation_id = c.id and s.resolved_at is null), '{}') as signals,
           coalesce((select array_agg(dd.draft_text order by dd.created_at) from drafts dd
                      where dd.conversation_id = c.id), '{}') as drafts,
           (select count(*)::int from deletion_asks a where a.conversation_id = c.id) as asks,
           (select t.answer_path from turns t where t.conversation_id = c.id order by t.created_at desc limit 1) as path,
           coalesce((select array_agg(m.text_content order by m.sent_at) from messages m
                      where m.conversation_id = c.id and m.direction = 'inbound'), '{}') as said
      from conversations c where c.id = ${conv}::uuid`.execute(tx).then((r) => r.rows[0]!));
  const alertsFor = async (conv: string, kind: string) => {
    const { QUEUES } = await import('../../src/queue/boss.js');
    return (await sql<{ n: number }>`
      select count(*)::int as n from pgboss.job
       where name = ${QUEUES.notify} and data->>'kind' = ${kind} and data->>'conversationId' = ${conv}`
      .execute(prod.db)).rows[0]!.n;
  };
  const send = async (text: string) => {
    const from = buyer();
    expect((await post(sim.inboundText({ from, text }))).statusCode).toBe(200);
    return convOf(from);
  };
  const handedOver = async (conv: string) => {
    await until(async () => ((await state(conv)).assigned !== null ? true : undefined), 'the hand-off');
    return state(conv);
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
    it(`${m.lang} · their own side (layer ${m.layer}) — answered as usual: ${JSON.stringify(m.text)}`, async () => {
      const conv = await send(m.text);
      await until(async () => ((await state(conv)).drafts.length > 0 ? true : undefined), 'the answer');
      const s = await state(conv);
      expect(s.assigned).toBeNull();                       // still the assistant's
      expect(s.signals).not.toContain('human_requested');
      expect(s.signals).not.toContain('not_answered');
      expect(s.path).toBe('model');
      expect(s.drafts).toEqual([ANSWER]);
      expect(analyzer.texts).toContain(m.text);            // the analyser read it (and said no)
      expect(await alertsFor(conv, 'handoff')).toBe(0);
    });
  }

  for (const text of LAYER_ONE) {
    it(`layer 1 — hands off from the words alone, no model asked: ${JSON.stringify(text)}`, async () => {
      const { HANDOFF_REPLIES } = await import('../../src/core/conversation/templates.js');
      // LG — said in the customer's language where Nomi writes it.
      const lang = /[\u4e00-\u9fff]/.test(text) ? 'zh' : /[\u0600-\u06ff]/.test(text) ? 'ar' : 'en';
      const conv = await send(text);
      const s = await handedOver(conv);
      expect(s.assigned).toBe('unclaimed');
      expect(s.signals).toEqual(['human_requested']);
      expect(s.path).toBe('handoff');
      expect(s.drafts).toEqual([HANDOFF_REPLIES[lang]]);
      expect(s.asks).toBe(0);
      expect(analyzer.texts).not.toContain(text);
      await until(async () => ((await alertsFor(conv, 'handoff')) > 0 ? true : undefined), 'the ordinary alert');
    });
  }

  it(`layer 2 — the analyser reads a request no word gives away, and it hands off: ${JSON.stringify(MEANING_ONLY)}`, async () => {
    const { HANDOFF_REPLIES } = await import('../../src/core/conversation/templates.js');
    const conv = await send(MEANING_ONLY);
    const s = await handedOver(conv);
    expect(analyzer.texts).toContain(MEANING_ONLY);
    expect(s.assigned).toBe('unclaimed');
    expect(s.signals).toEqual(['human_requested']);
    expect(s.path).toBe('handoff');
    expect(s.drafts).toEqual([HANDOFF_REPLIES.en]);                // the ordinary sentence; the writer never ran
    await until(async () => ((await alertsFor(conv, 'handoff')) > 0 ? true : undefined), 'the ordinary alert');
  });

  it('an answer that cannot be read hands off as not_answered — nothing drafted, nothing sent; the ordinary alert', async () => {
    const conv = await send(UNREADABLE);
    const s = await handedOver(conv);
    expect(analyzer.texts).toContain(UNREADABLE);
    expect(s.assigned).toBe('unclaimed');
    expect(s.signals).toEqual(['not_answered']);
    expect(s.path).toBe('silent');
    expect(s.drafts).toEqual([]);
    expect(s.asks).toBe(0);
    await until(async () => ((await alertsFor(conv, 'handoff')) > 0 ? true : undefined), 'the ordinary alert');
    const outbound = await q((tx) => sql<{ n: number }>`
      select count(*)::int as n from outbound_messages where conversation_id = ${conv}::uuid`.execute(tx).then((r) => r.rows[0]!.n));
    expect(outbound).toBe(0);
  });

  it('a turn that gave up — its job dead-lettered after the retries — goes to a person as not_answered, with the alert', async () => {
    const { QUEUES } = await import('../../src/queue/boss.js');
    // A buyer the assistant has been answering as usual…
    const conv = await send('Is the price for 5000 pcs still valid?');
    await until(async () => ((await state(conv)).drafts.length > 0 ? true : undefined), 'the first answer');
    expect((await state(conv)).assigned).toBeNull();
    // …whose next message's turn failed until the queue gave up: pg-boss
    // copies the job's data into `message.inbound.dead`, exactly this.
    const wamid = `wamid.gave-up.${RUN}`;
    await prod.boss.send(`${QUEUES.inbound}.dead`, {
      businessId: BIZ, conversationId: conv, messageId: wamid, text: 'And the lead time?', messageType: 'text',
    });
    const s = await handedOver(conv);
    expect(s.assigned).toBe('unclaimed');
    expect(s.signals).toEqual(['not_answered']);
    expect(s.said).toContain('And the lead time?');       // on the timeline for the person who answers
    await until(async () => ((await alertsFor(conv, 'handoff')) > 0 ? true : undefined), 'the ordinary alert');
    // …and the operator is still told, as before: the dead job is written down as its own
    // kind of error for this business (CC-10, `app_errors`), which is what alerts the operator.
    await until(async () => ((await sql<{ n: number }>`
      select count(*)::int as n from app_errors
       where "where" = ${`worker:${QUEUES.inbound}`} and business_id = ${BIZ}::uuid`
      .execute(prod.db)).rows[0]!.n > 0 ? true : undefined), 'the operator’s dead-letter error');
    // The warmth run, phase 8 — the owner's own "a message may not have gone through" copy waits in the
    // app (QUIET_KINDS): no such job is queued for them; the hand-over above is what reaches them.
    expect((await sql<{ n: number }>`
      select count(*)::int as n from pgboss.job
       where name = ${QUEUES.notify} and data->>'kind' = 'dead_letter' and data->>'businessId' = ${BIZ}`
      .execute(prod.db)).rows[0]!.n).toBe(0);
  });

  it('a dead job naming no conversation it can find hands nothing over, and breaks nothing', async () => {
    const { QUEUES } = await import('../../src/queue/boss.js');
    const ghost = randomUUID();
    await prod.boss.send(`${QUEUES.inbound}.dead`, { businessId: BIZ, conversationId: ghost, messageId: `wamid.ghost.${RUN}`, text: 'hello' });
    await until(async () => ((await sql<{ n: number }>`
      select count(*)::int as n from pgboss.job
       where name = ${`${QUEUES.inbound}.dead`} and data->>'conversationId' = ${ghost} and state = 'completed'`
      .execute(prod.db)).rows[0]!.n > 0 ? true : undefined), 'the dead job to complete');
    expect(await alertsFor(ghost, 'handoff')).toBe(0);
  });

  it('the deletion hand-off still fires as before, with their own manager named in the same breath', async () => {
    const conv = await send(DELETION);
    const s = await handedOver(conv);
    expect(s.assigned).toBe('unclaimed');
    expect(s.signals).toEqual(['deletion_requested']);    // not "asked for a person" as well
    expect(s.path).toBe('silent');
    expect(s.drafts).toEqual([]);
    expect(s.asks).toBe(1);
    expect(analyzer.texts).not.toContain(DELETION);
    await until(async () => ((await alertsFor(conv, 'deletion_requested')) > 0 ? true : undefined), 'its own alert');
    expect(await alertsFor(conv, 'handoff')).toBe(0);
  });
});
