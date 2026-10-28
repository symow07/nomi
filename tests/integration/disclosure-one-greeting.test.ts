import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';
import { disclosureFor } from '../../src/core/conversation/disclosure.js';

/**
 * ONE GREETING, NOT TWO (the owner, 2026-10-28; src/core/conversation/openingGreeting.ts) — in the production
 * composition, on WhatsApp (the simulator) and Telegram (its Bot API a recorder), a reply sent alone:
 *
 *   · the first one carries the signed disclosure, word for word, and the reply after it WITHOUT its own "Hi Amal!";
 *   · once the customer has been told, the next reply goes as the writer wrote it, greeting and all — nothing in
 *     front of it, so nothing is taken from it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `0ee90000-0000-4000-8000-${RUN}0001`;
const SECRET = 'tg-webhook-secret-for-tests-only';
const BOT = '7099990001';
const ENV = { TELEGRAM_BOT_TOKEN: `${BOT}:AAtest-token-not-real_0123456789`, TELEGRAM_WEBHOOK_SECRET: SECRET, TELEGRAM_BOT_USERNAME: 'NomiGreetBot' };
const REPLY = 'Hi Amal! Yes, we make tote bags — which size are you looking for?';
const REST = 'Yes, we make tote bags — which size are you looking for?';
type Tx = import('../../src/db/client.js').Tx;

d('one greeting: the disclosure\'s, on WhatsApp and Telegram (requires DATABASE_URL)', { timeout: 180_000 }, () => {
  let prod: Awaited<ReturnType<typeof import('../../src/main.js')['buildProduction']>>;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  let startCode = '';
  const tg: { method: string; body: Record<string, unknown> }[] = [];
  let update = 2000 + Math.floor(Math.random() * 1e6);
  let msg = 1;
  const chat = 100_000_000 + Math.floor(Math.random() * 800_000_000);
  const phone = `4479${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const disclosure = disclosureFor({ detected: 'en', name: 'Lily', business: 'Atlas Bags' })!;

  const analyzer = new FakeAnalyzer();
  analyzer.next = {
    language: { detected: 'en', replyIn: 'en' },
    intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
    recommendedPhase: 'clarification', wantsPerson: false,
  };
  const replyWriter = new FakeReplyWriter();
  replyWriter.replies = [REPLY, REPLY, REPLY, REPLY];

  const until = async <T>(probe: () => Promise<T | undefined> | T | undefined, what: string, ms = 60_000): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await probe();
      if (v !== undefined) return v;
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  };
  const q = async <T>(fn: (tx: Tx) => Promise<T>) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(prod.db, BIZ as never, fn);
  };
  const told = (channel: string) => q((tx) => sql<{ at: string | null }>`select ai_disclosure_delivered_at::text as at from conversations
    where business_id = ${BIZ}::uuid and channel = ${channel}`.execute(tx).then((r) => r.rows[0]?.at ?? undefined));
  const telegram = (text: string) => prod.app.inject({
    method: 'POST', url: '/webhook/telegram',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
    payload: JSON.stringify({ update_id: ++update, message: { message_id: ++msg, date: Math.floor(Date.now() / 1000), chat: { id: chat, type: 'private' }, from: { id: chat, first_name: 'Amal' }, text } }),
  });
  const whatsapp = (text: string) => {
    const w = sim.inboundText({ from: phone, text, name: 'Amal' });
    return prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: w.rawBody, headers: { 'content-type': 'application/json', ...w.headers } });
  };
  const tgTexts = () => tg.filter((s) => s.method === 'sendMessage' && s.body['chat_id'] === String(chat)).map((s) => String(s.body['text']));
  const waTexts = () => sim.requests.map((r) => JSON.parse(r.body) as { to?: string; text?: { body?: string } })
    .filter((b) => b.to === phone && b.text?.body).map((b) => b.text!.body!);

  beforeAll(async () => {
    Object.assign(process.env, ENV);
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { setTelegram } = await import('../../src/db/telegram.js');
    sim = whatsappSimulator([], { tag: `gr${RUN}` });
    const setup = createDb(DATABASE_URL!);
    await withTenantTx(setup, BIZ as never, async (t) => {
      await sql`insert into businesses (id, name, engine, batch_debounce_ms, batch_max_window_ms) values (${BIZ}, 'Atlas Bags', 'service', 300, 1000)`.execute(t);
      await sql`insert into channels (business_id, kind, status, display_phone, connected_at, activated_at, activated_by, pilot_mode)
                values (${BIZ}, 'whatsapp', 'connected', '+44 79****0001', now(), now(), 'test', false)`.execute(t);
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
                values (${BIZ}, 'whatsapp', ${sim.phoneNumberId}, 'sim-test', 'service')`.execute(t);
      for (const cap of ['greet', 'qualify', 'recommend', 'quote', 'negotiate', 'follow_up']) {
        await sql`insert into autonomy_policy (business_id, capability, mode) values (${BIZ}, ${cap}, 'auto')
                  on conflict (business_id, capability) do update set mode = 'auto'`.execute(t);
      }
      await sql`insert into assistants (business_id, name, is_default) values (${BIZ}, 'Lily', true)`.execute(t);
      await sql`insert into onboarding_state (business_id, assistant_named_at) values (${BIZ}, now())
                on conflict (business_id) do update set assistant_named_at = now()`.execute(t);
      startCode = (await setTelegram(t, BIZ as never, true, 'owner'))!;
    });
    await setup.destroy();
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: sim.phoneNumberId,
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: 'meta-app-secret-not-real', META_GRAPH_API_VERSION: 'v23.0',
      WEBHOOK_VERIFY_TOKEN: 'gr-verify-token-xxx', CREDENTIAL_KEY: 'e'.repeat(64), PORT: 0,
    }, {
      adapter: sim.adapter, logger: false, media: {}, models: { analyzer, replyWriter }, autonomyReleased: () => true,
      telegramFetch: async (url, init) => {
        tg.push({ method: url.split('/').at(-1)!, body: JSON.parse(init.body) as Record<string, unknown> });
        return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 9000 + tg.length } }) };
      },
    });
  }, 60_000);
  afterAll(async () => {
    if (prod) {
      const { QUEUES } = await import('../../src/queue/boss.js');
      await until(async () => ((await sql<{ n: number }>`select count(*)::int as n from pgboss.job where name in (${QUEUES.inbound}, ${QUEUES.outbound}, ${QUEUES.notify})
        and data->>'businessId' = ${BIZ} and state in ('created', 'retry', 'active')`.execute(prod.db)).rows[0]!.n === 0 ? true : undefined), 'this test\'s jobs');
    }
    await prod?.close();
    for (const k of Object.keys(ENV)) delete process.env[k];
  }, 90_000);

  it('WHATSAPP: the first reply is the disclosure, word for word, then the reply without its "Hi Amal!"', async () => {
    await whatsapp('Do you make tote bags?');
    const first = await until(() => waTexts()[0], 'the first WhatsApp reply');
    expect(first).toBe(`${disclosure}\n\n${REST}`);
    expect(first).not.toContain('Hi Amal');
  });

  it('WHATSAPP: told, the next reply goes as written, greeting and all', async () => {
    await until(() => told('whatsapp'), 'the WhatsApp conversation told');
    // Meta's receipt for the first, once it is recorded — as WhatsApp sends one; without it the next waits out the sequencer.
    const id = sim.sentIds[0]!;
    await until(() => q((tx) => sql`select 1 as one from outbound_messages where provider_message_id = ${id}`.execute(tx)
      .then((r) => r.rows[0])), 'the first send recorded');
    const receipt = sim.status(id, 'delivered');
    await prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: receipt.rawBody, headers: { 'content-type': 'application/json', ...receipt.headers } });
    await whatsapp('And in black?');
    expect(await until(() => waTexts()[1], 'the second WhatsApp reply')).toBe(REPLY);
  });

  it('TELEGRAM: the first reply is the disclosure, word for word, then the reply without its "Hi Amal!"', async () => {
    expect((await telegram(`/start ${startCode}`)).statusCode).toBe(200);   // ties the chat; no greeting is signed, so nothing is said
    await telegram('Do you make tote bags?');
    const first = await until(() => tgTexts()[0], 'the first Telegram reply');
    expect(first).toBe(`${disclosure}\n\n${REST}`);
    expect(first).not.toContain('Hi Amal');
  });

  it('TELEGRAM: told, the next reply goes as written, greeting and all', async () => {
    await until(() => told('telegram'), 'the Telegram conversation told');
    await telegram('And in black?');
    expect(await until(() => tgTexts()[1], 'the second Telegram reply')).toBe(REPLY);
  });
});
