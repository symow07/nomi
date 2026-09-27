import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { runDigits } from './tenant.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';

/**
 * 0075 — a buyer who asks in chat for their data to be deleted is answered by
 * a PERSON, and the assistant says NOTHING (the owner's decision, 2026-09-27).
 *
 * Through the PRODUCTION composition — a signed WhatsApp webhook, the real
 * worker, Postgres — for a workspace with every capability on AUTO and its
 * assistant's name confirmed:
 *
 *   · "Please delete my data", "请删除我的个人信息", "أرجو حذف بياناتي": each is
 *     recorded and visible; no model is asked anything; no reply is sent,
 *     queued or drafted; the conversation waits on "Needs you" with the
 *     reason, and its page says nothing was sent and opens the buyer page's
 *     deletion section;
 *   · the comparison, in the same workspace: "delete that line from the
 *     quote" is answered by the assistant as usual. Today that answer is a
 *     DRAFT, not a send — nothing goes out alone anywhere until the zh/ar
 *     disclosure has native review (rule 1) — and the turn says so on the
 *     record. The send itself, with that gate open, is proved at the turn
 *     (tests/pipeline/deletion-handoff.test.ts).
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd7f0000-0000-4000-8000-${RUN}0001`;
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

type Tx = import('../../src/db/client.js').Tx;

const bidOf = async (raw: string) => {
  const { parseBusinessId } = await import('../../src/core/types/ids.js');
  const b = parseBusinessId(raw); if (!b.ok) throw new Error('fixture'); return b.value;
};
/**
 * Patience. The suite runs its files one after another on ONE database, and the
 * queues are shared: jobs an earlier file left behind are taken by this file's
 * worker first (run alone, each message here is handed over in about four
 * seconds; after twenty-odd files it waited behind their leftovers for over
 * thirty). What is asserted is the outcome, never the speed.
 */
const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 90_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

const REQUESTS = [
  { lang: 'en', from: `9718${runDigits(RUN, 6)}1`, text: 'Please delete my data.' },
  { lang: 'zh', from: `9718${runDigits(RUN, 6)}2`, text: '请删除我的个人信息' },
  { lang: 'ar', from: `9718${runDigits(RUN, 6)}3`, text: 'أرجو حذف بياناتي' },
] as const;
const PASSING = { from: `9718${runDigits(RUN, 6)}4`, text: 'delete that line from the quote' };
const ANSWER = 'Done — that line is gone. Anything else to change?';

