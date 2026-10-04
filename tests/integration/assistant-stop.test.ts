import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID, createHmac } from 'node:crypto';
import { flashSaid, runDigits } from './tenant.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';
import type { ChannelAdapter } from '../../src/channels/contract.js';

/**
 * 0070 — the owner's Stop, on every channel (2026-09-27).
 *
 * Before this, Stop on My business stopped WhatsApp alone: Instagram, Messenger
 * and e-mail had no stop, and a reply already queued there went out whatever
 * the owner pressed. The owner's decisions, verified here over Postgres:
 *
 *   SEND    — after Stop, a reply the assistant wrote on Instagram is refused;
 *             the owner's own reply still goes; Start lifts it; and a reply
 *             queued BEFORE Stop is cancelled at send time, never sent late.
 *   WAITING — silent while stopped (no model call, no draft), and a buyer who
 *             writes still arrives, is visible, and is on "Needs you" and Today.
 *   DOOR    — nothing moves a waiting buyer off "Needs you" while stopped:
 *             handing back, "answer this", approving or editing an old draft
 *             are refused. Only the owner may Stop or Start.
 *   PAGE    — My business and Today say what is true while stopped.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

type Db = import('../../src/db/client.js').Db;
type Tx = import('../../src/db/client.js').Tx;
type BusinessId = import('../../src/core/types/ids.js').BusinessId;

const bidOf = async (raw: string): Promise<BusinessId> => {
  const { parseBusinessId } = await import('../../src/core/types/ids.js');
  const b = parseBusinessId(raw); if (!b.ok) throw new Error('fixture'); return b.value;
};
const inTenant = async <R>(db: Db, biz: string, fn: (tx: Tx) => Promise<R>): Promise<R> => {
  const { withTenantTx } = await import('../../src/db/client.js');
  return withTenantTx(db, await bidOf(biz), fn);
};
const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 30_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

/** A web app for one business, signed in as its owner. */
const ownerApp = async (db: Db, biz: string, o: Record<string, unknown> = {}) => {
  const { registerWebApp } = await import('../../src/api/web/app.js');
  const app = Fastify({ logger: false });
  const code = `stop-${biz.slice(-4)}-${RUN}`;
  registerWebApp(app, {
    db, businessId: biz, accessCode: code, sessionSecret: SECRET,
    employeeName: 'Lily', avatar: '👩‍💼', secureCookie: false,
    kickOutbound: async () => {}, kickDrive: async () => {}, factsTtlMs: 0,
    ...o,
  } as unknown as Parameters<typeof registerWebApp>[1]);
  await app.ready();
  const login = async (c: string) => String((await app.inject({
    method: 'POST', url: '/login', payload: `code=${encodeURIComponent(c)}`, headers: FORM,
  })).headers['set-cookie'] ?? '').split(';')[0] ?? '';
  const cookie = await login(code);
  expect(cookie).not.toBe('');
  const post = (url: string, fields: Record<string, string> = {}, as = cookie) =>
    app.inject({ method: 'POST', url, headers: { cookie: as, ...FORM }, payload: new URLSearchParams(fields).toString() });
  const get = (url: string, as = cookie) => app.inject({ method: 'GET', url, headers: { cookie: as } });
  return { app, cookie, login, post, get };
};

const stoppedAt = (db: Db, biz: string) => inTenant(db, biz, (tx) => sql<{ at: Date | null }>`
  select assistant_stopped_at as at from businesses where id = ${biz}::uuid`.execute(tx).then((r) => r.rows[0]?.at ?? null));

