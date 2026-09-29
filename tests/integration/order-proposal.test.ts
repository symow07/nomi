import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { runDigits } from './tenant.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';

/**
 * 0080 — AN ORDER WAITS FOR THE OWNER'S TAP, through the PRODUCTION
 * composition: a signed WhatsApp webhook, the real worker, Postgres, the
 * owner's own routes. Every capability the owner may put on auto is on auto,
 * and the assistant's name is confirmed — the setting in which the defect
 * sent "Your order is confirmed" with nobody looking.
 *
 *   · the customer's "yes", with every order rule passing, writes a proposal:
 *     no order, no message queued, no draft, the conversation still open, an
 *     `order_proposed` alert queued (e-mail always);
 *   · it leads Buyers and Today, and the live answer counts it;
 *   · the owner's tap creates the order from exactly that proposal, closes the
 *     conversation, and only then queues the confirmation; a second tap does
 *     nothing;
 *   · stepping in sets it aside and gives the owner the conversation, with
 *     nothing created or sent;
 *   · while the assistant is stopped the tap is refused and the order waits;
 *   · the pending question is set when a message that asks it LEAVES — an
 *     approved draft carries its question to the send; an edited one does not.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd800000-0000-4000-8000-${RUN}0001`;
const PID = `dd800000-0000-4000-8001-${RUN}0001`;
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const CUSTOMERS = {
  confirm: `9718${runDigits(RUN, 6)}1`,
  stepIn: `9718${runDigits(RUN, 6)}2`,
  stopped: `9718${runDigits(RUN, 6)}3`,
  asks: `9718${runDigits(RUN, 6)}4`,
} as const;

type Tx = import('../../src/db/client.js').Tx;

const bidOf = async (raw: string) => {
  const { parseBusinessId } = await import('../../src/core/types/ids.js');
  const b = parseBusinessId(raw); if (!b.ok) throw new Error('fixture'); return b.value;
};
/** Outcomes, never speed: the queues are shared with every file that ran before this one. */
const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 90_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

