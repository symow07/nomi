import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { runDigits } from './tenant.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';

/**
 * 0155 — a buyer's address is each workspace's own. Until it, `client_channels` was unique on (channel,
 * channel_user_id) across ALL businesses: a buyer who had written to one workspace, writing to a second, became a
 * client there with no address — a new client with every message, and nowhere for a reply to go. Found building the
 * operator tool for decision 1 (a second number, a second workspace), where the first person to write to both
 * numbers is the owner testing them.
 *
 * Over the real inbound path: one customer writes twice to each of two numbers; each workspace keeps exactly one
 * client for them, with their address, and one conversation holding both messages — and neither sees the other's.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const FIRST = `bb000000-0000-4000-8000-${RUN}0001`;
const SECOND = `bb000000-0000-4000-8000-${RUN}0002`;
const NUMBER_1 = `1081${runDigits(RUN, 10)}`;
const NUMBER_2 = `1082${runDigits(RUN, 10)}`;
const CUSTOMER = `3463${runDigits(RUN, 7)}`;

const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 30_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
};

d('0155 · a buyer\'s address is each workspace\'s own (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  let admin: pg.Client;

  const analyzer = new FakeAnalyzer();
  analyzer.next = {
    language: { detected: 'en', replyIn: 'en' },
    intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
    recommendedPhase: 'clarification',
  };
  const toNumber = async (number: string, w: { rawBody: string }) => {
    const { signBody } = await import('../../src/channels/whatsapp/signature.js');
    const { SIMULATOR_SECRET } = await import('../../src/channels/whatsapp/simulator.js');
    const raw = w.rawBody.split(sim.phoneNumberId).join(number);
    return prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: raw,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signBody(raw, SIMULATOR_SECRET) } });
  };
  /** The customer as a workspace has them: its clients, their addresses, its conversations, what they said. */
  const seen = async (business: string) => {
    const clients = (await admin.query(`select id::text as id from clients where business_id = $1 and phone = $2`, [business, CUSTOMER])).rows;
    const addresses = (await admin.query(
      `select cc.business_id::text as business from client_channels cc join clients cl on cl.id = cc.client_id
        where cl.business_id = $1 and cc.channel = 'whatsapp' and cc.channel_user_id = $2`, [business, CUSTOMER])).rows;
    const said = (await admin.query(
      `select m.text_content as text, c.id::text as conversation from messages m join conversations c on c.id = m.conversation_id
         join clients cl on cl.id = c.client_id where c.business_id = $1 and cl.phone = $2 and m.direction = 'inbound'
        order by m.sent_at, m.id`, [business, CUSTOMER])).rows;
    return { clients: clients.length, addresses, said: said.map((r) => r.text as string), conversations: new Set(said.map((r) => r.conversation)).size };
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    await admin.query(`insert into businesses (id, name) values ($1, $2), ($3, $4) on conflict (id) do nothing`,
      [FIRST, `First ${RUN}`, SECOND, `Second ${RUN}`]);
    for (const [b, n] of [[FIRST, NUMBER_1], [SECOND, NUMBER_2]] as const) {
      await admin.query(`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
        values ($1, 'whatsapp', $2, 'sim-test', 'service')`, [b, n]);
    }
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    sim = whatsappSimulator([], { tag: `bp${RUN}` });
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!,
      ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'installation-token-not-real-0123456789',
      META_WHATSAPP_PHONE_NUMBER_ID: NUMBER_1,
      META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'buyer-verify-token',
      CREDENTIAL_KEY: 'c'.repeat(64), PORT: 0, PUBLIC_BASE_URL: 'https://nomi.test',
    }, { models: { analyzer, replyWriter: new FakeReplyWriter() }, adapter: sim.adapter, logger: false });
  }, 90_000);

  afterAll(async () => {
    await prod?.close();
    await admin?.end();
  });

  it('one customer, two workspaces, twice each: one client, one address, one conversation in each — never the other\'s', async () => {
    for (const [n, text] of [[NUMBER_1, 'first, one'], [NUMBER_2, 'second, one'], [NUMBER_1, 'first, two'], [NUMBER_2, 'second, two']] as const) {
      expect((await toNumber(n, sim.inboundText({ from: CUSTOMER, text }))).statusCode).toBe(200);
      // In order: the second message of each must find the client the first one made.
      await until(async () => ((await seen(n === NUMBER_1 ? FIRST : SECOND)).said.includes(text) ? true : undefined), text);
    }
    const first = await seen(FIRST);
    const second = await seen(SECOND);
    expect(first).toEqual({ clients: 1, addresses: [{ business: FIRST }], said: ['first, one', 'first, two'], conversations: 1 });
    expect(second).toEqual({ clients: 1, addresses: [{ business: SECOND }], said: ['second, one', 'second, two'], conversations: 1 });
  });

  it('a row\'s workspace is its client\'s, whatever the writer names — and one address per buyer per workspace', async () => {
    const client = (await admin.query(`select id from clients where business_id = $1 and phone = $2`, [FIRST, CUSTOMER])).rows[0].id;
    const other = `3464${runDigits(RUN, 7)}`;
    const row = (await admin.query(`insert into client_channels (business_id, client_id, channel, channel_user_id)
      values ($1, $2, 'whatsapp', $3) returning business_id::text as business`, [SECOND, client, other])).rows[0];
    expect(row.business).toBe(FIRST);
    await expect(admin.query(`insert into client_channels (client_id, channel, channel_user_id) values ($1, 'whatsapp', $2)`,
      [client, CUSTOMER])).rejects.toThrow(/client_channels_one_per_business/);
  });
});
