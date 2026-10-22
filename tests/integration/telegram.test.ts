import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';

/**
 * S7 (Phase 5, item 22) — TELEGRAM, ONE NOMI BOT FOR EVERY BUSINESS (the owner's choice, 2026-10-22), end to end in
 * the production composition, with Telegram's Bot API a recorder. Each business turns Telegram on and shares its own
 * start link; a chat that opens one belongs to that business and is answered through the one queue, turn and send
 * gate; a chat that opened two writes to the one it opened last; a chat that opened none, and a business switched off,
 * take nothing; an update without the webhook's secret is refused before it is read.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const A = `59590000-0000-4000-8000-${RUN}0001`;
const B = `59590000-0000-4000-8000-${RUN}0002`;
const SECRET = 'tg-webhook-secret-for-tests-only';
const BOT = '7099990000';
const ENV = { TELEGRAM_BOT_TOKEN: `${BOT}:AAtest-token-not-real_0123456789`, TELEGRAM_WEBHOOK_SECRET: SECRET, TELEGRAM_BOT_USERNAME: 'NomiTestBot' };
type Tx = import('../../src/db/client.js').Tx;

d('S7 · Telegram, one bot for every business (requires DATABASE_URL)', { timeout: 180_000 }, () => {
  let prod: Awaited<ReturnType<typeof import('../../src/main.js')['buildProduction']>>;
  const code: Record<'A' | 'B', string> = { A: '', B: '' };
  const sent: { method: string; body: Record<string, unknown> }[] = [];
  let update = 1000 + Math.floor(Math.random() * 1e6);
  let msg = 1;
  // Telegram's ids are unique per chat for a bot, so the receipt's key is too — in a test that runs again, only if the chats are new.
  const base = 100_000_000 + Math.floor(Math.random() * 800_000_000);
  const C = (n: number) => base + n;
  const analyzer = new FakeAnalyzer();
  analyzer.next = {
    language: { detected: 'en', replyIn: 'en' },
    intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
    recommendedPhase: 'clarification',
  };
  const replyWriter = new FakeReplyWriter();
  replyWriter.replies = ['Yes, we make tote bags — which size are you looking for?'];

  const q = async <T>(biz: string, fn: (tx: Tx) => Promise<T>) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(prod.db, biz as never, fn);
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
  const post = (chat: number, text: string, secret = SECRET) => prod.app.inject({
    method: 'POST', url: '/webhook/telegram',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret },
    payload: JSON.stringify({ update_id: ++update, message: { message_id: ++msg, date: Math.floor(Date.now() / 1000), chat: { id: chat, type: 'private' }, from: { id: chat, first_name: 'Amal' }, text } }),
  });
  const handles = (biz: string, chat: number) => q(biz, (tx) => sql<{ n: number }>`select count(*)::int as n from client_channels
    where channel = 'telegram' and channel_user_id = ${String(chat)}`.execute(tx).then((r) => r.rows[0]!.n));
  const said = (biz: string, text: string) => q(biz, (tx) => sql<{ n: number }>`select count(*)::int as n from messages m join conversations c on c.id = m.conversation_id
    where c.channel = 'telegram' and m.direction = 'inbound' and m.text_content = ${text}`.execute(tx).then((r) => r.rows[0]!.n));

  beforeAll(async () => {
    Object.assign(process.env, ENV);
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { setTelegram } = await import('../../src/db/telegram.js');
    const sim = whatsappSimulator([], { tag: `tg${RUN}` });
    const setup = createDb(DATABASE_URL!);
    for (const [biz, name] of [[A, 'Atlas Bags'], [B, 'Berber Rugs']] as const) {
      await withTenantTx(setup, biz as never, async (t) => {
        await sql`insert into businesses (id, name, engine, batch_debounce_ms, batch_max_window_ms) values (${biz}, ${name}, 'service', 300, 1000)`.execute(t);
        if (biz === A) {
          await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
                    values (${biz}, 'whatsapp', ${sim.phoneNumberId}, 'sim-test', 'service')`.execute(t);
          for (const cap of ['greet', 'qualify', 'recommend', 'quote', 'negotiate', 'follow_up']) {
            await sql`insert into autonomy_policy (business_id, capability, mode) values (${biz}, ${cap}, 'auto')
                      on conflict (business_id, capability) do update set mode = 'auto'`.execute(t);
          }
          await sql`insert into assistants (business_id, name, is_default) values (${biz}, 'Lily', true)`.execute(t);
          await sql`insert into onboarding_state (business_id, assistant_named_at) values (${biz}, now())
                    on conflict (business_id) do update set assistant_named_at = now()`.execute(t);
        }
        code[biz === A ? 'A' : 'B'] = (await setTelegram(t, biz as never, true, 'owner'))!;
      });
    }
    await setup.destroy();
    process.env['PILOT_BUSINESS_ID'] = A;
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: 'meta-app-secret-not-real', META_GRAPH_API_VERSION: 'v23.0',
      WEBHOOK_VERIFY_TOKEN: 'tg-verify-token-xxx', CREDENTIAL_KEY: 'e'.repeat(64), PORT: 0,
    }, {
      adapter: sim.adapter, logger: false, models: { analyzer, replyWriter }, autonomyReleased: () => true,
      telegramFetch: async (url, init) => {
        const method = url.split('/').at(-1)!;
        sent.push({ method, body: JSON.parse(init.body) as Record<string, unknown> });
        return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 9000 + sent.length } }) };
      },
    });
  }, 60_000);
  afterAll(async () => {
    if (prod) {
      const { QUEUES } = await import('../../src/queue/boss.js');
      await until(async () => ((await sql<{ n: number }>`select count(*)::int as n from pgboss.job where name in (${QUEUES.inbound}, ${QUEUES.outbound}, ${QUEUES.notify})
        and data->>'businessId' in (${A}, ${B}) and state in ('created', 'retry', 'active')`.execute(prod.db)).rows[0]!.n === 0 ? true : undefined), 'this test\'s jobs');
    }
    await prod?.close();
    for (const k of Object.keys(ENV)) delete process.env[k];
  }, 90_000);

  it('an update without the webhook\'s secret is refused before it is read', async () => {
    expect((await post(C(777), 'hello', 'not-the-secret-at-all')).statusCode).toBe(401);
  });

  it('THE START LINK ties the chat to its business, and is not a message; then the buyer is answered there', async () => {
    expect((await post(C(777), `/start ${code.A}`)).statusCode).toBe(200);
    expect(await handles(A, C(777))).toBe(1);
    expect(await handles(B, C(777))).toBe(0);
    expect(await said(A, `/start ${code.A}`)).toBe(0);
    await post(C(777), 'Do you make tote bags?');
    await until(async () => ((await said(A, 'Do you make tote bags?')) === 1 ? true : undefined), 'the message, in A');
    const reply = await until(async () => sent.find((s) => s.method === 'sendMessage' && s.body['chat_id'] === String(C(777))), 'the answer, to the chat');
    expect(String(reply.body['text'])).toContain('Yes, we make tote bags — which size are you looking for?');
    expect(String(reply.body['text'])).toContain('AI assistant');       // the first message nobody approved says so (rule 3)
  });

  it('A CHAT THAT STARTED TWO writes to the one it started last; one that started none, and a bad code, to nobody', async () => {
    await post(C(777), `/start ${code.B}`);
    await post(C(777), 'Do you have wool rugs?');
    await until(async () => ((await said(B, 'Do you have wool rugs?')) === 1 ? true : undefined), 'the message, in B');
    expect(await said(A, 'Do you have wool rugs?')).toBe(0);
    await post(C(888), 'hello from nowhere');
    await post(C(889), '/start not-a-code');
    await post(C(889), 'still nowhere');
    await new Promise((r) => setTimeout(r, 1500));
    for (const biz of [A, B]) {
      expect(await said(biz, 'hello from nowhere'), biz).toBe(0);
      expect(await said(biz, 'still nowhere'), biz).toBe(0);
      expect(await handles(biz, C(889)), biz).toBe(0);
    }
  });

  it('SWITCHED OFF: a business with Telegram off takes nothing from the chats that started it', async () => {
    const { setTelegram } = await import('../../src/db/telegram.js');
    await post(C(999), `/start ${code.B}`);
    expect(await handles(B, C(999))).toBe(1);
    await q(B, (tx) => setTelegram(tx, B as never, false, 'owner'));
    await post(C(999), 'are you there?');
    await new Promise((r) => setTimeout(r, 1500));
    expect(await said(B, 'are you there?')).toBe(0);
    expect(await q(B, (tx) => setTelegram(tx, B as never, true, 'owner'))).toBe(code.B);
  });
});