// ─────────────────────────────────────────────────────────────────────────────
d('Stop · SEND — the gate binds the assistant on Instagram, never the owner (requires DATABASE_URL)', () => {
  const BIZ = `dd7a0000-0000-4000-8000-${RUN}0001`;
  let db: Db;
  let web: Awaited<ReturnType<typeof ownerApp>>;
  let cid = '';
  const sent: { to: string; body: string }[] = [];
  const instagram: ChannelAdapter = {
    kind: 'instagram', provider: 'test',
    verifyWebhook: () => false, parseWebhook: () => [],
    sendText: async (to, body) => {
      sent.push({ to, body });
      return { ok: true, providerMessageId: `ig-${RUN}-${sent.length}` };
    },
  };

  const queue = async (body: string, origin: 'employee' | 'owner') => {
    const { enqueueOutboundRow } = await import('../../src/db/channels.js');
    const id = await inTenant(db, BIZ, async (tx) => enqueueOutboundRow(tx, await bidOf(BIZ), cid, body, origin));
    expect(id).not.toBeNull();
    return id!;
  };
  const drive = async () => {
    const { channelStore } = await import('../../src/db/channels.js');
    const { driveConversationOutbound } = await import('../../src/outbound/worker.js');
    const bid = await bidOf(BIZ);
    return inTenant(db, BIZ, (tx) => driveConversationOutbound(
      { store: channelStore(tx, bid), adapters: (ch) => (ch === 'instagram' ? instagram : undefined), now: () => new Date() }, cid));
  };
  /** The provider's receipt: the worker holds the next message until the last one is delivered. */
  const delivered = async () => {
    const { channelStore } = await import('../../src/db/channels.js');
    const bid = await bidOf(BIZ);
    const r = await inTenant(db, BIZ, (tx) => channelStore(tx, bid).reconcileStatus(`ig-${RUN}-${sent.length}`, 'delivered', null));
    expect(r.outcome).toBe('applied');
  };
  const row = (id: string) => inTenant(db, BIZ, (tx) => sql<{ status: string; cancel_reason: string | null }>`
    select status, cancel_reason from outbound_messages where id = ${id}::uuid`.execute(tx).then((r) => r.rows[0]!));

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { ensureConversation } = await import('../../src/db/channels.js');
    db = createDb(DATABASE_URL!);
    await inTenant(db, BIZ, (tx) => sql`insert into businesses (id, name, owner_locale) values (${BIZ}, 'Stop Send', 'en')
                                        on conflict (id) do nothing`.execute(tx));
    await inTenant(db, BIZ, async (tx) => {
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine, is_active)
                values (${BIZ}, 'instagram', ${`ig-acct-${RUN}`}, 'stop-secret', 'service', true)`.execute(tx);
      const c = await ensureConversation(tx, await bidOf(BIZ), `ig-buyer-${RUN}`, 'Instagram Buyer', 'instagram');
      cid = c.conversationId;
      // He wrote a minute ago: Instagram's window is open, so only Stop can refuse.
      await sql`update client_channels set last_inbound_at = now() - interval '1 minute'
                 where client_id = ${c.clientId} and channel = 'instagram'`.execute(tx);
      await sql`update conversations set assigned_to = null where id = ${cid}::uuid`.execute(tx);
    });
    web = await ownerApp(db, BIZ, { provider: 'disabled', messagingEnabled: true });
  }, 60_000);
  afterAll(async () => { await web?.app.close(); await db?.destroy(); });

  it('SEND · the control: before Stop, a reply the assistant wrote on Instagram goes', async () => {
    const id = await queue('Yes, we ship to Rabat.', 'employee');
    const fx = await drive();
    expect(fx).toContainEqual(expect.objectContaining({ kind: 'sent' }));
    expect(sent.at(-1)).toEqual({ to: `ig-buyer-${RUN}`, body: 'Yes, we ship to Rabat.' });
    expect((await row(id)).status).toBe('sent');
    await delivered();
  });

  it('SEND · a reply QUEUED BEFORE Stop is cancelled at send time — recorded, shown, never sent late', async () => {
    const before = sent.length;
    const id = await queue('Queued a moment before Stop.', 'employee');
    const r = await web.post('/app/business/stop-assistant');
    expect(r.statusCode).toBe(302);
    expect(flashSaid(r, SECRET)).toContain('Stopped on every channel');
    expect(await stoppedAt(db, BIZ)).not.toBeNull();

    const fx = await drive();
    expect(fx).toContainEqual(expect.objectContaining({ kind: 'canceled', id, reason: 'stopped' }));
    expect(fx.some((e) => e.kind === 'sent')).toBe(false);
    expect(sent.length).toBe(before);
    expect(await row(id)).toEqual({ status: 'canceled', cancel_reason: 'canceled: stopped' });
    // Recorded by its real reason, and shown to the owner on the conversation.
    const audit = await inTenant(db, BIZ, (tx) => sql<{ reason: string }>`
      select detail->>'reason' as reason from channel_audit
       where business_id = ${BIZ} and action = 'send_refused' order by at desc limit 1`.execute(tx).then((x) => x.rows[0]));
    expect(audit?.reason).toBe('stopped');
    const { loadRefusals } = await import('../../src/api/web/refusals.js');
    expect((await loadRefusals(db, BIZ, { conversationId: cid })).map((x) => x.reason)).toContain('stopped');
    // A later drive does not resurrect it.
    await drive();
    expect(sent.length).toBe(before);
    expect((await row(id)).status).toBe('canceled');
  });

  it('SEND · while stopped, a reply the assistant writes is refused on Instagram', async () => {
    const before = sent.length;
    const id = await queue('Written while stopped.', 'employee');
    const fx = await drive();
    expect(fx).toContainEqual(expect.objectContaining({ kind: 'canceled', id, reason: 'stopped' }));
    expect(sent.length).toBe(before);
  });

  it('SEND · while stopped, the owner’s own reply still goes', async () => {
    const id = await queue('This is the owner, answering in person.', 'owner');
    const fx = await drive();
    expect(fx).toContainEqual(expect.objectContaining({ kind: 'sent' }));
    expect(sent.at(-1)?.body).toBe('This is the owner, answering in person.');
    expect((await row(id)).status).toBe('sent');
    await delivered();
  });

  it('SEND · Start lifts it: the next reply the assistant writes goes', async () => {
    const r = await web.post('/app/business/start-assistant');
    expect(flashSaid(r, SECRET)).toContain('answers again');
    expect(await stoppedAt(db, BIZ)).toBeNull();
    const id = await queue('Back to answering.', 'employee');
    const fx = await drive();
    expect(fx).toContainEqual(expect.objectContaining({ kind: 'sent' }));
    expect((await row(id)).status).toBe('sent');
    // Both decisions are on the record, with who made them.
    const acts = await inTenant(db, BIZ, (tx) => sql<{ action: string; actor: string }>`
      select action, actor from channel_audit
       where business_id = ${BIZ} and action in ('assistant_stop', 'assistant_start') order by at`.execute(tx).then((x) => x.rows));
    expect(acts.map((a) => a.action)).toEqual(['assistant_stop', 'assistant_start']);
    expect(acts.every((a) => a.actor.length > 0)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
d('Stop · WAITING — silent while stopped, and a buyer who writes is still there (requires DATABASE_URL)', { timeout: 40_000 }, () => {
  const BIZ = `dd7a0000-0000-4000-8000-${RUN}0002`;
  const A = `9716${runDigits(RUN, 6)}1`;
  const B = `9716${runDigits(RUN, 6)}2`;
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  let cookie = '';
  const WEB_SECRET = createHmac('sha256', 'b'.repeat(64)).update('yf-web-session').digest('hex');
  const analyzer = new FakeAnalyzer();
  analyzer.next = {
    language: { detected: 'en', replyIn: 'en' },
    intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
    recommendedPhase: 'clarification',
  };
  const replyWriter = new FakeReplyWriter();
  replyWriter.replies = ['Thanks — which size are you looking for?'];

  const q = <T>(fn: (tx: Tx) => Promise<T>) => inTenant(prod.db, BIZ, fn);
  const post = (w: { rawBody: string; headers: Record<string, string> }) =>
    prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: w.rawBody,
      headers: { 'content-type': 'application/json', ...w.headers } });
  const get = (url: string) => prod.app.inject({ method: 'GET', url, headers: { cookie } });
  const act = (url: string) => prod.app.inject({ method: 'POST', url, headers: { cookie, ...FORM }, payload: '' });
  const convOf = (wa: string) => until(() => q((tx) => sql<{ id: string }>`
    select c.id::text as id from conversations c
      join client_channels cc on cc.client_id = c.client_id and cc.channel = 'whatsapp'
     where cc.channel_user_id = ${wa} and c.is_active limit 1`.execute(tx).then((r) => r.rows[0]?.id)), `conversation of ${wa}`);
  /** Every turn records its model use against its business; a stopped assistant has none. */
  const usage = () => q((tx) => sql<{ turns: number; calls: number }>`
    select coalesce(sum(turns), 0)::int as turns, coalesce(sum(llm_calls), 0)::int as calls
      from usage_ledger where business_id = ${BIZ}::uuid`.execute(tx).then((r) => r.rows[0]!));
  const assigned = (conv: string) => q((tx) => sql<{ a: string | null }>`
    select assigned_to as a from conversations where id = ${conv}::uuid`.execute(tx).then((r) => r.rows[0]?.a ?? null));

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    sim = whatsappSimulator([], { tag: `stop${RUN}` });
    const setup = createDb(DATABASE_URL!);
    await withTenantTx(setup, await bidOf(BIZ), async (t) => {
      await sql`insert into businesses (id, name, engine) values (${BIZ}, 'Stop Waiting', 'service')
                on conflict (id) do nothing`.execute(t);
      // Short batching for this tenant only (day-one.test.ts explains why).
      await sql`update businesses set batch_debounce_ms = 300, batch_max_window_ms = 1000 where id = ${BIZ}`.execute(t);
      await sql`insert into channels (business_id, kind, status, display_phone, connected_at)
                values (${BIZ}, 'whatsapp', 'connected', '+86 579****0070', now())`.execute(t);
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
      WEBHOOK_VERIFY_TOKEN: 'stop-verify-token-xx',
      CREDENTIAL_KEY: 'b'.repeat(64),
      PORT: 0,
    }, { adapter: sim.adapter, logger: false, models: { analyzer, replyWriter } });
    const login = await prod.app.inject({ method: 'POST', url: '/login', headers: FORM,
      payload: `code=${encodeURIComponent(prod.ownerAccessCode)}` });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
    const r = await act('/app/business/stop-assistant');
    expect(flashSaid(r, WEB_SECRET)).toContain('Stopped on every channel');
  }, 60_000);
  afterAll(async () => { await prod?.close(); });

  let convA = '';

  it('WAITING · a buyer who writes while stopped ARRIVES and is VISIBLE on the conversation', async () => {
    const w = sim.inboundText({ from: A, text: 'Hello — are you open this week?' });
    expect((await post(w)).statusCode).toBe(200);
    convA = await convOf(A);
    await until(() => q((tx) => sql<{ n: number }>`
      select count(*)::int as n from messages where conversation_id = ${convA}::uuid and direction = 'inbound'`
      .execute(tx).then((r) => (r.rows[0]!.n > 0 ? true : undefined))), 'his message on the timeline');
    const page = await get(`/app/inbox/${convA}`);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Hello — are you open this week?');
  });

  it('WAITING · …and is on NEEDS YOU and TODAY — the stop hides nobody', async () => {
    // Handed to a person: the thing "Needs you" is made of (inbox NEEDS_OWNER).
    await until(async () => ((await assigned(convA)) !== null ? true : undefined), 'the handoff');
    const needs = await get('/app/inbox?filter=pending');
    expect(needs.body).toContain(`/app/inbox/${convA}`);
    const signal = await q((tx) => sql<{ kind: string }>`
      select kind from conversation_signals where conversation_id = ${convA}::uuid and resolved_at is null`
      .execute(tx).then((r) => r.rows.map((x) => x.kind)));
    expect(signal).toContain('assistant_stopped');
    const today = await get('/app');
    expect(today.body).toContain('is stopped on every channel');
    // The design pass: the one handed over is named on Today, a door to the newest message.
    // The warmth run — the band's heading, in the owner's words, with the waiting ○ (was nav.needsYou).
    expect(today.body).toContain(`<h2 id="today-now" class="tw-head"><span class="tw-need"><span class="dot warn shape s-waiting" aria-hidden="true"></span> 1 waiting for you</span></h2>`);
    expect(today.body).toContain(`href="/app/inbox/${convA}#latest"`);
  });

  it('WAITING · silent: no model call, no draft, nothing queued to him — a photo is named, not opened', async () => {
    const w = sim.inboundImage({ from: A, caption: 'this one?' });
    expect((await post(w)).statusCode).toBe(200);
    await until(() => q((tx) => sql<{ received: string | null }>`
      select ai_analysis->>'received' as received from messages
       where conversation_id = ${convA}::uuid and input_type = 'unknown' limit 1`
      .execute(tx).then((r) => r.rows[0]?.received ?? undefined)), 'the photo, named');
    expect(await usage()).toEqual({ turns: 0, calls: 0 });
    const counts = await q((tx) => sql<{ drafts: number; outbound: number }>`
      select (select count(*)::int from drafts where conversation_id = ${convA}::uuid) as drafts,
             (select count(*)::int from outbound_messages where conversation_id = ${convA}::uuid) as outbound`
      .execute(tx).then((r) => r.rows[0]!));
    expect(counts).toEqual({ drafts: 0, outbound: 0 });
  });

  it('WAITING · Start lifts it: a buyer who writes after Start is answered; the one who waited stays with the owner', async () => {
    const r = await act('/app/business/start-assistant');
    expect(flashSaid(r, WEB_SECRET)).toContain('answers again');
    const w = sim.inboundText({ from: B, text: 'Do you make canvas bags?' });
    expect((await post(w)).statusCode).toBe(200);
    const convB = await convOf(B);
    await until(() => q((tx) => sql<{ n: number }>`
      select count(*)::int as n from drafts where conversation_id = ${convB}::uuid`
      .execute(tx).then((x) => (x.rows[0]!.n > 0 ? true : undefined))), 'a draft for the new buyer');
    // The turn's cost lands in its own transaction just after the turn commits
    // (T7), so the draft can be seen first: wait for it (ops-silence-handoff's twin failed on CI).
    await until(async () => ((await usage()).turns > 0 ? true : undefined), 'the turn on the ledger');
    expect(await assigned(convA)).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * THE OWNER'S DECISION OF 2026-09-30 — Stop pressed while a customer's lines
 * are still being grouped is recorded as "stopped", and the hold is a turn.
 *
 * The lines of a batch are marked processed IN a turn (`processed_in`
 * references `turns`). The hold path wrote no turn, so this failed: the job
 * retried, dead-lettered, and the customer reached "Needs you" as "not
 * answered" minutes later — not as what happened. Found 2026-09-28, fixed here.
 */
d('Stop · GROUPING — Stop pressed while his lines wait to be grouped (requires DATABASE_URL)', { timeout: 120_000 }, () => {
  const BIZ = `dd7a0000-0000-4000-8000-${RUN}0005`;
  const C = `9715${runDigits(RUN, 6)}5`;
  const WEB_SECRET = createHmac('sha256', 'b'.repeat(64)).update('yf-web-session').digest('hex');
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  let cookie = '';
  const analyzer = new FakeAnalyzer();
  const replyWriter = new FakeReplyWriter();
  const q = <T>(fn: (tx: Tx) => Promise<T>) => inTenant(prod.db, BIZ, fn);
  const post = (w: { rawBody: string; headers: Record<string, string> }) =>
    prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: w.rawBody,
      headers: { 'content-type': 'application/json', ...w.headers } });

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    sim = whatsappSimulator([], { tag: `grp${RUN}` });
    const setup = createDb(DATABASE_URL!);
    await withTenantTx(setup, await bidOf(BIZ), async (t) => {
      await sql`insert into businesses (id, name, engine) values (${BIZ}, 'Stop Grouping', 'service') on conflict (id) do nothing`.execute(t);
      // A long quiet time: his first line waits in its batch long enough to press Stop.
      await sql`update businesses set batch_debounce_ms = 6000, batch_max_window_ms = 20000 where id = ${BIZ}`.execute(t);
      await sql`insert into channels (business_id, kind, status, display_phone, connected_at)
                values (${BIZ}, 'whatsapp', 'connected', '+86 579****0075', now())`.execute(t);
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
                values (${BIZ}, 'whatsapp', ${sim.phoneNumberId}, 'sim-test', 'service')`.execute(t);
    });
    await setup.destroy();
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'grp-verify-token-xx', CREDENTIAL_KEY: 'b'.repeat(64), PORT: 0,
    }, { adapter: sim.adapter, logger: false, models: { analyzer, replyWriter } });
    const login = await prod.app.inject({ method: 'POST', url: '/login', headers: FORM,
      payload: `code=${encodeURIComponent(prod.ownerAccessCode)}` });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
  }, 60_000);
  afterAll(async () => { await prod?.close(); });

  it('handed to a person as STOPPED — not "not answered" — and the hold is a turn his lines were processed in', async () => {
    const w = sim.inboundText({ from: C, text: 'hi, do you make tote bags?' });
    expect((await post(w)).statusCode).toBe(200);
    // His line is recorded and waits in its batch.
    const frag = await until(() => q((tx) => sql<{ id: string }>`
      select f.id from message_fragments f join conversations c on c.id = f.conversation_id
       where c.business_id = ${BIZ}::uuid and f.processed_in is null`.execute(tx).then((r) => r.rows[0])), 'his line waiting in its batch');
    // The owner presses Stop while it waits.
    const r = await prod.app.inject({ method: 'POST', url: '/app/business/stop-assistant', headers: { cookie, ...FORM }, payload: '' });
    expect(flashSaid(r, WEB_SECRET)).toContain('Stopped on every channel');
    // The batch wakes, meets the Stop, and hands him over — as stopped.
    const conv = await until(() => q((tx) => sql<{ conv: string; assigned: string | null }>`
      select c.id::text as conv, c.assigned_to as assigned from conversations c
        join message_fragments f on f.conversation_id = c.id where f.id = ${frag.id}`.execute(tx)
      .then((x) => (x.rows[0]?.assigned ? x.rows[0] : undefined))), 'the handoff', 60_000);
    const signals = await q((tx) => sql<{ kind: string }>`
      select kind from conversation_signals where conversation_id = ${conv.conv}::uuid and resolved_at is null`
      .execute(tx).then((x) => x.rows.map((y) => y.kind)));
    expect(signals).toContain('assistant_stopped');
    expect(signals).not.toContain('not_answered');
    // The hold is a turn: nothing read, nothing written — and his line was processed in it.
    const turn = await q((tx) => sql<{ kind: string; reason: string; analysis: unknown; path: string; calls: number; processed: string | null }>`
      select t.decision->'action'->>'kind' as kind, t.decision->'action'->>'reason' as reason, t.analysis,
             t.answer_path as path, t.llm_calls as calls,
             (select processed_in from message_fragments where id = ${frag.id}) as processed
        from turns t where t.message_id = ${frag.id}`.execute(tx).then((x) => x.rows[0]));
    expect(turn).toMatchObject({ kind: 'held', reason: 'assistant_stopped', analysis: null, path: 'silent', calls: 0, processed: frag.id });
    // This production's worker also drains jobs other files left in the shared
    // queue — other tenants' messages, answered under their own conditions (found
    // 2026-10-01: 'price for 500 totes?' and 'hello' reached this analyzer). So the
    // claim is about HIS line and HIS number: no model read it, nothing went to him.
    expect(analyzer.texts.filter((t) => t.includes('do you make tote bags'))).toEqual([]);
    expect(sim.requests.filter((x) => x.body.includes(C))).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
d('Stop · DOOR — nothing takes a waiting buyer off Needs you while stopped (requires DATABASE_URL)', () => {
  const BIZ = `dd7a0000-0000-4000-8000-${RUN}0003`;
  let db: Db;
  let web: Awaited<ReturnType<typeof ownerApp>>;
  let staff = '';
  let held = '';      // handed to a person while stopped
  let drafted = '';   // holds a draft written before Stop
  let voiceMsg = '';
  const kicked: string[] = [];
  const answered: string[] = [];

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { ensureConversation } = await import('../../src/db/channels.js');
    const { addPerson } = await import('../../src/api/web/people.js');
    db = createDb(DATABASE_URL!);
    await inTenant(db, BIZ, (tx) => sql`insert into businesses (id, name, owner_locale) values (${BIZ}, 'Stop Door', 'en')
                                        on conflict (id) do nothing`.execute(tx));
    await inTenant(db, BIZ, async (tx) => {
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine, is_active)
                values (${BIZ}, 'instagram', ${`ig-door-${RUN}`}, 'stop-secret', 'service', true)`.execute(tx);
      const bid = await bidOf(BIZ);
      const h = await ensureConversation(tx, bid, `ig-held-${RUN}`, 'Held Buyer', 'instagram');
      const g = await ensureConversation(tx, bid, `ig-draft-${RUN}`, 'Draft Buyer', 'instagram');
      held = h.conversationId; drafted = g.conversationId;
      await sql`update client_channels set last_inbound_at = now() - interval '1 minute'
                 where client_id in (${h.clientId}, ${g.clientId})`.execute(tx);
      await sql`update conversations set assigned_to = 'unclaimed' where id = ${held}::uuid`.execute(tx);
      await sql`update conversations set assigned_to = null where id = ${drafted}::uuid`.execute(tx);
      await sql`insert into drafts (business_id, conversation_id, capability, draft_text, turn_message_id, status)
                values (${BIZ}, ${drafted}, 'quote', 'Written before Stop: 500 pcs at 2.40', null, 'pending')`.execute(tx);
      voiceMsg = (await sql<{ id: string }>`
        insert into messages (conversation_id, direction, input_type, text_content, sent_at)
        values (${held}, 'inbound', 'voice_transcribed', 'what is the price for 500', now()) returning id::text as id`
        .execute(tx)).rows[0]!.id;
    });
    web = await ownerApp(db, BIZ, {
      provider: 'disabled', messagingEnabled: true,
      kickOutbound: async (_b: string, c: string) => { kicked.push(c); },
      kickAnswer: async (_b: string, c: string) => { answered.push(c); },
    });
    const person = await addPerson(db, BIZ, SECRET, 'Mei');
    staff = await web.login((person as { accessCode: string }).accessCode);
    expect(staff).not.toBe('');
  }, 60_000);
  afterAll(async () => { await web?.app.close(); await db?.destroy(); });

  it('DOOR · only the owner may Stop or Start — a sales assistant is refused and nothing changes', async () => {
    const r = await web.post('/app/business/stop-assistant', {}, staff);
    expect(flashSaid(r, SECRET)).toContain('Only the owner');
    expect(await stoppedAt(db, BIZ)).toBeNull();
    const s = await web.post('/app/business/stop-assistant');
    expect(flashSaid(s, SECRET)).toContain('Stopped on every channel');
    const t2 = await web.post('/app/business/start-assistant', {}, staff);
    expect(flashSaid(t2, SECRET)).toContain('Only the owner');
    expect(await stoppedAt(db, BIZ)).not.toBeNull();
  });

  it('DOOR · a second Stop changes nothing and records nothing', async () => {
    const r = await web.post('/app/business/stop-assistant');
    expect(flashSaid(r, SECRET)).toContain('already stopped');
    const n = await inTenant(db, BIZ, (tx) => sql<{ n: number }>`
      select count(*)::int as n from channel_audit where business_id = ${BIZ} and action = 'assistant_stop'`
      .execute(tx).then((x) => x.rows[0]!.n));
    expect(n).toBe(1);
  });

  it('DOOR · handing a conversation back is refused, and the buyer stays on Needs you', async () => {
    const r = await web.post(`/app/inbox/${held}/resume`);
    expect(flashSaid(r, SECRET)).toContain('this conversation stays with you');
    const a = await inTenant(db, BIZ, (tx) => sql<{ a: string | null }>`
      select assigned_to as a from conversations where id = ${held}::uuid`.execute(tx).then((x) => x.rows[0]!.a));
    expect(a).toBe('unclaimed');
    expect((await web.get('/app/inbox?filter=pending')).body).toContain(`/app/inbox/${held}`);
  });

  it('DOOR · "answer this" is refused: nothing asks the assistant, and the conversation stays with its person', async () => {
    const r = await web.post(`/app/inbox/${held}/answer-now`, { messageId: voiceMsg });
    expect(flashSaid(r, SECRET)).toContain('this conversation stays with you');
    expect(answered).toEqual([]);
  });

  it('DOOR · approving or editing a draft written before Stop is refused; the draft stays pending, on Needs you', async () => {
    const draftId = await inTenant(db, BIZ, (tx) => sql<{ id: string }>`
      select id::text as id from drafts where conversation_id = ${drafted}::uuid`.execute(tx).then((x) => x.rows[0]!.id));
    for (const fields of [{ draftId, command: '发送' }, { draftId, command: '改', edit: 'My own words: 500 pcs at 2.40' }]) {
      const r = await web.post(`/app/inbox/${drafted}/act`, fields);
      expect(flashSaid(r, SECRET)).toContain('this draft was not sent');
    }
    const status = await inTenant(db, BIZ, (tx) => sql<{ s: string }>`
      select status as s from drafts where id = ${draftId}::uuid`.execute(tx).then((x) => x.rows[0]!.s));
    expect(status).toBe('pending');
    expect(kicked).toEqual([]);
    expect((await web.get('/app/inbox?filter=pending')).body).toContain(`/app/inbox/${drafted}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
d('Stop · PAGE — My business and Today say what is true (requires DATABASE_URL)', () => {
  const BIZ = `dd7a0000-0000-4000-8000-${RUN}0004`;
  let db: Db;
  let web: Awaited<ReturnType<typeof ownerApp>>;

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    await inTenant(db, BIZ, (tx) => sql`insert into businesses (id, name, owner_locale, channels_used)
                                        values (${BIZ}, 'Stop Page', 'en', '{instagram}'::text[])
                                        on conflict (id) do nothing`.execute(tx));
    await inTenant(db, BIZ, (tx) => sql`
      insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine, is_active)
      values (${BIZ}, 'instagram', ${`ig-page-${RUN}`}, 'stop-secret', 'service', true)`.execute(tx));
    web = await ownerApp(db, BIZ, { provider: 'disabled', messagingEnabled: true, instagramAccountId: `ig-page-${RUN}` });
  }, 60_000);
  afterAll(async () => { await web?.app.close(); await db?.destroy(); });

  it('PAGE · answering: My business offers Stop on every channel, confirmed first', async () => {
    // Phase 7 — on its going-live screen, one tap from the menu, whose row says where it stands.
    expect((await web.get('/app/business')).body).toContain('href="/app/business/ready"');
    const html = (await web.get('/app/business/ready')).body;
    expect(html).toContain('data-golive="every"');
    expect(html).toContain('action="/app/business/stop-assistant"');
    expect(html).not.toContain('action="/app/business/start-assistant"');
    expect(html).toMatch(/action="\/app\/business\/stop-assistant"[\s\S]*?onclick="return confirm\(this\.dataset\.confirm\)"/);
  });

  it('PAGE · stopped: My business says so, offers Start, and says nothing about the assistant answering anyone', async () => {
    await web.post('/app/business/stop-assistant');
    expect((await web.get('/app/business')).body).toContain(`<bdi>${t('en', 'business.live.stopped')}</bdi>`);
    const html = (await web.get('/app/business/ready')).body;
    expect(html).toContain('is stopped on every channel');
    expect(html).toContain('action="/app/business/start-assistant"');
    expect(html).not.toContain('action="/app/business/stop-assistant"');
    expect(html).toContain('href="/app/inbox?filter=pending"');
    expect(html).not.toContain('replies go out as soon as they are sent');   // golive.other.live
    const today = (await web.get('/app')).body;
    expect(today).toContain('is stopped on every channel');
    expect(today).not.toContain('class="calm-say"');
  });

  it('PAGE · in every locale, nothing is left as a key', async () => {
    for (const l of ['zh', 'ar'] as const) {
      for (const url of ['/app/business', '/app/business/ready', '/app']) {
        const html = (await web.app.inject({ method: 'GET', url, headers: { cookie: web.cookie, 'accept-language': l } })).body;
        expect(html, `${l} ${url}`).toContain(`lang="${l}"`);
        expect(html, `${l} ${url}`).not.toMatch(/assistant\.stop\.|today\.stopped\./);
      }
    }
  });
});
