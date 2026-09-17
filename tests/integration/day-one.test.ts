import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant, runDigits } from './tenant.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';

/**
 * G10 — day-one WhatsApp, through the PRODUCTION composition: a signed webhook
 * → the real ingress → pg-boss → the real worker, and the owner's own routes.
 *
 *  a · what the buyer typed, and what went out, are on her timeline;
 *  b · each buyer has his own 24-hour window, and approving past it says so;
 *  c · a number not on her pilot list is recorded and shown, never answered.
 *
 * Its own business, so turning messaging on here cannot change what any other
 * file's buyers are allowed.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd100000-0000-4000-8000-${RUN}0001`;
const buyer = (n: number) => `9715${runDigits(RUN, 6)}${n}`;
const A = buyer(1); const B = buyer(2); const C = buyer(3);
const HOURS = 3600 * 1000;

const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 30_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
};

d('G10 · day-one WhatsApp (requires DATABASE_URL)', { timeout: 40_000 }, () => {
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  let bid: import('../../src/core/types/ids.js').BusinessId;
  let cookie = '';
  const analyzer = new FakeAnalyzer();
  analyzer.next = {
    language: { detected: 'en', replyIn: 'en' },
    intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
    recommendedPhase: 'clarification',
  };
  const replyWriter = new FakeReplyWriter();
  replyWriter.replies = ['Thanks — which size are you looking for?'];

  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(prod.db, bid, fn);
  };
  const post = (w: { rawBody: string; headers: Record<string, string> }) =>
    prod.app.inject({ method: 'POST', url: '/webhook/whatsapp',
      payload: w.rawBody, headers: { 'content-type': 'application/json', ...w.headers } });
  const wamidOf = (w: { payload: unknown }) =>
    (w.payload as { entry: { changes: { value: { messages: { id: string }[] } }[] }[] })
      .entry[0]!.changes[0]!.value.messages[0]!.id;
  const convOf = (wa: string) => until(() => tx((t) => sql<{ id: string }>`
    select c.id::text as id from conversations c
      join client_channels cc on cc.client_id = c.client_id and cc.channel = 'whatsapp'
     where cc.channel_user_id = ${wa} and c.is_active limit 1`.execute(t).then((r) => r.rows[0]?.id)), `conversation of ${wa}`);
  const windowOf = (wa: string) => tx((t) => sql<{ at: Date | null }>`
    select last_inbound_at as at from client_channels where channel = 'whatsapp' and channel_user_id = ${wa}
  `.execute(t).then((r) => r.rows[0]?.at ?? null));

  beforeAll(async () => {
    await seedRunTenant();
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    bid = b.value;

    sim = whatsappSimulator([], { tag: `g10${RUN}` });
    const setup = createDb(DATABASE_URL!);
    await withTenantTx(setup, bid, async (t) => {
      await sql`insert into businesses (id, name, engine) values (${BIZ}, 'Day One Factory', 'service')
                on conflict (id) do nothing`.execute(t);
      await sql`insert into channels (business_id, kind, status, display_phone, connected_at)
                values (${BIZ}, 'whatsapp', 'connected', '+86 579****0010', now())`.execute(t);
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
      WEBHOOK_VERIFY_TOKEN: 'g10-verify-token-xx',
      CREDENTIAL_KEY: 'b'.repeat(64),
      PORT: 0,
    }, { adapter: sim.adapter, logger: false, models: { analyzer, replyWriter } });

    const login = await prod.app.inject({ method: 'POST', url: '/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `code=${encodeURIComponent(prod.ownerAccessCode)}` });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 60_000);

  afterAll(async () => { await prod?.close(); });

  it('a · WHAT HE TYPED IS ON HER TIMELINE — nothing in production used to write it', async () => {
    const w = sim.inboundText({ from: A, text: 'Hello, do you make canvas bags?' });
    expect((await post(w)).statusCode).toBe(200);
    const row = await until(() => tx((t) => sql<{ direction: string; input_type: string; text_content: string }>`
      select direction, input_type, text_content from messages where external_id = ${wamidOf(w)}
    `.execute(t).then((r) => r.rows[0])), 'the typed message');
    expect(row).toEqual({ direction: 'inbound', input_type: 'text', text_content: 'Hello, do you make canvas bags?' });

    const conv = await convOf(A);
    const page = await prod.app.inject({ method: 'GET', url: `/app/inbox/${conv}`, headers: { cookie } });
    expect(page.body).toContain('Hello, do you make canvas bags?');
  });

  it('a · …and what LEFT is on it too, once — at the moment the provider took it', async () => {
    const { enqueueOutboundRow, channelStore } = await import('../../src/db/channels.js');
    const conv = await convOf(A);
    const id = await tx((t) => enqueueOutboundRow(t, bid, conv, 'Yes — 38 × 40 cm, 90 gsm.', 'owner'));
    expect(id).not.toBeNull();
    await tx((t) => channelStore(t, bid).transition(id!, 'sending', null));
    const none = await tx((t) => sql<{ n: number }>`
      select count(*)::int as n from messages where external_id = ${'out:' + id}`.execute(t).then((r) => r.rows[0]!.n));
    expect(none).toBe(0);                                  // queued and sending are not "said"
    await tx((t) => channelStore(t, bid).transition(id!, 'sent', null));
    await tx((t) => channelStore(t, bid).transition(id!, 'sent', null));   // a replayed status
    const rows = await tx((t) => sql<{ direction: string; text_content: string }>`
      select direction, text_content from messages where external_id = ${'out:' + id}`.execute(t).then((r) => r.rows));
    expect(rows).toEqual([{ direction: 'outbound', text_content: 'Yes — 38 × 40 cm, 90 gsm.' }]);
  });

  it('b · EACH BUYER HAS HIS OWN WINDOW — a chatty buyer cannot keep a silent one’s open', async () => {
    const dayAgo = new Date(Date.now() - 25 * HOURS);
    expect((await post(sim.inboundText({ from: B, text: 'Price for 5000?', at: dayAgo }))).statusCode).toBe(200);
    await convOf(B);
    await until(async () => ((await windowOf(B))?.getTime() === dayAgo.getTime() - (dayAgo.getTime() % 1000) ? true : undefined), 'B’s window');

    // A writes again, now. B's window must not move with it.
    await post(sim.inboundText({ from: A, text: 'And the price?' }));
    await until(async () => ((await windowOf(A))!.getTime() > Date.now() - 60_000 ? true : undefined), 'A’s window');
    expect((await windowOf(B))!.getTime()).toBeLessThan(Date.now() - 24 * HOURS);

    // The send path reads HIS window.
    const { channelStore } = await import('../../src/db/channels.js');
    const { windowState } = await import('../../src/core/channel/window.js');
    const [convA, convB] = [await convOf(A), await convOf(B)];
    const ctxA = (await tx((t) => channelStore(t, bid).load(convA as never))).ctx;
    const ctxB = (await tx((t) => channelStore(t, bid).load(convB as never))).ctx;
    expect(windowState(ctxA.lastInboundAt, new Date())).not.toBe('expired');
    expect(windowState(ctxB.lastInboundAt, new Date())).toBe('expired');
  });

  it('b · APPROVING PAST HIS WINDOW SAYS WHY — and the draft is still hers to send when he writes', async () => {
    // Live, in pilot, with both buyers on her list: only the window stands.
    await tx(async (t) => {
      await sql`update channels set activated_at = now(), pilot_mode = true
                 where business_id = ${BIZ} and kind = 'whatsapp'`.execute(t);
      for (const wa of [A, B]) {
        await sql`insert into pilot_allowlist (business_id, phone, label, added_by)
                  values (${BIZ}, ${wa}, 'test', 'owner') on conflict (business_id, phone) do nothing`.execute(t);
      }
    });
    const convB = await convOf(B);
    const draft = await tx((t) => sql<{ id: string }>`
      insert into drafts (business_id, conversation_id, capability, draft_text, turn_message_id, status)
      values (${BIZ}, ${convB}::uuid, 'quote', 'For 5,000 pcs: $0.45 each.', null, 'pending')
      returning id::text as id`.execute(t).then((r) => r.rows[0]!.id));

    const res = await prod.app.inject({ method: 'POST', url: `/app/inbox/${convB}/act`,
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: `draftId=${draft}&command=${encodeURIComponent('发送')}` });
    expect(res.statusCode).toBe(302);
    expect(decodeURIComponent(String(res.headers['location']))).toContain('As soon as they reply, you can continue');
    const status = await tx((t) => sql<{ status: string }>`select status from drafts where id = ${draft}::uuid`
      .execute(t).then((r) => r.rows[0]!.status));
    expect(status).toBe('pending');

    // And A, whose window is open, is approved and sent as ever.
    const convA = await convOf(A);
    const dA = await tx((t) => sql<{ id: string }>`
      insert into drafts (business_id, conversation_id, capability, draft_text, turn_message_id, status)
      values (${BIZ}, ${convA}::uuid, 'qualify', 'Which size?', null, 'pending')
      returning id::text as id`.execute(t).then((r) => r.rows[0]!.id));
    await prod.app.inject({ method: 'POST', url: `/app/inbox/${convA}/act`,
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: `draftId=${dA}&command=${encodeURIComponent('发送')}` });
    expect(await tx((t) => sql<{ status: string }>`select status from drafts where id = ${dA}::uuid`
      .execute(t).then((r) => r.rows[0]!.status))).toBe('approved');
  });

  it('c · A NUMBER NOT ON HER LIST — recorded, shown to her, and no model is asked', async () => {
    const w = sim.inboundText({ from: C, text: 'Hi, send me your catalogue' });
    expect((await post(w)).statusCode).toBe(200);
    const conv = await convOf(C);

    // Recorded, on her timeline…
    await until(() => tx((t) => sql<{ text_content: string }>`
      select text_content from messages where external_id = ${wamidOf(w)}`.execute(t).then((r) => r.rows[0])), 'C’s message');
    // …handed to a person, with the reason…
    const held = await until(() => tx((t) => sql<{ assigned_to: string | null; kind: string }>`
      select c.assigned_to, s.kind from conversations c
        join conversation_signals s on s.conversation_id = c.id and s.kind = 'unlisted_number' and s.resolved_at is null
       where c.id = ${conv}::uuid`.execute(t).then((r) => r.rows[0])), 'the hand-off');
    expect(held.assigned_to).toBe('unclaimed');
    // …and no turn — not now, and not after the batching window a typed line
    // would have waited out — so no model call and no draft that could never leave.
    await new Promise((r) => setTimeout(r, 6_000));
    const count = (table: string) => tx((t) => sql<{ n: number }>`
      select count(*)::int as n from ${sql.table(table)} where conversation_id = ${conv}::uuid`
      .execute(t).then((r) => r.rows[0]!.n));
    expect(await count('turns')).toBe(0);
    expect(await count('drafts')).toBe(0);

    const page = await prod.app.inject({ method: 'GET', url: `/app/inbox/${conv}`, headers: { cookie } });
    expect(page.body).toContain('Someone not on your list wrote');
    expect(page.body).toContain('Hi, send me your catalogue');
  });

  it('c · a buyer ON her list is still answered while live', async () => {
    await post(sim.inboundText({ from: A, text: 'Do you do custom printing?' }));
    const convA = await convOf(A);
    await until(() => tx((t) => sql<{ n: number }>`
      select 1 as n from turns where conversation_id = ${convA}::uuid and input->>'text' like '%custom printing%'
    `.execute(t).then((r) => r.rows[0])), 'a turn for A');
  });
});