d('0080 · an order waits for the owner\'s tap (requires DATABASE_URL)', { timeout: 180_000 }, () => {
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  let cookie = '';
  const analyzer = new FakeAnalyzer();
  analyzer.next = {
    language: { detected: 'en', replyIn: 'en' },
    intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
    recommendedPhase: 'clarification',
    wantsPerson: false,
  };
  const replyWriter = new FakeReplyWriter();
  replyWriter.replies = Array.from({ length: 20 }, () => 'Happy to help — which colour would you like?');

  const q = async <T>(fn: (tx: Tx) => Promise<T>) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(prod.db, await bidOf(BIZ), fn);
  };
  const post = (w: { rawBody: string; headers: Record<string, string> }) =>
    prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: w.rawBody,
      headers: { 'content-type': 'application/json', ...w.headers } });
  const get = (url: string) => prod.app.inject({ method: 'GET', url, headers: { cookie } });
  const postForm = (url: string, fields: Record<string, string> = {}) => prod.app.inject({
    method: 'POST', url, headers: { cookie, ...FORM }, payload: new URLSearchParams(fields).toString() });
  const convOf = (wa: string) => until(() => q((tx) => sql<{ id: string }>`
    select c.id::text as id from conversations c
      join client_channels cc on cc.client_id = c.client_id and cc.channel = 'whatsapp'
     where cc.channel_user_id = ${wa} limit 1`.execute(tx).then((r) => r.rows[0]?.id)), `conversation of ${wa}`);
  const say = async (wa: string, text: string) => {
    expect((await post(sim.inboundText({ from: wa, text }))).statusCode).toBe(200);
  };
  const turnsOf = (conv: string) => q((tx) => sql<{ n: number }>`
    select count(*)::int as n from turns where conversation_id = ${conv}::uuid`.execute(tx).then((r) => r.rows[0]!.n));
  /** The conversation, as the customer's "yes" is about to find it: "shall I confirm?" asked and sent. */
  const readyToConfirm = (conv: string) => q(async (tx) => {
    await sql`update conversations set phase = 'confirmation', assigned_to = null where id = ${conv}::uuid`.execute(tx);
    await sql`update conversation_state set identified_product_id = ${PID}::uuid, product_confidence = 0.95,
                product_confirmed_by_client = true, inquiry_quantity = 40, inquiry_unit = 'boxes',
                pending_question = 'order_confirmation', problem_score = 0
               where conversation_id = ${conv}::uuid`.execute(tx);
    await sql`update clients set email = 'customer@example.com'
               where id = (select client_id from conversations where id = ${conv}::uuid)`.execute(tx);
  });
  const footprint = (conv: string) => q((tx) => sql<{
    proposals: number; pending: number; orders: number; outbound: number; drafts: number; active: boolean;
    assigned: string | null; events: string[];
  }>`
    select (select count(*)::int from order_proposals p where p.conversation_id = c.id) as proposals,
           (select count(*)::int from order_proposals p where p.conversation_id = c.id and p.state = 'pending') as pending,
           (select count(*)::int from orders o where o.conversation_id = c.id) as orders,
           (select count(*)::int from outbound_messages o where o.conversation_id = c.id) as outbound,
           (select count(*)::int from drafts dd where dd.conversation_id = c.id) as drafts,
           c.is_active as active, c.assigned_to as assigned,
           coalesce((select array_agg(e.type order by e.id) from conversation_events e
                      where e.conversation_id = c.id), '{}') as events
      from conversations c where c.id = ${conv}::uuid`.execute(tx).then((r) => r.rows[0]!));
  const alertsFor = async (conv: string, kind: string) => {
    const { QUEUES } = await import('../../src/queue/boss.js');
    return (await sql<{ n: number }>`
      select count(*)::int as n from pgboss.job
       where name = ${QUEUES.notify} and data->>'kind' = ${kind} and data->>'conversationId' = ${conv}`
      .execute(prod.db)).rows[0]!.n;
  };
  const proposalOf = (conv: string) => q((tx) => sql<{ id: string; state: string; order_id: string | null; decided_by: string | null }>`
    select id::text as id, state, order_id::text as order_id, decided_by from order_proposals
     where conversation_id = ${conv}::uuid order by created_at desc limit 1`.execute(tx).then((r) => r.rows[0]));
  /** A conversation whose customer said yes, waiting for the owner: its id, and what it looked like before the yes. */
  const proposed = async (wa: string) => {
    await say(wa, 'hello, I would like some gift boxes');
    const conv = await convOf(wa);
    await until(async () => ((await turnsOf(conv)) >= 1 ? true : undefined), 'the first turn');
    // Its reply is queued by the worker after the turn: wait for it, so the yes's footprint is the yes's alone.
    await until(async () => ((await footprint(conv)).outbound >= 1 ? true : undefined), 'the first reply');
    await readyToConfirm(conv);
    const before = await footprint(conv);
    await say(wa, 'yes');
    await until(async () => ((await footprint(conv)).proposals >= 1 ? true : undefined), 'the proposal');
    await until(async () => ((await turnsOf(conv)) >= 2 ? true : undefined), 'the second turn');
    return { conv, before };
  };

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    sim = whatsappSimulator([], { tag: `ord${RUN}` });
    const setup = createDb(DATABASE_URL!);
    await withTenantTx(setup, await bidOf(BIZ), async (t) => {
      await sql`insert into businesses (id, name, engine) values (${BIZ}, 'Order Waits', 'service')
                on conflict (id) do nothing`.execute(t);
      await sql`update businesses set batch_debounce_ms = 300, batch_max_window_ms = 1000 where id = ${BIZ}`.execute(t);
      // Live: activated, and not in pilot mode, so what is sent reaches the customer.
      await sql`insert into channels (business_id, kind, status, display_phone, connected_at, activated_at, activated_by, pilot_mode)
                values (${BIZ}, 'whatsapp', 'connected', '+86 579****0080', now(), now(), 'test', false)`.execute(t);
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
                values (${BIZ}, 'whatsapp', ${sim.phoneNumberId}, 'sim-test', 'service')`.execute(t);
      for (const cap of ['greet', 'qualify', 'recommend', 'quote', 'negotiate', 'follow_up', 'confirm_order']) {
        await sql`insert into autonomy_policy (business_id, capability, mode) values (${BIZ}, ${cap}, 'auto')
                  on conflict (business_id, capability) do update set mode = 'auto'`.execute(t);
      }
      await sql`insert into assistants (business_id, name, is_default) values (${BIZ}, 'Lily', true)`.execute(t);
      await sql`insert into onboarding_state (business_id, assistant_named_at) values (${BIZ}, now())
                on conflict (business_id) do update set assistant_named_at = now()`.execute(t);
      await sql`insert into products (id, business_id, sku, name, unit, moq, is_active)
                values (${PID}, ${BIZ}, ${'OW-' + RUN}, 'Gift box', 'boxes', 10, true)`.execute(t);
      await sql`insert into price_tiers (product_id, min_qty, max_qty, unit_price_usd, currency)
                values (${PID}, 10, null, 2.10, 'USD')`.execute(t);
      await sql`insert into pricing_policy
                  (business_id, product_id, floor_price_usd, currency, max_discount_pct, human_required_above_pct)
                values (${BIZ}, ${PID}, 1.50, 'USD', 10, 50)`.execute(t);
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
      WEBHOOK_VERIFY_TOKEN: 'ord-verify-token-xx',
      CREDENTIAL_KEY: 'b'.repeat(64),
      PORT: 0,
    }, {
      adapter: sim.adapter, logger: false, models: { analyzer, replyWriter },
      // Every capability on auto is the point here: the "yes" must still wait
      // with sending alone released. The real gate is shut while es/fr wait
      // for a reader (CLAUDE.md rule 1), so this file opens it as a rehearsal.
      autonomyReleased: () => true,
    });
    const login = await prod.app.inject({ method: 'POST', url: '/login', headers: FORM,
      payload: `code=${encodeURIComponent(prod.ownerAccessCode)}` });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 60_000);
  afterAll(async () => { await prod?.close(); });

  let confirmConv = '';

  it('the "yes" writes a proposal and nothing else: no order, nothing queued or drafted, still open, the owner alerted', async () => {
    const { conv, before } = await proposed(CUSTOMERS.confirm);
    confirmConv = conv;
    const after = await footprint(conv);
    expect(after.pending).toBe(1);
    expect(after.orders).toBe(0);
    expect(after.outbound).toBe(before.outbound);
    expect(after.drafts).toBe(before.drafts);
    expect(after.active).toBe(true);
    expect(after.events).toContain('order_proposed');
    expect(after.events).not.toContain('order_created');
    await until(async () => ((await alertsFor(conv, 'order_proposed')) > 0 ? true : undefined), 'the order alert');
    // Exactly what they said yes to.
    const row = await q((tx) => sql<{ quantity: number; unit: string; total: string; currency: string; client_email: string }>`
      select quantity, unit, total::text as total, currency, client_email from order_proposals
       where conversation_id = ${conv}::uuid`.execute(tx).then((r) => r.rows[0]!));
    expect(row).toEqual({ quantity: 40, unit: 'boxes', total: '84.00', currency: 'USD', client_email: 'customer@example.com' });
  });

  it('it leads Buyers and Today, and every live answer counts it', async () => {
    const list = await get('/app/inbox?filter=pending');
    expect(list.statusCode).toBe(200);
    const head = list.body.indexOf('Said yes to an order');
    expect(head).toBeGreaterThan(-1);
    expect(list.body.indexOf(confirmConv)).toBeGreaterThan(head);
    const today = await get('/app');
    // The design pass: Today's first block is the Buyers list's own "Needs
    // you", in its order — the order first, named, a door to its conversation.
    const first = today.body.indexOf('<a class="tline" href="/app/inbox/');
    expect(first).toBeGreaterThan(-1);
    expect(today.body.slice(first)).toMatch(new RegExp(`^<a class="tline" href="/app/inbox/${confirmConv}#latest">[\\s\\S]*?Order waiting`));
    expect(today.body).toMatch(/data-live-orders="[1-9][0-9]*"/);
    const live = await get('/app/live/today?since=0.0.0.0.0.0');
    expect(live.statusCode).toBe(200);
    expect((live.json() as { orders: number }).orders).toBeGreaterThanOrEqual(1);
  });

  it('the conversation page shows what they said yes to, and the two answers', async () => {
    const page = await get(`/app/inbox/${confirmConv}`);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('They said yes to this order');
    expect(page.body).toContain('customer@example.com');
    expect(page.body).toContain(`/app/inbox/${confirmConv}/order/confirm`);
    expect(page.body).toContain(`/app/inbox/${confirmConv}/order/step-in`);
  });

  it('the owner\'s tap creates the order, closes the conversation, and only then queues the confirmation — once', async () => {
    const p = (await proposalOf(confirmConv))!;
    const before = await footprint(confirmConv);
    const r = await postForm(`/app/inbox/${confirmConv}/order/confirm`, { proposalId: p.id });
    expect(r.statusCode).toBe(302);
    const after = await footprint(confirmConv);
    expect(after.orders).toBe(1);
    expect(after.active).toBe(false);
    expect(after.events).toContain('order_created');
    const decided = (await proposalOf(confirmConv))!;
    expect(decided.state).toBe('confirmed');
    expect(decided.order_id).not.toBeNull();
    const order = await q((tx) => sql<{ quantity: number; total: string; by_actor: string }>`
      select o.quantity, o.total_value_usd::text as total, u.by_actor from orders o
        join order_updates u on u.order_id = o.id where o.id = ${decided.order_id}::uuid`.execute(tx).then((x) => x.rows[0]!));
    expect(order.quantity).toBe(40);
    expect(order.total).toBe('84.00');
    expect(order.by_actor).not.toBe('employee');
    // The confirmation is queued now, by the tap, through the ordinary outbound path.
    const sent = await until(() => q((tx) => sql<{ body: string }>`
      select body from outbound_messages where conversation_id = ${confirmConv}::uuid and body like 'Your order is confirmed%'`
      .execute(tx).then((x) => x.rows[0])), 'the confirmation');
    expect(sent.body).toContain('Gift box');
    expect(after.outbound).toBeGreaterThanOrEqual(before.outbound);

    const again = await postForm(`/app/inbox/${confirmConv}/order/confirm`, { proposalId: p.id });
    expect(again.statusCode).toBe(302);
    expect((await footprint(confirmConv)).orders).toBe(1);
    const confirmations = await q((tx) => sql<{ n: number }>`
      select count(*)::int as n from outbound_messages
       where conversation_id = ${confirmConv}::uuid and body like 'Your order is confirmed%'`.execute(tx).then((x) => x.rows[0]!.n));
    expect(confirmations).toBe(1);
  });

  it('stepping in sets the order aside and gives the owner the conversation: nothing created, nothing sent', async () => {
    const { conv } = await proposed(CUSTOMERS.stepIn);
    const p = (await proposalOf(conv))!;
    const before = await footprint(conv);
    const r = await postForm(`/app/inbox/${conv}/order/step-in`, { proposalId: p.id });
    expect(r.statusCode).toBe(302);
    const after = await footprint(conv);
    expect((await proposalOf(conv))!.state).toBe('set_aside');
    expect(after.orders).toBe(0);
    expect(after.outbound).toBe(before.outbound);
    expect(after.assigned).not.toBeNull();
    expect(after.active).toBe(true);
    expect(after.events).toContain('order_set_aside');
  });

  it('while the assistant is stopped the tap is refused, and the order still waits', async () => {
    const { conv } = await proposed(CUSTOMERS.stopped);
    const p = (await proposalOf(conv))!;
    await q((tx) => sql`update businesses set assistant_stopped_at = now() where id = ${BIZ}`.execute(tx));
    try {
      const r = await postForm(`/app/inbox/${conv}/order/confirm`, { proposalId: p.id });
      expect(r.statusCode).toBe(302);
      expect((await proposalOf(conv))!.state).toBe('pending');
      expect((await footprint(conv)).orders).toBe(0);
    } finally {
      await q((tx) => sql`update businesses set assistant_stopped_at = null where id = ${BIZ}`.execute(tx));
    }
  });

  it('the pending question is set when an approved draft that asks it leaves — and an edit asks nothing', async () => {
    await say(CUSTOMERS.asks, 'hi, do you have gift boxes?');
    const conv = await convOf(CUSTOMERS.asks);
    await until(async () => ((await turnsOf(conv)) >= 1 ? true : undefined), 'the first turn');
    await until(() => q((tx) => sql<{ n: number }>`select count(*)::int as n from outbound_messages
      where conversation_id = ${conv}::uuid and status = 'sent'`.execute(tx).then((x) => (x.rows[0]!.n >= 1 ? true : undefined))), 'the first reply to leave');
    const pending = () => q((tx) => sql<{ p: string | null }>`
      select pending_question as p from conversation_state where conversation_id = ${conv}::uuid`.execute(tx).then((x) => x.rows[0]!.p));
    const draft = (text: string, asks: string) => q((tx) => sql<{ id: string }>`
      insert into drafts (business_id, conversation_id, capability, draft_text, status, asks)
      values (${BIZ}, ${conv}::uuid, 'negotiate', ${text}, 'pending', ${asks}) returning id::text as id`
      .execute(tx).then((x) => x.rows[0]!.id));
    await q((tx) => sql`update conversation_state set pending_question = null where conversation_id = ${conv}::uuid`.execute(tx));
    // WhatsApp's delivery receipt, which the simulator never sends: without it
    // each message waits up to 90 s behind the one before (sequencer.ts).
    const delivered = () => q((tx) => sql`update outbound_messages set status = 'delivered'
      where conversation_id = ${conv}::uuid and status = 'sent'`.execute(tx));
    await delivered();

    // Edited: the owner's words ask whatever they ask. Nothing is pending once it leaves.
    const edited = await draft('Shall I confirm 40 gift boxes for you?', 'order_confirmation');
    await postForm(`/app/inbox/${conv}/act`, { draftId: edited, command: '改', edit: 'They come in two colours.' });
    await until(() => q((tx) => sql<{ status: string }>`
      select status from outbound_messages where conversation_id = ${conv}::uuid and body = 'They come in two colours.'`
      .execute(tx).then((x) => (x.rows[0]?.status === 'sent' ? x.rows[0] : undefined))), 'the edited reply to leave');
    expect(await pending()).toBeNull();
    await delivered();

    // Sent as written: it asked, and once it has left, the question is pending.
    const asked = await draft('Shall I go ahead and confirm the order?', 'order_confirmation');
    await postForm(`/app/inbox/${conv}/act`, { draftId: asked, command: '发送' });
    const row = await until(() => q((tx) => sql<{ asks: string | null; status: string }>`
      select asks, status from outbound_messages where conversation_id = ${conv}::uuid and body = 'Shall I go ahead and confirm the order?'`
      .execute(tx).then((x) => (x.rows[0]?.status === 'sent' ? x.rows[0] : undefined))), 'the approved draft to leave');
    expect(row.asks).toBe('order_confirmation');
    await until(async () => ((await pending()) === 'order_confirmation' ? true : undefined), 'the pending question');
  });
});
