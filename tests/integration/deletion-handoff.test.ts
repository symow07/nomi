import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID, createHmac } from 'node:crypto';
import { runDigits, flashSaid } from './tenant.js';
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
 *     quote" is answered by the assistant as usual — and, since the owner read
 *     the zh/ar disclosure (2026-09-28, rule 1), SENT alone, the disclosure
 *     first, as every capability here is on auto and the name is confirmed.
 *
 * 0076 — and the request is WRITTEN DOWN with the hand-off, the owner told in
 * its own words (e-mail always):
 *
 *   · each request leaves a `deletion_asks` row — the buyer, the conversation,
 *     the very message and its time — and a `deletion_requested` alert, never
 *     the generic hand-off's;
 *   · handing the conversation back does not clear it: Today, the Buyers tab,
 *     Your data, the conversation and the buyer's page all still show it;
 *   · recording it asks for no note and dates it from when they asked;
 *     setting it aside is recorded with who did it; a repeat is counted, not
 *     duplicated; and while the assistant is STOPPED a request is still
 *     written down and alerted as one.
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
const DURING_STOP = { from: `9718${runDigits(RUN, 6)}5`, text: 'Please delete my data' };
// Words no pattern of layer 1 knows; the reply is what gives it away (layer 2).
const SLIPS_PAST = { from: `9718${runDigits(RUN, 6)}6`, text: "Can you get rid of everything about me? I don't want to be in your files." };
/** The same derivation main.ts makes, so a notice this app minted can be read. */
const WEB_SECRET = createHmac('sha256', 'b'.repeat(64)).update('yf-web-session').digest('hex');
const wamidOf = (w: { payload: unknown }) =>
  (w.payload as { entry: { changes: { value: { messages: { id: string }[] } }[] }[] })
    .entry[0]!.changes[0]!.value.messages[0]!.id;
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
  /** 0076 — the request as written down: whose, where, which message and when. */
  const askOf = (conv: string) => q((tx) => sql<{
    state: string; asks: number; conversation: string; client: string; buyer_client: string;
    external: string | null; asked_at: Date; sent_at: Date | null; request: string | null; decided_by: string | null;
  }>`
    select a.state, a.asks, a.conversation_id::text as conversation, a.client_id::text as client,
           (select c.client_id::text from conversations c where c.id = ${conv}::uuid) as buyer_client,
           m.external_id as external, a.asked_at, m.sent_at, a.request_id::text as request, a.decided_by
      from deletion_asks a left join messages m on m.id = a.message_id
     where a.conversation_id = ${conv}::uuid
     order by a.created_at`.execute(tx).then((r) => r.rows));
  /** Alerts queued for this conversation, by kind — sent or not, pg-boss keeps the row. */
  const alertsFor = async (conv: string, kind: string) => {
    const { QUEUES } = await import('../../src/queue/boss.js');
    return (await sql<{ n: number }>`
      select count(*)::int as n from pgboss.job
       where name = ${QUEUES.notify} and data->>'kind' = ${kind} and data->>'conversationId' = ${conv}`
      .execute(prod.db)).rows[0]!.n;
  };
  const postForm = (url: string, fields: Record<string, string> = {}) => prod.app.inject({
    method: 'POST', url, headers: { cookie, ...FORM }, payload: new URLSearchParams(fields).toString() });

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
    }, {
      adapter: sim.adapter, logger: false, models: { analyzer, replyWriter },
      // The comparison is about a workspace that sends alone. Since 2026-09-29
      // the real gate is shut while es/fr wait for a reader (CLAUDE.md rule 1),
      // so this file says, as a rehearsal, that it is open.
      autonomyReleased: () => true,
    });
    const login = await prod.app.inject({ method: 'POST', url: '/login', headers: FORM,
      payload: `code=${encodeURIComponent(prod.ownerAccessCode)}` });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 60_000);
  afterAll(async () => { await prod?.close(); });

  const convs: Record<string, string> = {};

  for (const r of REQUESTS) {
    it(`${r.lang} · ${JSON.stringify(r.text)} — recorded, handed to a person; no model, nothing sent, queued or drafted`, async () => {
      const w = sim.inboundText({ from: r.from, text: r.text });
      expect((await post(w)).statusCode).toBe(200);
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
      // 0076 — written down with the hand-off: this buyer, this conversation,
      // the very message that asked, and its time.
      const [noted, ...more] = await askOf(conv);
      expect(more).toEqual([]);
      expect(noted).toMatchObject({ state: 'waiting', asks: 1, conversation: conv, external: wamidOf(w) });
      expect(noted!.client).toBe(noted!.buyer_client);
      expect(noted!.asked_at.getTime()).toBe(noted!.sent_at!.getTime());
      // …and the owner told in its own words — never the generic hand-off's.
      await until(async () => ((await alertsFor(conv, 'deletion_requested')) > 0 ? true : undefined), 'its own alert');
      expect(await alertsFor(conv, 'handoff')).toBe(0);
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
    await until(async () => ((await footprint(conv)).outbound > 0 ? true : undefined), 'her answer');
    const f = await footprint(conv);
    expect(f.assigned).toBeNull();                     // still hers
    expect(f.signals).not.toContain('deletion_requested');
    expect(f.path).toBe('model');
    expect(await modelCalls()).toBeGreaterThan(0);
    // Sent alone — the gate is open since the owner read zh and ar
    // (2026-09-28) — with the disclosure first, as the first unapproved
    // message of a conversation must. No draft, and nothing withheld.
    expect(f.drafts).toBe(0);
    expect(f.events).not.toContain('autonomy_withheld');
    const body = await q((tx) => sql<{ body: string }>`
      select body from outbound_messages where conversation_id = ${conv}::uuid`.execute(tx).then((x) => x.rows[0]!.body));
    expect(body).toMatch(/^Hi, I'm Lily, .+'s AI assistant\./);
    expect(body.endsWith(`\n\n${ANSWER}`)).toBe(true);
  });

  it('0076 · handing it back does not clear it: Today, the Buyers tab, Your data, the conversation and the buyer page still show it', async () => {
    const { t } = await import('../../src/core/owner/i18n/messages.js');
    const { formatDate } = await import('../../src/core/owner/i18n/format.js');
    const { esc } = await import('../../src/api/web/layout.js');
    const conv = convs['en']!;
    const back = await postForm(`/app/inbox/${conv}/resume`);
    expect(back.statusCode).toBe(302);
    const f = await footprint(conv);
    expect(f.assigned).toBeNull();                          // the assistant has it again
    expect(f.signals).not.toContain('deletion_requested');  // the hand-off's reason is gone…
    const [noted] = await askOf(conv);
    expect(noted!.state).toBe('waiting');                   // …the request is not

    expect((await get('/app')).body).toMatch(/<a class="stat need" href="\/app\/inbox\?filter=deletion">\s*<span class="v">3<\/span>/);
    const tab = (await get('/app/inbox?filter=deletion')).body;
    for (const r of REQUESTS) expect(tab, r.lang).toContain(`/app/inbox/${convs[r.lang]}`);
    expect(tab).not.toContain(`/app/inbox/${await convOf(PASSING.from)}`);
    const data = (await get('/app/settings/data')).body;
    for (const r of REQUESTS) expect(data, r.lang).toContain(`href="/app/conversations/${convs[r.lang]}#deletion"`);
    expect((await get(`/app/inbox/${conv}`)).body)
      .toContain(esc(t('en', 'deletionAsked.noted' as never, { date: formatDate('en', noted!.asked_at) })));
    const buyerPage = (await get(`/app/conversations/${conv}`)).body;
    expect(buyerPage).toContain(`action="/app/conversations/${conv}/deletion/dismiss"`);
    expect(buyerPage.slice(buyerPage.indexOf('id="deletion"'))).not.toContain('name="note"');
  });

  it('0076 · recording it asks for no note, and dates it from when they asked', async () => {
    const conv = convs['en']!;
    const [noted] = await askOf(conv);
    const r = await postForm(`/app/conversations/${conv}/deletion`, { note: '' });
    expect(flashSaid(r, WEB_SECRET)).toContain('dated from when they asked');
    const [after] = await askOf(conv);
    expect(after!.state).toBe('recorded');
    const request = await q((tx) => sql<{ state: string; asked_at: Date; subject_note: string | null }>`
      select state, asked_at, subject_note from deletion_requests where id = ${after!.request}::uuid`.execute(tx).then((x) => x.rows[0]!));
    expect(request).toMatchObject({ state: 'open', subject_note: null });
    expect(request.asked_at.getTime()).toBe(noted!.asked_at.getTime());
    expect((await get('/app')).body).toMatch(/href="\/app\/inbox\?filter=deletion">\s*<span class="v">2<\/span>/);
  });

  it('0076 · not a deletion request: set aside — nothing deleted, nothing sent — and the trail says who', async () => {
    const conv = convs['zh']!;
    const r = await postForm(`/app/conversations/${conv}/deletion/dismiss`);
    expect(flashSaid(r, WEB_SECRET)).toContain('not a deletion request');
    const [after] = await askOf(conv);
    expect(after!.state).toBe('dismissed');
    expect(after!.decided_by).not.toBeNull();
    const trail = await q((tx) => sql<{ n: number }>`
      select count(*)::int as n from channel_audit where action = 'deletion_dismissed'`.execute(tx).then((x) => x.rows[0]!.n));
    expect(trail).toBe(1);
    const f = await footprint(conv);
    expect({ drafts: f.drafts, outbound: f.outbound }).toEqual({ drafts: 0, outbound: 0 });
  });

  it('0076 · asked again while it waits: the same request, counted — not a second one, not a second alert', async () => {
    const conv = convs['ar']!;
    expect((await post(sim.inboundText({ from: REQUESTS[2].from, text: 'امسحوا جميع رسائلي' }))).statusCode).toBe(200);
    await until(async () => ((await askOf(conv))[0]!.asks === 2 ? true : undefined), 'the second ask, counted');
    expect(await askOf(conv)).toHaveLength(1);
    expect(await alertsFor(conv, 'deletion_requested')).toBe(1);
  });

  it('0076 · while the assistant is STOPPED, a deletion request is still written down, and alerted as one', async () => {
    const stop = await postForm('/app/factory/stop-assistant');
    expect(stop.statusCode).toBe(302);
    try {
      expect((await post(sim.inboundText({ from: DURING_STOP.from, text: DURING_STOP.text }))).statusCode).toBe(200);
      const conv = await convOf(DURING_STOP.from);
      await until(async () => ((await askOf(conv)).length > 0 ? true : undefined), 'the request, written down while stopped');
      const f = await footprint(conv);
      expect(f.assigned).toBe('unclaimed');
      expect(f.signals).toEqual(expect.arrayContaining(['assistant_stopped', 'deletion_requested']));
      expect((await askOf(conv))[0]).toMatchObject({ state: 'waiting', asks: 1 });
      await until(async () => ((await alertsFor(conv, 'deletion_requested')) > 0 ? true : undefined), 'its own alert');
      expect(await alertsFor(conv, 'handoff')).toBe(0);
      expect({ drafts: f.drafts, outbound: f.outbound }).toEqual({ drafts: 0, outbound: 0 });
    } finally {
      await postForm('/app/factory/start-assistant');
    }
  });

  it('layer 2 · a reply that promises the deletion is never sent — and the request is written down all the same', async () => {
    const promised = replyWriter.replies;
    replyWriter.replies = ["Of course — I've deleted your data."];
    try {
      expect((await post(sim.inboundText({ from: SLIPS_PAST.from, text: SLIPS_PAST.text }))).statusCode).toBe(200);
      const conv = await convOf(SLIPS_PAST.from);
      await until(async () => ((await footprint(conv)).assigned !== null ? true : undefined), 'the hand-off');
      const f = await footprint(conv);
      expect(f.assigned).toBe('unclaimed');
      expect(f.signals).toContain('deletion_requested');
      expect(f.path).toBe('silent');
      expect(f.events).toEqual(expect.arrayContaining(['handoff', 'deletion_promise_withheld']));
      expect({ drafts: f.drafts, outbound: f.outbound }).toEqual({ drafts: 0, outbound: 0 });
      expect((await askOf(conv))[0]).toMatchObject({ state: 'waiting', asks: 1, conversation: conv });
      await until(async () => ((await alertsFor(conv, 'deletion_requested')) > 0 ? true : undefined), 'its own alert');
    } finally {
      replyWriter.replies = promised;
    }
  });
});
