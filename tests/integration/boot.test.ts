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

  // ── M18.3 · webhook verification: everything that must be REJECTED ─────────
  // The webhook is the one publicly reachable door into the system. The happy
  // paths are covered above; these are the forgeries, and they must all fail
  // closed BEFORE any buyer traffic is switched on.
  describe('M18.3 · webhook rejection (the public door)', () => {
    const post = (payload: string, headers: Record<string, string> = {}) =>
      prod.app.inject({ method: 'POST', url: '/webhook/whatsapp',
        payload, headers: { 'content-type': 'application/json', ...headers } });

    it('GET handshake: the RIGHT verify token echoes the challenge', async () => {
      const res = await prod.app.inject({ method: 'GET',
        url: '/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=boot-verify-token&hub.challenge=echo-me' });
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe('echo-me');
    });

    it('GET handshake: a WRONG or missing verify token is forbidden', async () => {
      for (const qs of [
        'hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=x',
        'hub.mode=subscribe&hub.challenge=x',
        'hub.mode=unsubscribe&hub.verify_token=boot-verify-token&hub.challenge=x',
        'hub.verify_token=boot-verify-token&hub.challenge=x',
      ]) {
        const res = await prod.app.inject({ method: 'GET', url: `/webhook/whatsapp?${qs}` });
        expect(res.statusCode, qs).toBe(403);
        expect(res.body, qs).not.toBe('x');            // the challenge is never echoed
      }
    });

    it('POST: an UNSIGNED payload is rejected', async () => {
      const w = sim.status('wamid.M18_UNSIGNED', 'delivered');
      expect((await post(w.rawBody)).statusCode).toBe(401);
    });

    it('POST: a payload signed with the WRONG secret is rejected', async () => {
      const w = sim.status('wamid.M18_WRONGSIG', 'delivered');
      expect((await post(w.rawBody, { 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) })).statusCode).toBe(401);
    });

    it('POST: a malformed signature header is rejected, never crashed on', async () => {
      const w = sim.status('wamid.M18_MALFORMED', 'delivered');
      for (const sig of ['', 'garbage', 'sha256=', 'sha256=zz', 'sha1=' + '0'.repeat(40)]) {
        const res = await post(w.rawBody, { 'x-hub-signature-256': sig });
        expect(res.statusCode, sig).toBe(401);         // never a 500
      }
    });

    it('POST: a body altered after signing is rejected (the signature covers bytes)', async () => {
      const w = sim.status('wamid.M18_TAMPER2', 'delivered');
      expect((await post(w.rawBody.replace('delivered', 'read'), w.headers)).statusCode).toBe(401);
    });

    it('a rejected webhook persists NOTHING', async () => {
      const { withTenantTx } = await import('../../src/db/client.js');
      const { parseBusinessId } = await import('../../src/core/types/ids.js');
      const p = parseBusinessId(DEMO_BIZ); if (!p.ok) throw new Error('fixture');
      const count = () => withTenantTx(prod.db, p.value, (tx) =>
        sql<{ n: number }>`select count(*)::int n from channel_events`.execute(tx).then((r) => r.rows[0]!.n));

      const before = await count();
      const w = sim.status('wamid.M18_NOPERSIST', 'delivered');
      expect((await post(w.rawBody, { 'x-hub-signature-256': 'sha256=' + 'a'.repeat(64) })).statusCode).toBe(401);
      expect(await count()).toBe(before);              // a forged call leaves no trace
    });
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
  // ONE simulator for this whole describe: whatsappSimulator() restarts its
  // wamid counter per instance and outbound_messages.provider_message_id is
  // UNIQUE, so separate instances collide on the second send.
  let m18Adapter: import('../../src/channels/contract.js').ChannelAdapter;
  beforeAll(async () => {
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    m18Adapter = whatsappSimulator().adapter;
  });
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

    // Authenticated: the shell renders with the M16.2b Operations Home (real data).
    const home = await prod.app.inject({ method: 'GET', url: '/app', headers: { cookie } });
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain("Lily's workspace");     // shell tagline (English default)
    expect(home.body).toContain('Needs your attention'); // M16.2b attention section
    expect(home.body).toContain('System status');        // M16.2b honest channel status
    expect(home.body).toMatch(/Conversations handled/);  // M16.2b employee-activity fact
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
    expect(zhHome.body).toContain('需要你处理');   // M16.2b Operations Home, localized
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

  it('M15.1 pilot readiness: hub renders detected checklist + attestations; unauth → /login', async () => {
    const cookie = await login();
    const res = await prod.app.inject({ method: 'GET', url: '/app/onboarding', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Pilot readiness');             // English default
    expect(res.body).toContain('Verified by system');          // detected badge (demo has products/channel)
    expect(res.body).toContain('action="/app/onboarding/validate"');   // sandbox check
    expect(res.body).toContain('action="/app/onboarding/attest"');     // owner attestation form
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

  // ── M15.1 pilot readiness: detected derivation + owner attestations + validate ─
  describe('M15.1 · pilot readiness', () => {
    it('detected readiness is derived from real data; the demo tenant has products', async () => {
      const { loadPilotReadiness } = await import('../../src/api/web/pilot.js');
      const { withTenantTx } = await import('../../src/db/client.js');
      const { parseBusinessId } = await import('../../src/core/types/ids.js');
      const bid = parseBusinessId(DEMO_BIZ); if (!bid.ok) throw new Error('fixture');

      const r = await loadPilotReadiness(prod.db, DEMO_BIZ);
      // HONESTY: each detected item equals an independent existence check.
      const indep = await withTenantTx(prod.db, bid.value, (tx) => sql<{ prod: boolean; chan: boolean }>`
        select
          exists(select 1 from products where business_id=${DEMO_BIZ} and is_active and price_usd_per_unit is not null) as prod,
          exists(select 1 from channels where business_id=${DEMO_BIZ} and kind='whatsapp' and status='connected') as chan
      `.execute(tx as never).then((x) => x.rows[0]!));
      expect(r.detected.products).toBe(indep.prod);
      expect(r.detected.channel).toBe(indep.chan);   // derived, whatever the real state is
    });

    it('an owner attestation stamps a timestamp (confirmed by owner, not detected)', async () => {
      const { loadPilotReadiness, attest } = await import('../../src/api/web/pilot.js');
      await attest(prod.db, DEMO_BIZ, 'backup_tested');
      const after = (await loadPilotReadiness(prod.db, DEMO_BIZ)).attest.backupTestedAt;
      expect(after).not.toBeNull();   // a real timestamp, owner-confirmed
    });

    it('sandbox validation replays the golden scenarios and records the summary; drives Sandbox ✓', async () => {
      const { loadPilotReadiness, runValidation } = await import('../../src/api/web/pilot.js');
      const r = await runValidation(prod.db, DEMO_BIZ);
      expect(r.total).toBeGreaterThanOrEqual(15);
      expect(r.pass).toBe(r.total);                 // all golden scenarios pass through the real engine
      const rd = await loadPilotReadiness(prod.db, DEMO_BIZ);
      expect(rd.validation.pass).toBe(r.pass);
      expect(rd.validation.total).toBe(r.total);
      expect(rd.detected.sandbox).toBe(true);       // pass===total → Sandbox ✓
    });

    it('the attest route requires auth and stamps via the one service', async () => {
      const noauth = await prod.app.inject({ method: 'POST', url: '/app/onboarding/attest', payload: {} });
      expect(noauth.statusCode).toBe(302);
      const cookie = await login();
      const res = await prod.app.inject({ method: 'POST', url: '/app/onboarding/attest',
        headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, payload: 'which=owner_ready' });
      expect(res.statusCode).toBe(302);
      expect(res.headers['location']).toContain('/app/onboarding?flash=');
    });
  });

  // ── M16.1 human takeover lifecycle (real Postgres) ──────────────────────────
  describe('M16.1 · human takeover lifecycle', () => {
    const now = () => new Date();
    let bid: import('../../src/core/types/ids.js').BusinessId;
    let convId: string;

    const q = <T>(fn: (tx: import('kysely').Transaction<never>) => Promise<T>): Promise<T> =>
      import('../../src/db/client.js').then(({ withTenantTx }) => withTenantTx(prod.db, bid, fn as never));
    const assignedTo = () => q((tx) => sql<{ a: string | null }>`select assigned_to as a from conversations where id=${convId}`.execute(tx as never).then((r) => r.rows.length === 0 ? 'MISSING' : r.rows[0]!.a));
    const eventCount = (type: string) => q((tx) => sql<{ n: number }>`select count(*)::int n from conversation_events where conversation_id=${convId} and type=${type}`.execute(tx as never).then((r) => r.rows[0]!.n));

    beforeAll(async () => {
      const { parseBusinessId } = await import('../../src/core/types/ids.js');
      const { withTenantTx } = await import('../../src/db/client.js');
      const { ensureConversation } = await import('../../src/db/channels.js');
      const { tenantRepos } = await import('../../src/db/repos.js');
      const p = parseBusinessId(DEMO_BIZ); if (!p.ok) throw new Error('fixture'); bid = p.value;
      // A conversation WITH a channel identity so ownerReply can enqueue, then
      // simulate the auto-handoff (unclaimed) it would arrive in.
      convId = await withTenantTx(prod.db, bid, async (tx) => {
        const { conversationId } = await ensureConversation(tx, bid, '971500009999', 'Takeover Buyer');
        await tenantRepos(tx, bid).conversations.assign(conversationId as never, 'unclaimed');
        return conversationId;
      });
    });

    it('handoff → owner takes control: assigned to owner + takeover event', async () => {
      const { takeOver } = await import('../../src/conversations/takeover.js');
      const r = await takeOver({ db: prod.db, now }, { businessId: bid, conversationId: convId, actor: 'owner' });
      expect(r.outcome).toBe('taken_over');
      expect(await assignedTo()).toBe('owner');
      expect(await eventCount('takeover')).toBeGreaterThanOrEqual(1);
    });

    it('owner reply: exactly ONE owner-origin outbound row via the one send path + audit', async () => {
      const { ownerReply } = await import('../../src/outbound/ownerReply.js');
      const before = await q((tx) => sql<{ n: number }>`select count(*)::int n from outbound_messages where conversation_id=${convId}`.execute(tx as never).then((r) => r.rows[0]!.n));
      const kicks: string[] = [];
      const r = await ownerReply(
        { db: prod.db, now, kickDrive: async (_b, c) => { kicks.push(c); } },
        { businessId: bid, conversationId: convId, text: 'This is the owner — I can help you directly.', actor: 'owner' },
      );
      expect(r.outcome).toBe('sent');
      const rows = await q((tx) => sql<{ origin: string; body: string }>`select origin, body from outbound_messages where conversation_id=${convId} order by seq desc limit 5`.execute(tx as never).then((x) => x.rows));
      const after = rows.length;
      expect(after - before).toBe(1);                 // exactly one message enqueued
      expect(rows[0]!.origin).toBe('owner');          // via enqueueOutboundRow, origin owner
      expect(kicks).toEqual([convId]);                // the ONE send path was kicked, once
      expect(await eventCount('owner_reply')).toBeGreaterThanOrEqual(1);
    });

    it('resume: back to AI, history PRESERVED (signals soft-resolved, not deleted)', async () => {
      const { resumeAi } = await import('../../src/conversations/takeover.js');
      const { withTenantTx } = await import('../../src/db/client.js');
      const { tenantRepos } = await import('../../src/db/repos.js');
      await withTenantTx(prod.db, bid, (tx) => tenantRepos(tx, bid).signals.record(convId as never, { kind: 'human_requested' }));

      const r = await resumeAi({ db: prod.db, now }, { businessId: bid, conversationId: convId, actor: 'owner' });
      expect(r.outcome).toBe('resumed');
      expect(await assignedTo()).toBeNull();
      const sig = await q((tx) => sql<{ total: number; active: number }>`
        select count(*)::int total, count(*) filter (where resolved_at is null)::int active
          from conversation_signals where conversation_id=${convId} and kind='human_requested'`.execute(tx as never).then((x) => x.rows[0]!));
      expect(sig.total).toBeGreaterThanOrEqual(1);    // the row is KEPT (history)
      expect(sig.active).toBe(0);                      // soft-resolved → AI won't instantly re-hand-off
      expect(await eventCount('resume_ai')).toBeGreaterThanOrEqual(1);
    });

    it('owner reply CANNOT bypass ownership: refused once the AI owns it again', async () => {
      const { ownerReply } = await import('../../src/outbound/ownerReply.js');
      const before = await q((tx) => sql<{ n: number }>`select count(*)::int n from outbound_messages where conversation_id=${convId}`.execute(tx as never).then((r) => r.rows[0]!.n));
      const r = await ownerReply({ db: prod.db, now, kickDrive: async () => {} }, { businessId: bid, conversationId: convId, text: 'should be refused', actor: 'owner' });
      expect(r.outcome).toBe('ai_owned');
      const after = await q((tx) => sql<{ n: number }>`select count(*)::int n from outbound_messages where conversation_id=${convId}`.execute(tx as never).then((r) => r.rows[0]!.n));
      expect(after).toBe(before);   // nothing sent
    });

    it('TENANT ISOLATION: another business cannot control this conversation', async () => {
      const { takeOver } = await import('../../src/conversations/takeover.js');
      const { parseBusinessId } = await import('../../src/core/types/ids.js');
      const other = parseBusinessId('5a4d0000-0000-4000-8000-0000000000b1'); if (!other.ok) throw new Error('fixture');
      const r = await takeOver({ db: prod.db, now }, { businessId: other.value, conversationId: convId, actor: 'attacker' });
      expect(r.outcome).toBe('not_found');    // scoped away — as if it does not exist
      expect(await assignedTo()).toBeNull();  // and unchanged
    });

    it('SECURITY: takeover / reply / resume routes require auth', async () => {
      for (const path of ['takeover', 'reply', 'resume']) {
        const res = await prod.app.inject({ method: 'POST', url: `/app/inbox/${convId}/${path}`, payload: {} });
        expect(res.statusCode).toBe(302);
        expect(res.headers['location']).toBe('/login');
      }
    });
  });

  // ── M16.2a operations snapshot read model (real Postgres) ───────────────────
  describe('M16.2a · operations snapshot', () => {
    let bid: import('../../src/core/types/ids.js').BusinessId;
    const q = <T>(fn: (tx: import('kysely').Transaction<never>) => Promise<T>): Promise<T> =>
      import('../../src/db/client.js').then(({ withTenantTx }) => withTenantTx(prod.db, bid, fn as never));

    beforeAll(async () => {
      const { parseBusinessId } = await import('../../src/core/types/ids.js');
      const p = parseBusinessId(DEMO_BIZ); if (!p.ok) throw new Error('fixture'); bid = p.value;
    });

    it('HONESTY: every number equals an independent COUNT query', async () => {
      const { loadOperationsSnapshot } = await import('../../src/api/web/operations.js');
      const s = await loadOperationsSnapshot(prod.db, DEMO_BIZ, 'month', 'disabled');
      const indep = await q((tx) => sql<{
        pending: number; handoffs: number; owner_handling: number;
        handled: number; drafts_created: number; corrections: number;
      }>`
        with cut as (select (date_trunc('month', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai') as c)
        select
          (select count(*)::int from drafts where business_id=${DEMO_BIZ} and status='pending') as pending,
          (select count(*)::int from conversations where business_id=${DEMO_BIZ} and is_active and assigned_to='unclaimed') as handoffs,
          (select count(*)::int from conversations where business_id=${DEMO_BIZ} and is_active and assigned_to is not null and assigned_to<>'unclaimed') as owner_handling,
          (select count(distinct conversation_id)::int from turns where business_id=${DEMO_BIZ} and created_at>=(select c from cut)) as handled,
          (select count(*)::int from drafts where business_id=${DEMO_BIZ} and created_at>=(select c from cut)) as drafts_created,
          (select count(*)::int from drafts where business_id=${DEMO_BIZ} and status='edited' and decided_at>=(select c from cut)) as corrections
      `.execute(tx as never).then((r) => r.rows[0]!));
      expect(s.attention.pendingApprovals).toBe(indep.pending);
      expect(s.attention.handoffs).toBe(indep.handoffs);
      expect(s.attention.ownerHandling).toBe(indep.owner_handling);
      expect(s.activity.handled).toBe(indep.handled);
      expect(s.activity.draftsCreated).toBe(indep.drafts_created);
      expect(s.activity.corrections).toBe(indep.corrections);
    });

    it('knowledge sub-model is REUSED from M14 (not recomputed)', async () => {
      const { loadOperationsSnapshot } = await import('../../src/api/web/operations.js');
      const { loadKnowledgeOps } = await import('../../src/api/web/knowledge-insights.js');
      const [s, ops] = await Promise.all([
        loadOperationsSnapshot(prod.db, DEMO_BIZ, 'month', 'disabled'),
        loadKnowledgeOps(prod.db, DEMO_BIZ, 'month'),
      ]);
      expect(s.knowledge.openGaps).toBe(ops.gaps.length);
      expect(s.knowledge.recentCorrections).toBe(ops.report.answersCorrected);
      expect(s.knowledge.recentlyTaught).toBe(ops.report.factsAdded);
    });

    it('attention reflects exactly the states created (pending / unclaimed / owner)', async () => {
      const { loadOperationsSnapshot } = await import('../../src/api/web/operations.js');
      const { withTenantTx } = await import('../../src/db/client.js');
      const { ensureConversation } = await import('../../src/db/channels.js');
      const { tenantRepos } = await import('../../src/db/repos.js');
      const before = await loadOperationsSnapshot(prod.db, DEMO_BIZ, 'month', 'disabled');
      await withTenantTx(prod.db, bid, async (tx) => {
        const a = await ensureConversation(tx, bid, '971500008881', 'Ops A');
        const b = await ensureConversation(tx, bid, '971500008882', 'Ops B');
        await tenantRepos(tx, bid).conversations.assign(a.conversationId as never, 'unclaimed');
        await tenantRepos(tx, bid).conversations.assign(b.conversationId as never, 'owner');
        await sql`insert into drafts (business_id, conversation_id, capability, draft_text, turn_message_id, status)
                  values (${DEMO_BIZ}, ${a.conversationId}, 'quote', 'awaiting approval', null, 'pending')`.execute(tx as never);
      });
      const after = await loadOperationsSnapshot(prod.db, DEMO_BIZ, 'month', 'disabled');
      expect(after.attention.handoffs).toBe(before.attention.handoffs + 1);
      expect(after.attention.ownerHandling).toBe(before.attention.ownerHandling + 1);
      expect(after.attention.pendingApprovals).toBe(before.attention.pendingApprovals + 1);
      expect(after.hasAttention).toBe(true);
    });

    it('TENANT ISOLATION: another business\'s pending draft never appears', async () => {
      const { loadOperationsSnapshot } = await import('../../src/api/web/operations.js');
      const { sandboxSeedSql } = await import('../../src/demo/sandbox.js');
      const { withTenantTx } = await import('../../src/db/client.js');
      const { ensureConversation } = await import('../../src/db/channels.js');
      const { parseBusinessId } = await import('../../src/core/types/ids.js');
      const SANDBOX = '5a4d0000-0000-4000-8000-0000000000b1';
      const sb = parseBusinessId(SANDBOX); if (!sb.ok) throw new Error('fixture');

      const demoBefore = (await loadOperationsSnapshot(prod.db, DEMO_BIZ, 'month', 'disabled')).attention.pendingApprovals;
      await withTenantTx(prod.db, sb.value, async (tx) => {
        for (const stmt of sandboxSeedSql().split(';')) {
          const s = stmt.trim(); if (!s || s.replace(/--.*$/gm, '').trim() === '') continue;
          await sql.raw(s).execute(tx as never);
        }
        const c = await ensureConversation(tx, sb.value, 'ops-iso-buyer', 'Iso');
        await sql`insert into drafts (business_id, conversation_id, capability, draft_text, turn_message_id, status)
                  values (${SANDBOX}, ${c.conversationId}, 'quote', 'other tenant', null, 'pending')`.execute(tx as never);
      });
      const demoAfter = (await loadOperationsSnapshot(prod.db, DEMO_BIZ, 'month', 'disabled')).attention.pendingApprovals;
      expect(demoAfter).toBe(demoBefore);   // RLS-scoped: the sandbox draft is invisible to DEMO
    });

    it('empty / unknown factory → honest zeros', async () => {
      const { loadOperationsSnapshot } = await import('../../src/api/web/operations.js');
      const s = await loadOperationsSnapshot(prod.db, '00000000-0000-0000-0000-000000000000', 'month', 'disabled');
      expect(s.attention).toEqual({ pendingApprovals: 0, handoffs: 0, ownerHandling: 0 });
      expect(s.activity).toEqual({ handled: 0, draftsCreated: 0, corrections: 0 });
      expect(s.hasAttention).toBe(false);
      expect(s.channel.status).toBe('not_connected');
    });

    it('READ-ONLY: computing the snapshot writes nothing', async () => {
      const { loadOperationsSnapshot } = await import('../../src/api/web/operations.js');
      const rowcounts = () => q((tx) => sql<{ d: number; c: number; e: number }>`
        select (select count(*)::int from drafts where business_id=${DEMO_BIZ}) as d,
               (select count(*)::int from conversations where business_id=${DEMO_BIZ}) as c,
               (select count(*)::int from conversation_events where business_id=${DEMO_BIZ}) as e
      `.execute(tx as never).then((r) => r.rows[0]!));
      const before = await rowcounts();
      await loadOperationsSnapshot(prod.db, DEMO_BIZ, 'week', 'disabled');
      expect(await rowcounts()).toEqual(before);
    });
  });

  // ── M16.2b Operations Home UI (rendered over the real snapshot) ─────────────
  // The landing page IS the operations snapshot: loadOperationsSnapshot →
  // renderOperationsHome. These prove the wiring end-to-end, that cards reflect
  // real DB state, and that no buyer text / draft body ever reaches the page.
  describe('M16.2b · operations home (rendered over real data)', () => {
    let bid: import('../../src/core/types/ids.js').BusinessId;
    beforeAll(async () => {
      const { parseBusinessId } = await import('../../src/core/types/ids.js');
      const p = parseBusinessId(DEMO_BIZ); if (!p.ok) throw new Error('fixture'); bid = p.value;
    });

    it('GET /app renders the Operations Home end-to-end (authenticated)', async () => {
      const cookie = await login();
      const res = await prod.app.inject({ method: 'GET', url: '/app', headers: { cookie } });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('Needs your attention');
      expect(res.body).toContain('System status');
      expect(res.body).toContain('Conversations handled');
      expect(res.body).toContain('Waiting for connection'); // honest in disabled mode
      expect(res.body).not.toContain('class="pill ok"');     // never "Connected" pre-Meta
    });

    it('seeded pending + handoff surface as their cards; buyer text & draft body never leak', async () => {
      const { withTenantTx } = await import('../../src/db/client.js');
      const { ensureConversation } = await import('../../src/db/channels.js');
      const { tenantRepos } = await import('../../src/db/repos.js');
      const { loadOperationsSnapshot, renderOperationsHome } = await import('../../src/api/web/operations.js');
      const SECRET = 'ZZsecretdraftbodyDoNotLeak';
      const BUYERTAG = '971500009999zzpii';
      await withTenantTx(prod.db, bid, async (tx) => {
        const c = await ensureConversation(tx, bid, BUYERTAG, 'Leak Probe');
        await tenantRepos(tx, bid).conversations.assign(c.conversationId as never, 'unclaimed');
        await sql`insert into drafts (business_id, conversation_id, capability, draft_text, turn_message_id, status)
                  values (${DEMO_BIZ}, ${c.conversationId}, 'quote', ${SECRET}, null, 'pending')`.execute(tx as never);
      });
      const snap = await loadOperationsSnapshot(prod.db, DEMO_BIZ, 'today', 'disabled');
      const html = renderOperationsHome(snap, 'en');
      expect(snap.attention.handoffs).toBeGreaterThanOrEqual(1);
      expect(snap.attention.pendingApprovals).toBeGreaterThanOrEqual(1);
      expect(html).toContain('Waiting for you');    // handoff card
      expect(html).toContain('Approvals needed');   // approvals card
      expect(html).not.toContain(SECRET);           // draft body is never rendered
      expect(html).not.toContain(BUYERTAG);         // buyer identifier is never rendered
    });

    it('the knowledge-gaps card reflects the real M14 gap count', async () => {
      const { loadOperationsSnapshot, renderOperationsHome } = await import('../../src/api/web/operations.js');
      const { loadKnowledgeOps } = await import('../../src/api/web/knowledge-insights.js');
      const [snap, ops] = await Promise.all([
        loadOperationsSnapshot(prod.db, DEMO_BIZ, 'today', 'disabled'),
        loadKnowledgeOps(prod.db, DEMO_BIZ, 'today'),
      ]);
      expect(snap.knowledge.openGaps).toBe(ops.gaps.length);      // honest, reused from M14
      const html = renderOperationsHome(snap, 'en');
      expect(html).toContain('Questions to answer');             // the gaps card/label
      expect(html).toContain('href="/app/knowledge"');
    });

    it('empty factory renders the honest all-caught-up state', async () => {
      const { loadOperationsSnapshot, renderOperationsHome } = await import('../../src/api/web/operations.js');
      const snap = await loadOperationsSnapshot(prod.db, '00000000-0000-0000-0000-000000000000', 'today', 'disabled');
      const html = renderOperationsHome(snap, 'en');
      expect(html).toContain("You're all caught up");
      expect(html).not.toContain('Waiting for you');
      expect(html).not.toContain('Approvals needed');
    });

    it('SECURITY: the Operations Home is owner-gated — unauthenticated /app redirects', async () => {
      const res = await prod.app.inject({ method: 'GET', url: '/app' });
      expect(res.statusCode).toBe(302);
      expect(res.headers['location']).toBe('/login');
    });
  });

  // ── M16.2c Inbox human-operations detail (loadConversationDetail read model) ─
  // Proves the NEW lastHumanAction read model + the state→controls render over
  // real Postgres, reusing the M16.1 services exactly (takeOver/ownerReply/
  // resumeAi). The lifecycle drives it; the assertions are on the read model.
  describe('M16.2c · inbox human-operations detail (over real data)', () => {
    const now = () => new Date();
    let bid: import('../../src/core/types/ids.js').BusinessId;
    let convId: string;
    const q = <T>(fn: (tx: import('kysely').Transaction<never>) => Promise<T>): Promise<T> =>
      import('../../src/db/client.js').then(({ withTenantTx }) => withTenantTx(prod.db, bid, fn as never));
    const detail = () => import('../../src/api/web/inbox.js')
      .then(({ loadConversationDetail }) => loadConversationDetail(prod.db, DEMO_BIZ, convId));
    const render = async (d: import('../../src/api/web/inbox.js').ConversationDetail) =>
      import('../../src/api/web/inbox.js').then(({ renderConversationDetail }) => renderConversationDetail(d, 'en', new Date(), null));

    beforeAll(async () => {
      const { parseBusinessId } = await import('../../src/core/types/ids.js');
      const { withTenantTx } = await import('../../src/db/client.js');
      const { ensureConversation } = await import('../../src/db/channels.js');
      const { tenantRepos } = await import('../../src/db/repos.js');
      const p = parseBusinessId(DEMO_BIZ); if (!p.ok) throw new Error('fixture'); bid = p.value;
      convId = await withTenantTx(prod.db, bid, async (tx) => {
        const { conversationId } = await ensureConversation(tx, bid, '971500007777', 'Detail Buyer');
        await tenantRepos(tx, bid).conversations.assign(conversationId as never, 'unclaimed');
        await tenantRepos(tx, bid).signals.record(conversationId as never, { kind: 'human_requested' });
        return conversationId;
      });
    });

    it('WAITING_HUMAN: ownership + stored handoff reason; take-over available; no prior action', async () => {
      const d = (await detail())!;
      expect(d.ownership).toBe('WAITING_HUMAN');
      expect(d.handoffReasons).toContain('human_requested');   // stored signal, not inferred
      expect(d.lastHumanAction).toBeNull();
      expect(await render(d)).toContain(`action="/app/inbox/${convId}/takeover"`);
    });

    it('after takeOver: OWNER_CONTROLLED + lastHumanAction=takeover; render shows reply + return', async () => {
      const { takeOver } = await import('../../src/conversations/takeover.js');
      expect((await takeOver({ db: prod.db, now }, { businessId: bid, conversationId: convId, actor: 'owner' })).outcome).toBe('taken_over');
      const d = (await detail())!;
      expect(d.ownership).toBe('OWNER_CONTROLLED');
      expect(d.lastHumanAction).toMatchObject({ type: 'takeover', actor: 'owner' });
      expect(d.lastHumanAction!.at).toBeInstanceOf(Date);
      const html = await render(d);
      expect(html).toContain(`action="/app/inbox/${convId}/reply"`);
      expect(html).toContain(`action="/app/inbox/${convId}/resume"`);
      expect(html).toContain('Taken over by you');
    });

    it('after ownerReply: lastHumanAction=owner_reply AND exactly one owner-origin outbound row', async () => {
      const { ownerReply } = await import('../../src/outbound/ownerReply.js');
      const before = await q((tx) => sql<{ n: number }>`select count(*)::int n from outbound_messages where conversation_id=${convId}`.execute(tx as never).then((r) => r.rows[0]!.n));
      const r = await ownerReply({ db: prod.db, now, kickDrive: async () => {} }, { businessId: bid, conversationId: convId, text: 'Owner here — happy to help directly.', actor: 'owner' });
      expect(r.outcome).toBe('sent');
      const rows = await q((tx) => sql<{ origin: string }>`select origin from outbound_messages where conversation_id=${convId} order by seq desc`.execute(tx as never).then((x) => x.rows));
      expect(rows.length - before).toBe(1);          // the ONE send path — no second insert
      expect(rows[0]!.origin).toBe('owner');
      expect((await detail())!.lastHumanAction!.type).toBe('owner_reply');
    });

    it('after resumeAi: back to AI + lastHumanAction=resume_ai; render shows take-over again', async () => {
      const { resumeAi } = await import('../../src/conversations/takeover.js');
      expect((await resumeAi({ db: prod.db, now }, { businessId: bid, conversationId: convId, actor: 'owner' })).outcome).toBe('resumed');
      const d = (await detail())!;
      expect(d.ownership).toBe('AI');
      expect(d.lastHumanAction!.type).toBe('resume_ai');
      expect(await render(d)).toContain(`action="/app/inbox/${convId}/takeover"`);
    });

    it('latest wins: a later draft_resolved becomes the last action; shape carries no body/PII', async () => {
      await q((tx) => sql`
        insert into conversation_events (business_id, conversation_id, type, payload)
        values (${DEMO_BIZ}, ${convId}, 'draft_resolved',
                ${JSON.stringify({ draftId: 'x', status: 'approved', actor: 'owner', body: 'BODY-MUST-NOT-SURFACE' })}::jsonb)
      `.execute(tx as never));
      const a = (await detail())!.lastHumanAction!;
      expect(a.type).toBe('draft_resolved');                       // newest by (created_at, id)
      expect(Object.keys(a).sort()).toEqual(['actor', 'at', 'type']); // narrow shape only
      expect(a.actor).toBe('owner');
      expect(JSON.stringify(a)).not.toContain('BODY-MUST-NOT-SURFACE');
    });

    it('SECURITY: another tenant cannot read this conversation detail (RLS)', async () => {
      const { loadConversationDetail } = await import('../../src/api/web/inbox.js');
      expect(await loadConversationDetail(prod.db, '5a4d0000-0000-4000-8000-0000000000b1', convId)).toBeNull();
    });
  });

  // ── M16.3 Sandbox human-control rehearsal (the real routes, sandbox tenant) ─
  // The sandbox exercises the SAME lifecycle as production: takeOver /
  // ownerReply / resumeAi on the sandbox tenant, driven through the real HTTP
  // routes. Nothing is delivered — the owner row is sunk into the transcript.
  describe('M16.3 · sandbox human-control rehearsal', () => {
    const SANDBOX = '5a4d0000-0000-4000-8000-0000000000b1';
    let sbid: import('../../src/core/types/ids.js').BusinessId;

    const inSandbox = <T>(fn: (tx: import('kysely').Transaction<never>) => Promise<T>): Promise<T> =>
      import('../../src/db/client.js').then(({ withTenantTx }) => withTenantTx(prod.db, sbid, fn as never));
    const post = async (path: string, payload = 'mode=scripted') => {
      const cookie = await login();
      return prod.app.inject({ method: 'POST', url: `/app/sandbox/${path}`,
        headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, payload });
    };
    // The SAME lookup the routes use: the sandbox buyer's active conversation.
    // (Earlier describes archive theirs via /app/sandbox/reset, so this describe
    // starts its own rather than inheriting ambient state.)
    const convId = () => inSandbox((tx) => sql<{ id: string }>`
      select c.id from conversations c
        join client_channels cc on cc.client_id = c.client_id
         and cc.channel = 'whatsapp' and cc.channel_user_id = 'sandbox-buyer'
       where c.business_id=${SANDBOX} and c.is_active order by c.created_at desc limit 1
    `.execute(tx as never).then((r) => r.rows[0]?.id ?? null));
    const assigned = async () => {
      const cid = await convId();
      return inSandbox((tx) => sql<{ a: string | null }>`
        select assigned_to as a from conversations where id=${cid}
      `.execute(tx as never).then((r) => r.rows.length === 0 ? 'MISSING' : r.rows[0]!.a));
    };
    const events = (type: string) => inSandbox((tx) => sql<{ n: number }>`
      select count(*)::int n from conversation_events where business_id=${SANDBOX} and type=${type}
    `.execute(tx as never).then((r) => r.rows[0]!.n));

    beforeAll(async () => {
      const { parseBusinessId } = await import('../../src/core/types/ids.js');
      const p = parseBusinessId(SANDBOX); if (!p.ok) throw new Error('fixture'); sbid = p.value;
      // Start a fresh rehearsal conversation the way an owner does — one buyer
      // message through the real route (the M12.2 tenant is already seeded).
      const started = await post('message', 'mode=scripted&text=' + encodeURIComponent('Do you make canvas tote bags?'));
      expect(started.statusCode).toBe(302);
      expect(await convId()).not.toBeNull();
    });

    it('SECURITY: the rehearsal routes require owner auth', async () => {
      for (const path of ['takeover', 'reply', 'resume']) {
        const res = await prod.app.inject({ method: 'POST', url: `/app/sandbox/${path}`, payload: {} });
        expect(res.statusCode).toBe(302);
        expect(res.headers['location']).toBe('/login');
      }
    });

    it('take over: assigned to owner + a takeover event; the page shows owner controls', async () => {
      expect((await post('takeover')).statusCode).toBe(302);
      expect(await assigned()).toBe('owner');
      expect(await events('takeover')).toBeGreaterThanOrEqual(1);   // M16.2d can observe it

      const cookie = await login();
      const page = await prod.app.inject({ method: 'GET', url: '/app/sandbox', headers: { cookie } });
      expect(page.body).toContain('action="/app/sandbox/reply"');
      expect(page.body).toContain('action="/app/sandbox/resume"');
    });

    it('owner reply: ONE owner-origin row through the one send path, sunk into the transcript', async () => {
      const cid = (await convId())!;
      const before = await inSandbox((tx) => sql<{ n: number }>`select count(*)::int n from outbound_messages where conversation_id=${cid}`.execute(tx as never).then((r) => r.rows[0]!.n));
      expect((await post('reply', 'mode=scripted&text=' + encodeURIComponent('Owner here — I can do 4,800 pcs.'))).statusCode).toBe(302);

      const rows = await inSandbox((tx) => sql<{ origin: string; status: string; provider_message_id: string | null }>`
        select origin, status, provider_message_id from outbound_messages where conversation_id=${cid} order by seq desc
      `.execute(tx as never).then((r) => r.rows));
      expect(rows.length - before).toBe(1);            // exactly one — no second send path
      expect(rows[0]!.origin).toBe('owner');           // via enqueueOutboundRow(origin='owner')
      expect(rows[0]!.provider_message_id).toBeNull(); // NO real delivery — no provider ever saw it
      expect(await events('owner_reply')).toBeGreaterThanOrEqual(1);

      const cookie = await login();
      const page = await prod.app.inject({ method: 'GET', url: '/app/sandbox', headers: { cookie } });
      expect(page.body).toContain('Owner here — I can do 4,800 pcs.');   // sunk into the transcript
    });

    it('return to the employee: back to AI + a resume_ai event; take-over offered again', async () => {
      expect((await post('resume')).statusCode).toBe(302);
      expect(await assigned()).toBeNull();
      expect(await events('resume_ai')).toBeGreaterThanOrEqual(1);

      const cookie = await login();
      const page = await prod.app.inject({ method: 'GET', url: '/app/sandbox', headers: { cookie } });
      expect(page.body).toContain('action="/app/sandbox/takeover"');
    });

    it('NO real delivery: the sandbox tenant still has no channel credential', async () => {
      const n = await inSandbox((tx) => sql<{ n: number }>`select count(*)::int n from channel_credentials where business_id=${SANDBOX}`.execute(tx as never).then((r) => r.rows[0]!.n));
      expect(n).toBe(0);
    });

    it('TENANT ISOLATION: the rehearsal touched no pilot conversation', async () => {
      const { withTenantTx } = await import('../../src/db/client.js');
      const { parseBusinessId } = await import('../../src/core/types/ids.js');
      const p = parseBusinessId(DEMO_BIZ); if (!p.ok) throw new Error('fixture');
      const leaked = await withTenantTx(prod.db, p.value, (tx) => sql<{ n: number }>`
        select count(*)::int n from outbound_messages
         where business_id=${DEMO_BIZ} and body like 'Owner here — I can do 4,800%'
      `.execute(tx as never).then((r) => r.rows[0]!.n));
      expect(leaked).toBe(0);
    });

    it('the M16.2d runbook now observes all three rehearsals as practiced', async () => {
      const { loadPilotRunbook } = await import('../../src/api/web/pilot.js');
      const rb = await loadPilotRunbook(prod.db, DEMO_BIZ, { sandboxBusinessId: SANDBOX });
      expect(rb.rehearsal.done.takeover).toBe(true);
      expect(rb.rehearsal.done.ownerReply).toBe(true);
      expect(rb.rehearsal.done.resume).toBe(true);
    });
  });

  // ── M17.1 deployment visibility: authenticated only, never on /health ───────
  describe('M17.1 · deployment visibility', () => {
    it('/health stays a minimal PUBLIC probe — no commit, branch, or version', async () => {
      const res = await prod.app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      // exactly these keys — adding build info here would leak it publicly
      expect(Object.keys(res.json() as object).sort()).toEqual(['db', 'ok', 'provider', 'worker']);
      const body = res.body.toLowerCase();
      for (const leak of ['commit', 'sha', 'branch', 'version', 'railway']) {
        expect(body.includes(leak), `/health leaks "${leak}"`).toBe(false);
      }
    });

    it('the owner surface DOES show which build is running (behind login)', async () => {
      const cookie = await login();
      const res = await prod.app.inject({ method: 'GET', url: '/app/onboarding', headers: { cookie } });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('This installation');
      expect(res.body).toContain('Running version');
      expect(res.body).toContain('Environment');
    });

    it('and it is NOT reachable without a session', async () => {
      const res = await prod.app.inject({ method: 'GET', url: '/app/onboarding' });
      expect(res.statusCode).toBe(302);
      expect(res.headers['location']).toBe('/login');
    });
  });

  // ── M16.2d Pilot operations runbook (loadPilotRunbook read model) ───────────
  // Composes M15 readiness + M16.2a operations + a rehearsal derived from
  // existing events (sandbox conversation_events + a pilot owner-corrected fact +
  // M15 validation). No new storage; the integration seeds the events and checks
  // the runbook reflects them.
  describe('M16.2d · pilot operations runbook (over real data)', () => {
    const SANDBOX = '5a4d0000-0000-4000-8000-0000000000b1';
    const ZERO = '00000000-0000-0000-0000-000000000000';
    let bid: import('../../src/core/types/ids.js').BusinessId;
    let sbid: import('../../src/core/types/ids.js').BusinessId;
    const load = () => import('../../src/api/web/pilot.js').then(({ loadPilotRunbook }) => loadPilotRunbook);

    beforeAll(async () => {
      const { parseBusinessId } = await import('../../src/core/types/ids.js');
      const p = parseBusinessId(DEMO_BIZ); if (!p.ok) throw new Error('fixture'); bid = p.value;
      const s = parseBusinessId(SANDBOX); if (!s.ok) throw new Error('fixture'); sbid = s.value;
    });

    it('empty / unknown factory: nothing detected, no rehearsal complete, no sandbox', async () => {
      const rb = await (await load())(prod.db, ZERO, {});
      expect(Object.values(rb.readiness.detected).every((v) => v === false)).toBe(true);
      expect(rb.rehearsal.completed).toBe(0);
      expect(rb.rehearsal.available).toBe(false);        // no sandbox tenant passed
      expect(rb.operations.hasAttention).toBe(false);
      expect(rb.rehearsal.total).toBe(5);
    });

    it('M15 validation all-pass → validationPassed ✓ (and the readiness Sandbox item flips)', async () => {
      const { withTenantTx } = await import('../../src/db/client.js');
      await withTenantTx(prod.db, bid, (tx) => sql`
        insert into onboarding_state (business_id, last_validation_at, last_validation_pass, last_validation_total)
        values (${DEMO_BIZ}, now(), 5, 5)
        on conflict (business_id) do update set last_validation_at = now(),
          last_validation_pass = 5, last_validation_total = 5, updated_at = now()
      `.execute(tx as never));
      const rb = await (await load())(prod.db, DEMO_BIZ, { sandboxBusinessId: SANDBOX });
      expect(rb.rehearsal.done.validationPassed).toBe(true);
      expect(rb.readiness.detected.sandbox).toBe(true);
    });

    it('sandbox takeover + owner_reply events → those rehearsals ✓ (read from the sandbox tenant)', async () => {
      const { withTenantTx } = await import('../../src/db/client.js');
      await withTenantTx(prod.db, sbid, async (tx) => {
        for (const type of ['takeover', 'owner_reply']) {
          await sql`insert into conversation_events (business_id, conversation_id, type, payload)
                    values (${SANDBOX}, gen_random_uuid(), ${type}, ${JSON.stringify({ actor: 'owner' })}::jsonb)`.execute(tx as never);
        }
      });
      const rb = await (await load())(prod.db, DEMO_BIZ, { sandboxBusinessId: SANDBOX });
      expect(rb.rehearsal.done.takeover).toBe(true);
      expect(rb.rehearsal.done.ownerReply).toBe(true);
      // "not practiced stays ○" is proven against an empty sandbox in the
      // isolation test below — asserting it here would depend on whether an
      // earlier describe rehearsed a hand-back in this same sandbox tenant.
    });

    it('an owner-corrected knowledge fact → correction rehearsal ✓ (pilot tenant)', async () => {
      const { withTenantTx } = await import('../../src/db/client.js');
      await withTenantTx(prod.db, bid, (tx) => sql`
        insert into product_knowledge (business_id, product_id, kind, label, content, source)
        values (${DEMO_BIZ}, null, 'faq', 'rehearsal', 'a corrected fact', 'owner_corrected')
      `.execute(tx as never));
      const rb = await (await load())(prod.db, DEMO_BIZ, { sandboxBusinessId: SANDBOX });
      expect(rb.rehearsal.done.knowledgeCorrection).toBe(true);
    });

    it('during-pilot operations equal the real snapshot (composed, not recomputed)', async () => {
      const [rb, snap] = await Promise.all([
        (await load())(prod.db, DEMO_BIZ, { sandboxBusinessId: SANDBOX, range: 'week' }),
        import('../../src/api/web/operations.js').then(({ loadOperationsSnapshot }) => loadOperationsSnapshot(prod.db, DEMO_BIZ, 'week', 'disabled')),
      ]);
      expect(rb.operations).toEqual(snap);
    });

    it('M17.6 feedback: counts + timestamps from stored signals/events, no invented metric', async () => {
      const { loadPilotFeedback } = await import('../../src/api/web/pilot.js');
      const { withTenantTx } = await import('../../src/db/client.js');
      const { tenantRepos } = await import('../../src/db/repos.js');
      const { ensureConversation } = await import('../../src/db/channels.js');

      const before = await loadPilotFeedback(prod.db, DEMO_BIZ, 'month');
      const beforeHuman = before.handoffReasons.find((r) => r.kind === 'human_requested')?.count ?? 0;

      await withTenantTx(prod.db, bid, async (tx) => {
        const c = await ensureConversation(tx, bid, '971500006666', 'Feedback Buyer');
        await tenantRepos(tx, bid).signals.record(c.conversationId as never, { kind: 'human_requested' });
      });

      const after = await loadPilotFeedback(prod.db, DEMO_BIZ, 'month');
      const item = after.handoffReasons.find((r) => r.kind === 'human_requested');
      expect(item, 'human_requested surfaced').toBeDefined();
      expect(item!.count).toBe(beforeHuman + 1);            // a real count, +1 for what we created
      expect(item!.lastAt).toBeInstanceOf(Date);            // a real timestamp
      expect(after.hasActivity).toBe(true);

      // recurring issues are ordered by how often they occurred — not scored
      const counts = after.handoffReasons.map((r) => r.count);
      expect([...counts].sort((a, b) => b - a)).toEqual(counts);

      // the shape carries no judgement of quality
      const blob = JSON.stringify(after).toLowerCase();
      for (const banned of ['score', 'rating', 'quality', 'percent', 'confidence']) {
        expect(blob.includes(banned), banned).toBe(false);
      }
    });

    it('M17.6 feedback: an unknown factory is honestly empty, and it writes nothing', async () => {
      const { loadPilotFeedback } = await import('../../src/api/web/pilot.js');
      const f = await loadPilotFeedback(prod.db, '00000000-0000-0000-0000-000000000000', 'month');
      expect(f.hasActivity).toBe(false);
      expect(f.handoffReasons).toEqual([]);
      expect(f.ownerActions).toEqual([]);
      expect(f.lastActivityAt).toBeNull();
    });

    it('TENANT ISOLATION: a pilot pointed at a different sandbox sees none of that rehearsal', async () => {
      const rb = await (await load())(prod.db, DEMO_BIZ, { sandboxBusinessId: ZERO });
      expect(rb.rehearsal.done.takeover).toBe(false);      // the SANDBOX events do not leak
      expect(rb.rehearsal.done.ownerReply).toBe(false);
      expect(rb.rehearsal.available).toBe(true);           // a sandbox id was supplied, just an empty one
    });
  });

  // ── M18.2 pilot allowlist, against real Postgres ────────────────────────────
  // The rule that stands between a bug and a real buyer's phone. Every check
  // here goes through the REAL send gate and the REAL store — no fakes.
  describe('M18.2 · pilot allowlist', () => {
    const ALLOWED = '971500001111';
    const BLOCKED = '971500002222';
    let bid: import('../../src/core/types/ids.js').BusinessId;
    const q = <T>(fn: (tx: import('kysely').Transaction<never>) => Promise<T>): Promise<T> =>
      import('../../src/db/client.js').then(({ withTenantTx }) => withTenantTx(prod.db, bid, fn as never));

    // A send that reaches the simulator is a send that WOULD have gone to a
    // real buyer — exactly what the allowlist must prevent.
    beforeAll(async () => {
      const { parseBusinessId } = await import('../../src/core/types/ids.js');
      const p = parseBusinessId(DEMO_BIZ); if (!p.ok) throw new Error('fixture'); bid = p.value;
      // Put the demo channel in pilot mode explicitly (it is the default too).
      await q((tx) => sql`update channels set pilot_mode = true where business_id=${DEMO_BIZ}`.execute(tx as never));
    });

    it('owner adds a number: normalized on the way in, and audited', async () => {
      const { addToAllowlist, listAllowlist } = await import('../../src/channels/allowlist.js');
      const r = await addToAllowlist(prod.db, bid, '+971 50 000 1111', 'my phone', 'owner');
      expect(r).toEqual({ ok: true, phone: ALLOWED });          // stored as digits

      const list = await listAllowlist(prod.db, bid);
      expect(list.find((e) => e.phone === ALLOWED)?.label).toBe('my phone');

      const audits = await q((tx) => sql<{ n: number }>`
        select count(*)::int n from channel_audit
         where business_id=${DEMO_BIZ} and action='allowlist_add'`.execute(tx as never).then((x) => x.rows[0]!.n));
      expect(audits).toBeGreaterThanOrEqual(1);
    });

    it('rejects an unusable number instead of storing something unmatchable', async () => {
      const { addToAllowlist } = await import('../../src/channels/allowlist.js');
      expect(await addToAllowlist(prod.db, bid, 'not-a-phone', null, 'owner'))
        .toEqual({ ok: false, code: 'invalid_phone' });
    });

    it('ALLOWED number: the gate lets it through and the message is sent', async () => {
      const { withTenantTx } = await import('../../src/db/client.js');
      const { ensureConversation, enqueueOutboundRow, channelStore } = await import('../../src/db/channels.js');
      const { driveConversationOutbound } = await import('../../src/outbound/worker.js');

      const cid = await withTenantTx(prod.db, bid, async (tx) => {
        const c = await ensureConversation(tx, bid, ALLOWED, 'Allowed Buyer');
        await sql`update conversations set assigned_to=null where id=${c.conversationId}`.execute(tx as never);
        await sql`insert into messages (conversation_id, direction, input_type, text_content, sent_at)
                  values (${c.conversationId},'inbound','text','hello',now())`.execute(tx as never);
        // the 24h window reads channels.last_inbound_at — open it, so this test
        // isolates the ALLOWLIST decision rather than re-testing the window
        await sql`update channels set last_inbound_at=now() where business_id=${DEMO_BIZ}`.execute(tx as never);
        await enqueueOutboundRow(tx, bid, c.conversationId, 'Reply to an allowlisted buyer', 'employee');
        return c.conversationId;
      });

      const effects = await withTenantTx(prod.db, bid, (tx) =>
        driveConversationOutbound(
          { store: channelStore(tx as never, bid), adapter: m18Adapter, now: () => new Date() }, cid));
      expect(effects.some((e) => e.kind === 'sent'), JSON.stringify(effects)).toBe(true);
    });

    it('BLOCKED number: refused at send time, canceled, audited — never delivered', async () => {
      const { withTenantTx } = await import('../../src/db/client.js');
      const { ensureConversation, enqueueOutboundRow, channelStore } = await import('../../src/db/channels.js');
      const { driveConversationOutbound } = await import('../../src/outbound/worker.js');

      const before = await q((tx) => sql<{ n: number }>`
        select count(*)::int n from channel_audit
         where business_id=${DEMO_BIZ} and action='blocked_not_allowlisted'`.execute(tx as never).then((x) => x.rows[0]!.n));

      const cid = await withTenantTx(prod.db, bid, async (tx) => {
        const c = await ensureConversation(tx, bid, BLOCKED, 'Not Allowlisted');
        await sql`update conversations set assigned_to=null where id=${c.conversationId}`.execute(tx as never);
        await sql`insert into messages (conversation_id, direction, input_type, text_content, sent_at)
                  values (${c.conversationId},'inbound','text','hello',now())`.execute(tx as never);
        // the 24h window reads channels.last_inbound_at — open it, so this test
        // isolates the ALLOWLIST decision rather than re-testing the window
        await sql`update channels set last_inbound_at=now() where business_id=${DEMO_BIZ}`.execute(tx as never);
        await enqueueOutboundRow(tx, bid, c.conversationId, 'This must never reach a real buyer', 'employee');
        return c.conversationId;
      });

      const effects = await withTenantTx(prod.db, bid, (tx) =>
        driveConversationOutbound(
          { store: channelStore(tx as never, bid), adapter: m18Adapter, now: () => new Date() }, cid));

      expect(effects).toContainEqual(expect.objectContaining({ kind: 'canceled', reason: 'not_allowlisted' }));
      expect(effects.some((e) => e.kind === 'sent')).toBe(false);       // nothing left the building

      // the row is canceled, not silently dropped or left queued
      const row = await q((tx) => sql<{ status: string }>`
        select status from outbound_messages where conversation_id=${cid} order by seq desc limit 1
      `.execute(tx as never).then((x) => x.rows[0]!));
      expect(row.status).toBe('canceled');

      // and the refusal is visible to the owner
      const after = await q((tx) => sql<{ n: number }>`
        select count(*)::int n from channel_audit
         where business_id=${DEMO_BIZ} and action='blocked_not_allowlisted'`.execute(tx as never).then((x) => x.rows[0]!.n));
      expect(after).toBe(before + 1);

      // the transition trail records WHY — no silent drop
      const trail = await q((tx) => sql<{ detail: string | null }>`
        select t.detail from outbound_transitions t
          join outbound_messages o on o.id = t.outbound_id
         where o.conversation_id=${cid} order by t.id desc limit 1
      `.execute(tx as never).then((x) => x.rows[0]));
      expect(trail?.detail ?? '').toContain('not_allowlisted');
    });

    it('archiving a number blocks it again — and never deletes the record', async () => {
      const { addToAllowlist, archiveFromAllowlist, listAllowlist, activeAllowlistCount } =
        await import('../../src/channels/allowlist.js');
      const TEMP = '971500003333';
      await addToAllowlist(prod.db, bid, TEMP, 'temporary', 'owner');
      const activeBefore = await activeAllowlistCount(prod.db, bid);

      expect(await archiveFromAllowlist(prod.db, bid, TEMP, 'owner')).toEqual({ ok: true, phone: TEMP });
      expect(await activeAllowlistCount(prod.db, bid)).toBe(activeBefore - 1);

      // archived, not gone — the history survives
      const entry = (await listAllowlist(prod.db, bid)).find((e) => e.phone === TEMP);
      expect(entry).toBeDefined();
      expect(entry!.archivedAt).toBeInstanceOf(Date);

      // archiving twice is honest about it
      expect(await archiveFromAllowlist(prod.db, bid, TEMP, 'owner')).toEqual({ ok: false, code: 'not_found' });
    });

    it('TENANT ISOLATION: one factory\'s allowlist never authorises another\'s send', async () => {
      const { isAllowlisted } = await import('../../src/channels/allowlist.js');
      const { withTenantTx } = await import('../../src/db/client.js');
      const { parseBusinessId } = await import('../../src/core/types/ids.js');
      const other = parseBusinessId('5a4d0000-0000-4000-8000-0000000000b1');
      if (!other.ok) throw new Error('fixture');

      // allowed for DEMO…
      expect(await withTenantTx(prod.db, bid, (tx) => isAllowlisted(tx, bid, ALLOWED))).toBe(true);
      // …and NOT for the sandbox tenant, which never listed it
      expect(await withTenantTx(prod.db, other.value, (tx) => isAllowlisted(tx, other.value, ALLOWED))).toBe(false);
    });
  });

  // ── M18.1 activation + M18.4 rollback drill, against real Postgres ─────────
  // Activation is a GATE, not a display: it refuses until the factory is
  // genuinely ready. The drill then proves the rollback ladder for real —
  // enable → send → disable → verify blocked → restore — with no fake state.
  describe('M18.1/M18.4 · activation and the rollback drill', () => {
    const BUYER = '971500004444';
    let bid: import('../../src/core/types/ids.js').BusinessId;
    const q = <T>(fn: (tx: import('kysely').Transaction<never>) => Promise<T>): Promise<T> =>
      import('../../src/db/client.js').then(({ withTenantTx }) => withTenantTx(prod.db, bid, fn as never));
    const audits = (action: string) => q((tx) => sql<{ n: number }>`
      select count(*)::int n from channel_audit where business_id=${DEMO_BIZ} and action=${action}
    `.execute(tx as never).then((r) => r.rows[0]!.n));

    // Every precondition is established HERE so no test depends on a sibling
    // having run first; the refusal tests restore whatever they break.
    beforeAll(async () => {
      const { parseBusinessId } = await import('../../src/core/types/ids.js');
      const { addToAllowlist } = await import('../../src/channels/allowlist.js');
      const p = parseBusinessId(DEMO_BIZ); if (!p.ok) throw new Error('fixture'); bid = p.value;

      await q((tx) => sql`
        insert into onboarding_state (business_id, backup_tested_at, secrets_rotated_at, owner_ready_at,
                                      claims_reviewed_at, last_validation_at, last_validation_pass, last_validation_total)
        values (${DEMO_BIZ}, now(), now(), now(), now(), now(), 5, 5)
        on conflict (business_id) do update set backup_tested_at=now(), secrets_rotated_at=now(),
          owner_ready_at=now(), claims_reviewed_at=now(), last_validation_at=now(),
          last_validation_pass=5, last_validation_total=5`.execute(tx as never));
      await q((tx) => sql`update businesses set description='d', location='l', contact_email='e@x.com'
                           where id=${DEMO_BIZ}`.execute(tx as never));
      await q((tx) => sql`
        insert into product_knowledge (business_id, product_id, kind, label, content, source)
        values (${DEMO_BIZ}, null, 'faq', 'activation-fixture', 'a taught fact', 'owner_confirmed')
        on conflict do nothing`.execute(tx as never));
      await q((tx) => sql`update products set is_active=true,
                            price_usd_per_unit=coalesce(price_usd_per_unit, 1.00)
                           where business_id=${DEMO_BIZ}`.execute(tx as never));
      await q((tx) => sql`
        insert into channels (business_id, kind, status, pilot_mode)
        values (${DEMO_BIZ}, 'whatsapp', 'connected', true)
        on conflict (business_id, kind) do update set status='connected', pilot_mode=true`.execute(tx as never));
      await addToAllowlist(prod.db, bid, BUYER, 'friendly buyer', 'owner');
    });

    it('REFUSES while the factory is not ready — and names the reason', async () => {
      const { activate, activationPreconditions } = await import('../../src/channels/activation.js');
      // clear the rotation confirmation so the M18.0 gate is unmet
      await q((tx) => sql`
        insert into onboarding_state (business_id, secrets_rotated_at) values (${DEMO_BIZ}, null)
        on conflict (business_id) do update set secrets_rotated_at = null`.execute(tx as never));

      const pre = await activationPreconditions(prod.db, bid);
      expect(pre.blockers.length).toBeGreaterThan(0);
      expect(pre.blockers).toContain('secrets_not_rotated');   // the M18.0 gate holds

      const r = await activate(prod.db, bid, 'owner');
      expect(r.ok).toBe(false);
      // nothing was activated by a refused attempt
      const { activationState } = await import('../../src/channels/activation.js');
      expect((await activationState(prod.db, bid)).activatedAt).toBeNull();

      // restore the precondition this test deliberately broke
      await q((tx) => sql`update onboarding_state set secrets_rotated_at=now()
                           where business_id=${DEMO_BIZ}`.execute(tx as never));
    });

    it('REFUSES with an empty allowlist even when everything else is ready', async () => {
      const { activationPreconditions } = await import('../../src/channels/activation.js');
      const { archiveFromAllowlist, listAllowlist, addToAllowlist } = await import('../../src/channels/allowlist.js');

      for (const e of await listAllowlist(prod.db, bid)) {
        if (!e.archivedAt) await archiveFromAllowlist(prod.db, bid, e.phone, 'test');
      }
      const pre = await activationPreconditions(prod.db, bid);
      expect(pre.allowlistCount).toBe(0);
      expect(pre.blockers).toContain('no_allowlist');

      // restore: the drill below needs a reachable buyer
      await addToAllowlist(prod.db, bid, BUYER, 'friendly buyer', 'owner');
    });

    it('DRILL 1 — enable: activation succeeds, is audited, and keeps pilot mode ON', async () => {
      const { activate, activationState } = await import('../../src/channels/activation.js');
      const before = await audits('activate');
      const r = await activate(prod.db, bid, 'owner');
      expect(r, JSON.stringify(r)).toMatchObject({ ok: true });

      const state = await activationState(prod.db, bid);
      expect(state.activatedAt).toBeInstanceOf(Date);
      expect(state.pilotMode).toBe(true);          // activation starts a CONTROLLED pilot
      expect(await audits('activate')).toBe(before + 1);
    });

    it('DRILL 2 — test: an allowlisted buyer receives; a stranger never does', async () => {
      const { withTenantTx } = await import('../../src/db/client.js');
      const { ensureConversation, enqueueOutboundRow, channelStore } = await import('../../src/db/channels.js');
      const { driveConversationOutbound } = await import('../../src/outbound/worker.js');
      const drive = async (wa: string, body: string) => {
        const cid = await withTenantTx(prod.db, bid, async (tx) => {
          const c = await ensureConversation(tx, bid, wa, `Drill ${wa}`);
          await sql`update conversations set assigned_to=null where id=${c.conversationId}`.execute(tx as never);
          await sql`update channels set last_inbound_at=now() where business_id=${DEMO_BIZ}`.execute(tx as never);
          await enqueueOutboundRow(tx, bid, c.conversationId, body, 'employee');
          return c.conversationId;
        });
        return withTenantTx(prod.db, bid, (tx) =>
          driveConversationOutbound({ store: channelStore(tx as never, bid), adapter: m18Adapter, now: () => new Date() }, cid));
      };

      const allowed = await drive(BUYER, 'hello allowlisted buyer');
      expect(allowed.some((e) => e.kind === 'sent'), JSON.stringify(allowed)).toBe(true);
      const stranger = await drive('971509999999', 'MUST NEVER BE DELIVERED');
      expect(stranger).toContainEqual(expect.objectContaining({ kind: 'canceled', reason: 'not_allowlisted' }));
      expect(stranger.some((e) => e.kind === 'sent')).toBe(false);
    });

    it('DRILL 3 — disable: outbound to a PREVIOUSLY WORKING buyer is now blocked', async () => {
      const { deactivate, activationState } = await import('../../src/channels/activation.js');
      const { withTenantTx } = await import('../../src/db/client.js');
      const { ensureConversation, enqueueOutboundRow, channelStore } = await import('../../src/db/channels.js');
      const { driveConversationOutbound } = await import('../../src/outbound/worker.js');
      const before = await audits('deactivate');
      await deactivate(prod.db, bid, 'owner', 'drill');
      expect(await audits('deactivate')).toBe(before + 1);
      const state = await activationState(prod.db, bid);
      expect(state.activatedAt).toBeNull();
      expect(state.status).toBe('disconnected');

      // the SAME allowlisted buyer that just worked must now be refused
      const cid = await withTenantTx(prod.db, bid, async (tx) => {
        const c = await ensureConversation(tx, bid, BUYER, 'Drill buyer');
        await sql`update conversations set assigned_to=null where id=${c.conversationId}`.execute(tx as never);
        await enqueueOutboundRow(tx, bid, c.conversationId, 'after deactivation', 'employee');
        return c.conversationId;
      });
      const effects = await withTenantTx(prod.db, bid, (tx) =>
        driveConversationOutbound(
          { store: channelStore(tx as never, bid), adapter: m18Adapter, now: () => new Date() }, cid));
      expect(effects.some((e) => e.kind === 'sent'), JSON.stringify(effects)).toBe(false);

      // nothing was destroyed by the rollback — the allowlist survives
      const { activeAllowlistCount } = await import('../../src/channels/allowlist.js');
      expect(await activeAllowlistCount(prod.db, bid)).toBeGreaterThanOrEqual(1);
    });

    it('DRILL 4 — restore: reconnect + re-activate, and sending resumes', async () => {
      const { activate, activationState } = await import('../../src/channels/activation.js');
      await q((tx) => sql`update channels set status='connected', connected_at=now(), disconnected_at=null
                           where business_id=${DEMO_BIZ}`.execute(tx as never));
      const r = await activate(prod.db, bid, 'owner');
      expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
      const state = await activationState(prod.db, bid);
      expect(state.activatedAt).toBeInstanceOf(Date);
      expect(state.status).toBe('connected');
    });

    it('the whole drill is reconstructable from the audit trail', async () => {
      const trail = await q((tx) => sql<{ action: string }>`
        select action from channel_audit where business_id=${DEMO_BIZ}
           and action in ('activate','deactivate') order by at asc, id asc
      `.execute(tx as never).then((r) => r.rows.map((x) => x.action)));
      // enable → disable → restore, in order, with nothing invented
      expect(trail).toContain('activate');
      expect(trail).toContain('deactivate');
      expect(trail.lastIndexOf('activate')).toBeGreaterThan(trail.indexOf('deactivate'));
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
