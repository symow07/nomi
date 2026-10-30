import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';
import { TIKTOK_APP, tiktokFake, tiktokDelivery, customerSays } from '../channels/tiktok-fake.js';

/**
 * 0215 — TIKTOK DIRECT MESSAGES, end to end in the production composition (docs/TIKTOK-CHANNEL.md, surface A), with
 * TikTok a recorded fake of its documented answers. A business's own account: a customer's message is answered through
 * the one queue, turn and send gate, from the account's own grant; the owner typing in TikTok takes the conversation;
 * TikTok's counts hold the send gate; a grant near its end is renewed and kept first; a dead one is marked and nothing
 * more goes; a message from the EEA, Switzerland or the UK is counted, never answered; an unsigned delivery is refused.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const A = `71710000-0000-4000-8000-${RUN}0001`;
const OPEN_ID = `oid-${RUN}-westlake`;
const KEY_HEX = 'e'.repeat(64);
type Tx = import('../../src/db/client.js').Tx;

d('0215 · TikTok direct messages, in the production composition (requires DATABASE_URL)', { timeout: 240_000 }, () => {
  let prod: Awaited<ReturnType<typeof import('../../src/main.js')['buildProduction']>>;
  const tt = tiktokFake();
  const analyzer = new FakeAnalyzer();
  analyzer.next = {
    language: { detected: 'en', replyIn: 'en' },
    intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
    recommendedPhase: 'clarification',
  };
  const replyWriter = new FakeReplyWriter();
  replyWriter.replies = ['Yes, we ship to Rabat — which bag are you looking at?'];
  let conv = 0;
  const C = () => `conv-${RUN}-${++conv}`;

  const q = async <T>(fn: (tx: Tx) => Promise<T>) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(prod.db, A as never, fn);
  };
  const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 60_000): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await probe();
      if (v !== undefined) return v;
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  };
  const deliver = (event: string, content: Record<string, unknown>, o: { secret?: string; openId?: string } = {}) => {
    const app = o.secret ? { ...TIKTOK_APP, appSecret: o.secret } : TIKTOK_APP;
    const dl = tiktokDelivery(app, event, o.openId ?? OPEN_ID, content);
    return prod.app.inject({ method: 'POST', url: '/webhook/tiktok', headers: { 'content-type': 'application/json', 'tiktok-signature': dl.signature }, payload: dl.body });
  };
  const said = (text: string) => q((tx) => sql<{ n: number }>`select count(*)::int as n from messages m join conversations c on c.id = m.conversation_id
    where c.channel = 'tiktok' and m.direction = 'inbound' and m.text_content = ${text}`.execute(tx).then((r) => r.rows[0]!.n));
  const account = () => q(async (tx) => (await import('../../src/db/tiktokAccounts.js')).liveTikTokAccount(tx, A as never));
  const sentTo = (c: string) => tt.sent.filter((s) => s.conversation === c);
  const refusals = (c: string) => q((tx) => sql<{ reason: string }>`select om.cancel_reason as reason from outbound_messages om
    join conversations cv on cv.id = om.conversation_id join client_channels cc on cc.client_id = cv.client_id and cc.channel = 'tiktok'
    where cc.channel_user_id = ${c} and om.status = 'canceled'`.execute(tx).then((r) => r.rows.map((x) => x.reason.replace(/^canceled: /, ''))));

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { connectTikTokAccount, linkTikTokCredential } = await import('../../src/db/tiktokAccounts.js');
    const { exchangeTikTokCode, packTikTokGrant } = await import('../../src/channels/tiktok/api.js');
    const { encryptSecret, credentialFingerprint, deriveKey } = await import('../../src/security/credentials.js');
    const sim = whatsappSimulator([], { tag: `tt${RUN}` });
    const setup = createDb(DATABASE_URL!);
    // The account's grant, as the connect would have kept it (the connect itself: tiktok-connect.test.ts).
    const t = await exchangeTikTokCode(TIKTOK_APP, tt.code(OPEN_ID), 'https://app.example/app/connect/tiktok/callback', tt.fetch);
    if (!t.ok) throw new Error('fixture: the fake refused the code');
    const packed = packTikTokGrant(t.grant);
    await withTenantTx(setup, A as never, async (tx) => {
      await sql`insert into businesses (id, name, engine, batch_debounce_ms, batch_max_window_ms) values (${A}, 'Westlake TikTok', 'service', 300, 1000)`.execute(tx);
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
                values (${A}, 'whatsapp', ${sim.phoneNumberId}, 'sim-test', 'service')`.execute(tx);
      for (const cap of ['greet', 'qualify', 'recommend', 'quote', 'negotiate', 'follow_up']) {
        await sql`insert into autonomy_policy (business_id, capability, mode) values (${A}, ${cap}, 'auto')
                  on conflict (business_id, capability) do update set mode = 'auto'`.execute(tx);
      }
      await sql`insert into assistants (business_id, name, is_default) values (${A}, 'Lily', true)`.execute(tx);
      await sql`insert into onboarding_state (business_id, assistant_named_at) values (${A}, now())
                on conflict (business_id) do update set assistant_named_at = now()`.execute(tx);
      const saved = await connectTikTokAccount(tx, A as never, { openId: OPEN_ID, username: '', ciphertext: encryptSecret(packed, deriveKey(KEY_HEX)),
        fingerprint: credentialFingerprint(packed), scopes: t.scopes.join(','), by: 'owner' });
      if (!saved.ok) throw new Error('fixture');
      expect(await linkTikTokCredential(tx, A as never, { accountId: saved.id, openId: OPEN_ID, actor: 'owner' })).toBe('linked');
    });
    await setup.destroy();
    process.env['PILOT_BUSINESS_ID'] = A;
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: 'meta-app-secret-not-real', META_GRAPH_API_VERSION: 'v23.0',
      WEBHOOK_VERIFY_TOKEN: 'tt-verify-token-xxx', CREDENTIAL_KEY: KEY_HEX, PORT: 0,
    }, {
      adapter: sim.adapter, logger: false, models: { analyzer, replyWriter }, autonomyReleased: () => true,
      tiktok: { app: TIKTOK_APP, fetch: tt.fetch }, echoSettleSeconds: 1,
    });
  }, 60_000);
  afterAll(async () => {
    if (prod) {
      const { QUEUES } = await import('../../src/queue/boss.js');
      await until(async () => ((await sql<{ n: number }>`select count(*)::int as n from pgboss.job where name in (${QUEUES.inbound}, ${QUEUES.outbound}, ${QUEUES.notify}, ${QUEUES.echo})
        and data->>'businessId' = ${A} and state in ('created', 'retry', 'active')`.execute(prod.db)).rows[0]!.n === 0 ? true : undefined), 'this test\'s jobs');
    }
    await prod?.close();
  }, 90_000);

  it('a delivery not signed with the app\'s secret is refused before it is read', async () => {
    expect((await deliver('im_receive_msg', customerSays({ conversation: C(), text: 'hello' }), { secret: 'not-the-app-secret' })).statusCode).toBe(401);
  });

  it('A CUSTOMER WRITES: answered through the one turn and send gate, from the account\'s own grant, to the conversation', async () => {
    const c = C();
    expect((await deliver('im_receive_msg', customerSays({ conversation: c, text: 'Do you ship to Rabat?', to: 'westlake.canvas' }))).statusCode).toBe(200);
    await until(async () => ((await said('Do you ship to Rabat?')) === 1 ? true : undefined), 'the message, recorded');
    const reply = await until(async () => sentTo(c)[0], 'the answer, to the conversation');
    expect(reply.openId).toBe(OPEN_ID);
    expect(reply.body).toContain('Yes, we ship to Rabat');
    expect(reply.body).toContain('AI assistant');   // the first message nobody approved says so (rule 3)
    // the delivery named the account: kept for the page
    expect((await account())?.username).toBe('westlake.canvas');
    // and the reply is on the transcript under the id TikTok gave it — written just AFTER the call (#405, A1: the provider
    // is called with no transaction open, and its answer recorded in the next), so it is waited for, not read at once.
    const ids = await until(async () => {
      const got = await q((tx) => sql<{ id: string }>`select provider_message_id as id from outbound_messages where provider_message_id like 'tt:%'`.execute(tx).then((r) => r.rows.map((x) => x.id)));
      return got.includes(`tt:${reply.messageId}`) ? got : undefined;
    }, 'the id TikTok gave, recorded');
    expect(ids).toContain(`tt:${reply.messageId}`);
  });

  it('A PHOTO IS NAMED AND HANDED TO A PERSON, never opened; nothing is sent', async () => {
    const c = C();
    await deliver('im_receive_msg', customerSays({ conversation: c, type: 'image' }));
    await until(async () => q((tx) => sql<{ held: string | null }>`select cv.assigned_to as held from conversations cv join client_channels cc on cc.client_id = cv.client_id
      where cc.channel = 'tiktok' and cc.channel_user_id = ${c}`.execute(tx).then((r) => (r.rows[0]?.held ? true : undefined))), 'handed to a person');
    await new Promise((r) => setTimeout(r, 1000));
    expect(sentTo(c)).toEqual([]);
  });

  it('THE OWNER TYPES IN TIKTOK: the echo is the owner\'s, the conversation passes to them, the assistant says nothing more', async () => {
    const c = C();
    await deliver('im_receive_msg', customerSays({ conversation: c, text: 'Is the blue one in stock?' }));
    await until(async () => sentTo(c)[0], 'the first answer');
    const before = sentTo(c).length;
    // our own echo (source API, the id we recorded) changes nothing
    await deliver('im_send_msg', { ...customerSays({ conversation: c, text: sentTo(c)[0]!.body }), message_id: sentTo(c)[0]!.messageId, message_tag: { source: 'API' } });
    // the owner, in the TikTok app
    await deliver('im_send_msg', { ...customerSays({ conversation: c, text: 'I will check the shelf for you.', from: 'westlake.canvas' }), message_tag: { source: 'APP' } });
    await until(async () => q((tx) => sql<{ n: number }>`select count(*)::int as n from conversation_events e join conversations cv on cv.id = e.conversation_id
      join client_channels cc on cc.client_id = cv.client_id where cc.channel = 'tiktok' and cc.channel_user_id = ${c} and e.type = 'owner_replied_elsewhere'`
      .execute(tx).then((r) => (r.rows[0]!.n === 1 ? true : undefined))), 'the owner\'s reply, recorded once');
    await deliver('im_receive_msg', customerSays({ conversation: c, text: 'Thanks!' }));
    await until(async () => ((await said('Thanks!')) === 1 ? true : undefined), 'the next message, recorded');
    await new Promise((r) => setTimeout(r, 1500));
    expect(sentTo(c).length, 'nothing more from the assistant').toBe(before);
  });

  it('TIKTOK\'S COUNT: ten messages after a first one, then the gate refuses with its own reason — the owner\'s own reply too', async () => {
    const c = C();
    await deliver('im_receive_msg', customerSays({ conversation: c, text: 'Hello?' }));
    await until(async () => sentTo(c)[0], 'the first answer');
    // nine more the account sent (as if the owner typed them in TikTok): ten in all, and the customer has not replied
    for (let i = 0; i < 9; i++) await deliver('im_send_msg', { ...customerSays({ conversation: c, text: `follow-up ${i}` }), message_tag: { source: 'WEB' } });
    await until(async () => q((tx) => sql<{ n: number }>`select count(*)::int as n from messages m join conversations cv on cv.id = m.conversation_id
      join client_channels cc on cc.client_id = cv.client_id where cc.channel = 'tiktok' and cc.channel_user_id = ${c} and m.direction = 'outbound'`
      .execute(tx).then((r) => (r.rows[0]!.n >= 10 ? true : undefined))), 'ten from the account');
    const { enqueueOutboundRow } = await import('../../src/db/channels.js');
    const { QUEUES } = await import('../../src/queue/boss.js');
    const cid = await q((tx) => sql<{ id: string }>`select cv.id::text as id from conversations cv join client_channels cc on cc.client_id = cv.client_id
      where cc.channel = 'tiktok' and cc.channel_user_id = ${c}`.execute(tx).then((r) => r.rows[0]!.id));
    await q((tx) => enqueueOutboundRow(tx, A as never, cid, 'One more from me', 'owner'));
    await prod.boss.send(QUEUES.outbound, { businessId: A, conversationId: cid });
    await until(async () => ((await refusals(c)).includes('tiktok_limit') ? true : undefined), 'the eleventh, refused as TikTok\'s limit');
    expect(sentTo(c).some((s) => s.body === 'One more from me')).toBe(false);
  });

  it('A GRANT NEAR ITS END is renewed before the send and kept, whole; a dead one is marked once and nothing more goes from it', async () => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { openTikTokGrant, packTikTokGrant } = await import('../../src/channels/tiktok/api.js');
    const { decryptSecret, encryptSecret, credentialFingerprint, deriveKey } = await import('../../src/security/credentials.js');
    const { rotateTikTokGrant } = await import('../../src/db/tiktokAccounts.js');
    const acct = (await account())!;
    const g = openTikTokGrant(decryptSecret(acct.ciphertext, deriveKey(KEY_HEX)).plain)!;
    const ending = packTikTokGrant({ ...g, ae: Date.now() + 60_000 });   // a minute left: under the five-minute margin
    await withTenantTx(prod.db, A as never, (tx) => rotateTikTokGrant(tx, acct.id, encryptSecret(ending, deriveKey(KEY_HEX)), credentialFingerprint(ending)));
    const refreshesBefore = tt.refreshes();
    const c = C();
    await deliver('im_receive_msg', customerSays({ conversation: c, text: 'Any discount?' }));
    await until(async () => sentTo(c)[0], 'the answer, after a renewal');
    expect(tt.refreshes()).toBe(refreshesBefore + 1);
    const kept = openTikTokGrant(decryptSecret((await account())!.ciphertext, deriveKey(KEY_HEX)).plain)!;
    expect(kept.a).not.toBe(g.a);
    expect(kept.ae).toBeGreaterThan(Date.now() + 3600_000);

    tt.killAll();   // the owner removed the app in TikTok
    const c2 = C();
    await deliver('im_receive_msg', customerSays({ conversation: c2, text: 'Hello again' }));
    await until(async () => ((await account())?.needsAttention === 'revoked' ? true : undefined), 'the grant, marked');
    const c3 = C();
    await deliver('im_receive_msg', customerSays({ conversation: c3, text: 'Anyone there?' }));
    await until(async () => ((await refusals(c3)).length > 0 ? true : undefined), 'the next reply, refused');
    expect(await refusals(c3)).toEqual(['channel_unavailable']);
    expect(sentTo(c2).concat(sentTo(c3))).toEqual([]);
  });

  it('A MESSAGE FROM THE EEA, SWITZERLAND OR THE UK carries nothing to answer: counted on the account, no conversation, nothing sent', async () => {
    const before = (await account())!.euMessages;
    const sentBefore = tt.sent.length;
    await deliver('im_receive_msg_eu', { to: 'westlake.canvas', to_user: { id: OPEN_ID, role: 'business_account' }, timestamp: Date.now() });
    await until(async () => ((await account())!.euMessages === before + 1 ? true : undefined), 'counted');
    expect((await account())!.euLastAt).not.toBeNull();
    expect(tt.sent.length).toBe(sentBefore);
  });

  it('A DELIVERY FOR AN ACCOUNT NOBODY CONNECTED is acknowledged and dropped', async () => {
    const r = await deliver('im_receive_msg', customerSays({ conversation: C(), text: 'stray message' }), { openId: 'oid-nobody-connected-this' });
    expect(r.statusCode).toBe(200);
    await new Promise((res) => setTimeout(res, 800));
    expect(await said('stray message')).toBe(0);
  });
});
