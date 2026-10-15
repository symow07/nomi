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
 *     approved draft carries its question to the send; an edited one does not;
 *   · a yes the list does not know (2026-10-14, 0157), in en, zh and ar, goes to
 *     the owner as "this may be a confirmation": the buyer gets the order's own
 *     line, never the price again, and nothing is proposed.
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
  maybeEn: `9718${runDigits(RUN, 6)}5`,
  maybeZh: `9718${runDigits(RUN, 6)}6`,
  maybeAr: `9718${runDigits(RUN, 6)}7`,
  mismatch: `9718${runDigits(RUN, 6)}8`,
  matched: `9718${runDigits(RUN, 6)}9`,
  noEmail: `9718${runDigits(RUN, 6)}0`,
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
      // The installation's number IS the one this workspace's credential holds, as in production: since
      // 2026-10-14 that number sends only for its own workspace (src/main.ts `installationNumber`).
      META_WHATSAPP_PHONE_NUMBER_ID: sim.phoneNumberId,
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
  afterAll(async () => {
    // The confirmation the owner's tap queues waits up to 90 s for the previous message's receipt
    // (the sequencer, main.ts), and nobody here sends one. Left queued, it re-queued itself into the
    // NEXT files' workers and went out through whichever adapter was live 90 s later: on 2026-10-05
    // wa-self's "never the installation's number" counted it. This file's sends go with it: the row
    // canceled first, so a job already running finds nothing to wait for, then its jobs removed.
    if (prod) {
      await q((tx) => sql`update outbound_messages set status = 'canceled', last_error = 'canceled: test ended'
        where business_id = ${BIZ}::uuid and status = 'queued'`.execute(tx));
      await sql`delete from pgboss.job where name = 'message.outbound' and data->>'businessId' = ${BIZ}
        and state in ('created', 'retry')`.execute(prod.db);
      const left = await sql<{ n: number }>`select count(*)::int as n from pgboss.job
        where data->>'businessId' = ${BIZ} and state in ('created', 'retry', 'active')`.execute(prod.db);
      expect(left.rows[0]!.n, 'jobs this file leaves for the next one').toBe(0);
    }
    await prod?.close();
  });

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
    // The warmth run (phase 2) — the band's first person, in the Inbox's order: a face, the name, the why, a door.
    const first = today.body.indexOf('<li class="tw-item">');
    expect(first).toBeGreaterThan(-1);
    expect(today.body.slice(first)).toMatch(new RegExp(`^<li class="tw-item">[\\s\\S]*?<a class="tw-go" href="/app/inbox/${confirmConv}#latest">[\\s\\S]*?Order waiting`));
    // Phase 8 of the warmth run — the order waiting is one of the customers the rail counts; a page
    // left open learns of it from the rail's question (the browser's own order notice is retired).
    const live = await get('/app/live/home?since=0.0.0.0.0.0');
    expect(live.statusCode).toBe(200);
    expect((live.json() as { news: boolean }).news).toBe(true);
    // THE HOME RUN — a tab opened before the rename still asks at the old address, and is answered the same.
    expect((await get('/app/live/today?since=0.0.0.0.0.0')).json()).toEqual(live.json());
    const since = /data-rail="\/app\/live\/rail\?since=([0-9.]+)"/.exec(today.body)?.[1];
    expect(Number(since?.split('.')[0])).toBeGreaterThanOrEqual(1);
  });

  it('the conversation page shows what they said yes to, and the two answers', async () => {
    const page = await get(`/app/inbox/${confirmConv}`);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('They said yes to this order');
    expect(page.body).toContain('customer@example.com');
    // 2026-10-14 — before either button: their words as they wrote them (the message the proposal was made from,
    // `order_proposals.turn_message_id` → `messages.external_id`), and the unit price beside the total.
    const words = page.body.indexOf('<blockquote class="unsure-q" dir="auto"><bdi>yes</bdi></blockquote>');
    const unit = page.body.indexOf('$2.10');
    const confirm = page.body.indexOf(`/app/inbox/${confirmConv}/order/confirm`);
    expect(words, 'their words, verbatim').toBeGreaterThan(-1);
    expect(unit, 'the unit price').toBeGreaterThan(-1);
    expect(words).toBeLessThan(confirm);
    expect(unit).toBeLessThan(confirm);
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
  it('A YES NOT ON THE LIST, in en, zh and ar, goes to the owner — the order\'s line, never the price, nothing proposed', async () => {
    const { orderBlockedReply } = await import('../../src/core/conversation/templates.js');
    const cases = [
      [CUSTOMERS.maybeEn, 'Sounds great, let us go with that', 'en'],
      [CUSTOMERS.maybeZh, '那就这么定了吧', 'zh'],
      [CUSTOMERS.maybeAr, 'تمام كذا، نمشي على هذا', 'ar'],
    ] as const;
    for (const [wa, text, lang] of cases) {
      await say(wa, 'hello, I would like some gift boxes');
      const conv = await convOf(wa);
      await until(async () => ((await turnsOf(conv)) >= 1 ? true : undefined), 'the first turn');
      await until(() => q((tx) => sql<{ n: number }>`select count(*)::int as n from outbound_messages
        where conversation_id = ${conv}::uuid and status = 'sent'`.execute(tx).then((x) => (x.rows[0]!.n >= 1 ? true : undefined))), 'the first reply to leave');
      // WhatsApp's receipt, which the simulator never sends: the next message would wait 90 s behind it (sequencer.ts).
      await q((tx) => sql`update outbound_messages set status = 'delivered'
        where conversation_id = ${conv}::uuid and status = 'sent'`.execute(tx));
      await readyToConfirm(conv);
      await say(wa, text);
      await until(async () => ((await turnsOf(conv)) >= 2 ? true : undefined), `the second turn (${lang})`);
      const line = orderBlockedReply(['conversation_handed_off'], null, lang);
      await until(() => q((tx) => sql<{ n: number }>`select count(*)::int as n from outbound_messages
        where conversation_id = ${conv}::uuid and position(${line} in body) > 0`.execute(tx)
        .then((x) => (x.rows[0]!.n >= 1 ? true : undefined))), `the order's line (${lang})`);
      const signals = await q((tx) => sql<{ kind: string }>`select kind from conversation_signals
        where conversation_id = ${conv}::uuid and resolved_at is null`.execute(tx).then((x) => x.rows.map((r) => r.kind)));
      expect(signals, lang).toContain('maybe_confirmation');
      const after = await footprint(conv);
      expect(after.proposals, `${lang}: no order proposed on a maybe`).toBe(0);
      expect(after.orders, lang).toBe(0);
      const priced = await q((tx) => sql<{ n: number }>`select count(*)::int as n from outbound_messages
        where conversation_id = ${conv}::uuid and (body like '%2.10%' or body like '%84.00%')`.execute(tx).then((x) => x.rows[0]!.n));
      expect(priced, `${lang}: never the price again`).toBe(0);
    }
  });

  let mismatchConv = '';
  /** A buyer priced for 500 boxes, nothing asked, who then writes `text`: the conversation, once it waits as a maybe. */
  const maybeAfterQuote = async (wa: string, text: string): Promise<string> => {
    await say(wa, 'hello, I would like some gift boxes');
    const conv = await convOf(wa);
    await until(async () => ((await turnsOf(conv)) >= 1 ? true : undefined), 'the first turn');
    await until(() => q((tx) => sql<{ n: number }>`select count(*)::int as n from outbound_messages
      where conversation_id = ${conv}::uuid and status = 'sent'`.execute(tx).then((x) => (x.rows[0]!.n >= 1 ? true : undefined))), 'the first reply to leave');
    await q((tx) => sql`update outbound_messages set status = 'delivered'
      where conversation_id = ${conv}::uuid and status = 'sent'`.execute(tx));
    await q(async (tx) => {
      await sql`update conversations set phase = 'commercial_discussion', assigned_to = null where id = ${conv}::uuid`.execute(tx);
      await sql`update conversation_state set identified_product_id = ${PID}::uuid, product_confidence = 0.95,
                  product_confirmed_by_client = true, inquiry_quantity = 500, inquiry_unit = 'boxes',
                  pending_question = null, problem_score = 0
                 where conversation_id = ${conv}::uuid`.execute(tx);
      await sql`insert into quotes (business_id, conversation_id, product_id, quantity, inputs, unit_price_usd, total_usd, engine_version)
                values (${BIZ}, ${conv}::uuid, ${PID}, 500, '{}'::jsonb, 2.10, 1050, 'test')`.execute(tx);
    });
    await say(wa, text);
    await until(() => q((tx) => sql<{ n: number }>`select count(*)::int as n from conversation_signals
      where conversation_id = ${conv}::uuid and kind = 'maybe_confirmation' and resolved_at is null`.execute(tx)
      .then((x) => (x.rows[0]!.n >= 1 ? true : undefined))), 'the maybe');
    return conv;
  };
  /** The hand-off's alert is queued by the turn: let it finish, so this file leaves no job for the next one. */
  const drained = (conv: string) => until(async () => ((await sql<{ n: number }>`select count(*)::int as n from pgboss.job
    where data->>'conversationId' = ${conv} and name <> 'message.outbound' and state in ('created', 'retry', 'active')`
    .execute(prod.db)).rows[0]!.n === 0 ? true : undefined), 'the alert to be sent');

  it('THE CARD — "ok, 5000 again please" after a price for 500: their words, the price they were given, and the mismatch; no Confirm', async () => {
    const { esc } = await import('../../src/api/web/layout.js');
    const show = await import('../../src/api/web/values.js');
    const { t } = await import('../../src/core/owner/i18n/messages.js');
    const { usd } = await import('../../src/core/types/money.js');
    const conv = await maybeAfterQuote(CUSTOMERS.mismatch, 'ok, 5000 again please');
    mismatchConv = conv;
    const page = await get(`/app/inbox/${conv}`);
    expect(page.statusCode).toBe(200);
    // The card alone — its own <div>, to the one that closes it — never the reply box after it, which has a form.
    const from = page.body.lastIndexOf('<div', page.body.indexOf('id="maybe-yes"'));
    expect(page.body.indexOf('id="maybe-yes"'), 'the card').toBeGreaterThan(-1);
    const tags = /<div\b|<\/div>/g;
    tags.lastIndex = from;
    let depth = 0, to = page.body.length;
    for (let m = tags.exec(page.body); m; m = tags.exec(page.body)) {
      depth += m[0] === '</div>' ? -1 : 1;
      if (depth === 0) { to = m.index + m[0].length; break; }
    }
    const card = page.body.slice(from, to);
    const at = (x: string) => card.indexOf(x);
    const words = at('<bdi>ok, 5000 again please</bdi>');
    const product = at('<bdi>Gift box</bdi>');
    const quantity = at(esc(show.quantityOf('en', 500, 'boxes')));
    const unit = at(esc(show.money('en', usd(2.1))));
    const total = at(esc(show.money('en', usd(1050))));
    const mismatch = at(esc(t('en', 'maybeYes.mismatch', { said: '5000', given: show.quantityOf('en', 500, 'boxes') })));
    for (const [what, i] of Object.entries({ words, product, quantity, unit, total, mismatch })) expect(i, what).toBeGreaterThan(-1);
    expect(words, 'their words first').toBeLessThan(product);
    expect(total, 'then the price, then the mismatch').toBeLessThan(mismatch);
    // CHANGED BY DESIGN (on PR 345): no Confirm on a maybe — one form that PREPARES, the quantity left for the owner to
    // type where their words name another.
    expect(card, 'no Confirm on a maybe').not.toMatch(/order\/confirm/);
    expect(card.match(/<form/g)).toHaveLength(1);
    expect(card).toContain(`action="/app/inbox/${conv}/maybe-yes/order"`);
    expect(card).toMatch(/<input type="number" name="quantity"[^>]* value="" \/>/);
    await drained(conv);
  });

  it('THE WAY OUT (on PR 345) — the owner prepares 5,000: the list price, said never sent; their words above Confirm; confirmed', async () => {
    const { esc } = await import('../../src/api/web/layout.js');
    const show = await import('../../src/api/web/values.js');
    const { t } = await import('../../src/core/owner/i18n/messages.js');
    const { usd } = await import('../../src/core/types/money.js');
    const conv = mismatchConv;
    // A bad address prepares nothing.
    const bad = await postForm(`/app/inbox/${conv}/maybe-yes/order`, { quantity: '5000', email: 'not an address' });
    expect(bad.statusCode).toBe(302);
    expect((await footprint(conv)).proposals).toBe(0);
    const r = await postForm(`/app/inbox/${conv}/maybe-yes/order`, { quantity: '5000', email: 'maya@example.com' });
    expect(r.statusCode).toBe(302);
    expect((await footprint(conv)).proposals).toBe(1);
    expect((await footprint(conv)).orders, 'prepared, not confirmed').toBe(0);
    const page = await get(`/app/inbox/${conv}`);
    expect(page.body, 'the maybe card has gone').not.toContain('id="maybe-yes"');
    const at = (x: string) => page.body.indexOf(x);
    const confirm = at(`/app/inbox/${conv}/order/confirm`);
    for (const [what, x] of Object.entries({
      words: '<bdi>ok, 5000 again please</bdi>',
      quantity: esc(show.quantityOf('en', 5000, 'boxes')),
      unit: esc(show.money('en', usd(2.1))),
      total: esc(show.money('en', usd(10500))),
      never: esc(t('en', 'order.card.unquoted')),
    })) {
      expect(at(x), what).toBeGreaterThan(-1);
      expect(at(x), `${what} before Confirm`).toBeLessThan(confirm);
    }
    // A second submit changes nothing.
    await postForm(`/app/inbox/${conv}/maybe-yes/order`, { quantity: '5000', email: 'maya@example.com' });
    expect((await footprint(conv)).proposals).toBe(1);
    const p = (await proposalOf(conv))!;
    expect((await postForm(`/app/inbox/${conv}/order/confirm`, { proposalId: p.id })).statusCode).toBe(302);
    const after = await footprint(conv);
    expect(after.orders).toBe(1);
    expect(after.events).toContain('order_prepared');
    expect(after.events).toContain('order_created');
  });

  it('THE WAY OUT — a yes the list did not know, at the quantity priced: prepared at the price they were given; confirmed', async () => {
    const { esc } = await import('../../src/api/web/layout.js');
    const { t } = await import('../../src/core/owner/i18n/messages.js');
    const conv = await maybeAfterQuote(CUSTOMERS.matched, 'Sounds great, let us go with that');
    const card = await get(`/app/inbox/${conv}`);
    expect(card.body).toMatch(/<input type="number" name="quantity"[^>]* value="500" \/>/);
    await postForm(`/app/inbox/${conv}/maybe-yes/order`, { quantity: '500', email: 'lee@example.com' });
    const page = await get(`/app/inbox/${conv}`);
    expect(page.body).toContain(`/app/inbox/${conv}/order/confirm`);
    expect(page.body, 'the price they were given: nothing to warn').not.toContain(esc(t('en', 'order.card.unquoted')));
    const p = (await proposalOf(conv))!;
    await postForm(`/app/inbox/${conv}/order/confirm`, { proposalId: p.id });
    expect((await footprint(conv)).orders).toBe(1);
    const email = await q((tx) => sql<{ email: string | null }>`select cl.email from clients cl
      join conversations c on c.client_id = cl.id where c.id = ${conv}::uuid`.execute(tx).then((x) => x.rows[0]!.email));
    expect(email).toBe('lee@example.com');
    await drained(conv);
  });
  it('A WHATSAPP ORDER WITH NO E-MAIL (the owner, 2026-10-15): hello to confirmed proforma — nobody asks for an address, nothing prints one', async () => {
    const { esc } = await import('../../src/api/web/layout.js');
    const { t } = await import('../../src/core/owner/i18n/messages.js');
    // Her delivery and payment terms, as Business › How you sell writes them: an order needs these for a proforma.
    await q((tx) => sql`insert into trade_terms (business_id, payment_terms, incoterm, stated_at, stated_by)
      values (${BIZ}, '30% deposit, balance before shipment', 'FOB', now(), 'owner')`.execute(tx));
    const wa = CUSTOMERS.noEmail;
    await say(wa, 'hello, I would like some gift boxes');
    const conv = await convOf(wa);
    await until(async () => ((await turnsOf(conv)) >= 1 ? true : undefined), 'the first turn');
    await until(async () => ((await footprint(conv)).outbound >= 1 ? true : undefined), 'the first reply');
    // Ready to confirm — product, quantity, the question asked — and NO e-mail on record, ever.
    await q(async (tx) => {
      await sql`update conversations set phase = 'confirmation', assigned_to = null where id = ${conv}::uuid`.execute(tx);
      await sql`update conversation_state set identified_product_id = ${PID}::uuid, product_confidence = 0.95,
                  product_confirmed_by_client = true, inquiry_quantity = 40, inquiry_unit = 'boxes',
                  pending_question = 'order_confirmation', problem_score = 0
                 where conversation_id = ${conv}::uuid`.execute(tx);
    });
    const email = () => q((tx) => sql<{ e: string | null }>`select cl.email as e from clients cl
      join conversations c on c.client_id = cl.id where c.id = ${conv}::uuid`.execute(tx).then((x) => x.rows[0]!.e));
    expect(await email()).toBeNull();
    await say(wa, 'yes');
    await until(async () => ((await footprint(conv)).proposals >= 1 ? true : undefined), 'the proposal');
    const p = (await proposalOf(conv))!;
    expect((await q((tx) => sql<{ e: string | null }>`select client_email as e from order_proposals where id = ${p.id}::uuid`
      .execute(tx).then((x) => x.rows[0]!.e)))).toBeNull();
    // Nothing that went to the buyer asked for an address.
    const said = await q((tx) => sql<{ body: string }>`select body from outbound_messages where conversation_id = ${conv}::uuid`
      .execute(tx).then((x) => x.rows.map((r) => r.body)));
    for (const b of said) expect(b, b).not.toMatch(/e-?mail|邮箱|البريد/i);
    // The order card: the facts and the Confirm — no e-mail row standing empty.
    const page = await get(`/app/inbox/${conv}`);
    expect(page.body).toContain(`/app/inbox/${conv}/order/confirm`);
    const card = page.body.slice(page.body.indexOf('id="order"'), page.body.indexOf(`/app/inbox/${conv}/order/confirm`));
    expect(card).not.toContain(esc(t('en', 'order.card.email')));
    // Confirmed by the owner: an order, with no address on it.
    expect((await postForm(`/app/inbox/${conv}/order/confirm`, { proposalId: p.id })).statusCode).toBe(302);
    const order = await q((tx) => sql<{ id: string; e: string | null }>`select id::text as id, client_email as e from orders
      where conversation_id = ${conv}::uuid`.execute(tx).then((x) => x.rows[0]));
    expect(order, 'the order').toBeDefined();
    expect(order!.e).toBeNull();
    // Its proforma: made, opened by the customer with no session — no e-mail line, no blank, no placeholder.
    expect((await postForm(`/app/orders/${order!.id}/proforma-link`, { from: 'order' })).statusCode).toBe(302);
    const token = await q((tx) => sql<{ t: string | null }>`select proforma_token as t from orders where id = ${order!.id}::uuid`
      .execute(tx).then((x) => x.rows[0]!.t));
    expect(token).toBeTruthy();
    const pi = await prod.app.inject({ method: 'GET', url: `/pi/${token}` });
    expect(pi.statusCode).toBe(200);
    expect(pi.body).toContain('Gift box');
    expect(pi.body).toContain('FOB');
    // The page's own words, its stylesheet aside (its CSS has `@media`): no address of any kind, no e-mail line.
    const words = pi.body.replace(/<style[^]*?<\/style>/g, '');
    expect(words).not.toMatch(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    expect(words).not.toMatch(/e-?mail|邮箱|البريد/i);
    await drained(conv);
  });
});
