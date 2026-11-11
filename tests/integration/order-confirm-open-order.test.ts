import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { offlineModels } from '../pipeline/fakes.js';

/**
 * "Confirm the order" on a conversation that ALREADY HOLDS AN OPEN ORDER (found by the authorization walk's reach
 * check, 2026-11-12; t1r's ruling the same day).
 *
 * A conversation holds one order that is not cancelled (orders_one_open_per_conversation, ADR-0004). The order writer
 * met that index by inserting and catching the 23505 — inside the same transaction, which the failed insert had
 * aborted, so its next query failed and the owner's tap answered 500. Now the confirmation asks first, under the
 * conversation's lock: the owner is told in words, naming the open order with a door to it; the proposal stays waiting;
 * nothing is written and nothing is sent. Through the production composition (`buildProduction`).
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd810000-0000-4000-8000-${RUN}0001`;
const PID = `dd810000-0000-4000-8001-${RUN}0001`;
const CLIENT = `dd810000-0000-4000-8002-${RUN}0001`;
const CONV = `dd810000-0000-4000-8003-${RUN}0001`;
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
type Tx = import('../../src/db/client.js').Tx;

d('Confirm the order, where the conversation already holds an open order (requires DATABASE_URL)', { timeout: 120_000 }, () => {
  let prod: import('../../src/main.js').Production;
  let cookie = '';
  let proposalId = '';
  let orderId = '';
  const q = async <T>(fn: (tx: Tx) => Promise<T>) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return withTenantTx(prod.db, b.value, fn);
  };
  const footprint = () => q((tx) => sql<{ orders: number; pending: number; outbound: number; active: boolean; created: number; refs: string[] }>`
    select (select count(*)::int from orders o where o.conversation_id = c.id) as orders,
           (select count(*)::int from order_proposals p where p.conversation_id = c.id and p.state = 'pending') as pending,
           (select count(*)::int from outbound_messages o where o.conversation_id = c.id) as outbound,
           c.is_active as active,
           (select count(*)::int from conversation_events e where e.conversation_id = c.id and e.type = 'order_created') as created,
           coalesce((select array_agg(o.order_reference) from orders o where o.business_id = c.business_id), '{}') as refs
      from conversations c where c.id = ${CONV}::uuid`.execute(tx).then((r) => r.rows[0]!));

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const sim = whatsappSimulator([], { tag: `ooo${RUN}` });
    const setup = createDb(DATABASE_URL!);
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    await withTenantTx(setup, b.value, async (t) => {
      await sql`insert into businesses (id, name, engine) values (${BIZ}, 'Open Order', 'service') on conflict (id) do nothing`.execute(t);
      await sql`insert into channels (business_id, kind, status, display_phone, connected_at, activated_at, activated_by, pilot_mode)
                values (${BIZ}, 'whatsapp', 'connected', '+86 579****0081', now(), now(), 'test', false)`.execute(t);
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
                values (${BIZ}, 'whatsapp', ${sim.phoneNumberId}, 'sim-test', 'service')`.execute(t);
      await sql`insert into products (id, business_id, sku, name, unit, moq, is_active)
                values (${PID}, ${BIZ}, ${'OO-' + RUN}, 'Gift box', 'boxes', 10, true)`.execute(t);
      await sql`insert into price_tiers (product_id, min_qty, max_qty, unit_price_usd, currency) values (${PID}, 10, null, 2.10, 'USD')`.execute(t);
      await sql`insert into clients (id, business_id, display_name, email) values (${CLIENT}, ${BIZ}, 'Mina', 'mina@example.com')`.execute(t);
      await sql`insert into client_channels (client_id, channel, channel_user_id, last_inbound_at) values (${CLIENT}, 'whatsapp', ${'9718' + RUN.replace(/\D/g, '1').slice(0, 7)}, now())`.execute(t);
      await sql`insert into conversations (id, business_id, client_id, channel, phase) values (${CONV}, ${BIZ}, ${CLIENT}, 'whatsapp', 'confirmation')`.execute(t);
      // The order this conversation already holds (confirmed, so open: not cancelled) …
      orderId = (await sql<{ id: string }>`insert into orders (order_reference, business_id, client_id, conversation_id, product_id, quantity, unit, status)
        values (${'OO-' + RUN}, ${BIZ}, ${CLIENT}, ${CONV}, ${PID}, 20, 'boxes', 'confirmed') returning id::text as id`.execute(t)).rows[0]!.id;
      // … and a customer's later "yes", waiting for the owner.
      proposalId = (await sql<{ id: string }>`insert into order_proposals (business_id, conversation_id, client_id, product_id, quantity, unit, unit_price, total, currency, client_email)
        values (${BIZ}, ${CONV}, ${CLIENT}, ${PID}, 40, 'boxes', 2.10, 84, 'USD', 'mina@example.com') returning id::text as id`.execute(t)).rows[0]!.id;
    });
    await setup.destroy();
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: sim.phoneNumberId,
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: 'meta-app-secret-not-real', META_GRAPH_API_VERSION: 'v23.0',
      WEBHOOK_VERIFY_TOKEN: 'ooo-verify-token-xx', CREDENTIAL_KEY: 'b'.repeat(64), PORT: 0,
    }, { adapter: sim.adapter, logger: false, models: offlineModels() });
    const login = await prod.app.inject({ method: 'POST', url: '/login', headers: FORM, payload: `code=${encodeURIComponent(prod.ownerAccessCode)}` });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 60_000);
  afterAll(async () => { await prod?.close(); });

  it('answers in words naming the open order, with a door to it; the proposal waits; nothing written or sent', async () => {
    const before = await footprint();
    expect(before).toMatchObject({ orders: 1, pending: 1, active: true, created: 0 });
    const res = await prod.app.inject({ method: 'POST', url: `/app/inbox/${CONV}/order/confirm`, headers: { cookie, ...FORM },
      payload: new URLSearchParams({ proposalId }).toString() });
    expect(res.statusCode, res.body.slice(0, 200)).toBe(302);
    expect(String(res.headers['location'])).toContain(`/app/inbox/${CONV}`);
    // Nothing written, nothing sent: the open order alone, the proposal still waiting, the conversation still open.
    expect(await footprint()).toEqual(before);
    // The page the owner lands on says it, names the order, and opens it.
    const flash = ([] as string[]).concat(res.headers['set-cookie'] as string | string[]).map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_flash='))!;
    const page = await prod.app.inject({ method: 'GET', url: String(res.headers['location']).split('#')[0]!, headers: { cookie: `${cookie}; ${flash}` } });
    expect(page.statusCode).toBe(200);
    const banner = /<div class="flash bad[^"]*" role="alert"[^>]*>([\s\S]*?)<\/div>/.exec(page.body)?.[1] ?? '';
    expect(banner, 'the refusal\'s banner').not.toBe('');
    expect(banner.replace(/[\u2066-\u2069]/g, '')).toContain(`OO-${RUN}`);
    expect(banner).toContain('already has an open order');
    expect(banner).toContain(`href="/app/orders/${orderId}"`);
  });
});