d('0075 · a deletion request in chat goes to a person, and nothing is sent (requires DATABASE_URL)', { timeout: 120_000 }, () => {
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  let cookie = '';
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
  const get = (url: string) => prod.app.inject({ method: 'GET', url, headers: { cookie } });
  const convOf = (wa: string) => until(() => q((tx) => sql<{ id: string }>`
    select c.id::text as id from conversations c
      join client_channels cc on cc.client_id = c.client_id and cc.channel = 'whatsapp'
     where cc.channel_user_id = ${wa} and c.is_active limit 1`.execute(tx).then((r) => r.rows[0]?.id)), `conversation of ${wa}`);
  /** Everything the turn left behind for one conversation. */
  const footprint = (conv: string) => q((tx) => sql<{
    assigned: string | null; signals: string[]; drafts: number; outbound: number; path: string | null; events: string[];
  }>`
    select c.assigned_to as assigned,
           coalesce((select array_agg(s.kind order by s.kind) from conversation_signals s
                      where s.conversation_id = c.id and s.resolved_at is null), '{}') as signals,
           (select count(*)::int from drafts dd where dd.conversation_id = c.id) as drafts,
           (select count(*)::int from outbound_messages o where o.conversation_id = c.id) as outbound,
           (select t.answer_path from turns t where t.conversation_id = c.id order by t.created_at desc limit 1) as path,
           coalesce((select array_agg(e.type order by e.id) from conversation_events e
                      where e.conversation_id = c.id), '{}') as events
      from conversations c where c.id = ${conv}::uuid`.execute(tx).then((r) => r.rows[0]!));
  const modelCalls = () => q((tx) => sql<{ calls: number }>`
    select coalesce(sum(llm_calls), 0)::int as calls from usage_ledger where business_id = ${BIZ}::uuid`
    .execute(tx).then((r) => r.rows[0]!.calls));

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    sim = whatsappSimulator([], { tag: `del${RUN}` });
    const setup = createDb(DATABASE_URL!);
    await withTenantTx(setup, await bidOf(BIZ), async (t) => {
      await sql`insert into businesses (id, name, engine) values (${BIZ}, 'Deletion Handoff', 'service')
                on conflict (id) do nothing`.execute(t);
      await sql`update businesses set batch_debounce_ms = 300, batch_max_window_ms = 1000 where id = ${BIZ}`.execute(t);
      await sql`insert into channels (business_id, kind, status, display_phone, connected_at)
                values (${BIZ}, 'whatsapp', 'connected', '+86 579****0075', now())`.execute(t);
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
                values (${BIZ}, 'whatsapp', ${sim.phoneNumberId}, 'sim-test', 'service')`.execute(t);
      // Every capability she may hold on AUTO, and her name confirmed: the
      // setting in which any reply would have been meant to go out alone.
      for (const cap of ['greet', 'qualify', 'recommend', 'quote', 'negotiate', 'follow_up']) {
        await sql`insert into autonomy_policy (business_id, capability, mode) values (${BIZ}, ${cap}, 'auto')
                  on conflict (business_id, capability) do update set mode = 'auto'`.execute(t);
      }
      await sql`insert into assistants (business_id, name, is_default) values (${BIZ}, 'Lily', true)`.execute(t);
      await sql`insert into onboarding_state (business_id, assistant_named_at) values (${BIZ}, now())
                on conflict (business_id) do update set assistant_named_at = now()`.execute(t);
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
      WEBHOOK_VERIFY_TOKEN: 'del-verify-token-xx',
      CREDENTIAL_KEY: 'b'.repeat(64),
      PORT: 0,
    }, { adapter: sim.adapter, logger: false, models: { analyzer, replyWriter } });
    const login = await prod.app.inject({ method: 'POST', url: '/login', headers: FORM,
      payload: `code=${encodeURIComponent(prod.ownerAccessCode)}` });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 60_000);
  afterAll(async () => { await prod?.close(); });

  const convs: Record<string, string> = {};

  for (const r of REQUESTS) {
    it(`${r.lang} · ${JSON.stringify(r.text)} — recorded, handed to a person; no model, nothing sent, queued or drafted`, async () => {
      expect((await post(sim.inboundText({ from: r.from, text: r.text }))).statusCode).toBe(200);
      const conv = convs[r.lang] = await convOf(r.from);
      await until(async () => ((await footprint(conv)).assigned !== null ? true : undefined), 'the hand-off');
      const f = await footprint(conv);
      expect(f.assigned).toBe('unclaimed');
      expect(f.signals).toContain('deletion_requested');
      expect(f.path).toBe('silent');
      expect(f.events).toContain('handoff');
      // Nothing to the buyer: every message that leaves is an outbound row
      // first, and nothing waits for approval either.
      expect({ drafts: f.drafts, outbound: f.outbound }).toEqual({ drafts: 0, outbound: 0 });
      expect(await modelCalls()).toBe(0);
      // …and it is on the timeline, as it arrived.
      expect((await get(`/app/inbox/${conv}`)).body).toContain(r.text);
    });
  }

  it('each waits on Needs you; the page names the reason, says nothing was sent, and opens the buyer page there', async () => {
    const { t } = await import('../../src/core/owner/i18n/messages.js');
    const { esc } = await import('../../src/api/web/layout.js');
    const pending = (await get('/app/inbox?filter=pending')).body;
    for (const r of REQUESTS) {
      const conv = convs[r.lang]!;
      expect(pending, r.lang).toContain(`/app/inbox/${conv}`);
      const page = (await get(`/app/inbox/${conv}`)).body;
      expect(page).toContain(esc(t('en', 'takeover.reason.deletion_requested' as never)));
      expect(page).toContain(esc(t('en', 'deletionAsked.title' as never)));
      expect(page).toContain(`href="/app/conversations/${conv}#deletion"`);
      expect((await get(`/app/conversations/${conv}`)).body).toContain('id="deletion"');
    }
  });

  it('the comparison — "delete that line from the quote" is answered as usual, and still no model call was spent on the three', async () => {
    const before = await modelCalls();
    expect(before).toBe(0);
    expect((await post(sim.inboundText({ from: PASSING.from, text: PASSING.text }))).statusCode).toBe(200);
    const conv = await convOf(PASSING.from);
    await until(async () => ((await footprint(conv)).drafts > 0 ? true : undefined), 'her answer');
    const f = await footprint(conv);
    expect(f.assigned).toBeNull();                     // still hers
    expect(f.signals).not.toContain('deletion_requested');
    expect(f.path).toBe('model');
    expect(await modelCalls()).toBeGreaterThan(0);
    const draft = await q((tx) => sql<{ text: string }>`
      select draft_text as text from drafts where conversation_id = ${conv}::uuid`.execute(tx).then((x) => x.rows[0]!.text));
    expect(draft).toBe(ANSWER);
    // A draft and not a send ONLY because nothing goes out alone before the
    // zh/ar disclosure review — and the turn says so.
    const withheld = await q((tx) => sql<{ reason: string }>`
      select payload->>'reason' as reason from conversation_events
       where conversation_id = ${conv}::uuid and type = 'autonomy_withheld'`.execute(tx).then((x) => x.rows.map((w) => w.reason)));
    expect(withheld).toEqual(['disclosure_not_reviewed']);
  });
});
