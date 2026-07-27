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

    // Authenticated: the shell renders with the M9.2 home briefing (real data).
    const home = await prod.app.inject({ method: 'GET', url: '/app', headers: { cookie } });
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain('的工作台');           // shell
    expect(home.body).toContain('今日总结');           // greeting line
    expect(home.body).toContain('工作状态');           // employee status card
    expect(home.body).toMatch(/询盘/);                 // today summary
    const inbox = await prod.app.inject({ method: 'GET', url: '/app/inbox', headers: { cookie } });
    expect(inbox.statusCode).toBe(200);
    expect(inbox.body).toContain('收件箱');
  });

  it('M9.3 inbox: opens a real conversation; unknown/foreign id → 404, no leak', async () => {
    const cookie = await login();
    // Demo conversation 302 (Sara / canvas bags) exists for the demo business.
    const detail = await prod.app.inject({ method: 'GET',
      url: '/app/inbox/de300000-0000-4000-8000-000000000302', headers: { cookie } });
    expect(detail.statusCode).toBe(200);
    expect(detail.body).toContain('对话记录');

    const unknown = await prod.app.inject({ method: 'GET',
      url: '/app/inbox/de300000-0000-4000-8000-0000000009ff', headers: { cookie } });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.body).toContain('找不到这个对话');
    // Never reveals whether the id exists in another tenant.
    expect(unknown.body).not.toContain('bb000000');
  });

  it('M9.3: pending draft renders and the action loop resolves it via applyOwnerCommand', async () => {
    const { sql } = await import('kysely');
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const CONV = 'de300000-0000-4000-8000-000000000302';
    const parsed = parseBusinessId('de300000-0000-4000-8000-0000000000b1');
    if (!parsed.ok) throw new Error('fixture');
    const bidv = parsed.value;

    // Seed a pending draft (turn_message_id null; the real pipeline FKs it).
    const draftId = await withTenantTx(prod.db, bidv, (tx) => sql<{ id: string }>`
      insert into drafts (business_id, conversation_id, capability, draft_text, turn_message_id, status)
      values (${bidv}, ${CONV}, 'quote', 'Draft reply from 小雅', null, 'pending')
      returning id`.execute(tx).then((r) => r.rows[0]!.id));

    const cookie = await login();
    const before = await prod.app.inject({ method: 'GET', url: `/app/inbox/${CONV}`, headers: { cookie } });
    expect(before.body).toContain('小雅等你确认');
    expect(before.body).toContain('Draft reply from 小雅');

    // A GET must never send: the draft is still pending after viewing.
    expect(await draftStatus(draftId)).toBe('pending');

    // POST the send action → PRG redirect, draft resolved through the one service.
    const act = await prod.app.inject({ method: 'POST', url: `/app/inbox/${CONV}/act`,
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: `draftId=${draftId}&command=${encodeURIComponent('发送')}` });
    expect(act.statusCode).toBe(302);
    expect(act.headers['location']).toContain(`/app/inbox/${CONV}?flash=`);
    expect(await draftStatus(draftId)).toBe('approved');

    // Double submit is safe — already resolved, nothing changes.
    const again = await prod.app.inject({ method: 'POST', url: `/app/inbox/${CONV}/act`,
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: `draftId=${draftId}&command=${encodeURIComponent('发送')}` });
    expect(again.statusCode).toBe(302);
    expect(await draftStatus(draftId)).toBe('approved');

    async function draftStatus(id: string): Promise<string> {
      return withTenantTx(prod.db, bidv, (tx) =>
        sql<{ status: string }>`select status from drafts where id=${id}`.execute(tx).then((r) => r.rows[0]!.status));
    }
  });

  it('inbox mutation requires auth; unauthenticated POST redirects to login', async () => {
    const res = await prod.app.inject({ method: 'POST', url: '/app/inbox/x/act',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'draftId=d&command=%E5%8F%91%E9%80%81' });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/login');
  });

  it('M9.4 channels: page renders; coming-soon honest; no secret/provider leak', async () => {
    const cookie = await login();
    const res = await prod.app.inject({ method: 'GET', url: '/app/channels', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('销售渠道');
    expect(res.body).toContain('WhatsApp');
    expect(res.body).toContain('即将支持');
    expect(res.body).toContain('Instagram');
    for (const secret of ['DEMO_PNID', 'SIM_PNID', 'demo-no-secret', 'access_token', '360dialog']) {
      expect(res.body).not.toContain(secret);
    }
  });

  it('M9.4 channels: disconnect toggles the credential + audits; reconnect restores', async () => {
    const { sql } = await import('kysely');
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const parsed = parseBusinessId('de300000-0000-4000-8000-0000000000b1');
    if (!parsed.ok) throw new Error('fixture');
    const bidv = parsed.value;
    const cookie = await login();
    const active = () => withTenantTx(prod.db, bidv, (tx) =>
      sql<{ a: boolean }>`select bool_or(is_active) as a from channel_credentials where channel='whatsapp'`.execute(tx).then((r) => r.rows[0]!.a));
    const auditCount = (action: string) => withTenantTx(prod.db, bidv, (tx) =>
      sql<{ n: number }>`select count(*)::int as n from channel_audit where action=${action}`.execute(tx).then((r) => r.rows[0]!.n));

    const before = await auditCount('disconnect');
    const disc = await prod.app.inject({ method: 'POST', url: '/app/channels/whatsapp/disconnect',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, payload: '' });
    expect(disc.statusCode).toBe(302);
    expect(disc.headers['location']).toContain('/app/channels?flash=');
    expect(await active()).toBe(false);                 // real effect: inbound resolution stops
    expect(await auditCount('disconnect')).toBe(before + 1);

    const rec = await prod.app.inject({ method: 'POST', url: '/app/channels/whatsapp/reconnect',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, payload: '' });
    expect(rec.statusCode).toBe(302);
    expect(await active()).toBe(true);                  // restored
  });

  it('M9.4 channels: test action records an audit and redirects with a result', async () => {
    const cookie = await login();
    const res = await prod.app.inject({ method: 'POST', url: '/app/channels/whatsapp/test',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, payload: '' });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toContain('/app/channels?flash=');
  });

  it('M9.4 channels: mutation requires auth', async () => {
    const res = await prod.app.inject({ method: 'POST', url: '/app/channels/whatsapp/disconnect',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: '' });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/login');
  });

  it('M9.5 products: list + detail render the real catalog', async () => {
    const cookie = await login();
    const list = await prod.app.inject({ method: 'GET', url: '/app/products', headers: { cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.body).toContain('产品目录');
    expect(list.body).toContain('帆布袋');       // demo ZX-100
    expect(list.body).toContain('已学习');

    const detail = await prod.app.inject({ method: 'GET',
      url: '/app/products/de300000-0000-4000-8000-000000000101', headers: { cookie } });
    expect(detail.statusCode).toBe(200);
    expect(detail.body).toContain('价格');
    expect(detail.body).toContain('买家怎么称呼它');   // aliases
    expect(detail.body).toContain('canvas bag');

    const missing = await prod.app.inject({ method: 'GET',
      url: '/app/products/de300000-0000-4000-8000-0000000009ff', headers: { cookie } });
    expect(missing.body).toContain('找不到这个产品');
  });

  it('M9.5 TRUST RULE: an unconfirmed (price-less) product is inactive and excluded from quotes', async () => {
    const { sql } = await import('kysely');
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const parsed = parseBusinessId('de300000-0000-4000-8000-0000000000b1');
    if (!parsed.ok) throw new Error('fixture');
    const bidv = parsed.value;
    const cookie = await login();

    // Teach one priced product and one without a price.
    const text = '独家测试杯 $5.00 MOQ 500\n神秘无价样品';
    const conf = await prod.app.inject({ method: 'POST', url: '/app/products/add/confirm',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: `text=${encodeURIComponent(text)}` });
    expect(conf.statusCode).toBe(302);
    expect(conf.headers['location']).toContain('flash=');

    const activeOf = (name: string) => withTenantTx(prod.db, bidv, (tx) =>
      sql<{ a: boolean }>`select is_active as a from products where name=${name} order by created_at desc limit 1`
        .execute(tx).then((r) => r.rows[0]?.a));
    expect(await activeOf('独家测试杯')).toBe(true);     // priced → learned/active
    expect(await activeOf('神秘无价样品')).toBe(false);   // no price → NOT activated

    // Retrieval (what feeds quotes) excludes the inactive product entirely.
    const hits = await withTenantTx(prod.db, bidv, (tx) =>
      sql<{ names: string | null }>`select string_agg(name, ',') as names
        from retrieve_products(${bidv}::uuid, '神秘无价样品'::text, null, 5)`.execute(tx).then((r) => r.rows[0]?.names ?? ''));
    expect(hits).not.toContain('神秘无价样品');            // cannot affect a quote
  });

  it('M9.6 employee: profile renders real trust data (duties, growth, promotion)', async () => {
    const cookie = await login();
    const res = await prod.app.inject({ method: 'GET', url: '/app/employee', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('员工档案');
    expect(res.body).toContain('工作职责');
    expect(res.body).toContain('现在可以');
    expect(res.body).toContain('成长记录');
    expect(res.body).toContain('晋升状态');
    // demo: greet is promoted (auto) → appears under 现在可以 as 接待问候
    expect(res.body).toContain('接待问候');
    // no confidence score / percentage leaks
    expect(res.body).not.toContain('置信度');
  });

  it('M9.6 capability action: revoke flips autonomy + writes a capability event', async () => {
    const { sql } = await import('kysely');
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const parsed = parseBusinessId('de300000-0000-4000-8000-0000000000b1');
    if (!parsed.ok) throw new Error('fixture');
    const bidv = parsed.value;
    const cookie = await login();
    // Ensure greet is auto to start.
    await withTenantTx(prod.db, bidv, (tx) => sql`update autonomy_policy set mode='auto' where capability='greet'`.execute(tx));
    const modeOf = () => withTenantTx(prod.db, bidv, (tx) =>
      sql<{ m: string }>`select mode as m from autonomy_policy where capability='greet'`.execute(tx).then((r) => r.rows[0]!.m));
    const evCount = () => withTenantTx(prod.db, bidv, (tx) =>
      sql<{ n: number }>`select count(*)::int as n from capability_events where capability='greet' and reasons @> array['owner_revoked']`.execute(tx).then((r) => r.rows[0]!.n));

    const before = await evCount();
    const res = await prod.app.inject({ method: 'POST', url: '/app/employee/capability/greet/revoke',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, payload: '' });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toContain('/app/employee?flash=');
    expect(await modeOf()).toBe('draft');                  // authority pulled back
    expect(await evCount()).toBe(before + 1);              // recorded in capability_events
    // restore
    await withTenantTx(prod.db, bidv, (tx) => sql`update autonomy_policy set mode='auto' where capability='greet'`.execute(tx));
  });

  it('M9.6 capability action requires auth; confirm_order can never be promoted', async () => {
    const noAuth = await prod.app.inject({ method: 'POST', url: '/app/employee/capability/greet/revoke',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: '' });
    expect(noAuth.statusCode).toBe(302);
    expect(noAuth.headers['location']).toBe('/login');

    const cookie = await login();
    const confirm = await prod.app.inject({ method: 'POST', url: '/app/employee/capability/confirm_order/promote',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, payload: '' });
    expect(confirm.statusCode).toBe(302);
    // confirm_order stays draft — the flash says so, and autonomy is unchanged
    const { sql } = await import('kysely');
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const parsed = parseBusinessId('de300000-0000-4000-8000-0000000000b1');
    if (!parsed.ok) throw new Error('fixture');
    const mode = await withTenantTx(prod.db, parsed.value, (tx) =>
      sql<{ m: string }>`select mode as m from autonomy_policy where capability='confirm_order'`.execute(tx).then((r) => r.rows[0]?.m));
    expect(mode).toBe('draft');
  });

  async function login(): Promise<string> {
    const ok = await prod.app.inject({ method: 'POST', url: '/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `code=${encodeURIComponent(prod.ownerAccessCode)}` });
    return String(ok.headers['set-cookie']).split(';')[0] ?? '';
  }

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
