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
      provider: 'meta',
      DATABASE_URL: DATABASE_URL!,
      ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok',
      META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765',
      META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0',
      WEBHOOK_VERIFY_TOKEN: 'boot-verify-token',
      CREDENTIAL_KEY: 'a'.repeat(64),
      PORT: 0,
    }, { adapter: sim.adapter, logger: false });
  }, 30_000);

  afterAll(async () => { await prod?.close(); });

  it('health reports process + database + active provider', async () => {
    const res = await prod.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, db: true, worker: true, provider: 'active' });
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

/**
 * Deployment mode — full stack boots with WHATSAPP_PROVIDER=disabled, but
 * NO messaging surface: no webhook routes, no outbound worker. For hosting on
 * Railway before Meta onboarding finishes.
 */
d('production deployment mode (requires DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    prod = await buildProduction({
      provider: 'disabled',
      DATABASE_URL: DATABASE_URL!,
      ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_GRAPH_API_VERSION: 'v23.0',
      WEBHOOK_VERIFY_TOKEN: 'deploy-verify-token',
      CREDENTIAL_KEY: 'a'.repeat(64),
      PORT: 0,
    }, { logger: false });   // no adapter override → real disabled path
  }, 30_000);

  afterAll(async () => { await prod?.close(); });

  it('boots and health reports database + worker healthy, provider disabled', async () => {
    const res = await prod.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, db: true, worker: true, provider: 'disabled' });
  });

  it('M9 command center: / and /app require login; /login serves the form', async () => {
    const root = await prod.app.inject({ method: 'GET', url: '/' });
    expect(root.statusCode).toBe(302);
    expect(root.headers['location']).toBe('/login');

    const appUnauthed = await prod.app.inject({ method: 'GET', url: '/app' });
    expect(appUnauthed.statusCode).toBe(302);
    expect(appUnauthed.headers['location']).toBe('/login');

    const login = await prod.app.inject({ method: 'GET', url: '/login' });
    expect(login.statusCode).toBe(200);
    expect(login.body).toContain('name="code"');
  });

  it('M9: wrong code rejected; correct code opens the shell with the dashboard', async () => {
    const bad = await prod.app.inject({ method: 'POST', url: '/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'code=wrong' });
    expect(bad.statusCode).toBe(401);

    const ok = await prod.app.inject({ method: 'POST', url: '/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `code=${encodeURIComponent(prod.ownerAccessCode)}` });
    expect(ok.statusCode).toBe(302);
    expect(ok.headers['location']).toBe('/app');
    const cookie = String(ok.headers['set-cookie']).split(';')[0];

    // Authenticated: the shell renders with the reused dashboard body.
    const home = await prod.app.inject({ method: 'GET', url: '/app', headers: { cookie } });
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain('的工作台');           // shell
    expect(home.body).toContain('报价卡');             // reused live quote card
    const inbox = await prod.app.inject({ method: 'GET', url: '/app/inbox', headers: { cookie } });
    expect(inbox.statusCode).toBe(200);               // stub renders in-shell, no 404
  });

  it('mounts NO webhook routes (GET verification absent)', async () => {
    const res = await prod.app.inject({ method: 'GET',
      url: '/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=deploy-verify-token&hub.challenge=x' });
    expect(res.statusCode).toBe(404);
  });

  it('mounts NO webhook routes (POST absent)', async () => {
    const res = await prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: {} });
    expect(res.statusCode).toBe(404);
  });

  it('registers NO outbound worker (queue has no consumer)', async () => {
    // With no registered worker the job stays available — we can fetch it
    // ourselves. In active mode a worker would race to consume it first.
    await prod.boss.send('message.outbound', { businessId: DEMO_BIZ, conversationId: DEMO_BIZ });
    await new Promise((r) => setTimeout(r, 400));
    const jobs = await prod.boss.fetch('message.outbound');
    expect(jobs.length).toBeGreaterThanOrEqual(1);   // nobody consumed it
  });

  it('shuts down cleanly', async () => {
    await prod.close();
    await prod.close();
  });
});
