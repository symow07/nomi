import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';

/**
 * S7 (Phase 5, item 22) — THE BUSINESS'S CHAT PAGE, end to end, in the production composition: a visitor opens the
 * page, writes, and the assistant's answer appears on the same page — through the one inbound queue, the one turn and
 * the one send gate every channel shares. A form sent twice is one message; one visitor never sees another's lines; a
 * page switched off takes nothing; the owner's Stop binds the assistant here too, and the owner's own reply still goes.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `58580000-0000-4000-8000-${RUN}0001`;
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
type Tx = import('../../src/db/client.js').Tx;

d('S7 · the chat page, end to end (requires DATABASE_URL)', { timeout: 180_000 }, () => {
  let prod: Awaited<ReturnType<typeof import('../../src/main.js')['buildProduction']>>;
  let key = '';
  const analyzer = new FakeAnalyzer();
  analyzer.next = {
    language: { detected: 'en', replyIn: 'en' },
    intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
    recommendedPhase: 'clarification',
  };
  const replyWriter = new FakeReplyWriter();
  replyWriter.replies = ['Thanks — which size are you looking for?'];

  const q = async <T>(fn: (tx: Tx) => Promise<T>) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(prod.db, BIZ as never, fn);
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
  /** A visitor: their cookie, from opening the page. */
  const visit = async () => {
    const r = await prod.app.inject({ method: 'GET', url: `/chat/${key}` });
    expect(r.statusCode).toBe(200);
    const set = String(r.headers['set-cookie'] ?? '');
    expect(set).toMatch(new RegExp(`yf_chat=[A-Za-z0-9_-]{32}; HttpOnly; Path=/chat/${key}; SameSite=Lax; Max-Age=15552000`));
    return set.split(';')[0]!;
  };
  const say = (cookie: string, text: string, n = randomUUID().replace(/-/g, '')) =>
    prod.app.inject({ method: 'POST', url: `/chat/${key}`, headers: { cookie, ...FORM }, payload: new URLSearchParams({ text, n }).toString() });
  const pageOf = async (cookie: string) => (await prod.app.inject({ method: 'GET', url: `/chat/${key}`, headers: { cookie } })).body;
  const said = (text: string) => q((tx) => sql<{ n: number }>`select count(*)::int as n from messages m join conversations c on c.id = m.conversation_id
    where c.business_id = ${BIZ}::uuid and c.channel = 'web_chat' and m.direction = 'inbound' and m.text_content = ${text}`.execute(tx).then((r) => r.rows[0]!.n));
  const convOf = (text: string) => until(() => q((tx) => sql<{ id: string }>`select c.id::text as id from messages m join conversations c on c.id = m.conversation_id
    where c.business_id = ${BIZ}::uuid and c.channel = 'web_chat' and m.text_content = ${text} limit 1`.execute(tx).then((r) => r.rows[0]?.id)), `the message "${text}"`);
  const sentIn = (conv: string) => q((tx) => sql<{ body: string; origin: string }>`select body, origin from outbound_messages
    where conversation_id = ${conv}::uuid and status = 'sent' order by seq`.execute(tx).then((r) => r.rows));

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { setChatPage } = await import('../../src/db/webChat.js');
    const sim = whatsappSimulator([], { tag: `wc${RUN}` });
    const setup = createDb(DATABASE_URL!);
    await withTenantTx(setup, BIZ as never, async (t) => {
      await sql`insert into businesses (id, name, engine, batch_debounce_ms, batch_max_window_ms) values (${BIZ}, 'Atlas Bags', 'service', 300, 1000)`.execute(t);
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
                values (${BIZ}, 'whatsapp', ${sim.phoneNumberId}, 'sim-test', 'service')`.execute(t);
      for (const cap of ['greet', 'qualify', 'recommend', 'quote', 'negotiate', 'follow_up']) {
        await sql`insert into autonomy_policy (business_id, capability, mode) values (${BIZ}, ${cap}, 'auto')
                  on conflict (business_id, capability) do update set mode = 'auto'`.execute(t);
      }
      await sql`insert into assistants (business_id, name, is_default) values (${BIZ}, 'Lily', true)`.execute(t);
      await sql`insert into onboarding_state (business_id, assistant_named_at) values (${BIZ}, now())
                on conflict (business_id) do update set assistant_named_at = now()`.execute(t);
      key = (await setChatPage(t, BIZ as never, true, 'owner'))!;
    });
    await setup.destroy();
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: 'meta-app-secret-not-real', META_GRAPH_API_VERSION: 'v23.0',
      WEBHOOK_VERIFY_TOKEN: 'wc-verify-token-xxx', CREDENTIAL_KEY: 'd'.repeat(64), PORT: 0,
    }, { adapter: sim.adapter, logger: false, models: { analyzer, replyWriter }, autonomyReleased: () => true });
  }, 60_000);
  afterAll(async () => {
    if (prod) {
      const { QUEUES } = await import('../../src/queue/boss.js');
      await until(async () => ((await sql<{ n: number }>`select count(*)::int as n from pgboss.job where name in (${QUEUES.inbound}, ${QUEUES.outbound}, ${QUEUES.notify})
        and data->>'businessId' = ${BIZ} and state in ('created', 'retry', 'active')`.execute(prod.db)).rows[0]!.n === 0 ? true : undefined), 'this test\'s jobs');
    }
    await prod?.close();
  }, 90_000);

  it('A VISITOR WRITES, AND THE ANSWER APPEARS ON THE PAGE: the one queue, the one turn, the one send path', async () => {
    const me = await visit();
    expect(await pageOf(me)).toContain('Chat with Atlas Bags');
    const r = await say(me, 'Do you make tote bags?');
    expect([r.statusCode, r.headers['location']]).toEqual([303, `/chat/${key}#latest`]);
    const conv = await convOf('Do you make tote bags?');
    const sent = await until(async () => { const s = await sentIn(conv); return s.length ? s : undefined; }, 'the answer');
    expect(sent[0]!.origin).toBe('employee');
    expect(sent[0]!.body).toContain('Thanks — which size are you looking for?');
    // a first message nobody approved says what is writing (rule 3)
    expect(sent[0]!.body).toContain('AI assistant');
    const shown = await until(async () => { const p = await pageOf(me); return p.includes('which size are you looking for?') ? p : undefined; }, 'the answer on the page');
    expect(shown).toMatch(/<li class="chat-line mine">[\s\S]*Do you make tote bags\?[\s\S]*<li class="chat-line"[^>]*>[\s\S]*Atlas Bags/);
    const mark = await prod.app.inject({ method: 'GET', url: `/chat/${key}/mark`, headers: { cookie: me } });
    expect(mark.body).toMatch(/^\d+_[0-9a-f-]{36}$/);
  });

  it('ONE MESSAGE, ONCE: the same form sent twice is one message; another visitor sees none of it', async () => {
    const me = await visit();
    await say(me, 'Price for 500 pieces?', 'same-nonce-0123456789abcdef');
    await say(me, 'Price for 500 pieces?', 'same-nonce-0123456789abcdef');
    await convOf('Price for 500 pieces?');
    expect(await said('Price for 500 pieces?')).toBe(1);
    const other = await visit();
    const theirs = await pageOf(other);
    expect(theirs).not.toContain('Price for 500 pieces?');
    expect(theirs).not.toContain('Do you make tote bags?');
  });

  it('THE OWNER\'S STOP binds the assistant here too: no answer, the buyer handed to a person; the owner\'s own reply goes', async () => {
    await q((tx) => sql`update businesses set assistant_stopped_at = now() where id = ${BIZ}::uuid`.execute(tx));
    const me = await visit();
    await say(me, 'Anyone there?');
    const conv = await convOf('Anyone there?');
    await until(async () => ((await q((tx) => sql<{ a: string | null }>`select assigned_to as a from conversations where id = ${conv}::uuid`
      .execute(tx).then((r) => r.rows[0]?.a ?? null))) !== null ? true : undefined), 'the hand-off');
    expect(await sentIn(conv)).toEqual([]);
    // the owner takes it, as the conversation page does, and answers in person
    const { takeOver } = await import('../../src/conversations/takeover.js');
    await takeOver({ db: prod.db, now: () => new Date() }, { businessId: BIZ as never, conversationId: conv, actor: 'owner' });
    const { ownerReply } = await import('../../src/outbound/ownerReply.js');
    const { QUEUES } = await import('../../src/queue/boss.js');
    const r = await ownerReply({ db: prod.db, now: () => new Date(), kickDrive: async (b, c) => { await prod.boss.send(QUEUES.outbound, { businessId: b, conversationId: c }, { singletonKey: c }); } },
      { businessId: BIZ as never, conversationId: conv, text: 'This is the owner — yes, we are here.', actor: 'owner' });
    expect(r.outcome).toBe('sent');
    await until(async () => ((await sentIn(conv)).some((x) => x.origin === 'owner') ? true : undefined), 'the owner\'s reply');
    expect(await pageOf(me)).toContain('This is the owner — yes, we are here.');
    await q((tx) => sql`update businesses set assistant_stopped_at = null where id = ${BIZ}::uuid`.execute(tx));
  });

  it('SWITCHED OFF: the page answers nobody, and takes nothing', async () => {
    const me = await visit();
    const { setChatPage } = await import('../../src/db/webChat.js');
    await q((tx) => setChatPage(tx, BIZ as never, false, 'owner'));
    expect((await prod.app.inject({ method: 'GET', url: `/chat/${key}`, headers: { cookie: me } })).statusCode).toBe(404);
    const r = await say(me, 'Hello while off');
    expect(r.statusCode).toBe(404);
    expect(await said('Hello while off')).toBe(0);
    // on again: the same address
    expect(await q((tx) => setChatPage(tx, BIZ as never, true, 'owner'))).toBe(key);
  });
});
