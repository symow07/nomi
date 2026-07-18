import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';

/**
 * Production boot-and-probe (audit item 12). Uses the REAL composition path
 * (buildProduction) with the provider simulator injected — no live network
 * credentials. Runs when DATABASE_URL points at a migrated database (same
 * convention as db.test.ts); the status-webhook path is exercised because it
 * proves signed ingress → tenant resolution → persistence → dedup without
 * touching the LLM.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const DEMO_BIZ = 'de300000-0000-4000-8000-0000000000b1';

d('production boot-and-probe (requires DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator, SIM_PHONE_NUMBER_ID } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');

    // The simulator's phone_number_id must resolve to the demo tenant.
    const setup = createDb(DATABASE_URL!);
    const bid = parseBusinessId(DEMO_BIZ);
    if (!bid.ok) throw new Error('fixture');
    await withTenantTx(setup, bid.value, (tx) => sql`
      insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
      values (${DEMO_BIZ}, 'whatsapp', ${SIM_PHONE_NUMBER_ID}, 'sim-test', 'service')
      on conflict (channel, external_ref) do nothing
    `.execute(tx));
    await setup.destroy();

    sim = whatsappSimulator();
    prod = await buildProduction({
      DATABASE_URL: DATABASE_URL!,
      ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      D360_API_KEY: 'sim-not-real',
      D360_BASE_URL: 'https://simulator.invalid',
      WEBHOOK_SECRET: 'sim-webhook-secret-32-chars-min-xx',
      WEBHOOK_VERIFY_TOKEN: 'boot-verify-token',
      CREDENTIAL_KEY: 'a'.repeat(64),
      PORT: 0,
    }, { adapter: sim.adapter, logger: false });
  }, 30_000);

  afterAll(async () => { await prod?.close(); });

  it('health reports process + database', async () => {
    const res = await prod.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, db: true, worker: true });
  });

  it('verification handshake is mounted', async () => {
    const res = await prod.app.inject({ method: 'GET',
      url: '/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=boot-verify-token&hub.challenge=b00t' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('b00t');
  });

  it('a signed webhook flows through the production composition and dedups', async () => {
    const w = sim.status(`wamid.BOOT_${Date.now()}`, 'delivered');
    const first = await prod.app.inject({ method: 'POST', url: '/webhook/whatsapp',
      payload: w.rawBody, headers: { 'content-type': 'application/json', ...w.headers } });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ ok: true, received: 1 });   // persisted for the demo tenant

    const replay = await prod.app.inject({ method: 'POST', url: '/webhook/whatsapp',
      payload: w.rawBody, headers: { 'content-type': 'application/json', ...w.headers } });
    expect(replay.json()).toEqual({ ok: true, received: 0 });  // dedupKey hit
  });

  it('tampered signatures are rejected by the production app', async () => {
    const w = sim.status('wamid.BOOT_TAMPER', 'delivered');
    const res = await prod.app.inject({ method: 'POST', url: '/webhook/whatsapp',
      payload: w.rawBody.replace('delivered', 'read'), headers: { 'content-type': 'application/json', ...w.headers } });
    expect(res.statusCode).toBe(401);
  });

  it('/shadow/turn is NOT publicly mounted (audit H1)', async () => {
    const res = await prod.app.inject({ method: 'POST', url: '/shadow/turn',
      payload: { message_id: 'x', business_id: DEMO_BIZ, conversation_id: DEMO_BIZ, text: 'hi' } });
    expect(res.statusCode).toBe(404);
  });

  it('shuts down cleanly and idempotently', async () => {
    await prod.close();
    await prod.close();   // second call must be a no-op
  });
});
