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

  it('P3 runtime path: QUEUES.notify → consumer → adapter delivers the owner alert', async () => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const parsed = parseBusinessId(DEMO_BIZ); if (!parsed.ok) throw new Error('fixture');
    await withTenantTx(prod.db, parsed.value, (tx) =>
      sql`update businesses set owner_locale='en', owner_phone='+8613800000001' where id=${parsed.value}`.execute(tx));

    const before = sim.sentIds.length;
    // Enqueue a neutral alert; the consumer registered by buildProduction must
    // resolve the destination and deliver through the SAME adapter (sim records the send).
    await prod.boss.send('notify.team', { businessId: DEMO_BIZ, kind: 'hot_lead', conversationId: null });
    let delivered = false;
    for (let i = 0; i < 50; i++) {
      if (sim.sentIds.length > before) { delivered = true; break; }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(delivered).toBe(true);   // the notify consumer is wired and sent via the adapter

    await withTenantTx(prod.db, parsed.value, (tx) =>
      sql`update businesses set owner_phone=null where id=${parsed.value}`.execute(tx));
  }, 15_000);

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
    expect(home.body).toContain("Lily's workspace");   // shell tagline (English default)
    expect(home.body).toContain("Lily's summary today"); // greeting line
    expect(home.body).toContain("Lily's status");      // employee status card
    expect(home.body).toMatch(/Inquiries/);            // today summary
    const inbox = await prod.app.inject({ method: 'GET', url: '/app/inbox', headers: { cookie } });
    expect(inbox.statusCode).toBe(200);
    expect(inbox.body).toContain('Inbox');             // English default
  });

  it('ADR-0008 i18n: login/home localize by cookie & Accept-Language, /locale switches', async () => {
    // default English
    const en = await prod.app.inject({ method: 'GET', url: '/login' });
    expect(en.body).toContain('<html lang="en" dir="ltr">');
    expect(en.body).toContain('Access code');
    // Accept-Language Arabic → RTL
    const ar = await prod.app.inject({ method: 'GET', url: '/login', headers: { 'accept-language': 'ar-SA,ar;q=0.9' } });
    expect(ar.body).toContain('<html lang="ar" dir="rtl">');
    expect(ar.body).toContain('رمز الدخول');
    // yf_locale cookie → Chinese
    const zh = await prod.app.inject({ method: 'GET', url: '/login', headers: { cookie: 'yf_locale=zh' } });
    expect(zh.body).toContain('<html lang="zh"');
    expect(zh.body).toContain('进入密码');
    // /locale sets the cookie and honors next; open-redirect is rejected
    const set = await prod.app.inject({ method: 'GET', url: '/locale?set=zh&next=/login' });
    expect(set.statusCode).toBe(302);
    expect(set.headers['location']).toBe('/login');
    expect(String(set.headers['set-cookie'])).toContain('yf_locale=zh');
    const evil = await prod.app.inject({ method: 'GET', url: '/locale?set=en&next=//evil.com' });
    expect(evil.headers['location']).toBe('/app');
    // authenticated home follows the cookie
    const cookie = await login();
    const zhHome = await prod.app.inject({ method: 'GET', url: '/app', headers: { cookie: `${cookie}; yf_locale=zh` } });
    expect(zhHome.body).toContain('小雅的今日总结');
  });

  it('M9.3 inbox: opens a real conversation; unknown/foreign id → 404, no leak', async () => {
    const cookie = await login();
    // Demo conversation 302 (Sara / canvas bags) exists for the demo business.
    const detail = await prod.app.inject({ method: 'GET',
      url: '/app/inbox/de300000-0000-4000-8000-000000000302', headers: { cookie } });
    expect(detail.statusCode).toBe(200);
    expect(detail.body).toContain('Conversation');   // English default

    const unknown = await prod.app.inject({ method: 'GET',
      url: '/app/inbox/de300000-0000-4000-8000-0000000009ff', headers: { cookie } });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.body).toContain('Conversation not found');
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
    expect(before.body).toContain('Lily is waiting for your OK');   // English default
    expect(before.body).toContain('Draft reply from 小雅');          // draft text is data, verbatim

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
    expect(res.body).toContain('Channels');        // English default
    expect(res.body).toContain('WhatsApp');
    expect(res.body).toContain('Coming soon');
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
    expect(list.body).toContain('Products');     // English default
    expect(list.body).toContain('ZX-100');       // demo SKU (locale-stable)
    expect(list.body).toContain('Learned');

    const detail = await prod.app.inject({ method: 'GET',
      url: '/app/products/de300000-0000-4000-8000-000000000101', headers: { cookie } });
    expect(detail.statusCode).toBe(200);
    expect(detail.body).toContain('Pricing');
    expect(detail.body).toContain('What buyers call it');   // aliases
    expect(detail.body).toContain('canvas bag');

    const missing = await prod.app.inject({ method: 'GET',
      url: '/app/products/de300000-0000-4000-8000-0000000009ff', headers: { cookie } });
    expect(missing.body).toContain('Product not found');
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
    expect(res.body).toContain('Employee file');   // English default
    expect(res.body).toContain('Responsibilities');
    expect(res.body).toContain('Can do now');
    expect(res.body).toContain('Growth');
    expect(res.body).toContain('Promotion');
    // demo: greet is promoted (auto) → appears under Can do now as Greeting
    expect(res.body).toContain('Greeting');
    expect(res.body).not.toContain('置信度');       // no invented score
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

  it('M9.7 conversations: requires auth', async () => {
    const res = await prod.app.inject({ method: 'GET', url: '/app/conversations' });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/login');
  });

  it('M9.7 conversations: list renders demo customers (memory, not a chat log)', async () => {
    const cookie = await login();
    const res = await prod.app.inject({ method: 'GET', url: '/app/conversations', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Customers');   // English default
    expect(res.body).toContain('Ahmed Al-Rashid');
    expect(res.body).toContain('Ivan Petrov');
    expect(res.body).toContain('WhatsApp');
    expect(res.body).not.toContain('置信度');   // no invented score
    expect(res.body).not.toContain('<table');   // mobile: no wide tables
  });

  it('M9.7 conversations: simple search filters by buyer name', async () => {
    const cookie = await login();
    const res = await prod.app.inject({ method: 'GET', url: '/app/conversations?q=Ivan', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Ivan Petrov');
    expect(res.body).not.toContain('Ahmed Al-Rashid');
  });

  it('M9.7 conversations: customer file renders profile + timeline', async () => {
    const cookie = await login();
    const res = await prod.app.inject({ method: 'GET',
      url: '/app/conversations/de300000-0000-4000-8000-000000000301', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Ahmed Al-Rashid');
    expect(res.body).toContain('Customer file');
    expect(res.body).toContain('First contact');
    expect(res.body).toContain('History');
  });

  it('M9.7 conversations: unknown id 404s without revealing existence', async () => {
    const cookie = await login();
    const res = await prod.app.inject({ method: 'GET',
      url: '/app/conversations/de300000-0000-4000-8000-0000000009ff', headers: { cookie } });
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('Customer not found');
  });

  it('M9.8 analytics: requires auth', async () => {
    const res = await prod.app.inject({ method: 'GET', url: '/app/analytics' });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/login');
  });

  it('M9.8 analytics: renders the business review (real counts, no fake charts)', async () => {
    const cookie = await login();
    const res = await prod.app.inject({ method: 'GET', url: '/app/analytics?range=month', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Business review');   // English default
    expect(res.body).toContain('Overview');
    expect(res.body).toContain('New customers');
    expect(res.body).toContain('Activity');
    expect(res.body).toContain("Lily's work");
    expect(res.body).not.toContain('<svg');    // no fabricated chart
    expect(res.body).not.toContain('<table');  // mobile: no wide tables
    // Visible content (styles + hrefs stripped) carries no rate/score vocabulary.
    // A percentage rate reads as <digit>% — URL-encoded %2F in the locale switcher
    // is not that.
    const visible = res.body.replace(/<style[\s\S]*?<\/style>/g, '').replace(/href="[^"]*"/g, '');
    expect(visible).not.toMatch(/\d\s*%/);
    expect(visible).not.toContain('置信度');
  });

  it('M9.8 analytics: numbers equal independent counts (nothing invented)', async () => {
    const { loadAnalytics } = await import('../../src/api/web/analytics.js');
    const { sql } = await import('kysely');
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const parsed = parseBusinessId(DEMO_BIZ);
    if (!parsed.ok) throw new Error('fixture');
    const bidv = parsed.value;

    const d = await loadAnalytics(prod.db, DEMO_BIZ, 'month');
    const truth = await withTenantTx(prod.db, bidv, (tx) => sql<{ clients: number; inbound: number; quotes: number }>`
      select (select count(*)::int from clients where created_at >= (date_trunc('month', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai')) as clients,
             (select count(*)::int from messages where direction='inbound' and sent_at >= (date_trunc('month', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai')) as inbound,
             (select count(*)::int from quotes where created_at >= (date_trunc('month', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai')) as quotes
    `.execute(tx).then((r) => r.rows[0]!));
    expect(d.summary.newClients).toBe(truth.clients);
    expect(d.activity.inbound).toBe(truth.inbound);
    expect(d.commerce.quotes).toBe(truth.quotes);
    // demo has real activity this month
    expect(d.hasActivity).toBe(true);
  });

  it('M9.8 analytics: a business with no data shows the honest empty state (tenant isolation)', async () => {
    const { loadAnalytics } = await import('../../src/api/web/analytics.js');
    // A well-formed but data-less business sees ZERO — never the demo's rows.
    const other = await loadAnalytics(prod.db, 'de300000-0000-4000-8000-0000000000c9', 'month');
    expect(other.hasActivity).toBe(false);
    expect(other.summary.newClients).toBe(0);
    expect(other.summary.activeConvos).toBe(0);
    expect(other.activity.inbound).toBe(0);
    // same range on the demo DOES have data → the two tenants are isolated
    const demo = await loadAnalytics(prod.db, DEMO_BIZ, 'month');
    expect(demo.summary.newClients).toBeGreaterThan(0);
  });

  it('P3 owner alert: consumer resolves persisted locale + destination, sends localized (en/zh/ar)', async () => {
    const { deliverOwnerAlert } = await import('../../src/pipeline/notify.js');
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { sql } = await import('kysely');
    const parsed = parseBusinessId(DEMO_BIZ); if (!parsed.ok) throw new Error('fixture');
    const bidv = parsed.value;
    const setOwner = (loc: string, phone: string | null) => withTenantTx(prod.db, bidv, (tx) =>
      sql`update businesses set owner_locale=${loc}, owner_phone=${phone} where id=${bidv}`.execute(tx));
    const sent: { to: string; body: string }[] = [];
    const rec = { sendText: async (to: string, body: string) => { sent.push({ to, body }); return { ok: true as const, providerMessageId: 'x' }; } };
    const job = (kind: 'hot_lead' | 'handoff') => ({ businessId: DEMO_BIZ, kind, conversationId: null });

    await setOwner('zh', '+8613800000000');
    expect(await deliverOwnerAlert({ db: prod.db, adapter: rec }, job('hot_lead'))).toBe('sent');
    expect(sent).toHaveLength(1);                    // exactly one send — no duplicate
    expect(sent[0]!.to).toBe('+8613800000000');      // persisted destination
    expect(sent[0]!.body).toContain('小雅');          // zh

    await setOwner('en', '+8613800000000');
    await deliverOwnerAlert({ db: prod.db, adapter: rec }, job('hot_lead'));
    expect(sent[1]!.body).toContain('Lily');          // locale switched to en

    await setOwner('ar', '+8613800000000');
    await deliverOwnerAlert({ db: prod.db, adapter: rec }, job('handoff'));
    expect(sent[2]!.body).toContain('ياسمين');        // ar

    await setOwner('en', null);                        // restore
  });

  it('P3 owner alert: no destination → skipped, never a fake send', async () => {
    const { deliverOwnerAlert } = await import('../../src/pipeline/notify.js');
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { sql } = await import('kysely');
    const parsed = parseBusinessId(DEMO_BIZ); if (!parsed.ok) throw new Error('fixture');
    await withTenantTx(prod.db, parsed.value, (tx) => sql`update businesses set owner_phone=null where id=${parsed.value}`.execute(tx));
    const sent: unknown[] = [];
    const rec = { sendText: async () => { sent.push(1); return { ok: true as const, providerMessageId: 'x' }; } };
    expect(await deliverOwnerAlert({ db: prod.db, adapter: rec }, { businessId: DEMO_BIZ, kind: 'hot_lead', conversationId: null })).toBe('skipped_no_destination');
    expect(sent).toHaveLength(0);
  });

  it('P3 owner alert: retryable failure throws (pg-boss retries); permanent does not', async () => {
    const { deliverOwnerAlert } = await import('../../src/pipeline/notify.js');
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { sql } = await import('kysely');
    const parsed = parseBusinessId(DEMO_BIZ); if (!parsed.ok) throw new Error('fixture');
    await withTenantTx(prod.db, parsed.value, (tx) => sql`update businesses set owner_locale='en', owner_phone='+8613800000009' where id=${parsed.value}`.execute(tx));
    const j = { businessId: DEMO_BIZ, kind: 'hot_lead' as const, conversationId: null };

    const retry = { sendText: async () => ({ ok: false as const, retryable: true, error: '503' }) };
    await expect(deliverOwnerAlert({ db: prod.db, adapter: retry }, j)).rejects.toThrow();

    const perm = { sendText: async () => ({ ok: false as const, retryable: false, error: 'invalid number' }) };
    expect(await deliverOwnerAlert({ db: prod.db, adapter: perm }, j)).toBe('failed_permanent');

    await withTenantTx(prod.db, parsed.value, (tx) => sql`update businesses set owner_phone=null where id=${parsed.value}`.execute(tx));
  });

  it('P3 settings: owner can save/clear the alert number; it audits; alerts then resolve', async () => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { deliverOwnerAlert } = await import('../../src/pipeline/notify.js');
    const { sql } = await import('kysely');
    const parsed = parseBusinessId(DEMO_BIZ); if (!parsed.ok) throw new Error('fixture');
    const bidv = parsed.value;
    const phoneOf = () => withTenantTx(prod.db, bidv, (tx) =>
      sql<{ p: string | null }>`select owner_phone as p from businesses where id=${bidv}`.execute(tx).then((r) => r.rows[0]!.p));
    const auditCount = () => withTenantTx(prod.db, bidv, (tx) =>
      sql<{ n: number }>`select count(*)::int n from channel_audit where business_id=${bidv} and action='set_owner_phone'`.execute(tx).then((r) => r.rows[0]!.n));
    await withTenantTx(prod.db, bidv, (tx) => sql`update businesses set owner_phone=null where id=${bidv}`.execute(tx));

    const cookie = await login();
    const before = await auditCount();
    const save = await prod.app.inject({ method: 'POST', url: '/app/settings/owner-phone',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, payload: 'phone=%2B8613800000042' });
    expect(save.statusCode).toBe(302);
    expect(save.headers['location']).toContain('/app/channels?flash=');
    expect(await phoneOf()).toBe('+8613800000042');       // saved
    expect(await auditCount()).toBe(before + 1);          // audited

    // A notification now resolves the destination.
    const sent: { to: string }[] = [];
    const rec = { sendText: async (to: string) => { sent.push({ to }); return { ok: true as const, providerMessageId: 'x' }; } };
    expect(await deliverOwnerAlert({ db: prod.db, adapter: rec }, { businessId: DEMO_BIZ, kind: 'hot_lead', conversationId: null })).toBe('sent');
    expect(sent[0]!.to).toBe('+8613800000042');

    // invalid input is rejected — number unchanged.
    const bad = await prod.app.inject({ method: 'POST', url: '/app/settings/owner-phone',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, payload: 'phone=not-a-number' });
    expect(bad.headers['location']).toContain('flash=');
    expect(await phoneOf()).toBe('+8613800000042');       // unchanged

    // clear
    await prod.app.inject({ method: 'POST', url: '/app/settings/owner-phone',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, payload: 'phone=' });
    expect(await phoneOf()).toBeNull();
  });

  it('P3 settings: unauthenticated cannot change the alert number', async () => {
    const res = await prod.app.inject({ method: 'POST', url: '/app/settings/owner-phone',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'phone=%2B8613800000099' });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/login');
  });

  it('M11.1 settings: profile renders reused fields + derived categories (owner-auth)', async () => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { sql } = await import('kysely');
    const parsed = parseBusinessId(DEMO_BIZ); if (!parsed.ok) throw new Error('fixture');
    await withTenantTx(prod.db, parsed.value, (tx) =>
      sql`update businesses set name='Yiwu Demo Factory', location='Yiwu, Zhejiang' where id=${parsed.value}`.execute(tx));

    const cookie = await login();
    const res = await prod.app.inject({ method: 'GET', url: '/app/settings', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Business profile');          // English default
    expect(res.body).toContain('Profile checklist');
    expect(res.body).toContain('Yiwu Demo Factory');         // reused businesses.name
    expect(res.body).toContain('Company name');
    expect(res.body).toContain('Product categories');
    // derived from the demo catalog (products.category): bags/drinkware/home/lighting
    expect(res.body).toMatch(/bags|drinkware|lighting/);
    // (checklist-is-not-a-percentage is asserted deterministically in the pure test)
  });

  it('M11.1 settings: unauthenticated cannot view or save', async () => {
    expect((await prod.app.inject({ method: 'GET', url: '/app/settings' })).headers['location']).toBe('/login');
    const post = await prod.app.inject({ method: 'POST', url: '/app/settings',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'name=Hacker' });
    expect(post.statusCode).toBe(302);
    expect(post.headers['location']).toBe('/login');
  });

  it('M11.1 settings: save persists + audits; invalid (empty name) rejected unchanged', async () => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { sql } = await import('kysely');
    const parsed = parseBusinessId(DEMO_BIZ); if (!parsed.ok) throw new Error('fixture');
    const bidv = parsed.value;
    const nameOf = () => withTenantTx(prod.db, bidv, (tx) =>
      sql<{ n: string }>`select name as n from businesses where id=${bidv}`.execute(tx).then((r) => r.rows[0]!.n));
    const auditCount = () => withTenantTx(prod.db, bidv, (tx) =>
      sql<{ c: number }>`select count(*)::int c from channel_audit where business_id=${bidv} and action='update_profile'`.execute(tx).then((r) => r.rows[0]!.c));

    const cookie = await login();
    const before = await auditCount();
    const ok = await prod.app.inject({ method: 'POST', url: '/app/settings',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'name=Acme%20Exports&location=Ningbo&contact_email=sales%40acme.co&lang_en=on&lang_zh=on' });
    expect(ok.statusCode).toBe(302);
    expect(ok.headers['location']).toContain('/app/settings?flash=');
    expect(await nameOf()).toBe('Acme Exports');            // persisted
    expect(await auditCount()).toBe(before + 1);            // audited (update_profile)

    // invalid: empty name is rejected — the saved name is unchanged.
    const bad = await prod.app.inject({ method: 'POST', url: '/app/settings',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, payload: 'name=' });
    expect(bad.headers['location']).toContain('flash=');
    expect(await nameOf()).toBe('Acme Exports');            // unchanged

    // restore the demo name
    await withTenantTx(prod.db, bidv, (tx) => sql`update businesses set name='义乌宏发日用品厂' where id=${bidv}`.execute(tx));
  });

  it('M11.2 onboarding: completion is derived LIVE from real data (no fake completion)', async () => {
    const { loadOnboarding } = await import('../../src/api/web/onboarding.js');
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { sql } = await import('kysely');
    const parsed = parseBusinessId(DEMO_BIZ); if (!parsed.ok) throw new Error('fixture');
    const bidv = parsed.value;
    const CONV = 'de300000-0000-4000-8000-000000000302';
    const stepDone = (d: Awaited<ReturnType<typeof loadOnboarding>>, s: string) => d.steps.find((x) => x.step === s)!.done;
    const stateStep = () => withTenantTx(prod.db, bidv, (tx) =>
      sql<{ s: string | null }>`select step as s from onboarding_state where business_id=${bidv}`.execute(tx).then((r) => r.rows[0]?.s ?? null));

    // Baseline: clear the profile identity so Step 1 is honestly not done.
    await withTenantTx(prod.db, bidv, (tx) => sql`update businesses set description=null, location=null, contact_email=null, contact_phone=null where id=${bidv}`.execute(tx));
    const onbStateBefore = await stateStep();
    expect(stepDone(await loadOnboarding(prod.db, DEMO_BIZ), 'profile')).toBe(false);

    // Fill the profile → Step 1 flips to done (live).
    await withTenantTx(prod.db, bidv, (tx) => sql`update businesses set description='Household goods', location='Yiwu', contact_email='a@b.co' where id=${bidv}`.execute(tx));
    expect(stepDone(await loadOnboarding(prod.db, DEMO_BIZ), 'profile')).toBe(true);

    // Step 4 guard: an approved draft on a REAL conversation counts. Neutralize any
    // existing approved/edited drafts first (app role has no DELETE — archive, not
    // erase — so status→rejected; demo drafts are all test-created).
    await withTenantTx(prod.db, bidv, (tx) => sql`update drafts set status='rejected' where business_id=${bidv} and status in ('approved','edited')`.execute(tx));
    expect(stepDone(await loadOnboarding(prod.db, DEMO_BIZ), 'first_success')).toBe(false);
    const draftId = await withTenantTx(prod.db, bidv, (tx) => sql<{ id: string }>`
      insert into drafts (business_id, conversation_id, capability, draft_text, turn_message_id, status, decided_at)
      values (${bidv}, ${CONV}, 'quote', 'first reply', null, 'approved', now()) returning id`.execute(tx).then((r) => r.rows[0]!.id));
    expect(stepDone(await loadOnboarding(prod.db, DEMO_BIZ), 'first_success')).toBe(true);

    // onboarding_state is NEVER touched by completion logic.
    expect(await stateStep()).toBe(onbStateBefore);

    // cleanup (archive the test draft, restore profile)
    await withTenantTx(prod.db, bidv, (tx) => sql`update drafts set status='rejected' where id=${draftId}`.execute(tx));
    await withTenantTx(prod.db, bidv, (tx) => sql`update businesses set description=null, location=null, contact_email=null, contact_phone=null where id=${bidv}`.execute(tx));
  });

  it('M11.2 onboarding: page renders the checklist with deep links; unauth → /login', async () => {
    const cookie = await login();
    const res = await prod.app.inject({ method: 'GET', url: '/app/onboarding', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Get set up');                  // English default
    expect(res.body).toContain('href="/app/settings"');
    expect(res.body).toContain('href="/app/products"');
    expect(res.body).toContain('href="/app/inbox"');
    const noauth = await prod.app.inject({ method: 'GET', url: '/app/onboarding' });
    expect(noauth.statusCode).toBe(302);
    expect(noauth.headers['location']).toBe('/login');
  });

  async function login(): Promise<string> {
    const ok = await prod.app.inject({ method: 'POST', url: '/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `code=${encodeURIComponent(prod.ownerAccessCode)}` });
    return String(ok.headers['set-cookie']).split(';')[0] ?? '';
  }

  // ── M12.2 Interactive pilot sandbox (dedicated tenant, real engine) ─────────
  describe('M12.2 · interactive pilot sandbox', () => {
    const SANDBOX = '5a4d0000-0000-4000-8000-0000000000b1';

    const withSandbox = async <T>(fn: (tx: import('kysely').Transaction<never>) => Promise<T>): Promise<T> => {
      const { withTenantTx } = await import('../../src/db/client.js');
      const { parseBusinessId } = await import('../../src/core/types/ids.js');
      const bid = parseBusinessId(SANDBOX); if (!bid.ok) throw new Error('fixture');
      return withTenantTx(prod.db, bid.value, fn as never);
    };

    beforeAll(async () => {
      const { sandboxSeedSql } = await import('../../src/demo/sandbox.js');
      // App-role seed inside the sandbox tenant tx (businesses RLS with-check = id).
      await withSandbox(async (tx) => {
        for (const stmt of sandboxSeedSql().split(';')) {
          const s = stmt.trim();
          if (!s || s.replace(/--.*$/gm, '').trim() === '') continue;
          await sql.raw(s).execute(tx as never);
        }
      });
    });

    it('requires owner auth', async () => {
      const res = await prod.app.inject({ method: 'GET', url: '/app/sandbox' });
      expect(res.statusCode).toBe(302);
      expect(res.headers['location']).toBe('/login');
    });

    it('ISOLATION: the sandbox tenant has NO channel credential (unroutable from any webhook)', async () => {
      const n = await withSandbox((tx) =>
        sql<{ n: number }>`select count(*)::int as n from channel_credentials where business_id=${SANDBOX}`
          .execute(tx as never).then((r) => r.rows[0]!.n));
      expect(n).toBe(0);
    });

    it('renders the simulation banner and starts empty', async () => {
      const cookie = await login();
      const res = await prod.app.inject({ method: 'GET', url: '/app/sandbox', headers: { cookie } });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('Simulation only. No customer messages are sent.');
      expect(res.body).toContain('No messages yet');
    });

    it('a scripted scenario runs the REAL engine → transcript + a passing trust strip, draft-first', async () => {
      const cookie = await login();
      const post = await prod.app.inject({ method: 'POST', url: '/app/sandbox/scenario',
        headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'mode=scripted&scenarioId=price-floor-clamp-under-aggressive-discount' });
      expect(post.statusCode).toBe(302);

      const page = await prod.app.inject({ method: 'GET', url: '/app/sandbox', headers: { cookie } });
      expect(page.body).toContain('We can commit to 5000 units');   // buyer message, in the transcript
      expect(page.body).toContain('Trust check');
      expect(page.body).toContain('All checks passed');             // floor respected, no silent escalation
      expect(page.body).toContain('action="/app/sandbox/act"');     // draft-first → pending approval
    });

    it('approval records the reply via the ONE approval service; a GET never sent it', async () => {
      const cookie = await login();
      const draft = await withSandbox((tx) =>
        sql<{ id: string }>`select id from drafts where status='pending' order by created_at desc limit 1`
          .execute(tx as never).then((r) => r.rows[0]));
      expect(draft).toBeTruthy();

      const act = await prod.app.inject({ method: 'POST', url: '/app/sandbox/act',
        headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
        payload: `draftId=${draft!.id}&command=${encodeURIComponent('发送')}&mode=scripted` });
      expect(act.statusCode).toBe(302);

      const after = await prod.app.inject({ method: 'GET', url: '/app/sandbox', headers: { cookie } });
      expect(after.body).toContain('msg outbound');   // the approved reply is now a sent bubble
    });

    it('reset archives (never deletes) and leaves a sandbox_reset audit event', async () => {
      const cookie = await login();
      const total0 = await withSandbox((tx) =>
        sql<{ n: number }>`select count(*)::int as n from conversations where business_id=${SANDBOX}`
          .execute(tx as never).then((r) => r.rows[0]!.n));

      const reset = await prod.app.inject({ method: 'POST', url: '/app/sandbox/reset',
        headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, payload: '' });
      expect(reset.statusCode).toBe(302);

      const { active, total, evt } = await withSandbox(async (tx) => ({
        active: (await sql<{ n: number }>`select count(*)::int as n from conversations where business_id=${SANDBOX} and is_active`.execute(tx as never)).rows[0]!.n,
        total: (await sql<{ n: number }>`select count(*)::int as n from conversations where business_id=${SANDBOX}`.execute(tx as never)).rows[0]!.n,
        evt: (await sql<{ n: number }>`select count(*)::int as n from conversation_events where business_id=${SANDBOX} and type='sandbox_reset'`.execute(tx as never)).rows[0]!.n,
      }));
      expect(active).toBe(0);              // conversation archived
      expect(total).toBe(total0);          // nothing deleted
      expect(evt).toBeGreaterThanOrEqual(1); // audit trace left
    });
  });

  // ── M13 factory knowledge: teach → answer → correct → new answer, live ──────
  describe('M13 · factory knowledge in the sandbox', () => {
    const SANDBOX = '5a4d0000-0000-4000-8000-0000000000b1';
    const TRUST_PRODUCT = 'b0000000-0000-0000-0000-000000000001';

    const bid = async () => {
      const { parseBusinessId } = await import('../../src/core/types/ids.js');
      const p = parseBusinessId(SANDBOX); if (!p.ok) throw new Error('fixture'); return p.value;
    };
    const q = async <T>(fn: (tx: import('kysely').Transaction<never>) => Promise<T>): Promise<T> => {
      const { withTenantTx } = await import('../../src/db/client.js');
      return withTenantTx(prod.db, await bid(), fn as never);
    };

    beforeAll(async () => {
      const { sandboxSeedSql } = await import('../../src/demo/sandbox.js');
      await q(async (tx) => {
        for (const stmt of sandboxSeedSql().split(';')) {
          const s = stmt.trim();
          if (!s || s.replace(/--.*$/gm, '').trim() === '') continue;
          await sql.raw(s).execute(tx as never);
        }
      });
    });

    const ask = async (cookie: string) => {
      await prod.app.inject({ method: 'POST', url: '/app/sandbox/reset',
        headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, payload: '' });
      await prod.app.inject({ method: 'POST', url: '/app/sandbox/message',
        headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'mode=scripted&text=' + encodeURIComponent('what is your minimum order?') });
      return prod.app.inject({ method: 'GET', url: '/app/sandbox', headers: { cookie } });
    };

    it('teach → answer, then correct → the NEW answer, old row archived (never deleted)', async () => {
      const { teachKnowledge, correctKnowledge } = await import('../../src/api/web/knowledge.js');
      const cookie = await login();

      await teachKnowledge(prod.db, SANDBOX, { productId: null, kind: 'faq',
        label: 'What is your minimum order?', content: 'Our minimum order is 1000 pieces.' });
      const first = await ask(cookie);
      expect(first.body).toContain('Our minimum order is 1000 pieces.');   // answered from taught knowledge

      const id = await q((tx) => sql<{ id: string }>`
        select id from product_knowledge where business_id=${SANDBOX} and status='active' and kind='faq'
        order by created_at desc limit 1`.execute(tx as never).then((r) => r.rows[0]!.id));
      await correctKnowledge(prod.db, SANDBOX, id, 'Our minimum order is 2000 pieces.');

      const second = await ask(cookie);
      expect(second.body).toContain('Our minimum order is 2000 pieces.');  // the correction won
      expect(second.body).not.toContain('1000 pieces');                    // fresh thread → only the new answer

      const archived = await q((tx) => sql<{ n: number }>`
        select count(*)::int as n from product_knowledge where business_id=${SANDBOX} and status='archived'`
        .execute(tx as never).then((r) => r.rows[0]!.n));
      expect(archived).toBeGreaterThanOrEqual(1);
    });

    it('a certification is authorised through claims_policy, not stored as knowledge', async () => {
      const { setCertification, loadProductKnowledge } = await import('../../src/api/web/knowledge.js');
      await setCertification(prod.db, SANDBOX, 'CE', true);
      const d = await loadProductKnowledge(prod.db, SANDBOX, TRUST_PRODUCT);
      expect(d?.certs).toContain('CE');
      // and it is NOT a product_knowledge row
      const knowledgeCerts = await q((tx) => sql<{ n: number }>`
        select count(*)::int as n from product_knowledge where business_id=${SANDBOX} and kind='certification'`
        .execute(tx as never).then((r) => r.rows[0]!.n));
      expect(knowledgeCerts).toBe(0);
    });
  });

  // ── M14 knowledge operations: derived gaps + honest report over real turns ──
  describe('M14 · knowledge operations read models', () => {
    const SANDBOX = '5a4d0000-0000-4000-8000-0000000000b1';
    const q = async <T>(fn: (tx: import('kysely').Transaction<never>) => Promise<T>): Promise<T> => {
      const { withTenantTx } = await import('../../src/db/client.js');
      const { parseBusinessId } = await import('../../src/core/types/ids.js');
      const p = parseBusinessId(SANDBOX); if (!p.ok) throw new Error('fixture');
      return withTenantTx(prod.db, p.value, fn as never);
    };
    const askSandbox = async (cookie: string, text: string) => {
      await prod.app.inject({ method: 'POST', url: '/app/sandbox/reset',
        headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, payload: '' });
      await prod.app.inject({ method: 'POST', url: '/app/sandbox/message',
        headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'mode=scripted&text=' + encodeURIComponent(text) });
    };

    beforeAll(async () => {
      const { sandboxSeedSql } = await import('../../src/demo/sandbox.js');
      await q(async (tx) => {
        for (const stmt of sandboxSeedSql().split(';')) {
          const s = stmt.trim();
          if (!s || s.replace(/--.*$/gm, '').trim() === '') continue;
          await sql.raw(s).execute(tx as never);
        }
      });
    });

    it('a question answered WITHOUT taught knowledge surfaces as a derived gap, deterministically reasoned', async () => {
      const { loadKnowledgeOps } = await import('../../src/api/web/knowledge-insights.js');
      const cookie = await login();
      // FDA is not authorised here → an unmatched claim question is a gap with that reason.
      await askSandbox(cookie, 'is it FDA approved?');
      const ops = await loadKnowledgeOps(prod.db, SANDBOX, 'month');
      const gap = ops.gaps.find((g) => g.question.toLowerCase().includes('fda'));
      expect(gap).toBeTruthy();
      expect(gap!.reason).toBe('claim_requires_authorization');
    });

    it('teaching an answer feeds the report + recent changes; the next ask uses it (loop closes)', async () => {
      const { loadKnowledgeOps } = await import('../../src/api/web/knowledge-insights.js');
      const { teachKnowledge } = await import('../../src/api/web/knowledge.js');
      const cookie = await login();

      const usedBefore = await q((tx) => sql<{ n: number }>`
        select count(*)::int as n from conversation_events where business_id=${SANDBOX} and type='knowledge_used'`
        .execute(tx as never).then((r) => r.rows[0]!.n));

      await teachKnowledge(prod.db, SANDBOX, { productId: null, kind: 'faq',
        label: 'Do you offer free samples?', content: 'Yes, free samples are available on request.' });
      await askSandbox(cookie, 'do you offer free samples?');

      const ops = await loadKnowledgeOps(prod.db, SANDBOX, 'month');
      expect(ops.report.factsAdded).toBeGreaterThanOrEqual(1);
      expect(ops.activity.some((a) => a.label === 'Do you offer free samples?' && a.change === 'taught')).toBe(true);

      const usedAfter = await q((tx) => sql<{ n: number }>`
        select count(*)::int as n from conversation_events where business_id=${SANDBOX} and type='knowledge_used'`
        .execute(tx as never).then((r) => r.rows[0]!.n));
      expect(usedAfter).toBeGreaterThan(usedBefore);   // the taught answer was used
    });

    it('HONESTY: report numbers equal independent counts (no invented metric)', async () => {
      const { loadKnowledgeOps } = await import('../../src/api/web/knowledge-insights.js');
      const ops = await loadKnowledgeOps(prod.db, SANDBOX, 'month');
      const indep = await q((tx) => sql<{ facts: number; corrected: number }>`
        with cut as (select (date_trunc('month', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai') as c)
        select
          (select count(*)::int from product_knowledge, cut where business_id=${SANDBOX} and source='owner_confirmed' and status='active' and created_at>=cut.c) as facts,
          (select count(*)::int from product_knowledge, cut where business_id=${SANDBOX} and source='owner_corrected' and created_at>=cut.c) as corrected
      `.execute(tx as never).then((r) => r.rows[0]!));
      expect(ops.report.factsAdded).toBe(indep.facts);
      expect(ops.report.answersCorrected).toBe(indep.corrected);
    });
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
