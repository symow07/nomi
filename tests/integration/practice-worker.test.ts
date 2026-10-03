import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID, createHmac } from 'node:crypto';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * PRACTICE THROUGH THE REAL PIPELINE (P3; docs/PRACTICE.md), in the production
 * composition: the page → the workspace's own copy (0086) → the inbound queue
 * → the worker and its turn → the approval path → the outbound worker and its
 * send gate → the practice adapter, which has no network.
 *
 * Before P3 the page ran turns itself, in the request, on one shared tenant:
 * Stop, batching and the send gate never applied, and every signed-in owner
 * could read and reset the same sandbox.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const PILOT = `dd870000-0000-4000-8000-${RUN}0001`;
const PRODUCT = `dd870000-0000-4000-8001-${RUN}0001`;
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
/** The notice's signing key, as main.ts derives it from this test's CREDENTIAL_KEY. */
const WEB_SECRET = createHmac('sha256', 'c'.repeat(64)).update('yf-web-session').digest('hex');

const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 60_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

d('Practice goes through the real pipeline, on the workspace\'s own copy (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  let cookie = '';
  let copy = '';
  const analyzer = new FakeAnalyzer();
  const replyWriter = new FakeReplyWriter();

  type Tx = import('../../src/db/client.js').Tx;
  const inBiz = async <R>(id: string, fn: (tx: Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(id); if (!b.ok) throw new Error('fixture');
    return withTenantTx(prod.db, b.value, fn);
  };
  const inCopy = <R>(fn: (tx: Tx) => Promise<R>) => inBiz(copy, fn);
  const post = (url: string, payload = '') => prod.app.inject({ method: 'POST', url, headers: { cookie, ...FORM }, payload });
  const page = () => prod.app.inject({ method: 'GET', url: '/app/sandbox', headers: { cookie } });
  const say = (text: string) => post('/app/sandbox/message', `text=${encodeURIComponent(text)}`);

  /** The copy's open practice conversation, as the routes find it. */
  const practiceConv = () => inCopy((tx) => sql<{ id: string }>`
    select c.id::text as id from conversations c
      join client_channels cc on cc.client_id = c.client_id and cc.channel = 'instagram' and cc.channel_user_id = ${`practice:${copy}`}
     where c.business_id = ${copy}::uuid and c.is_active order by c.created_at desc limit 1`.execute(tx).then((r) => r.rows[0]?.id));
  const pendingDraft = (conv: string) => inCopy((tx) => sql<{ id: string; text: string }>`
    select id::text as id, draft_text as text from drafts where conversation_id = ${conv}::uuid and status = 'pending'
     order by created_at desc limit 1`.execute(tx).then((r) => r.rows[0]));
  /** What left: accepted by the practice adapter, and delivered at once — the page is the customer's phone. */
  const sentReplies = (conv: string) => inCopy((tx) => sql<{ body: string; provider: string | null; origin: string; status: string }>`
    select body, provider_message_id as provider, origin, status from outbound_messages
     where conversation_id = ${conv}::uuid and status in ('sent', 'delivered') order by seq`.execute(tx).then((r) => r.rows));
  const setAutonomy = (mode: 'draft' | 'auto') => inBiz(PILOT, async (tx) => {
    for (const cap of ['greet', 'qualify', 'recommend', 'quote', 'negotiate', 'follow_up']) {
      await sql`insert into autonomy_policy (business_id, capability, mode) values (${PILOT}, ${cap}, ${mode})
                on conflict (business_id, capability) do update set mode = ${mode}`.execute(tx);
    }
  });
  const nothingReachedAProvider = (text: string) =>
    expect(sim.requests.filter((r) => r.body.includes(text.slice(0, 20))), 'a practice reply reached a provider').toEqual([]);

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    sim = whatsappSimulator([], { tag: `pw${RUN}` });
    const setup = createDb(DATABASE_URL!);
    const b = parseBusinessId(PILOT); if (!b.ok) throw new Error('fixture');
    await withTenantTx(setup, b.value, async (t) => {
      await sql`insert into businesses (id, name, engine, batch_debounce_ms, batch_max_window_ms)
                values (${PILOT}, 'Practice Pipeline Co', 'service', 300, 10000)`.execute(t);
      await sql`insert into products (id, business_id, sku, name, unit, moq, price_usd_per_unit)
                values (${PRODUCT}, ${PILOT}, ${`PW-${RUN}`}, 'Canvas tote', 'pcs', 100, 2.5)`.execute(t);
      await sql`insert into price_tiers (product_id, min_qty, unit_price_usd) values (${PRODUCT}, 100, 2.5)`.execute(t);
      await sql`insert into assistants (business_id, name, is_default) values (${PILOT}, 'Lily', true)`.execute(t);
      await sql`insert into onboarding_state (business_id, assistant_named_at) values (${PILOT}, now())`.execute(t);
    });
    await setup.destroy();
    process.env['PILOT_BUSINESS_ID'] = PILOT;
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'pw-verify-token-xxx', CREDENTIAL_KEY: 'c'.repeat(64), PORT: 0,
    }, { adapter: sim.adapter, logger: false, media: {}, models: { analyzer, replyWriter } });
    const login = await prod.app.inject({ method: 'POST', url: '/login', headers: FORM,
      payload: `code=${encodeURIComponent(prod.ownerAccessCode)}` });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    // An enquiry the writer answers (language-gate.test.ts's shape): no template stands in for it.
    analyzer.next = {
      language: { detected: 'en', replyIn: 'en' },
      intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
      recommendedPhase: 'clarification',
    } as never;
  }, 60_000);
  afterAll(async () => { await prod?.close(); delete process.env['PILOT_BUSINESS_ID']; });

  it('signed out, Practice and its live line send the visitor to sign in (or 401 to the script)', async () => {
    const res = await prod.app.inject({ method: 'GET', url: '/app/sandbox' });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/login');
    const live = await prod.app.inject({ method: 'GET', url: '/app/live/practice?since=0.0.00000000', headers: { accept: 'application/json' } });
    expect(live.statusCode).toBe(401);
  });

  it('before the first message there is no copy and nothing to watch; the page starts empty', async () => {
    const res = await page();
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('No messages yet');
    expect(res.body).not.toContain('/app/live/practice');
  });

  it('a practice message: the copy is made, the line is on the page at once, and the WORKER answers it — a reply that waits, draft-first', async () => {
    replyWriter.replies = ['Yes, we make canvas totes in natural cotton.'];
    const r = await say('Do you make canvas totes?');
    expect(r.statusCode).toBe(302);
    expect(r.headers['location']).toBe('/app/sandbox#latest');

    copy = await inBiz(PILOT, (tx) => sql<{ id: string }>`select practice_copy(${PILOT}::uuid)::text as id`.execute(tx).then((x) => x.rows[0]!.id));
    expect(copy).toMatch(/^[0-9a-f-]{36}$/);
    expect(copy).not.toBe(PILOT);
    const conv = (await practiceConv())!;
    expect((await page()).body).toContain('Do you make canvas totes?');       // on the transcript before any turn

    const draft = await until(() => pendingDraft(conv), 'the practice draft');
    expect(draft.text).toContain('Yes, we make canvas totes in natural cotton.');
    expect(analyzer.texts).toContain('Do you make canvas totes?');            // the worker's turn, the real analyser port
    const shown = (await page()).body;
    expect(shown).toContain('action="/app/sandbox/act"');
    expect(shown).toContain('All checks passed');                               // the golden set's checks, run in the worker
    const checked = await inCopy((tx) => sql<{ n: number }>`select count(*)::int as n from conversation_events
      where conversation_id = ${conv}::uuid and type = 'sandbox_turn'`.execute(tx).then((x) => x.rows[0]!.n));
    expect(checked).toBe(1);
    expect(shown).toContain('/app/live/practice?since=');                       // and the page now watches for the answer
    // The workspace itself is untouched: the practice customer is the copy's alone.
    const leaked = await inBiz(PILOT, (tx) => sql<{ n: number }>`select count(*)::int as n from conversations where business_id = ${PILOT}::uuid`
      .execute(tx).then((x) => x.rows[0]!.n));
    expect(leaked).toBe(0);
  }, 90_000);

  it('P5 — a practice turn is the workspace\'s cost: on its own ledger and allowance, never the copy\'s', async () => {
    const ledger = (id: string) => inBiz(id, (tx) => sql<{ turns: number; calls: number }>`
      select coalesce(sum(turns), 0)::int as turns, coalesce(sum(llm_calls), 0)::int as calls
        from usage_ledger where business_id = ${id}::uuid`.execute(tx).then((r) => r.rows[0]!));
    const onWorkspace = await ledger(PILOT);
    expect(onWorkspace.turns).toBeGreaterThanOrEqual(1);
    expect(onWorkspace.calls).toBeGreaterThanOrEqual(2);   // the analysis and the reply
    expect(await ledger(copy)).toEqual({ turns: 0, calls: 0 });
  });

  it('Send: the ONE approval path, then the outbound worker and its gate, then the practice adapter — on the transcript, and no provider saw it', async () => {
    const conv = (await practiceConv())!;
    const draft = (await pendingDraft(conv))!;
    const act = await post('/app/sandbox/act', `draftId=${draft.id}&command=${encodeURIComponent('发送')}`);
    expect(act.statusCode).toBe(302);
    const sent = await until(async () => (await sentReplies(conv)).find((x) => x.body.includes('Yes, we make canvas totes')), 'the approved reply, sent');
    expect(sent.provider).toMatch(/^practice:/);
    expect(sent.origin).toBe('employee');
    // Delivered through the receipt path, so the next reply is not held 90 s for a receipt.
    expect(await until(async () => (await sentReplies(conv)).find((x) => x.status === 'delivered'), 'the receipt')).toBeTruthy();
    expect((await page()).body).toContain('msg outbound');
    nothingReachedAProvider('Yes, we make canvas totes in natural cotton.');
  }, 90_000);

  it('P4 — the card\'s one Send with the box changed sends the owner\'s words, through the same path', async () => {
    replyWriter.replies = ['Yes, the totes come in natural cotton.'];
    await say('What are they made of?');
    const conv = (await practiceConv())!;
    const draft = await until(() => pendingDraft(conv), 'the second draft');
    expect((await page()).body).toContain('name="command" value="send"');
    const act = await post('/app/sandbox/act', `draftId=${draft.id}&command=send&edit=${encodeURIComponent('Natural cotton, and a black one too.')}`);
    expect(act.statusCode).toBe(302);
    const sent = await until(async () => (await sentReplies(conv)).find((x) => x.body.includes('Natural cotton, and a black one too.')), 'the edited reply, sent');
    expect(sent.provider).toMatch(/^practice:/);
  }, 90_000);

  it('the live line: both sides counted — the owner\'s own line is not news, the answer is', async () => {
    const conv = (await practiceConv())!;
    const { conversationMark } = await import('../../src/api/web/live.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const c = parseBusinessId(copy); if (!c.ok) throw new Error('fixture');
    const mark = (await conversationMark(prod.db, c.value, conv, 'both'))!;
    const ask = (since: string) => prod.app.inject({ method: 'GET', url: `/app/live/practice?since=${since}`, headers: { cookie, accept: 'application/json' } });
    expect((await ask(mark)).json()).toEqual({ news: false });
    const [n, ...rest] = mark.split('.');
    expect((await ask([String(Number(n) - 1), ...rest].join('.'))).json()).toEqual({ news: true, what: 'practice' });
    expect((await ask('not-a-mark')).statusCode).toBe(400);
  });

  it('a capability the workspace lets send alone sends alone in Practice — the refresh carries it — with the disclosure in front', async () => {
    await setAutonomy('auto');
    try {
      replyWriter.replies = ['Yes, there is a minimum order on every tote.'];
      replyWriter.calls = 0;
      await say('Do you have a minimum?');
      const conv = (await practiceConv())!;
      const sent = await until(async () => (await sentReplies(conv)).find((x) => x.body.includes('Yes, there is a minimum order on every tote.')), 'the reply sent alone');
      expect(sent.body).toContain('AI assistant');
      expect(sent.provider).toMatch(/^practice:/);
      nothingReachedAProvider('Yes, there is a minimum order on every tote.');
    } finally {
      await setAutonomy('draft');
    }
  }, 90_000);

  it('the owner\'s Stop binds Practice: the message is held — a turn, no model — and handed to a person; nothing is sent or drafted', async () => {
    await post('/app/sandbox/reset');   // a conversation of its own: nothing earlier waits in it
    await inBiz(PILOT, (tx) => sql`update businesses set assistant_stopped_at = now(), assistant_stopped_by = 'owner' where id = ${PILOT}::uuid`.execute(tx));
    try {
      const asked = analyzer.calls;
      await say('Are you there?');
      const conv = (await practiceConv())!;
      const held = await until(() => inCopy((tx) => sql<{ reason: string }>`
        select decision->'action'->>'reason' as reason from turns
         where conversation_id = ${conv}::uuid and decision->'action'->>'kind' = 'held' limit 1`.execute(tx).then((x) => x.rows[0])), 'the held turn');
      expect(held.reason).toBe('assistant_stopped');
      expect(analyzer.calls).toBe(asked);
      const assigned = await inCopy((tx) => sql<{ a: string | null }>`select assigned_to as a from conversations where id = ${conv}::uuid`.execute(tx).then((x) => x.rows[0]!.a));
      expect(assigned).toBe('unclaimed');
      expect(await pendingDraft(conv)).toBeUndefined();
    } finally {
      await inBiz(PILOT, (tx) => sql`update businesses set assistant_stopped_at = null, assistant_stopped_by = null where id = ${PILOT}::uuid`.execute(tx));
    }
  }, 90_000);

  it('P4 — as if sending alone: a reply the workspace would hold goes alone in Practice, with the disclosure; the workspace\'s levels are untouched', async () => {
    await post('/app/sandbox/reset');
    const levels = () => inBiz(PILOT, (tx) => sql<{ n: number }>`select count(*)::int as n from autonomy_policy
      where business_id = ${PILOT}::uuid and mode = 'auto'`.execute(tx).then((x) => x.rows[0]!.n));
    const before = await levels();
    const on = await post('/app/sandbox/alone', 'on=1');
    expect(on.statusCode).toBe(302);
    expect((await page()).body).toContain('action="/app/sandbox/alone"');
    try {
      replyWriter.replies = ['Yes, we make totes to order.'];
      await say('Do you make totes to order?');
      const conv = (await practiceConv())!;
      const sent = await until(async () => (await sentReplies(conv)).find((x) => x.body.includes('Yes, we make totes to order.')), 'the reply, alone');
      expect(sent.body).toContain('AI assistant');                       // as a customer meets it: the disclosure in front
      expect(await pendingDraft(conv)).toBeUndefined();
      expect(await levels()).toBe(before);                                // the workspace's own levels: unchanged
    } finally {
      await post('/app/sandbox/alone', 'on=');
    }
    const auto = await inCopy((tx) => sql<{ n: number }>`select count(*)::int as n from autonomy_policy
      where business_id = ${copy}::uuid and mode = 'auto'`.execute(tx).then((x) => x.rows[0]!.n));
    expect(auto).toBe(before);                                            // back to the workspace's levels
  }, 90_000);

  it('P4 — as if sending alone lifts the owner\'s level and nothing else: a Spanish customer\'s reply still waits, and the card says why', async () => {
    await post('/app/sandbox/reset');
    await post('/app/sandbox/alone', 'on=1');
    try {
      analyzer.next = {
        language: { detected: 'es', replyIn: 'es' },
        intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
        recommendedPhase: 'clarification',
      } as never;
      replyWriter.replies = ['Sí, hacemos bolsas de lona.'];
      await say('¿Hacen bolsas de lona?');
      const conv = (await practiceConv())!;
      await until(() => pendingDraft(conv), 'the Spanish reply, waiting');
      expect((await page()).body).toContain('does not send alone to customers writing in Spanish yet');
    } finally {
      analyzer.next = {
        language: { detected: 'en', replyIn: 'en' },
        intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
        recommendedPhase: 'clarification',
      } as never;
      await post('/app/sandbox/alone', 'on=');
    }
  }, 90_000);

  it('P4 — Practice\'s own Stop: the message is held and handed to the owner; the workspace\'s real Stop is untouched', async () => {
    await post('/app/sandbox/reset');
    expect((await post('/app/sandbox/stop', 'on=1')).statusCode).toBe(302);
    try {
      expect((await page()).body).toContain(t('en', 'practice.stop.stopped'));
      const asked = analyzer.calls;
      await say('Anyone there?');
      const conv = (await practiceConv())!;
      await until(() => inCopy((tx) => sql<{ n: number }>`select count(*)::int as n from turns
        where conversation_id = ${conv}::uuid and decision->'action'->>'kind' = 'held'`.execute(tx).then((x) => (x.rows[0]!.n > 0 ? true : undefined))), 'the held turn');
      expect(analyzer.calls).toBe(asked);
      const real = await inBiz(PILOT, (tx) => sql<{ s: boolean }>`select assistant_stopped_at is not null as s from businesses
        where id = ${PILOT}::uuid`.execute(tx).then((x) => x.rows[0]!.s));
      expect(real).toBe(false);
    } finally {
      await post('/app/sandbox/stop', 'on=');
    }
    const copyStopped = await inCopy((tx) => sql<{ s: boolean }>`select assistant_stopped_at is not null as s from businesses
      where id = ${copy}::uuid`.execute(tx).then((x) => x.rows[0]!.s));
    expect(copyStopped).toBe(false);
  }, 90_000);

  /** The copy's product, the one that stands for the workspace's canvas tote. */
  const copyProduct = () => inCopy((tx) => sql<{ id: string }>`select id::text as id from products
    where business_id = ${copy}::uuid and source_id = ${PRODUCT}::uuid`.execute(tx).then((x) => x.rows[0]!.id));
  /** A price the turn worked out, as its quotes row — the fixture stands for the turn's own quote. */
  const quoted = async (conv: string, total: number) => {
    const product = await copyProduct();
    await inCopy((tx) => sql`insert into quotes (business_id, conversation_id, product_id, quantity, inputs, unit_price_usd, total_usd, engine_version)
      values (${copy}::uuid, ${conv}::uuid, ${product}::uuid, 200, '{}'::jsonb, ${total / 200}, ${total}, 'practice-test')`.execute(tx));
  };
  const checks = () => inBiz(PILOT, (tx) => sql<{ item: string }>`select item from practice_checks where business_id = ${PILOT}::uuid`
    .execute(tx).then((x) => x.rows.map((r) => r.item)));

  it('P4 — your total first: the total the owner expected is kept, and set beside the answer\'s; agreeing ticks "quoted"', async () => {
    await post('/app/sandbox/reset');
    expect((await page()).body).toContain('name="expected"');
    await post('/app/sandbox/message', `text=${encodeURIComponent('200 canvas totes, how much?')}&expected=${encodeURIComponent('500.00')}`);
    const conv = (await practiceConv())!;
    const kept = await inBiz(PILOT, (tx) => sql<{ expected: string; agreed: boolean | null }>`select expected::text as expected, agreed
      from practice_totals where business_id = ${PILOT}::uuid order by created_at desc limit 1`.execute(tx).then((x) => x.rows[0]!));
    expect(Number(kept.expected)).toBe(500);
    expect(kept.agreed).toBeNull();                                         // no answer yet
    await quoted(conv, 500);
    const body = (await page()).body;
    expect(body).toMatch(/You expected [^;]*500\.00[^;]*; the answer said [^.]*500\.00/);
    expect(await checks()).toContain('quoted');

    // …and one that does not agree is said so, and recorded as such.
    await new Promise((r) => setTimeout(r, 20));
    await post('/app/sandbox/message', `text=${encodeURIComponent('and 200 in black?')}&expected=450`);
    await new Promise((r) => setTimeout(r, 20));
    await quoted(conv, 500);
    expect((await page()).body).toContain('Check that product');
    const verdicts = await inBiz(PILOT, (tx) => sql<{ agreed: boolean }>`select agreed from practice_totals
      where business_id = ${PILOT}::uuid and agreed is not null order by created_at`.execute(tx).then((x) => x.rows.map((r) => r.agreed)));
    expect(verdicts.slice(-2)).toEqual([true, false]);
  }, 90_000);

  it('P4 — an order in Practice waits for the owner\'s tap, and the tap goes through the one order service', async () => {
    await post('/app/sandbox/reset');
    await say('I will take 200.');
    const conv = (await practiceConv())!;
    const product = await copyProduct();
    const proposal = await inCopy((tx) => sql<{ id: string }>`
      insert into order_proposals (business_id, conversation_id, client_id, product_id, quantity, unit, unit_price, total, currency, client_email)
      select ${copy}::uuid, c.id, c.client_id, ${product}::uuid, 200, 'pcs', 2.5, 500, 'USD', 'buyer@example.com'
        from conversations c where c.id = ${conv}::uuid
      returning id::text as id`.execute(tx).then((x) => x.rows[0]!.id));
    const shown = (await page()).body;
    expect(shown).toContain('action="/app/sandbox/order/confirm"');
    expect(shown).toContain(`name="proposalId" value="${proposal}"`);
    expect(shown).not.toContain('/app/inbox/');                            // never the conversation page's routes
    const r = await post('/app/sandbox/order/confirm', `proposalId=${proposal}`);
    expect(r.statusCode).toBe(302);
    const state = await inCopy((tx) => sql<{ state: string; order: string | null }>`select state, order_id::text as order
      from order_proposals where id = ${proposal}::uuid`.execute(tx).then((x) => x.rows[0]!));
    expect(state.state).toBe('confirmed');
    expect(state.order).not.toBeNull();
    // What the customer received: the confirmation, through the practice adapter.
    const told = await until(async () => (await sentReplies(conv)).find((x) => x.provider?.startsWith('practice:') && x.origin === 'employee'), 'the confirmation, sent');
    expect(told.body.length).toBeGreaterThan(0);
    await page();
    expect(await checks()).toContain('order_tapped');
  }, 90_000);

  it('P4 — what was seen stays seen: Start over erases the transcript, not the checklist', async () => {
    await page();
    const before = await checks();
    expect(before).toEqual(expect.arrayContaining(['stop_handoff', 'quoted', 'order_tapped']));
    expect((await post('/app/sandbox/reset')).statusCode).toBe(302);
    const body = (await page()).body;
    expect(await checks()).toEqual(expect.arrayContaining(before));
    expect(body).toContain(t('en', 'practice.checklist.title'));
    expect(body).toContain(t('en', 'practice.check.stop_handoff'));
  }, 60_000);

  it('Practice alerts nobody: the notify consumer refuses a copy, whatever queued the alert', async () => {
    const { deliverOwnerAlert } = await import('../../src/pipeline/notify.js');
    const sent: string[] = [];
    const recorder = { sendText: async (to: string) => { sent.push(to); return { ok: true as const, providerMessageId: 'x' }; } };
    const conv = (await practiceConv())!;
    for (const kind of ['handoff', 'hot_lead', 'deletion_requested', 'order_proposed'] as const) {
      expect(await deliverOwnerAlert({ db: prod.db, adapter: recorder }, { businessId: copy, kind, conversationId: conv }), kind).toBe('skipped_practice');
    }
    expect(sent).toEqual([]);
  });

  it('take over, reply, hand back — the same lifecycle, on the copy; the owner\'s reply leaves through the outbound worker to the practice adapter', async () => {
    // A conversation of its own: the test before it started over.
    if (!(await practiceConv())) await say('Hello, is anyone there?');
    const conv = (await practiceConv())!;
    expect((await post('/app/sandbox/takeover')).statusCode).toBe(302);
    const holder = await inCopy((tx) => sql<{ a: string | null }>`select assigned_to as a from conversations where id = ${conv}::uuid`.execute(tx).then((x) => x.rows[0]!.a));
    expect(holder).not.toBeNull();
    expect(holder).not.toBe('unclaimed');
    expect((await page()).body).toContain('action="/app/sandbox/reply"');

    expect((await post('/app/sandbox/reply', `text=${encodeURIComponent('Owner here — 4,800 pcs is fine.')}`)).statusCode).toBe(302);
    const mine = await until(async () => (await sentReplies(conv)).find((x) => x.origin === 'owner'), 'the owner\'s reply, sent');
    expect(mine.body).toBe('Owner here — 4,800 pcs is fine.');
    expect(mine.provider).toMatch(/^practice:/);
    nothingReachedAProvider('Owner here — 4,800 pcs is fine.');
    // Phase 9 (V1-285) — on the page, the owner's own line is captioned "You", never as the assistant's.
    const shownMine = await until(async () => {
      const b = (await page()).body; return b.includes('Owner here — 4,800 pcs is fine.') ? b : undefined;
    }, 'the owner\'s reply, on the page');
    const bubble = shownMine.slice(shownMine.indexOf('Owner here — 4,800 pcs is fine.'));
    // (the fix wave) the caption carries its time too: "01:41 · You" — the owner's, never the assistant's.
    expect(bubble.match(/<div class="ts muted">([\s\S]*?)<\/div>/)?.[1]?.trim()).toMatch(/(^|· )You$/);

    expect((await post('/app/sandbox/resume')).statusCode).toBe(302);
    const back = await inCopy((tx) => sql<{ a: string | null }>`select assigned_to as a from conversations where id = ${conv}::uuid`.execute(tx).then((x) => x.rows[0]!.a));
    expect(back).toBeNull();
    expect((await page()).body).toContain('action="/app/sandbox/takeover"');

    // Getting ready reads the rehearsal from the workspace's own copy.
    const { loadPilotRunbook } = await import('../../src/api/web/pilot.js');
    const rb = await loadPilotRunbook(prod.db, PILOT, { practiceBusinessId: copy });
    expect(rb.rehearsal.done).toMatchObject({ takeover: true, ownerReply: true, resume: true });
    const onboarding = await prod.app.inject({ method: 'GET', url: '/app/onboarding', headers: { cookie } });
    expect(onboarding.statusCode).toBe(200);
  }, 90_000);

  it('teach an answer on the workspace → Practice answers with it; correct it → the NEW answer: the copy follows the workspace', async () => {
    const { teachKnowledge, correctKnowledge } = await import('../../src/api/web/knowledge.js');
    const label = 'What is your minimum order?';
    await teachKnowledge(prod.db, PILOT, { productId: null, kind: 'faq', label, content: 'Our minimum order is 1000 pieces.' });
    const ask = async (want: string) => {
      await post('/app/sandbox/reset');
      await say('what is your minimum order?');
      const conv = (await practiceConv())!;
      return until(async () => {
        const t = await inCopy((tx) => sql<{ t: string }>`
          select coalesce(string_agg(x, ' | '), '') as t from (
            select draft_text as x from drafts where conversation_id = ${conv}::uuid
            union all select body from outbound_messages where conversation_id = ${conv}::uuid) y`.execute(tx).then((r) => r.rows[0]!.t));
        return t.includes(want) ? t : undefined;
      }, `an answer with "${want}"`);
    };
    expect(await ask('Our minimum order is 1000 pieces.')).toContain('1000 pieces');
    const id = await inBiz(PILOT, (tx) => sql<{ id: string }>`
      select id::text as id from product_knowledge where business_id = ${PILOT}::uuid and status = 'active' and label = ${label}`
      .execute(tx).then((r) => r.rows[0]!.id));
    await correctKnowledge(prod.db, PILOT, id, 'Our minimum order is 2000 pieces.');
    const second = await ask('Our minimum order is 2000 pieces.');
    expect(second).not.toContain('1000 pieces');
  }, 120_000);

  it('P5 — fifty a day: the fifty-first practice line is refused, and nothing is recorded, queued or asked', async () => {
    const lines = () => inBiz(PILOT, (tx) => sql<{ day: string | null; n: number }>`
      select practice_day::text as day, practice_lines as n from businesses where id = ${PILOT}::uuid`.execute(tx).then((x) => x.rows[0]!));
    // every line so far was counted, on the workspace's own row
    expect((await lines()).n).toBeGreaterThanOrEqual(5);
    await inBiz(PILOT, (tx) => sql`update businesses set practice_day = (now() at time zone 'UTC')::date, practice_lines = 50
      where id = ${PILOT}::uuid`.execute(tx));
    const conv = await practiceConv();
    const said0 = conv ? await inCopy((tx) => sql<{ n: number }>`select count(*)::int as n from messages
      where conversation_id = ${conv}::uuid`.execute(tx).then((x) => x.rows[0]!.n)) : 0;
    const asked = analyzer.calls;
    const r = await say('one more?');
    expect(r.statusCode).toBe(302);
    const { flashSaid } = await import('./tenant.js');
    expect(flashSaid(r, WEB_SECRET).replace(/[\u2066-\u2069]/g, '')).toContain('Practice takes 50 messages a day');
    const said1 = conv ? await inCopy((tx) => sql<{ n: number }>`select count(*)::int as n from messages
      where conversation_id = ${conv}::uuid`.execute(tx).then((x) => x.rows[0]!.n)) : 0;
    expect(said1).toBe(said0);
    expect((await lines()).n).toBe(50);
    await new Promise((res) => setTimeout(res, 2_000));
    expect(analyzer.calls).toBe(asked);
    // Start over erases the transcript, and does not give the day back.
    await post('/app/sandbox/reset');
    expect(flashSaid(await say('and now?'), WEB_SECRET)).toContain('Practice takes');
    // …tomorrow does.
    await inBiz(PILOT, (tx) => sql`update businesses set practice_day = practice_day - 1 where id = ${PILOT}::uuid`.execute(tx));
    const { practiceRefusal } = await import('../../src/db/practice.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const live = parseBusinessId(PILOT); if (!live.ok) throw new Error('fixture');
    expect(await practiceRefusal(prod.db, live.value)).toBeNull();
  }, 60_000);

  it('P5 — the operator\'s switch (0088): practice_off for this workspace, or for everyone, refuses the message', async () => {
    const pg = (await import('pg')).default;
    const admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    const { practiceRefusal } = await import('../../src/db/practice.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const live = parseBusinessId(PILOT); if (!live.ok) throw new Error('fixture');
    try {
      // a copy that has used up nothing today
      await post('/app/sandbox/reset');
      expect(await practiceRefusal(prod.db, live.value)).toBeNull();
      const own = (await admin.query(`insert into ops_flags (business_id, flag, reason, set_by) values ($1, 'practice_off', 'test', 'test') returning id`, [PILOT])).rows[0].id;
      try {
        const r = await say('anyone there?');
        const { flashSaid } = await import('./tenant.js');
        expect(flashSaid(r, WEB_SECRET)).toContain('Practice is paused for now');
        expect(await practiceConv()).toBeUndefined();           // nothing was recorded
      } finally {
        await admin.query(`update ops_flags set cleared_at = now() where id = $1`, [own]);
      }
      expect(await practiceRefusal(prod.db, live.value)).toBeNull();
      const everyone = (await admin.query(`insert into ops_flags (business_id, flag, reason, set_by) values (null, 'practice_off', 'test', 'test') returning id`)).rows[0].id;
      try {
        expect(await practiceRefusal(prod.db, live.value)).toBe('switched_off');
      } finally {
        await admin.query(`update ops_flags set cleared_at = now() where id = $1`, [everyone]);
      }
      expect(await practiceRefusal(prod.db, live.value)).toBeNull();
    } finally {
      await admin.end();
    }
  });

  it('P6 — Start over ERASES the practice conversation and all that hangs off it; the copy and its customer stay', async () => {
    await say('a line to start over from');
    const before = (await practiceConv())!;
    await until(() => pendingDraft(before), 'the reply to the line');
    const count = (table: string) => inCopy((tx) => sql<{ n: number }>`select count(*)::int as n from ${sql.table(table)}
      where conversation_id = ${before}::uuid`.execute(tx).then((x) => x.rows[0]!.n));
    for (const t of ['messages', 'turns', 'drafts', 'conversation_events']) expect(await count(t), t).toBeGreaterThan(0);
    expect((await post('/app/sandbox/reset')).statusCode).toBe(302);
    expect(await practiceConv()).toBeUndefined();
    for (const t of ['messages', 'turns', 'drafts', 'conversation_events']) expect(await count(t), t).toBe(0);
    const left = await inCopy((tx) => sql<{ convs: number; products: number; customer: number }>`
      select (select count(*)::int from conversations where business_id = ${copy}::uuid) as convs,
             (select count(*)::int from products where business_id = ${copy}::uuid) as products,
             (select count(*)::int from client_channels where channel_user_id = ${`practice:${copy}`}) as customer`.execute(tx).then((x) => x.rows[0]!));
    expect(left).toEqual({ convs: 0, products: 1, customer: 1 });
    expect((await page()).body).toContain('No messages yet');
  }, 90_000);

  it('P6 — a job whose conversation was erased while it waited is dropped: no turn, no model, no error', async () => {
    const pg = (await import('pg')).default;
    const admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    try {
      const errorsNow = async () => (await admin.query('select coalesce(sum(count), 0)::int as n from app_errors')).rows[0].n as number;
      const [asked, errors0] = [analyzer.calls, await errorsNow()];
      const { QUEUES } = await import('../../src/queue/boss.js');
      const id = await prod.boss.send(QUEUES.inbound, { businessId: copy, conversationId: randomUUID(), messageId: `practice:${randomUUID()}`, text: 'late line', messageType: 'text' });
      const state = () => admin.query('select state from pgboss.job where id = $1', [id]).then((r) => r.rows[0]?.state as string | undefined);
      await until(async () => ((await state()) === 'completed' ? true : undefined), 'the job, completed');
      expect(analyzer.calls).toBe(asked);
      expect(await errorsNow()).toBe(errors0);
    } finally {
      await admin.end();
    }
  }, 60_000);
});
