import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DEMO_NAMESPACE, demoPhone } from '../../src/demo/factory.js';
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

/**
 * M22 — ONE TENANT PER RUN.
 *
 * This suite drives the real product: it activates channels, resolves drafts,
 * takes conversations over and sends messages. All of that persists. Run twice
 * against one database and ten assertions failed with errors that read exactly
 * like regressions — "expected 2 to be 3" — costing a diagnostic detour every
 * time. The suite was not wrong; it was not repeatable.
 *
 * Every demo id derives from an eight-hex-character namespace, so a run can
 * seed a factory of its own and leave the shared demo alone. That needs the
 * migrate role (RLS refuses a new `businesses` row to the app role, correctly),
 * so it happens only when MIGRATE_DATABASE_URL is available. Without it the run
 * falls back to the shared demo tenant — the old behaviour, now named.
 */
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const RUN_NS = MIGRATE_URL
  ? `f${Date.now().toString(16).slice(-7)}`      // 8 hex chars, unique per run
  : DEMO_NAMESPACE;
const DEMO_BIZ = `${RUN_NS}-0000-4000-8000-0000000000b1`;
const nsId = (suffix: string) => `${RUN_NS}-0000-4000-8000-${suffix}`;
/** channel_credentials.external_ref is unique across ALL tenants, like the
 *  simulator's phone-number id — so a fixture ref is run-scoped too. */
const M203_REF = `m203-ref-${RUN_NS}`;
/** A test phone number in this run's own block, so client_channels — UNIQUE on
 *  (channel, channel_user_id) GLOBALLY — cannot collide with a previous run. */
const ph = (n: string) => demoPhone(n, RUN_NS);

beforeAll(async () => {
  if (!DATABASE_URL || !MIGRATE_URL) return;
  // `buildProduction` resolves the owner's tenant from process.env, not from
  // the cfg it is handed (same gap that cost a harness restart in M21), so the
  // web surfaces would otherwise operate on the shared demo while the direct
  // database assertions looked at this run's tenant.
  process.env['PILOT_BUSINESS_ID'] = DEMO_BIZ;
  const { demoSeedSql } = await import('../../src/demo/factory.js');
  const { demoTrustSeedSql } = await import('../../src/demo/trust.js');
  const pg = (await import('pg')).default;
  const client = new pg.Client({ connectionString: MIGRATE_URL });
  await client.connect();
  try {
    await client.query('begin');
    await client.query(demoSeedSql(RUN_NS));
    await client.query(demoTrustSeedSql(RUN_NS));
    await client.query('commit');
  } catch (e) { await client.query('rollback'); throw e; }
  finally { await client.end(); }
}, 60_000);

d('production boot-and-probe (requires DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');

    // Built first: its phone_number_id is the credential's external_ref, which
    // Postgres holds unique across ALL tenants, so it has to be this run's.
    sim = whatsappSimulator([], { tag: RUN_NS });

    // The simulator's phone_number_id must resolve to THIS run's tenant.
    const setup = createDb(DATABASE_URL!);
    const bid = parseBusinessId(DEMO_BIZ);
    if (!bid.ok) throw new Error('fixture');
    await withTenantTx(setup, bid.value, (tx) => sql`
      insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
      values (${DEMO_BIZ}, 'whatsapp', ${sim.phoneNumberId}, 'sim-test', 'service')
      on conflict (channel, external_ref) do nothing
    `.execute(tx));
    await setup.destroy();
    prod = await buildProduction({
      provider: 'meta',
      DATABASE_URL: DATABASE_URL!,
      ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok',
      META_WHATSAPP_PHONE_NUMBER_ID: `1${ph('2345678901234')}5`,
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
      sql`update businesses set owner_locale='en', owner_phone=${'+' + ph('8613800000001')} where id=${parsed.value}`.execute(tx));

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
  // ONE simulator for this whole describe: whatsappSimulator([], { tag: RUN_NS }) restarts its
  // wamid counter per instance and outbound_messages.provider_message_id is
  // UNIQUE, so separate instances collide on the second send.
  let m18Adapter: import('../../src/channels/contract.js').ChannelAdapter;
  let m18Sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  beforeAll(async () => {
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    m18Sim = whatsappSimulator([], { tag: RUN_NS });
    m18Adapter = m18Sim.adapter;
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
    // Phase B: the attention section states either the real work or the calm
    // truth. M22 (F-01) added a THIRD honest state — messaging off, so nobody
    // can reach her — and this run's tenant is freshly seeded and not live, so
    // that is the one it lands on. Before the per-run tenant, this assertion
    // passed because leftover state from earlier runs kept work on the page.
    expect(home.body).toMatch(/Needs your attention|Nothing needs you|No buyer can reach/);
    expect(home.body).toContain('What Lily did');        // Phase B activity section
    expect(home.body).toMatch(/Buyers she talked to/);    // M16.2b employee-activity fact
    const inbox = await prod.app.inject({ method: 'GET', url: '/app/inbox', headers: { cookie } });
    expect(inbox.statusCode).toBe(200);
    expect(inbox.body).toContain('Buyers');            // English default
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
    // M22 (F-01): a freshly-seeded, not-yet-live factory lands on the third
    // honest state rather than the attention list. Either is correct here; what
    // is asserted is that the page is LOCALIZED, which was always the point.
    expect(zhHome.body).toMatch(/需要你处理|买家现在还找不到/);   // M16.2b Operations Home, localized
  });

  it('M9.3 inbox: opens a real conversation; unknown/foreign id → 404, no leak', async () => {
    const cookie = await login();
    // Demo conversation 302 (Sara / canvas bags) exists for the demo business.
    const detail = await prod.app.inject({ method: 'GET',
      url: `/app/inbox/${RUN_NS}-0000-4000-8000-000000000302`, headers: { cookie } });
    expect(detail.statusCode).toBe(200);
    expect(detail.body).toContain('Conversation');   // English default

    const unknown = await prod.app.inject({ method: 'GET',
      url: `/app/inbox/${RUN_NS}-0000-4000-8000-0000000009ff`, headers: { cookie } });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.body).toContain('Conversation not found');
    // Never reveals whether the id exists in another tenant.
    expect(unknown.body).not.toContain('bb000000');
  });

  it('M9.3: pending draft renders and the action loop resolves it via applyOwnerCommand', async () => {
    const { sql } = await import('kysely');
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const CONV = nsId('000000000302');
    const parsed = parseBusinessId(DEMO_BIZ);
    if (!parsed.ok) throw new Error('fixture');
    const bidv = parsed.value;

    // Seed a pending draft (turn_message_id null; the real pipeline FKs it).
    const draftId = await withTenantTx(prod.db, bidv, (tx) => sql<{ id: string }>`
      insert into drafts (business_id, conversation_id, capability, draft_text, turn_message_id, status)
      values (${bidv}, ${CONV}, 'quote', 'Draft reply from 小雅', null, 'pending')
      returning id`.execute(tx).then((r) => r.rows[0]!.id));

    const cookie = await login();
    const before = await prod.app.inject({ method: 'GET', url: `/app/inbox/${CONV}`, headers: { cookie } });
    expect(before.body).toContain('Review her reply');              // Phase D: a colleague's work
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
    expect(res.body).toContain('WhatsApp');        // English default
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
    const parsed = parseBusinessId(DEMO_BIZ);
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
      url: `/app/products/${RUN_NS}-0000-4000-8000-000000000101`, headers: { cookie } });
    expect(detail.statusCode).toBe(200);
    expect(detail.body).toContain('Pricing');
    expect(detail.body).toContain('What buyers call it');   // aliases
    expect(detail.body).toContain('canvas bag');

    const missing = await prod.app.inject({ method: 'GET',
      url: `/app/products/${RUN_NS}-0000-4000-8000-0000000009ff`, headers: { cookie } });
    expect(missing.body).toContain('Product not found');
  });

  it('M29 TRUST RULE: nothing is sellable until a HUMAN states the floor', async () => {
    const { sql } = await import('kysely');
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const parsed = parseBusinessId(DEMO_BIZ);
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
    // M29 — this used to assert `priced → active`, because the importer wrote a
    // pricing_policy row itself: floor = the list price, no discount authority.
    // That rule was fabricated, and a quote clamped against it is not "within
    // the owner's own price rules". Now BOTH halves must come from a human, so
    // a priced product is still pending until she says what she would accept.
    expect(await activeOf('独家测试杯')).toBe(false);     // priced, but no floor stated
    expect(await activeOf('神秘无价样品')).toBe(false);   // no price either

    // And the importer wrote no rule of its own for either of them.
    const policiesFor = (name: string) => withTenantTx(prod.db, bidv, (tx) =>
      sql<{ n: number }>`select count(*)::int n from pricing_policy pp
        join products pr on pr.id = pp.product_id
       where pr.business_id=${bidv} and pr.name=${name}`.execute(tx).then((r) => Number(r.rows[0]!.n)));
    expect(await policiesFor('独家测试杯')).toBe(0);

    // The owner answers the three questions, and THAT is what turns it on.
    const { savePriceRules } = await import('../../src/api/web/priceRules.js');
    const pid = await withTenantTx(prod.db, bidv, (tx) =>
      sql<{ id: string }>`select id from products where business_id=${bidv} and name='独家测试杯'
        order by created_at desc limit 1`.execute(tx).then((r) => r.rows[0]!.id));
    const saved = await savePriceRules(prod.db, DEMO_BIZ, 'owner',
      { productId: pid, floorUsd: '3.50', maxDiscountPct: '10', askAbovePct: '7' });
    expect(saved.ok).toBe(true);
    expect(await activeOf('独家测试杯')).toBe(true);      // her answer, not ours

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
    expect(res.body).toContain('<h1 class="page">Lily</h1>');  // Phase C: the page IS her
    expect(res.body).toContain('What she handles on her own');  // Phase C
    expect(res.body).toContain('She handles this herself');   // Phase C: permission wording
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
    const parsed = parseBusinessId(DEMO_BIZ);
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
    const parsed = parseBusinessId(DEMO_BIZ);
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
      url: `/app/conversations/${RUN_NS}-0000-4000-8000-000000000301`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Ahmed Al-Rashid');
    expect(res.body).toContain('Customer file');
    expect(res.body).toContain('First contact');
    expect(res.body).toContain('History');
  });

  it('M9.7 conversations: unknown id 404s without revealing existence', async () => {
    const cookie = await login();
    const res = await prod.app.inject({ method: 'GET',
      url: `/app/conversations/${RUN_NS}-0000-4000-8000-0000000009ff`, headers: { cookie } });
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
    expect(res.body).toContain('Results');   // English default
    expect(res.body).toContain('Overview');
    expect(res.body).toContain('New customers');
    expect(res.body).toContain('Activity');
    expect(res.body).toContain("Lily's work");
    // No fabricated chart. Scoped to <main> because the shell's own header
    // inlines the brand mark as an <svg>: this assertion read the WHOLE page
    // and silently became false the moment the real logo landed, which nobody
    // saw because the integration suite does not run without DATABASE_URL.
    // The rule is unchanged — the page still may not draw a chart.
    const main = res.body.slice(res.body.indexOf('<main>'), res.body.indexOf('</main>'));
    expect(main.length).toBeGreaterThan(0);
    expect(main).not.toContain('<svg');
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
    const other = await loadAnalytics(prod.db, nsId('0000000000c9'), 'month');
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

    await setOwner('zh', `+${ph('8613800000000')}`);
    expect(await deliverOwnerAlert({ db: prod.db, adapter: rec }, job('hot_lead'))).toBe('sent');
    expect(sent).toHaveLength(1);                    // exactly one send — no duplicate
    expect(sent[0]!.to).toBe(`+${ph('8613800000000')}`);      // persisted destination
    expect(sent[0]!.body).toContain('小雅');          // zh

    await setOwner('en', `+${ph('8613800000000')}`);
    await deliverOwnerAlert({ db: prod.db, adapter: rec }, job('hot_lead'));
    expect(sent[1]!.body).toContain('Lily');          // locale switched to en

    await setOwner('ar', `+${ph('8613800000000')}`);
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
    await withTenantTx(prod.db, parsed.value, (tx) => sql`update businesses set owner_locale='en', owner_phone=${'+' + ph('8613800000009')} where id=${parsed.value}`.execute(tx));
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
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, payload: `phone=%2B${ph('861380000004')}2` });
    expect(save.statusCode).toBe(302);
    expect(save.headers['location']).toContain('/app/channels?flash=');
    expect(await phoneOf()).toBe(`+${ph('8613800000042')}`);       // saved
    expect(await auditCount()).toBe(before + 1);          // audited

    // A notification now resolves the destination.
    const sent: { to: string }[] = [];
    const rec = { sendText: async (to: string) => { sent.push({ to }); return { ok: true as const, providerMessageId: 'x' }; } };
    expect(await deliverOwnerAlert({ db: prod.db, adapter: rec }, { businessId: DEMO_BIZ, kind: 'hot_lead', conversationId: null })).toBe('sent');
    expect(sent[0]!.to).toBe(`+${ph('8613800000042')}`);

    // invalid input is rejected — number unchanged.
    const bad = await prod.app.inject({ method: 'POST', url: '/app/settings/owner-phone',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, payload: 'phone=not-a-number' });
    expect(bad.headers['location']).toContain('flash=');
    expect(await phoneOf()).toBe(`+${ph('8613800000042')}`);       // unchanged

    // clear
    await prod.app.inject({ method: 'POST', url: '/app/settings/owner-phone',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, payload: 'phone=' });
    expect(await phoneOf()).toBeNull();
  });

  it('P3 settings: unauthenticated cannot change the alert number', async () => {
    const res = await prod.app.inject({ method: 'POST', url: '/app/settings/owner-phone',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: `phone=%2B${ph('861380000009')}9` });
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
    expect(res.body).toContain('Yiwu Demo Factory');         // reused businesses.name
    expect(res.body).toContain('Company name');
    expect(res.body).toContain('Product categories');
    // derived from the demo catalog (products.category): bags/drinkware/home/lighting
    expect(res.body).toMatch(/bags|drinkware|lighting/);
    // Phase F: no second "what is missing" list here — My factory owns that.
    expect(res.body).not.toContain('Profile checklist');
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

    // Invalid: empty name is rejected — the saved name is unchanged. Since
    // M20.4 (F-07) a rejection RE-RENDERS the submission instead of redirecting,
    // so nothing the owner typed is lost.
    const bad = await prod.app.inject({ method: 'POST', url: '/app/settings',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'name=&location=Ningbo' });
    expect(bad.statusCode).toBe(200);
    expect(bad.body).toContain('class="fld bad"');          // the failing field is named
    expect(bad.body).toContain('Ningbo');                   // her other input survived
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
    const CONV = nsId('000000000302');
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
    expect(res.body).toContain('Getting ready');             // English default
    expect(res.body).toContain('Checked for you');          // detected badge (demo has products/channel)
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
      // M22 — the sandbox tenant is a SINGLETON by design (one practice space
      // per installation), so unlike the factory it cannot be re-namespaced per
      // run. These tests assert it starts empty, which a previous run's practice
      // conversation breaks. Clear it through the product's own affordance —
      // the same one the owner taps, which archives rather than deletes.
      //
      // BEFORE the seed, not after: reset archives the ONE active conversation
      // it finds, so seeding first and resetting second leaves the seed's
      // conversation archived and a later test's conversation active — which is
      // exactly the state the reset test then fails on.
      // `resetSandbox` archives THE active conversation — one per call, because
      // the sandbox is meant to hold one. Runs accumulate them, so drain until
      // none is left. Bounded: a reset that stops archiving is a real defect and
      // should surface as this loop giving up, not as an infinite one.
      const { resetSandbox } = await import('../../src/api/web/sandbox.js');
      // Scoped to the sandbox BUYER's thread, which is the only thing
      // `resetSandbox` governs (it finds the conversation by SANDBOX_WA_ID).
      // Counting every active conversation in the tenant would demand more of
      // reset than it promises, and fail on threads it cannot reach.
      const activeNow = () => withSandbox((tx) => sql<{ n: number }>`
        select count(*)::int as n from conversations c
          join client_channels cc on cc.client_id = c.client_id
           and cc.channel = 'whatsapp' and cc.channel_user_id = 'sandbox-buyer'
         where c.business_id=${SANDBOX} and c.is_active`
        .execute(tx as never).then((r) => r.rows[0]!.n));
      for (let i = 0; i < 50 && (await activeNow()) > 0; i++) {
        await resetSandbox({ db: prod.db, businessId: SANDBOX, now: () => new Date() });
      }
      expect(await activeNow(), 'sandbox would not drain').toBe(0);

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
      expect(res.body).toContain('This is practice only. Nothing reaches a real buyer.');
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
        // M22 — scoped to the sandbox BUYER's thread, which is what reset
        // governs (`findActiveConversation` looks it up by SANDBOX_WA_ID).
        // Counting every active conversation in the tenant demanded more of
        // reset than it promises and only passed on a never-reused database:
        // the human-control tests below open threads under other numbers that
        // reset structurally cannot reach.
        active: (await sql<{ n: number }>`select count(*)::int as n from conversations c
          join client_channels cc on cc.client_id = c.client_id
           and cc.channel = 'whatsapp' and cc.channel_user_id = 'sandbox-buyer'
         where c.business_id=${SANDBOX} and c.is_active`.execute(tx as never)).rows[0]!.n,
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
        const { conversationId } = await ensureConversation(tx, bid, ph('971500009999'), 'Takeover Buyer');
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
        const a = await ensureConversation(tx, bid, ph('971500008881'), 'Ops A');
        const b = await ensureConversation(tx, bid, ph('971500008882'), 'Ops B');
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
      expect(s.attention).toEqual({ pendingApprovals: 0, handoffs: 0, ownerHandling: 0, blockedMessages: 0 });
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
      expect(res.body).toContain('What Lily did');           // Phase B activity
      expect(res.body).toContain('Buyers she talked to');
      // Phase B: messaging state is ONE quiet line, not a status card
      expect(res.body).toContain('Messaging is not active yet');
      expect(res.body).toContain('class="notlive"');
      expect(res.body).not.toContain('class="pill ok"');     // never "Connected" pre-Meta
    });

    it('seeded pending + handoff surface as their cards; buyer text & draft body never leak', async () => {
      const { withTenantTx } = await import('../../src/db/client.js');
      const { ensureConversation } = await import('../../src/db/channels.js');
      const { tenantRepos } = await import('../../src/db/repos.js');
      const { loadOperationsSnapshot, renderOperationsHome } = await import('../../src/api/web/operations.js');
      const SECRET = 'ZZsecretdraftbodyDoNotLeak';
      const BUYERTAG = `${ph('971500009999')}zzpii`;
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
      const quiet = snap.knowledge.openGaps === 0 && snap.knowledge.recentlyTaught === 0
                 && snap.knowledge.recentCorrections === 0;
      // Phase B: on a quiet day the card is one honest line, not a row of zeros.
      if (quiet) expect(html).not.toContain('Questions to answer');
      else {
        expect(html).toContain('Questions to answer');           // the gaps card/label
        expect(html).toContain('href="/app/knowledge"');         // and a way through to it
      }
    });

    it('empty factory renders the honest quiet state', async () => {
      const { loadOperationsSnapshot, renderOperationsHome } = await import('../../src/api/web/operations.js');
      const snap = await loadOperationsSnapshot(prod.db, '00000000-0000-0000-0000-000000000000', 'today', 'disabled');
      const html = renderOperationsHome(snap, 'en');
      // M22 (F-01): with messaging off she is looking after nobody, so this
      // says why it is quiet instead of congratulating the owner. It used to
      // read "You're all caught up · Lily is looking after your buyers" on a
      // factory where nothing could reach her at all.
      expect(html).toContain('No buyer can reach Lily yet');
      expect(html).not.toContain("You're all caught up");
      expect(html).not.toContain('Lily is looking after your buyers');
      expect(html).toContain('href="/app/factory"');
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
        const { conversationId } = await ensureConversation(tx, bid, ph('971500007777'), 'Detail Buyer');
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
      const q = <T>(fn: (tx: import('kysely').Transaction<never>) => Promise<T>): Promise<T> =>
        import('../../src/db/client.js').then(({ withTenantTx }) => withTenantTx(prod.db, bid, fn as never));

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
        const c = await ensureConversation(tx, bid, ph('971500006666'), 'Feedback Buyer');
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

    it('Phase B: conversationsNeedingYou equals an INDEPENDENT distinct count', async () => {
      const { loadPilotFeedback } = await import('../../src/api/web/pilot.js');
      const f = await loadPilotFeedback(prod.db, DEMO_BIZ, 'month');
      const independent = await q((tx) => sql<{ n: number }>`
        with cut as (select (date_trunc('month', now() at time zone 'Asia/Shanghai')
                              at time zone 'Asia/Shanghai') as c)
        select count(distinct conversation_id)::int as n
          from conversation_events
         where business_id=${DEMO_BIZ} and created_at >= (select c from cut)
           and type in ('takeover','owner_reply')
      `.execute(tx as never).then((r) => r.rows[0]!.n));
      expect(f.conversationsNeedingYou).toBe(independent);
    });

    it('Phase B: approving a draft is NOT "stepping in" — only takeover/owner_reply count', async () => {
      const { loadPilotFeedback } = await import('../../src/api/web/pilot.js');
      const before = (await loadPilotFeedback(prod.db, DEMO_BIZ, 'month')).conversationsNeedingYou;
      // a routine approval must not inflate the count: under draft-first EVERY
      // reply is approved, so counting those would say "n of n" and mean nothing
      await q((tx) => sql`
        insert into conversation_events (business_id, conversation_id, type, payload)
        values (${DEMO_BIZ}, gen_random_uuid(), 'draft_resolved',
                ${JSON.stringify({ actor: 'owner', status: 'approved' })}::jsonb)
      `.execute(tx as never));
      expect((await loadPilotFeedback(prod.db, DEMO_BIZ, 'month')).conversationsNeedingYou).toBe(before);

      // but a real take-over does
      await q((tx) => sql`
        insert into conversation_events (business_id, conversation_id, type, payload)
        values (${DEMO_BIZ}, gen_random_uuid(), 'takeover', ${JSON.stringify({ actor: 'owner' })}::jsonb)
      `.execute(tx as never));
      expect((await loadPilotFeedback(prod.db, DEMO_BIZ, 'month')).conversationsNeedingYou).toBe(before + 1);
    });

    it('Phase B: two events in ONE conversation count as one conversation', async () => {
      const { loadPilotFeedback } = await import('../../src/api/web/pilot.js');
      const before = (await loadPilotFeedback(prod.db, DEMO_BIZ, 'month')).conversationsNeedingYou;
      const cid = await q((tx) => sql<{ id: string }>`select gen_random_uuid() as id`
        .execute(tx as never).then((r) => r.rows[0]!.id));
      for (const type of ['takeover', 'owner_reply']) {
        await q((tx) => sql`
          insert into conversation_events (business_id, conversation_id, type, payload)
          values (${DEMO_BIZ}, ${cid}, ${type}, ${JSON.stringify({ actor: 'owner' })}::jsonb)
        `.execute(tx as never));
      }
      // DISTINCT, not a tally of events — "3 of 12 conversations", not "3 actions"
      expect((await loadPilotFeedback(prod.db, DEMO_BIZ, 'month')).conversationsNeedingYou).toBe(before + 1);
    });

    it('Phase B: TENANT ISOLATION — another factory\'s takeovers are invisible', async () => {
      const { loadPilotFeedback } = await import('../../src/api/web/pilot.js');
      const { withTenantTx } = await import('../../src/db/client.js');
      const { parseBusinessId } = await import('../../src/core/types/ids.js');
      const sb = parseBusinessId(SANDBOX); if (!sb.ok) throw new Error('fixture');

      const demoBefore = (await loadPilotFeedback(prod.db, DEMO_BIZ, 'month')).conversationsNeedingYou;
      await withTenantTx(prod.db, sb.value, (tx) => sql`
        insert into conversation_events (business_id, conversation_id, type, payload)
        values (${SANDBOX}, gen_random_uuid(), 'takeover', ${JSON.stringify({ actor: 'owner' })}::jsonb)
      `.execute(tx as never));
      expect((await loadPilotFeedback(prod.db, DEMO_BIZ, 'month')).conversationsNeedingYou).toBe(demoBefore);
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

  // ── Nomi Phase C · 小雅 over real data ──────────────────────────────────────
  describe('Phase C · 小雅 (over real data)', () => {
    let bid: import('../../src/core/types/ids.js').BusinessId;
    const q = <T>(fn: (tx: import('kysely').Transaction<never>) => Promise<T>): Promise<T> =>
      import('../../src/db/client.js').then(({ withTenantTx }) => withTenantTx(prod.db, bid, fn as never));

    beforeAll(async () => {
      const { parseBusinessId } = await import('../../src/core/types/ids.js');
      const p = parseBusinessId(DEMO_BIZ); if (!p.ok) throw new Error('fixture'); bid = p.value;
    });

    it('an unknown factory is honestly empty', async () => {
      const { loadEmployee } = await import('../../src/api/web/employee.js');
      const e = await loadEmployee(prod.db, '00000000-0000-0000-0000-000000000000');
      expect(e.knows).toBe(0);
      expect(e.canDo).toEqual([]);
      expect(e.promoted).toBe(false);
    });

    it('HONESTY: `knows` equals an independent COUNT of owner-taught knowledge', async () => {
      const { loadEmployee } = await import('../../src/api/web/employee.js');
      const e = await loadEmployee(prod.db, DEMO_BIZ);
      const independent = await q((tx) => sql<{ n: number }>`
        select count(*)::int as n from product_knowledge
         where business_id=${DEMO_BIZ} and status='active'
           and source in ('owner_confirmed','owner_corrected')
      `.execute(tx as never).then((r) => r.rows[0]!.n));
      expect(e.knows).toBe(independent);
    });

    it('teaching her a fact raises what she knows; a seeded sample does NOT', async () => {
      const { loadEmployee } = await import('../../src/api/web/employee.js');
      const before = (await loadEmployee(prod.db, DEMO_BIZ)).knows;

      // a system seed is not something the owner taught
      await q((tx) => sql`
        insert into product_knowledge (business_id, product_id, kind, label, content, source)
        values (${DEMO_BIZ}, null, 'faq', 'phase-c-seed', 'sample', 'system_seed')
      `.execute(tx as never));
      expect((await loadEmployee(prod.db, DEMO_BIZ)).knows).toBe(before);

      // one the owner confirmed IS
      await q((tx) => sql`
        insert into product_knowledge (business_id, product_id, kind, label, content, source)
        values (${DEMO_BIZ}, null, 'faq', 'phase-c-taught', 'a taught fact', 'owner_confirmed')
      `.execute(tx as never));
      expect((await loadEmployee(prod.db, DEMO_BIZ)).knows).toBe(before + 1);
    });

    it('archiving a correction removes it from what she currently knows', async () => {
      const { loadEmployee } = await import('../../src/api/web/employee.js');
      const before = (await loadEmployee(prod.db, DEMO_BIZ)).knows;
      await q((tx) => sql`
        update product_knowledge set status='archived', updated_at=now()
         where business_id=${DEMO_BIZ} and label='phase-c-taught'
      `.execute(tx as never));
      expect((await loadEmployee(prod.db, DEMO_BIZ)).knows).toBe(before - 1);
    });

    it('capability state comes from the EXISTING autonomy policy, unchanged', async () => {
      const { loadEmployee } = await import('../../src/api/web/employee.js');
      const e = await loadEmployee(prod.db, DEMO_BIZ);
      const policy = await q((tx) => sql<{ capability: string; mode: string }>`
        select capability, mode from autonomy_policy where business_id=${DEMO_BIZ} order by capability
      `.execute(tx as never).then((r) => r.rows));
      expect(e.capabilities.map((c) => c.capability)).toEqual(policy.map((p) => p.capability));
      expect([...e.canDo].sort()).toEqual(policy.filter((p) => p.mode === 'auto').map((p) => p.capability).sort());
      // confirm_order is never in the "handles alone" set
      expect(e.canDo).not.toContain('confirm_order');
    });

    it('the page renders her name and the four questions, authenticated', async () => {
      const cookie = await login();
      const res = await prod.app.inject({ method: 'GET', url: '/app/employee', headers: { cookie } });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('<h1 class="page">Lily</h1>');
      expect(res.body).toContain('What she knows');
      expect(res.body).toContain('What she handles on her own');
      expect(res.body).toContain('Recently');
      expect(res.body).toContain('What she still needs from you');
    });

    it('SECURITY: unauthenticated /app/employee redirects', async () => {
      const res = await prod.app.inject({ method: 'GET', url: '/app/employee' });
      expect(res.statusCode).toBe(302);
      expect(res.headers['location']).toBe('/login');
    });

    it('TENANT ISOLATION: another factory\'s taught knowledge is invisible', async () => {
      const { loadEmployee } = await import('../../src/api/web/employee.js');
      const { withTenantTx } = await import('../../src/db/client.js');
      const { parseBusinessId } = await import('../../src/core/types/ids.js');
      const SANDBOX = '5a4d0000-0000-4000-8000-0000000000b1';
      const sb = parseBusinessId(SANDBOX); if (!sb.ok) throw new Error('fixture');

      const demoBefore = (await loadEmployee(prod.db, DEMO_BIZ)).knows;
      await withTenantTx(prod.db, sb.value, (tx) => sql`
        insert into product_knowledge (business_id, product_id, kind, label, content, source)
        values (${SANDBOX}, null, 'faq', 'other-tenant', 'not yours', 'owner_confirmed')
      `.execute(tx as never));
      expect((await loadEmployee(prod.db, DEMO_BIZ)).knows).toBe(demoBefore);
    });
  });

  // ── Phase D · Buyers, over real data ────────────────────────────────────────
  // The list groups by the ONE ownership model and the detail explains what she
  // leaned on. Nothing here introduces a second ownership rule, a second send
  // path, or a stored metric — it reads what the pipeline already wrote.
  describe('Phase D · buyers (over real data)', () => {
    let bid: import('../../src/core/types/ids.js').BusinessId;
    let waitingId = '';   // buyer asked for a person — no draft by design
    let aiId = '';        // she is handling it, and used taught knowledge
    let factId = '';
    const q = <T>(fn: (tx: import('kysely').Transaction<never>) => Promise<T>): Promise<T> =>
      import('../../src/db/client.js').then(({ withTenantTx }) => withTenantTx(prod.db, bid, fn as never));
    const list = (f: 'pending' | 'all') => import('../../src/api/web/inbox.js')
      .then(({ loadInboxList }) => loadInboxList(prod.db, DEMO_BIZ, f));

    beforeAll(async () => {
      const { parseBusinessId } = await import('../../src/core/types/ids.js');
      const { ensureConversation } = await import('../../src/db/channels.js');
      const { tenantRepos } = await import('../../src/db/repos.js');
      const p = parseBusinessId(DEMO_BIZ); if (!p.ok) throw new Error('fixture'); bid = p.value;

      await q(async (tx) => {
        const w = await ensureConversation(tx as never, bid, ph('971500008891'), 'Waiting Buyer');
        waitingId = w.conversationId;
        await tenantRepos(tx as never, bid).conversations.assign(waitingId as never, 'unclaimed');
        // a real handoff always records WHY; the badge reads that signal
        await tenantRepos(tx as never, bid).signals.record(waitingId as never, { kind: 'human_requested' });

        const a = await ensureConversation(tx as never, bid, ph('971500008892'), 'Answered Buyer');
        aiId = a.conversationId;

        // a real taught fact, and the usage audit the pipeline writes for it
        factId = (await sql<{ id: string }>`
          insert into product_knowledge (business_id, product_id, kind, label, content, source)
          values (${DEMO_BIZ}, null, 'faq', 'Minimum order is 500 pcs', 'MOQ 500', 'owner_confirmed')
          returning id`.execute(tx as never)).rows[0]!.id;
        await sql`
          insert into conversation_events (business_id, conversation_id, type, payload)
          values (${DEMO_BIZ}, ${aiId}, 'knowledge_used', ${JSON.stringify({ ids: [factId] })}::jsonb)
        `.execute(tx as never);
      });
    });

    it('a buyer who asked for a person is in "needs you" — even with no reply drafted', async () => {
      const { renderInboxList } = await import('../../src/api/web/inbox.js');
      const pending = await list('pending');
      const row = pending.conversations.find((c) => c.conversationId === waitingId);
      expect(row, 'a handoff must never be hidden from the needs-you view').toBeTruthy();
      expect(row!.ownership).toBe('WAITING_HUMAN');
      expect(row!.awaitingReview).toBe(false);            // she drafted nothing, by design
      expect(pending.waitingCount).toBeGreaterThan(0);
      // the badge now states the SIGNAL that was stored, not a fixed sentence
      expect(row!.handoffReason).toBe('human_requested');
      expect(renderInboxList(pending, 'en', new Date())).toContain('the buyer asked for a person');
    });

    it('every waiting handoff sorts above every conversation that is not waiting', async () => {
      const all = await list('all');
      const idx = all.conversations.map((c) => c.ownership === 'WAITING_HUMAN');
      expect(idx.lastIndexOf(true)).toBeLessThan(idx.indexOf(false) === -1 ? Infinity : idx.indexOf(false));
      expect(all.conversations.some((c) => c.conversationId === waitingId && c.ownership === 'WAITING_HUMAN')).toBe(true);
      const html = (await import('../../src/api/web/inbox.js')).renderInboxList(all, 'en', new Date());
      expect(html.indexOf('Needs you')).toBeLessThan(html.indexOf('Lily is handling'));
      expect(html.indexOf(waitingId)).toBeLessThan(html.indexOf(aiId));
    });

    it('grouping is the ownership model, not a copy of it', async () => {
      const { ownershipOf } = await import('../../src/core/conversation/ownership.js');
      const all = await list('all');
      const stored = await q((tx) => sql<{ id: string; assigned_to: string | null }>`
        select id, assigned_to from conversations`.execute(tx as never).then((r) => r.rows));
      const byId = new Map(stored.map((r) => [r.id, r.assigned_to]));
      for (const c of all.conversations)
        expect(c.ownership, c.conversationId).toBe(ownershipOf(byId.get(c.conversationId) ?? null));
    });

    it('detail names the taught facts behind her reply — from the stored audit', async () => {
      const { loadConversationDetail, renderConversationDetail } = await import('../../src/api/web/inbox.js');
      const d = (await loadConversationDetail(prod.db, DEMO_BIZ, aiId))!;
      expect(d.ownership).toBe('AI');
      expect(d.knowledgeUsed).toContain('Minimum order is 500 pcs');
      expect(renderConversationDetail(d, 'en', new Date(), null)).toContain('What she used to answer');
    });

    it('only the LATEST answer is explained, and archived facts still read back', async () => {
      const { loadConversationDetail } = await import('../../src/api/web/inbox.js');
      const second = await q(async (tx) => {
        const r = (await sql<{ id: string }>`
          insert into product_knowledge (business_id, product_id, kind, label, content, source)
          values (${DEMO_BIZ}, null, 'faq', 'Lead time is 20 days', '20 days', 'owner_confirmed')
          returning id`.execute(tx as never)).rows[0]!.id;
        await sql`
          insert into conversation_events (business_id, conversation_id, type, payload)
          values (${DEMO_BIZ}, ${aiId}, 'knowledge_used', ${JSON.stringify({ ids: [r] })}::jsonb)
        `.execute(tx as never);
        return r;
      });
      const d = (await loadConversationDetail(prod.db, DEMO_BIZ, aiId))!;
      expect(d.knowledgeUsed).toEqual(['Lead time is 20 days']);   // the newest event only
      expect(d.knowledgeUsed).not.toContain('Minimum order is 500 pcs');
      expect(second).toBeTruthy();
    });

    it('taking over hides the explanation and hands the pen to the owner — one lifecycle', async () => {
      const { takeOver, resumeAi } = await import('../../src/conversations/takeover.js');
      const { loadConversationDetail, renderConversationDetail } = await import('../../src/api/web/inbox.js');
      const now = () => new Date();
      await takeOver({ db: prod.db, now }, { businessId: bid, conversationId: aiId, actor: 'owner' });

      const owned = (await loadConversationDetail(prod.db, DEMO_BIZ, aiId))!;
      expect(owned.ownership).toBe('OWNER_CONTROLLED');
      const html = renderConversationDetail(owned, 'en', new Date(), null);
      expect(html).not.toContain('What she used to answer');   // she is not the one speaking
      expect(html).toContain(`action="/app/inbox/${aiId}/reply"`);

      const inList = (await list('all')).conversations.find((c) => c.conversationId === aiId)!;
      expect(inList.ownership).toBe('OWNER_CONTROLLED');
      expect((await import('../../src/api/web/inbox.js')).renderInboxList(await list('all'), 'en', new Date()))
        .toContain('You are replying');

      await resumeAi({ db: prod.db, now }, { businessId: bid, conversationId: aiId, actor: 'owner' });
      expect((await loadConversationDetail(prod.db, DEMO_BIZ, aiId))!.ownership).toBe('AI');
    });

    it('an owner reply still goes through the ONE send path — no second outbound row', async () => {
      const { takeOver, resumeAi } = await import('../../src/conversations/takeover.js');
      const { ownerReply } = await import('../../src/outbound/ownerReply.js');
      const now = () => new Date();
      const count = () => q((tx) => sql<{ n: number }>`
        select count(*)::int n from outbound_messages where conversation_id=${waitingId}`
        .execute(tx as never).then((r) => r.rows[0]!.n));

      await takeOver({ db: prod.db, now }, { businessId: bid, conversationId: waitingId, actor: 'owner' });
      const before = await count();
      const r = await ownerReply({ db: prod.db, now, kickDrive: async () => {} },
        { businessId: bid, conversationId: waitingId, text: 'I will handle this myself.', actor: 'owner' });
      expect(r.outcome).toBe('sent');
      expect(await count()).toBe(before + 1);
      const origins = await q((tx) => sql<{ origin: string }>`
        select origin from outbound_messages where conversation_id=${waitingId} order by seq desc limit 1`
        .execute(tx as never).then((x) => x.rows));
      expect(origins[0]!.origin).toBe('owner');
      await resumeAi({ db: prod.db, now }, { businessId: bid, conversationId: waitingId, actor: 'owner' });
    });

    it('SECURITY: another tenant sees neither these buyers nor what she was taught', async () => {
      const { loadInboxList, loadConversationDetail } = await import('../../src/api/web/inbox.js');
      const SANDBOX = '5a4d0000-0000-4000-8000-0000000000b1';
      const theirs = await loadInboxList(prod.db, SANDBOX, 'all');
      expect(theirs.conversations.some((c) => c.conversationId === aiId)).toBe(false);
      expect(await loadConversationDetail(prod.db, SANDBOX, aiId)).toBeNull();
    });
  });

  // ── Phase E · My factory, over real data ────────────────────────────────────
  // The page owns nothing: it composes the profile, catalog, claims allowlist
  // and channel that already exist. These tests check it tells the truth about
  // each of them — and that the surfaces it folded in still work.
  describe('Phase E · my factory (over real data)', () => {
    const SANDBOX = '5a4d0000-0000-4000-8000-0000000000b1';
    let bid: import('../../src/core/types/ids.js').BusinessId;
    const q = <T>(fn: (tx: import('kysely').Transaction<never>) => Promise<T>): Promise<T> =>
      import('../../src/db/client.js').then(({ withTenantTx }) => withTenantTx(prod.db, bid, fn as never));
    const view = (b = DEMO_BIZ) => import('../../src/api/web/factory.js')
      .then(({ loadFactory }) => loadFactory(prod.db, b, false));
    const html = async (b = DEMO_BIZ) => {
      const { renderFactory } = await import('../../src/api/web/factory.js');
      return renderFactory(await view(b), 'en');
    };

    beforeAll(async () => {
      const { parseBusinessId } = await import('../../src/core/types/ids.js');
      const p = parseBusinessId(DEMO_BIZ); if (!p.ok) throw new Error('fixture'); bid = p.value;
    });

    it('factory information is the REAL business row, not a copy', async () => {
      const [f, row] = await Promise.all([
        view(),
        q((tx) => sql<{ name: string; location: string | null }>`
          select name, location from businesses where id = ${DEMO_BIZ}`
          .execute(tx as never).then((r) => r.rows[0]!)),
      ]);
      expect(f.profile.name).toBe(row.name);
      expect(f.profile.location).toBe(row.location);
      expect(await html()).toContain(row.name);
    });

    it('products are the real active catalog, with the real unpriced count', async () => {
      const [f, counts] = await Promise.all([
        view(),
        q((tx) => sql<{ total: number }>`
          select count(*)::int total from products where business_id = ${DEMO_BIZ} and is_active`
          .execute(tx as never).then((r) => r.rows[0]!)),
      ]);
      expect(f.products.total).toBe(counts.total);
      expect(f.products.needPrice).toBeLessThanOrEqual(f.products.total);
      expect(f.products.names.length).toBeLessThanOrEqual(4);       // recognition, not a dump
    });

    it('promises are the claims guard’s OWN allowlist — authorise one and it appears', async () => {
      const { setCertification } = await import('../../src/api/web/knowledge.js');
      expect((await view()).promises.certs).not.toContain('ISO9001');

      expect((await setCertification(prod.db, DEMO_BIZ, 'ISO9001', true)).code).toBe('cert');
      expect((await view()).promises.certs).toContain('ISO9001');
      // the owner reads the promise, never the guard's key
      expect(await html()).toContain('ISO 9001 quality system');
      expect(await html()).not.toContain('>ISO9001<');

      // withdrawing it removes the promise — default-deny, no stale claim left
      expect((await setCertification(prod.db, DEMO_BIZ, 'ISO9001', false)).code).toBe('cert');
      expect((await view()).promises.certs).not.toContain('ISO9001');
      expect(await html()).not.toContain('ISO 9001 quality system');
    });

    it('price rules come from the rows the GUARD uses, not the business-wide fallback', async () => {
      // repos.pricingPolicy(productId) lets a per-product row win, and turn.ts
      // always asks per product — so a page that read only the `product_id is
      // null` row reported numbers no quote has ever used.
      const rows = await q((tx) => sql<{ floor: string; ceiling: string; pid: string | null }>`
        select floor_price_usd floor, max_discount_pct ceiling, product_id pid
          from pricing_policy where business_id = ${DEMO_BIZ}`
        .execute(tx as never).then((r) => r.rows));
      const perProduct = rows.filter((r) => r.pid !== null);
      const applies = perProduct.length > 0 ? perProduct : rows;
      const f = await view();

      if (applies.length === 0) {
        expect(f.promises.floorLowUsd).toBeNull();
        expect(await html()).not.toContain('never quotes below');
        return;
      }
      const floors = applies.map((r) => Number(r.floor));
      expect(f.promises.floorLowUsd).toBe(Math.min(...floors));
      expect(f.promises.floorHighUsd).toBe(Math.max(...floors));
      expect(f.promises.ceilingPct).toBe(Math.min(...applies.map((r) => Number(r.ceiling))));

      // and it must NOT be the fallback row when per-product rules exist
      const fallback = rows.find((r) => r.pid === null);
      if (perProduct.length > 0 && fallback && Number(fallback.floor) !== f.promises.floorLowUsd)
        expect(f.promises.floorLowUsd).not.toBe(Number(fallback.floor));

      const page = await html();
      expect(page).toContain('never discounts more than');
      // the escalation threshold is not a gate (turn.ts asks resolveMode only),
      // so it may never be promised to the owner as one
      expect(page).not.toContain('waits for you');
      expect(page).not.toContain('on her own');
    });

    it('connection reflects the real channel state and never leaks a secret', async () => {
      const { loadChannels } = await import('../../src/api/web/channels.js');
      const f = await view();
      const real = await loadChannels(prod.db, DEMO_BIZ, false);
      expect(f.connection.channel.connected).toBe(real.whatsapp.connected);
      expect(f.connection.channel.status).toBe(real.whatsapp.status);

      const page = await html();
      const secrets = await q((tx) => sql<{ v: string }>`
        select unnest(array_remove(array[secret_ref, secret_ciphertext, webhook_secret_ciphertext, secret_fingerprint], null)) v
          from channel_credentials where business_id = ${DEMO_BIZ}`
        .execute(tx as never).then((r) => r.rows.map((x) => x.v)));
      expect(secrets.length, 'the demo tenant must have a credential for this test to mean anything').toBeGreaterThan(0);
      for (const sec of secrets) expect(page, 'a secret reached the page').not.toContain(sec);
    });

    it('the next step is the ONE setup derivation, not a second opinion', async () => {
      // Phase F: My factory composes loadOnboarding rather than deciding for
      // itself. Same business, same answer — always.
      const { loadOnboarding } = await import('../../src/api/web/onboarding.js');
      const [f, setup] = await Promise.all([view(), loadOnboarding(prod.db, DEMO_BIZ)]);
      expect(f.nextStep).toBe(setup.nextStep);
      const other = await loadOnboarding(prod.db, '00000000-0000-0000-0000-000000000000');
      expect((await view('00000000-0000-0000-0000-000000000000')).nextStep).toBe(other.nextStep);
    });

    it('M20.2: readiness is the ACTIVATION gate itself, not a second opinion', async () => {
      // The page and the activate action must never disagree, so the page asks
      // the same function activate() obeys.
      const { activationPreconditions } = await import('../../src/channels/activation.js');
      const { parseBusinessId } = await import('../../src/core/types/ids.js');
      const p = parseBusinessId(DEMO_BIZ); if (!p.ok) throw new Error('fixture');
      // The app builds with provider 'disabled', so the page asks with
      // providerConfigured:false — assert against the SAME question.
      const [f, pre] = await Promise.all([
        view(), activationPreconditions(prod.db, p.value, { providerConfigured: false })]);

      expect(f.readiness.blockers).toEqual(pre.blockers);
      expect(f.readiness.canActivate).toBe(pre.blockers.length === 0);

      const page = (await html()).replace(/<ul class="frules">[\s\S]*?<\/ul>/, '');
      expect(page).toContain('Before she talks to real buyers');
      expect(page).not.toMatch(/\d+\s*%/);          // no rate, no grade
      expect(page).toContain('href="/app/onboarding"');
    });

    it('M20.2: every blocker the gate reports is stated, with a way to fix it', async () => {
      const f = await view();
      const page = await html();
      const FIX: Record<string, string | null> = {
        schema_stale: '/app/onboarding', not_ready: '/app/onboarding',
        secrets_not_rotated: '/app/onboarding', no_channel: '/app/channels',
        no_allowlist: null,
      };
      for (const b of f.readiness.blockers) {
        const href = FIX[b];
        if (href) expect(page, `${b} needs a way to fix it`).toContain(`href="${href}"`);
      }
      // and the page never invents a blocker the gate did not report
      if (f.readiness.blockers.length === 0) expect(page).toContain('whenever you say so');
    });

    it('M20.3.1: activation on a channel that cannot carry a message is NOT “active”', async () => {
      const { withTenantTx } = await import('../../src/db/client.js');
      const { parseBusinessId } = await import('../../src/core/types/ids.js');
      const { loadFactory } = await import('../../src/api/web/factory.js');
      const p = parseBusinessId(DEMO_BIZ); if (!p.ok) throw new Error('fixture');
      const set = (on: boolean) => withTenantTx(prod.db, p.value, (tx) => sql`
        update channels set status='connected', activated_at=${on ? new Date() : null}
         where business_id=${DEMO_BIZ} and kind='whatsapp'`.execute(tx as never));

      await set(true);
      // This installation has no messaging provider: connected + activated is
      // still not a channel a buyer can be reached on, so it must not say so.
      const asShipped = await loadFactory(prod.db, DEMO_BIZ, false);
      expect(asShipped.readiness.live).toBe(false);
      expect(asShipped.readiness.lifecycle).not.toBe('active');

      // With a provider configured, the same row IS active.
      const withProvider = await loadFactory(prod.db, DEMO_BIZ, true);
      expect(withProvider.readiness.lifecycle).toBe('active');
      expect(withProvider.readiness.live).toBe(true);
      await set(false);
    });

    it('M20.3.1: the connection section and the activation section never disagree', async () => {
      const { loadFactory, renderFactory } = await import('../../src/api/web/factory.js');
      for (const provider of [false, true]) {
        const v = await loadFactory(prod.db, DEMO_BIZ, provider);
        const page = renderFactory(v, 'en');
        const offersActivate = page.includes('action="/app/factory/activate"');
        const saysReady = page.includes('whenever you say so');
        // "you can start" may only appear when the channel is genuinely ready
        if (saysReady || offersActivate) expect(v.readiness.lifecycle, JSON.stringify(v.readiness)).toBe('ready');
        // and a channel that cannot carry a message never reads as ready
        if (v.readiness.lifecycle !== 'ready' && v.readiness.lifecycle !== 'active') {
          expect(page).not.toContain('whenever you say so');
          expect(page).not.toContain('action="/app/factory/activate"');
        }
      }
    });

    it('an unknown factory renders the honest empty state, never a crash', async () => {
      const f = await view('00000000-0000-0000-0000-000000000000');
      expect(f.profile.name).toBe('');
      expect(f.products.total).toBe(0);
      expect(f.promises.certs).toEqual([]);
      expect(f.nextStep).toBe('profile');
      const page = await html('00000000-0000-0000-0000-000000000000');
      expect(page).toContain('nothing to tell buyers about you yet');
    });

    it('SECURITY: the page requires an owner session, and shows only that owner’s factory', async () => {
      const anon = await prod.app.inject({ method: 'GET', url: '/app/factory' });
      expect(anon.statusCode).toBe(302);
      expect(anon.headers['location']).toBe('/login');

      const cookie = await login();
      const mine = await prod.app.inject({ method: 'GET', url: '/app/factory', headers: { cookie } });
      expect(mine.statusCode).toBe(200);
      const demoName = (await view()).profile.name;
      expect(mine.body).toContain(demoName);

      // the sandbox tenant's own factory never appears on the demo owner's page
      const other = await view(SANDBOX);
      if (other.profile.name && other.profile.name !== demoName) expect(mine.body).not.toContain(other.profile.name);
      expect((await view(SANDBOX)).products.total).not.toBe(-1);   // RLS-scoped read, no leak
    });

    it('the surfaces My factory folded in are still routed and still reachable', async () => {
      const { CONTEXTUAL_ROUTES } = await import('../../src/api/web/layout.js');
      const cookie = await login();
      const page = await prod.app.inject({ method: 'GET', url: '/app/factory', headers: { cookie } });
      // everything My factory now contains — including the go-live runbook and
      // Practice, which used to hold nav slots of their own
      for (const route of CONTEXTUAL_ROUTES.filter((r) => r !== '/app/conversations' && r !== '/app/analytics')) {
        expect(page.body, `${route} must stay linked from My factory`).toContain(`href="${route}"`);
        const r = await prod.app.inject({ method: 'GET', url: route, headers: { cookie } });
        expect(r.statusCode, route).toBe(200);
      }
    });
  });

  // ── 0022 · the objects that used to sit outside tenant isolation ────────────
  // A view runs as its OWNER unless declared security_invoker, so these two —
  // created by postgres — evaluated RLS against a superuser and skipped it.
  // Scoped to one tenant they returned another tenant's buyer name, buyer email,
  // conversation summary, draft text and corrected sent text.
  describe('0022 · RLS gaps are closed', () => {
    const SANDBOX = '5a4d0000-0000-4000-8000-0000000000b1';
    const asTenant = async <T>(biz: string, fn: (tx: import('kysely').Transaction<never>) => Promise<T>): Promise<T> => {
      const { withTenantTx } = await import('../../src/db/client.js');
      const { parseBusinessId } = await import('../../src/core/types/ids.js');
      const p = parseBusinessId(biz); if (!p.ok) throw new Error('fixture');
      return withTenantTx(prod.db, p.value, fn as never);
    };
    const countIn = (biz: string, rel: string) =>
      asTenant(biz, (tx) => sql<{ n: number }>`select count(*)::int n from ${sql.raw(rel)}`
        .execute(tx as never).then((r) => r.rows[0]!.n));

    it('both views are declared security_invoker, so they inherit the base-table policies', async () => {
      const rows = await asTenant(DEMO_BIZ, (tx) => sql<{ relname: string; opts: string[] | null }>`
        select c.relname, c.reloptions as opts from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where c.relkind = 'v' and n.nspname = 'public'`.execute(tx as never).then((r) => r.rows));
      expect(rows.length).toBeGreaterThan(0);
      for (const v of rows)
        expect((v.opts ?? []).join(','), `${v.relname} is not security_invoker`).toContain('security_invoker=true');
    });

    it('shadow.turn_decisions has RLS enabled, forced, and a tenant policy', async () => {
      const r = await asTenant(DEMO_BIZ, (tx) => sql<{ sec: boolean; forced: boolean; policies: number }>`
        select c.relrowsecurity as sec, c.relforcerowsecurity as forced,
               (select count(*)::int from pg_policies p
                 where p.schemaname='shadow' and p.tablename='turn_decisions') as policies
          from pg_class c join pg_namespace n on n.oid=c.relnamespace
         where n.nspname='shadow' and c.relname='turn_decisions'`
        .execute(tx as never).then((x) => x.rows[0]!));
      expect(r.sec).toBe(true);
      expect(r.forced).toBe(true);
      expect(r.policies).toBeGreaterThan(0);
    });

    it('SECURITY: one tenant sees none of another tenant’s rows through any of the three', async () => {
      // Give each tenant a row in every object under test.
      const seed = async (biz: string, tag: string) => {
        await asTenant(biz, async (tx) => {
          await sql`insert into shadow.turn_decisions (message_id, conversation_id, business_id, svc_decision)
                    values (${`m-${tag}`}, null, ${biz}, ${JSON.stringify({ tag })}::jsonb)
                    on conflict (message_id) do nothing`.execute(tx as never);
        });
      };
      // message_id is UNIQUE across ALL tenants, so the tags are run-scoped:
      // otherwise a second run's insert is swallowed by `do nothing` and the
      // tenant it was meant for sees zero rows.
      const demoTag = `demo-${RUN_NS}`, sbxTag = `sbx-${RUN_NS}`;
      await seed(DEMO_BIZ, demoTag);
      await seed(SANDBOX, sbxTag);

      // Each tenant sees its own row and nothing else. (There is no honest
      // "total" to compare against any more — an unscoped read now returns 0,
      // which is the whole point; that is asserted in the next test.)
      expect(await countIn(DEMO_BIZ, 'shadow.turn_decisions')).toBe(1);
      expect(await countIn(SANDBOX, 'shadow.turn_decisions')).toBeGreaterThan(0);
      expect(await countIn(DEMO_BIZ, 'active_conversations_summary')).toBeGreaterThan(0);

      // the sharp assertion: the row tagged for one tenant is invisible to the other
      const sbxSeesDemoRow = await asTenant(SANDBOX, (tx) => sql<{ n: number }>`
        select count(*)::int n from shadow.turn_decisions where message_id = ${`m-${demoTag}`}`
        .execute(tx as never).then((r) => r.rows[0]!.n));
      expect(sbxSeesDemoRow).toBe(0);
      const demoSeesSbxRow = await asTenant(DEMO_BIZ, (tx) => sql<{ n: number }>`
        select count(*)::int n from shadow.turn_decisions where message_id = ${`m-${sbxTag}`}`
        .execute(tx as never).then((r) => r.rows[0]!.n));
      expect(demoSeesSbxRow).toBe(0);
    });

    it('SECURITY: with no tenant set the views return nothing — they used to return everything', async () => {
      const { sql: raw } = await import('kysely');
      for (const rel of ['active_conversations_summary', 'training_examples', 'shadow.turn_decisions']) {
        const n = await raw<{ n: number }>`select count(*)::int n from ${raw.raw(rel)}`
          .execute(prod.db as never).then((r) => r.rows[0]!.n);
        expect(n, `${rel} leaks without a tenant`).toBe(0);
      }
    });
  });

  // ── M20.3 · activate / deactivate as real owner actions ─────────────────────
  // Through the HTTP routes an owner actually uses, against real Postgres, with
  // the real activation service doing the writing and the auditing.
  describe('M20.3 · the owner turns messaging on, and off', () => {
    let bid: import('../../src/core/types/ids.js').BusinessId;
    const q = <T>(fn: (tx: import('kysely').Transaction<never>) => Promise<T>): Promise<T> =>
      import('../../src/db/client.js').then(({ withTenantTx }) => withTenantTx(prod.db, bid, fn as never));
    const post = async (path: string, cookie?: string) => prod.app.inject({
      method: 'POST', url: path, ...(cookie ? { headers: { cookie } } : {}) });
    const channel = () => q((tx) => sql<{ activated_at: Date | null; activated_by: string | null; status: string }>`
      select activated_at, activated_by, status from channels
       where business_id=${DEMO_BIZ} and kind='whatsapp'`.execute(tx as never).then((r) => r.rows[0] ?? null));
    const audits = (action: string) => q((tx) => sql<{ n: number; actor: string | null }>`
      select count(*)::int n, max(actor) actor from channel_audit
       where business_id=${DEMO_BIZ} and action=${action}`.execute(tx as never).then((r) => r.rows[0]!));

    beforeAll(async () => {
      const { parseBusinessId } = await import('../../src/core/types/ids.js');
      const { addToAllowlist } = await import('../../src/channels/allowlist.js');
      const p = parseBusinessId(DEMO_BIZ); if (!p.ok) throw new Error('fixture'); bid = p.value;
      // Every precondition met, so the only variable is the owner's decision.
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
        values (${DEMO_BIZ}, null, 'faq', 'm203-fixture', 'a taught fact', 'owner_confirmed')
        on conflict do nothing`.execute(tx as never));
      await q((tx) => sql`update products set is_active=true,
                            price_usd_per_unit=coalesce(price_usd_per_unit, 1.00)
                           where business_id=${DEMO_BIZ}`.execute(tx as never));
      await q((tx) => sql`
        insert into channels (business_id, kind, status, pilot_mode)
        values (${DEMO_BIZ}, 'whatsapp', 'connected', true)
        on conflict (business_id, kind) do update set status='connected', pilot_mode=true,
          activated_at=null, activated_by=null`.execute(tx as never));
      await q((tx) => sql`
        insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine, is_active)
        values (${DEMO_BIZ}, 'whatsapp', ${M203_REF}, 'm203-secret', 'service', true)
        on conflict (channel, external_ref) do update set is_active = true`.execute(tx as never));
      await addToAllowlist(prod.db, bid, ph('971500007070'), 'my own phone', 'owner');
    });

    it('M20.3.1: an installation with NO messaging provider cannot be activated', async () => {
      // The route passes this app's real provider state, which is 'disabled'.
      const cookie = await login();
      const r = await post('/app/factory/activate', cookie);
      expect(r.statusCode).toBe(302);
      expect((await channel())!.activated_at, 'activated with no provider').toBeNull();
      expect(decodeURIComponent(String(r.headers['location']))).toContain('Connect WhatsApp');
    });

    it('SECURITY: both actions reject an anonymous caller and change nothing', async () => {
      const before = await channel();
      for (const path of ['/app/factory/activate', '/app/factory/deactivate']) {
        const r = await post(path);
        expect(r.statusCode, path).toBe(302);
        expect(r.headers['location'], path).toBe('/login');
      }
      expect((await channel())!.activated_at).toEqual(before!.activated_at);
    });

    it('REFUSES to activate while a blocker stands, and names that same blocker', async () => {
      // Break a precondition that is INDEPENDENT of the readiness roll-up:
      // an empty allowlist means there is nobody she is allowed to message.
      const { archiveFromAllowlist, addToAllowlist } = await import('../../src/channels/allowlist.js');
      await archiveFromAllowlist(prod.db, bid, ph('971500007070'), 'owner');

      const cookie = await login();
      const r = await post('/app/factory/activate', cookie);
      expect(r.statusCode).toBe(302);
      expect((await channel())!.activated_at, 'activated despite a blocker').toBeNull();
      expect(decodeURIComponent(String(r.headers['location']))).toContain('start with your own');

      // the page and the refusal must say the SAME thing
      const page = await prod.app.inject({ method: 'GET', url: '/app/factory', headers: { cookie } });
      expect(page.body).toContain('start with your own');
      expect(page.body).not.toContain('action="/app/factory/activate"');

      await addToAllowlist(prod.db, bid, ph('971500007070'), 'my own phone', 'owner');
    });

    it('activates: writes through the service, audits the actor, and shows it at once', async () => {
      const { activate } = await import('../../src/channels/activation.js');
      const { loadFactory, renderFactory } = await import('../../src/api/web/factory.js');
      const beforeAudit = (await audits('activate')).n;
      const r = await activate(prod.db, bid, 'owner', { providerConfigured: true });
      expect(r, JSON.stringify(r)).toMatchObject({ ok: true });

      const ch = (await channel())!;
      expect(ch.activated_at).toBeInstanceOf(Date);
      expect(ch.activated_by).toBe('owner');

      const a = await audits('activate');
      expect(a.n).toBe(beforeAudit + 1);
      expect(a.actor).toBe('owner');

      // rendered as an installation that HAS a provider — this one has none
      const page = renderFactory(await loadFactory(prod.db, DEMO_BIZ, true), 'en');
      expect(page).toContain('is talking to real buyers');
      expect(page).toContain('action="/app/factory/deactivate"');
      expect(page).not.toContain('action="/app/factory/activate"');
    });

    it('deactivates: back to not-live, audited, and the data is still there', async () => {
      const beforeAudit = (await audits('deactivate')).n;
      const buyersBefore = await q((tx) => sql<{ n: number }>`
        select count(*)::int n from conversations`.execute(tx as never).then((x) => x.rows[0]!.n));

      const cookie = await login();
      const r = await post('/app/factory/deactivate', cookie);
      expect(r.statusCode).toBe(302);
      expect(cookie).toBeTruthy();

      expect((await channel())!.activated_at).toBeNull();
      const a = await audits('deactivate');
      expect(a.n).toBe(beforeAudit + 1);
      expect(a.actor).toBe('owner');

      // "nothing is deleted" is a promise the page makes — hold it to it
      expect(await q((tx) => sql<{ n: number }>`select count(*)::int n from conversations`
        .execute(tx as never).then((x) => x.rows[0]!.n))).toBe(buyersBefore);

      const page = await prod.app.inject({ method: 'GET', url: '/app/factory', headers: { cookie } });
      expect(page.body).not.toContain('is talking to real buyers');
    });

    it('SECURITY: activating one factory leaves another factory untouched', async () => {
      const SANDBOX = '5a4d0000-0000-4000-8000-0000000000b1';
      const { parseBusinessId } = await import('../../src/core/types/ids.js');
      const { withTenantTx } = await import('../../src/db/client.js');
      const sb = parseBusinessId(SANDBOX); if (!sb.ok) throw new Error('fixture');
      const sandboxChannel = () => withTenantTx(prod.db, sb.value, (tx) =>
        sql<{ n: number }>`select count(*)::int n from channels where activated_at is not null`
          .execute(tx as never).then((r) => r.rows[0]!.n));

      const { activate, deactivate } = await import('../../src/channels/activation.js');
      // the previous test rolled back, which disconnects (State D) — an owner
      // reconnects before starting again, so do the same here
      const { reconnectChannel } = await import('../../src/api/web/channels.js');
      await reconnectChannel(prod.db, DEMO_BIZ, 'owner');
      await activate(prod.db, bid, 'owner', { providerConfigured: true });
      expect((await channel())!.activated_at).toBeInstanceOf(Date);
      expect(await sandboxChannel(), 'the other tenant was activated too').toBe(0);
      await deactivate(prod.db, bid, 'owner', 'test cleanup');
    });
  });

  // ── M20.4 · the M21 blockers, reproduced against real Postgres ──────────────
  describe('M20.4 · the owner completion path', () => {
    let bid: import('../../src/core/types/ids.js').BusinessId;
    const q = <T>(fn: (tx: import('kysely').Transaction<never>) => Promise<T>): Promise<T> =>
      import('../../src/db/client.js').then(({ withTenantTx }) => withTenantTx(prod.db, bid, fn as never));
    const post = (path: string, body: string, cookie: string) => prod.app.inject({
      method: 'POST', url: path, headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, payload: body });

    beforeAll(async () => {
      const { parseBusinessId } = await import('../../src/core/types/ids.js');
      const p = parseBusinessId(DEMO_BIZ); if (!p.ok) throw new Error('fixture'); bid = p.value;
    });

    it('F-07: the M21 phone is rejected WITHOUT discarding the rest of the form', async () => {
      const cookie = await login();
      const r = await post('/app/settings',
        'name=' + encodeURIComponent('义乌宏发保温杯厂')
        + '&description=' + encodeURIComponent('不锈钢保温杯、饭盒、竹砧板。')
        + '&location=' + encodeURIComponent('浙江义乌')
        + `&contact_phone=${ph('865798500123')}4`, cookie);       // the exact M21 input

      expect(r.statusCode, 'must re-render, not redirect away').toBe(200);
      // her words come back
      expect(r.body).toContain('不锈钢保温杯、饭盒、竹砧板。');
      expect(r.body).toContain('浙江义乌');
      expect(r.body).toContain(ph('8657985001234'));
      // and the failing field is named
      expect(r.body).toContain('class="fld bad"');
      expect(r.body).toContain('role="alert"');
      // nothing was written
      const row = await q((tx) => sql<{ n: number }>`
        select count(*)::int n from businesses where id=${DEMO_BIZ} and location='浙江义乌'`
        .execute(tx as never).then((x) => x.rows[0]!.n));
      expect(row).toBe(0);
    });

    it('F-06: the owner can add and remove a number, and it persists + audits', async () => {
      const cookie = await login();
      const before = await q((tx) => sql<{ n: number }>`
        select count(*)::int n from pilot_allowlist where phone=${ph('8613900002222')}`
        .execute(tx as never).then((x) => x.rows[0]!.n));
      expect(before).toBe(0);

      // Typed the way an owner types it — spaces and a plus — so normalisation
      // is what is under test. Same number as the assertions above.
      const N = ph('8613900002222');
      const typed = `+${N.slice(0, 2)} ${N.slice(2, 5)} ${N.slice(5, 9)} ${N.slice(9)}`;
      const add = await post('/app/factory/allowlist/add',
        'phone=' + encodeURIComponent(typed) + '&label=' + encodeURIComponent('my own phone'), cookie);
      expect(add.statusCode).toBe(302);
      // SUCCESS MESSAGE MAPS TO PERSISTED STATE
      const stored = await q((tx) => sql<{ phone: string; label: string | null; archived: Date | null }>`
        select phone, label, archived_at as archived from pilot_allowlist where phone=${ph('8613900002222')}`
        .execute(tx as never).then((x) => x.rows[0]!));
      expect(stored.phone).toBe(ph('8613900002222'));        // normalised
      expect(stored.label).toBe('my own phone');
      expect(stored.archived).toBeNull();
      expect(decodeURIComponent(String(add.headers['location']))).toContain('can now receive');

      const page = await prod.app.inject({ method: 'GET', url: '/app/factory', headers: { cookie } });
      expect(page.body).toContain('my own phone');

      const rm = await post('/app/factory/allowlist/remove', `phone=${ph('861390000222')}2`, cookie);
      expect(rm.statusCode).toBe(302);
      const after = await q((tx) => sql<{ archived: Date | null }>`
        select archived_at as archived from pilot_allowlist where phone=${ph('8613900002222')}`
        .execute(tx as never).then((x) => x.rows[0]!));
      expect(after.archived, 'archive, never delete').not.toBeNull();

      const audits = await q((tx) => sql<{ n: number }>`
        select count(*)::int n from channel_audit where action in ('allowlist_add','allowlist_remove')`
        .execute(tx as never).then((x) => x.rows[0]!.n));
      expect(audits).toBeGreaterThanOrEqual(2);
    });

    it('F-06 SECURITY: both allowlist actions reject an anonymous caller', async () => {
      for (const p of ['/app/factory/allowlist/add', '/app/factory/allowlist/remove']) {
        const r = await prod.app.inject({ method: 'POST', url: p,
          headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: `phone=${ph('861390000333')}3` });
        expect(r.statusCode, p).toBe(302);
        expect(r.headers['location'], p).toBe('/login');
      }
      const leaked = await q((tx) => sql<{ n: number }>`
        select count(*)::int n from pilot_allowlist where phone=${ph('8613900003333')}`
        .execute(tx as never).then((x) => x.rows[0]!.n));
      expect(leaked).toBe(0);
    });

    it('F-08: reconnect on a factory with NO channel row reports the truth', async () => {
      const { reconnectChannel } = await import('../../src/api/web/channels.js');
      const OTHER = '5a4d0000-0000-4000-8000-0000000000b1';       // sandbox tenant: no channel
      const r = await reconnectChannel(prod.db, OTHER, 'owner');
      expect(r.code, 'must not claim success on zero rows').toBe('nothing_to_connect');
    });

    it('F-09: a reply while messaging is off is refused up front, and named', async () => {
      const { withTenantTx } = await import('../../src/db/client.js');
      const { ensureConversation } = await import('../../src/db/channels.js');
      const cid = await withTenantTx(prod.db, bid, async (tx) => {
        const c = await ensureConversation(tx, bid, ph('971500006061'), 'F09 Buyer');
        await sql`update conversations set assigned_to='owner' where id=${c.conversationId}`.execute(tx as never);
        return c.conversationId;
      });
      const cookie = await login();
      const r = await post(`/app/inbox/${cid}/reply`, 'text=' + encodeURIComponent('这条不该发出去'), cookie);
      expect(r.statusCode).toBe(302);
      const flash = decodeURIComponent(String(r.headers['location']));
      expect(flash).toMatch(/Not sent|没有发出去|لم يُرسَل/);
      // and NOTHING was queued — the owner is not left with a pending row
      const queued = await q((tx) => sql<{ n: number }>`
        select count(*)::int n from outbound_messages where conversation_id=${cid}`
        .execute(tx as never).then((x) => x.rows[0]!.n));
      expect(queued).toBe(0);
    });
  });

  // ── M18.2 pilot allowlist, against real Postgres ────────────────────────────
  // The rule that stands between a bug and a real buyer's phone. Every check
  // here goes through the REAL send gate and the REAL store — no fakes.
  describe('M18.2 · pilot allowlist', () => {
    const ALLOWED = ph('971500001111');
    const BLOCKED = ph('971500002222');
    let bid: import('../../src/core/types/ids.js').BusinessId;
    const q = <T>(fn: (tx: import('kysely').Transaction<never>) => Promise<T>): Promise<T> =>
      import('../../src/db/client.js').then(({ withTenantTx }) => withTenantTx(prod.db, bid, fn as never));

    // A send that reaches the simulator is a send that WOULD have gone to a
    // real buyer — exactly what the allowlist must prevent.
    beforeAll(async () => {
      const { parseBusinessId } = await import('../../src/core/types/ids.js');
      const p = parseBusinessId(DEMO_BIZ); if (!p.ok) throw new Error('fixture'); bid = p.value;
      // Put the demo channel in pilot mode explicitly (it is the default too).
      // M20.1 — and LIVE: activation now binds every send, so these allowlist
      // cases would otherwise all refuse for the wrong reason. Set directly
      // rather than through activate(), which has preconditions of its own —
      // those get their own tests below.
      await q((tx) => sql`
        update channels set pilot_mode = true, activated_at = now(), activated_by = 'test'
         where business_id=${DEMO_BIZ}`.execute(tx as never));
    });

    it('owner adds a number: normalized on the way in, and audited', async () => {
      const { addToAllowlist, listAllowlist } = await import('../../src/channels/allowlist.js');
      const typedByOwner = `+${ALLOWED.slice(0, 3)} ${ALLOWED.slice(3, 5)} ${ALLOWED.slice(5, 8)} ${ALLOWED.slice(8)}`;
      const r = await addToAllowlist(prod.db, bid, typedByOwner, 'my phone', 'owner');
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
         where business_id=${DEMO_BIZ} and action='send_refused'`.execute(tx as never).then((x) => x.rows[0]!.n));

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

      // and the refusal is visible to the owner, NAMED FOR WHAT IT WAS.
      // M22: this used to assert only that a row appeared. The verb was
      // hardcoded to 'blocked_not_allowlisted' for every reason, so a
      // not_activated refusal was recorded as an allowlist block and this test
      // passed anyway. Assert the reason, or the audit trail can lie again.
      const rows = await q((tx) => sql<{ action: string; detail: { reason?: string } }>`
        select action, detail from channel_audit
         where business_id=${DEMO_BIZ} and action='send_refused'
         order by at desc limit 1`.execute(tx as never).then((x) => x.rows));
      const after = await q((tx) => sql<{ n: number }>`
        select count(*)::int n from channel_audit
         where business_id=${DEMO_BIZ} and action='send_refused'`.execute(tx as never).then((x) => x.rows[0]!.n));
      expect(after).toBe(before + 1);
      expect(rows[0]?.detail?.reason).toBe('not_allowlisted');

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
      const TEMP = ph('971500003333');
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
  // ── M20.1 · activation binds the real send path ─────────────────────────────
  // Not a gate unit test: the REAL channelStore resolves activation from the
  // REAL channels row, the REAL worker drives, and a spy adapter stands in for
  // the provider so a "sent" here is a message that would have reached a buyer.
  describe('M20.1 · nothing reaches a buyer before the owner activates', () => {
    const BUYER = ph('971500005551');
    let bid: import('../../src/core/types/ids.js').BusinessId;
    let cid = '';
    /** What actually reached the provider — a send here would have reached a buyer.
     *  Uses the file-wide simulator: wamids must stay unique across describes. */
    const delivered = () => m18Sim.sendCount();
    const q = <T>(fn: (tx: import('kysely').Transaction<never>) => Promise<T>): Promise<T> =>
      import('../../src/db/client.js').then(({ withTenantTx }) => withTenantTx(prod.db, bid, fn as never));

    const drive = async () => {
      const { channelStore } = await import('../../src/db/channels.js');
      const { driveConversationOutbound } = await import('../../src/outbound/worker.js');
      return q((tx) => driveConversationOutbound(
        { store: channelStore(tx as never, bid), adapter: m18Adapter, now: () => new Date() }, cid));
    };
    const queueOne = async (body: string, origin: 'employee' | 'owner') => {
      const { enqueueOutboundRow } = await import('../../src/db/channels.js');
      await q((tx) => enqueueOutboundRow(tx as never, bid, cid, body, origin));
    };
    /** M3 orders sends: a queued row waits for the previous one to be DELIVERED.
     *  Settle prior rows so these cases isolate the activation decision. */
    const settle = () => q((tx) => sql`
      update outbound_messages set status='delivered'
       where conversation_id = ${cid} and status = 'sent'`.execute(tx as never));
    const setActivated = (on: boolean) => q((tx) => sql`
      update channels set activated_at = ${on ? new Date() : null}, activated_by = ${on ? 'test' : null}
       where business_id = ${DEMO_BIZ} and kind = 'whatsapp'`.execute(tx as never));

    beforeAll(async () => {
      const { parseBusinessId } = await import('../../src/core/types/ids.js');
      const { ensureConversation } = await import('../../src/db/channels.js');
      const { addToAllowlist } = await import('../../src/channels/allowlist.js');
      const p = parseBusinessId(DEMO_BIZ); if (!p.ok) throw new Error('fixture'); bid = p.value;
      await addToAllowlist(prod.db, bid, BUYER, 'm20 buyer', 'owner');
      cid = await q(async (tx) => {
        const c = await ensureConversation(tx as never, bid, BUYER, 'M20 Buyer');
        await sql`update conversations set assigned_to=null where id=${c.conversationId}`.execute(tx as never);
        // open the 24h window so this isolates ACTIVATION, not the window
        await sql`update channels set last_inbound_at=now(), status='connected', pilot_mode=true
                   where business_id=${DEMO_BIZ}`.execute(tx as never);
        return c.conversationId;
      });
    });

    it('connected but NOT activated: the employee reply is canceled, never delivered', async () => {
      await setActivated(false);
      const before = delivered();
      await queueOne('Employee reply before go-live', 'employee');
      const effects = await drive();
      expect(delivered() - before, 'a message reached the provider before activation').toBe(0);
      expect(effects.some((e) => e.kind === 'canceled' && e.reason === 'not_activated'),
        JSON.stringify(effects)).toBe(true);
    });

    it('the OWNER’s own reply is refused too — activation has no exceptions', async () => {
      await setActivated(false);
      const before = delivered();
      await queueOne('Owner speaking before go-live', 'owner');
      const effects = await drive();
      expect(delivered() - before).toBe(0);
      expect(effects.some((e) => e.kind === 'canceled' && e.reason === 'not_activated')).toBe(true);
    });

    it('the refusal is recorded where the owner can see it, not swallowed', async () => {
      const rows = await q((tx) => sql<{ n: number }>`
        select count(*)::int n from outbound_messages
         where conversation_id = ${cid} and status = 'canceled'
           and last_error like '%not_activated%'`.execute(tx as never).then((r) => r.rows[0]!.n));
      expect(rows).toBeGreaterThanOrEqual(2);   // the employee one and the owner one
    });

    it('after the owner activates, the same message goes out', async () => {
      await setActivated(true);
      const before = delivered();
      await queueOne('Reply after go-live', 'employee');
      const effects = await drive();
      expect(effects.some((e) => e.kind === 'sent'), JSON.stringify(effects)).toBe(true);
      expect(delivered() - before).toBe(1);
      // and it is the row we queued, marked sent with a provider id
      const row = await q((tx) => sql<{ status: string; pid: string | null }>`
        select status, provider_message_id pid from outbound_messages
         where conversation_id=${cid} and body='Reply after go-live'`
        .execute(tx as never).then((r) => r.rows[0]!));
      expect(row.status).toBe('sent');
      expect(row.pid).toBeTruthy();
    });

    it('deactivating puts it back — the rollback is real, not cosmetic', async () => {
      const { deactivate } = await import('../../src/channels/activation.js');
      await deactivate(prod.db, bid, 'owner', 'rollback drill');
      await settle();
      const before = delivered();
      await queueOne('Reply after rollback', 'employee');
      const effects = await drive();
      expect(delivered() - before).toBe(0);
      expect(effects.some((e) => e.kind === 'canceled')).toBe(true);
    });

    it('CONNECTED is not ACTIVATED: reconnecting does not make the system live', async () => {
      const { reconnectChannel } = await import('../../src/api/web/channels.js');
      await reconnectChannel(prod.db, DEMO_BIZ, 'owner');       // restores the connection
      const row = await q((tx) => sql<{ status: string; activated_at: Date | null }>`
        select status, activated_at from channels where business_id=${DEMO_BIZ} and kind='whatsapp'`
        .execute(tx as never).then((r) => r.rows[0]!));
      expect(row.status).toBe('connected');
      expect(row.activated_at, 'reconnect must not activate').toBeNull();

      await settle();
      const before = delivered();
      await queueOne('Reply after a reconnect', 'employee');
      const effects = await drive();
      expect(delivered() - before, 'a reconnect made the system live').toBe(0);
      expect(effects.some((e) => e.kind === 'canceled' && e.reason === 'not_activated')).toBe(true);
    });
  });

  describe('M18.1/M18.4 · activation and the rollback drill', () => {
    const BUYER = ph('971500004444');
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
      // M20.1 — this block is ABOUT activation, so it starts from not-activated
      // whatever a sibling describe left behind. Connected, but not live.
      await q((tx) => sql`update channels set activated_at = null, activated_by = null
                           where business_id=${DEMO_BIZ}`.execute(tx as never));
    });

    it('REFUSES while the factory is not ready — and names the reason', async () => {
      const { activate, activationPreconditions } = await import('../../src/channels/activation.js');
      // clear the rotation confirmation so the M18.0 gate is unmet
      await q((tx) => sql`
        insert into onboarding_state (business_id, secrets_rotated_at) values (${DEMO_BIZ}, null)
        on conflict (business_id) do update set secrets_rotated_at = null`.execute(tx as never));

      const pre = await activationPreconditions(prod.db, bid, { providerConfigured: true });
      expect(pre.blockers.length).toBeGreaterThan(0);
      expect(pre.blockers).toContain('secrets_not_rotated');   // the M18.0 gate holds

      const r = await activate(prod.db, bid, 'owner', { providerConfigured: true });
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
      const pre = await activationPreconditions(prod.db, bid, { providerConfigured: true });
      expect(pre.allowlistCount).toBe(0);
      expect(pre.blockers).toContain('no_allowlist');

      // restore: the drill below needs a reachable buyer
      await addToAllowlist(prod.db, bid, BUYER, 'friendly buyer', 'owner');
    });

    // M19.1 — the guard that protects the irreversible step. /health cannot see
    // a stale schema (it probes with `select 1`, which succeeds on the OLD
    // schema), and in disabled mode nothing drives outbound, so a version gap
    // would stay invisible until the first real buyer message.
    it('M19.1 — the schema version is checked, and it matches this build', async () => {
      const { readSchemaState, REQUIRED_SCHEMA_VERSION } = await import('../../src/db/schemaVersion.js');
      const state = await readSchemaState(prod.db);
      expect(state.actual).toBe(REQUIRED_SCHEMA_VERSION);   // migrations are current here
      expect(state.ok).toBe(true);
      expect(state.stale).toBe(false);

      const { activationPreconditions } = await import('../../src/channels/activation.js');
      const pre = await activationPreconditions(prod.db, bid, { providerConfigured: true });
      expect(pre.schema.ok).toBe(true);
      expect(pre.blockers).not.toContain('schema_stale');
    });

    it('M19.1 — a database BEHIND this build refuses activation (schema_stale)', async () => {
      const { activate, activationPreconditions } = await import('../../src/channels/activation.js');
      const { REQUIRED_SCHEMA_VERSION } = await import('../../src/db/schemaVersion.js');

      // simulate the exact M19 hazard: code deployed ahead of the migration
      await q((tx) => sql`delete from _migrations where version >= ${REQUIRED_SCHEMA_VERSION}`.execute(tx as never))
        .catch(async () => {
          // the app role has no DELETE — use the admin connection semantics via update
          await q((tx) => sql`update _migrations set version = version - 100
                               where version >= ${REQUIRED_SCHEMA_VERSION}`.execute(tx as never));
        });

      const pre = await activationPreconditions(prod.db, bid, { providerConfigured: true });
      expect(pre.schema.ok, JSON.stringify(pre.schema)).toBe(false);
      expect(pre.blockers[0]).toBe('schema_stale');        // reported FIRST

      const r = await activate(prod.db, bid, 'owner', { providerConfigured: true });
      expect(r).toEqual({ ok: false, code: 'schema_stale' });

      // restore so the drill below runs against a current schema
      await q((tx) => sql`update _migrations set version = version + 100
                           where version <= ${REQUIRED_SCHEMA_VERSION - 100}`.execute(tx as never));
      expect((await activationPreconditions(prod.db, bid, { providerConfigured: true })).schema.ok).toBe(true);
    });

    it('DRILL 1 — enable: activation succeeds, is audited, and keeps pilot mode ON', async () => {
      const { activate, activationState } = await import('../../src/channels/activation.js');
      const before = await audits('activate');
      const r = await activate(prod.db, bid, 'owner', { providerConfigured: true });
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
      const stranger = await drive(ph('971509999999'), 'MUST NEVER BE DELIVERED');
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
      const r = await activate(prod.db, bid, 'owner', { providerConfigured: true });
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

/**
 * M22 — every gateOutbound refusal, driven through the REAL worker against a
 * real database, then read back through the owner's own read model.
 *
 * The pure tests (tests/parity/refusals.test.ts) prove the copy is complete and
 * honest. What can only be proven here is the part that was broken: that the
 * reason RECORDED is the reason it was actually refused for, and that the owner
 * can see it. Before M22, `auditBlocked` wrote `blocked_not_allowlisted` for
 * every reason and four of the six refusals wrote nothing at all.
 */
d('M22 · refusal visibility over real data (requires DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let bid: import('../../src/core/types/ids.js').BusinessId;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  const M22_BIZ = DEMO_BIZ;

  const q = <T>(fn: (tx: import('kysely').Transaction<never>) => Promise<T>): Promise<T> =>
    import('../../src/db/client.js').then(({ withTenantTx }) => withTenantTx(prod.db, bid, fn as never));

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const p = parseBusinessId(M22_BIZ); if (!p.ok) throw new Error('fixture'); bid = p.value;
    sim = whatsappSimulator([], { tag: RUN_NS });
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!,
      ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok',
      META_WHATSAPP_PHONE_NUMBER_ID: `1${ph('2345678901234')}5`,
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765',
      META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'm22-verify-token',
      CREDENTIAL_KEY: 'b'.repeat(64), PORT: 0,
    }, { adapter: sim.adapter, logger: false });
  }, 30_000);

  afterAll(async () => { await prod?.close(); });

  /**
   * Queue one employee message to `phone` and drive the worker over it under
   * whatever channel/conversation state the caller set up. Returns what the
   * worker did plus what the owner would be shown.
   */
  const driveOne = async (phone: string, label: string) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { ensureConversation, enqueueOutboundRow, channelStore } = await import('../../src/db/channels.js');
    const { driveConversationOutbound } = await import('../../src/outbound/worker.js');
    const { loadRefusals } = await import('../../src/api/web/refusals.js');

    const cid = await withTenantTx(prod.db, bid, async (tx) => {
      const c = await ensureConversation(tx, bid, phone, label);
      await sql`update conversations set assigned_to=null where id=${c.conversationId}`.execute(tx as never);
      await sql`insert into messages (conversation_id, direction, input_type, text_content, sent_at)
                values (${c.conversationId},'inbound','text','hello',now())`.execute(tx as never);
      await enqueueOutboundRow(tx, bid, c.conversationId, 'a reply the buyer never sees', 'employee');
      return c.conversationId;
    });
    const effects = await withTenantTx(prod.db, bid, (tx) =>
      driveConversationOutbound(
        { store: channelStore(tx as never, bid), adapter: sim.adapter, now: () => new Date() }, cid));
    const refusals = await loadRefusals(prod.db, M22_BIZ, { conversationId: cid });
    const audit = await q((tx) => sql<{ action: string; detail: { reason?: string } }>`
      select action, detail from channel_audit
       where business_id=${M22_BIZ} and action='send_refused'
       order by at desc limit 1`.execute(tx as never).then((r) => r.rows[0]));
    const row = await q((tx) => sql<{ status: string; cancel_reason: string | null }>`
      select status, cancel_reason from outbound_messages
       where conversation_id=${cid} order by seq desc limit 1`
      .execute(tx as never).then((r) => r.rows[0]!));
    return { cid, effects, refusals, audit, row };
  };

  const setChannel = (patch: string) => q((tx) =>
    sql.raw(`update channels set ${patch} where business_id='${M22_BIZ}' and kind='whatsapp'`)
      .execute(tx as never));

  it('not_activated: the row is canceled, audited by its REAL reason, and shown', async () => {
    await setChannel(`activated_at = null, activated_by = null, pilot_mode = true`);
    const { effects, refusals, audit, row } = await driveOne(ph('971500007701'), 'M22 A');

    expect(effects).toContainEqual(expect.objectContaining({ kind: 'canceled', reason: 'not_activated' }));
    expect(effects.some((e) => e.kind === 'sent')).toBe(false);          // nothing left the building
    expect(row.status).toBe('canceled');
    expect(row.cancel_reason).toBe('canceled: not_activated');
    // THE bug this milestone fixes: the verb used to say 'blocked_not_allowlisted'.
    expect(audit?.action).toBe('send_refused');
    expect(audit?.detail?.reason).toBe('not_activated');
    expect(refusals.map((r) => r.reason)).toEqual(['not_activated']);    // and the owner sees it
  });

  it('not_allowlisted: refused for the allowlist, and recorded as such', async () => {
    await setChannel(`activated_at = now(), activated_by = 'test', pilot_mode = true`);
    const { effects, refusals, audit } = await driveOne(ph('971500007702'), 'M22 B');

    expect(effects).toContainEqual(expect.objectContaining({ kind: 'canceled', reason: 'not_allowlisted' }));
    expect(audit?.detail?.reason).toBe('not_allowlisted');
    expect(refusals.map((r) => r.reason)).toEqual(['not_allowlisted']);
  });

  it('handed_off: a human holds it, so she stays silent — and says so', async () => {
    await setChannel(`activated_at = now(), activated_by = 'test', pilot_mode = false`);
    const { withTenantTx } = await import('../../src/db/client.js');
    const { ensureConversation, enqueueOutboundRow, channelStore } = await import('../../src/db/channels.js');
    const { driveConversationOutbound } = await import('../../src/outbound/worker.js');
    const { loadRefusals } = await import('../../src/api/web/refusals.js');

    const cid = await withTenantTx(prod.db, bid, async (tx) => {
      const c = await ensureConversation(tx, bid, ph('971500007703'), 'M22 C');
      await sql`insert into messages (conversation_id, direction, input_type, text_content, sent_at)
                values (${c.conversationId},'inbound','text','hello',now())`.execute(tx as never);
      await enqueueOutboundRow(tx, bid, c.conversationId, 'she must not say this', 'employee');
      await sql`update conversations set assigned_to='owner' where id=${c.conversationId}`.execute(tx as never);
      return c.conversationId;
    });
    const effects = await withTenantTx(prod.db, bid, (tx) =>
      driveConversationOutbound(
        { store: channelStore(tx as never, bid), adapter: sim.adapter, now: () => new Date() }, cid));

    expect(effects).toContainEqual(expect.objectContaining({ kind: 'canceled', reason: 'handed_off' }));
    expect(effects.some((e) => e.kind === 'sent')).toBe(false);
    // Before M22 this refusal wrote NO audit row at all.
    const audit = await q((tx) => sql<{ detail: { reason?: string } }>`
      select detail from channel_audit where business_id=${M22_BIZ} and action='send_refused'
       order by at desc limit 1`.execute(tx as never).then((r) => r.rows[0]));
    expect(audit?.detail?.reason).toBe('handed_off');
    expect((await loadRefusals(prod.db, M22_BIZ, { conversationId: cid })).map((r) => r.reason))
      .toEqual(['handed_off']);
  });

  it('window_closed: outside the day WhatsApp allows, nothing is sent and the owner is told', async () => {
    await setChannel(`activated_at = now(), activated_by = 'test', pilot_mode = false`);
    const { withTenantTx } = await import('../../src/db/client.js');
    const { ensureConversation, enqueueOutboundRow, channelStore } = await import('../../src/db/channels.js');
    const { driveConversationOutbound } = await import('../../src/outbound/worker.js');
    const { loadRefusals } = await import('../../src/api/web/refusals.js');

    const cid = await withTenantTx(prod.db, bid, async (tx) => {
      const c = await ensureConversation(tx, bid, ph('971500007704'), 'M22 D');
      await sql`update conversations set assigned_to=null where id=${c.conversationId}`.execute(tx as never);
      await enqueueOutboundRow(tx, bid, c.conversationId, 'a reply three days late', 'employee');
      // The buyer last spoke three days ago, so the 24-hour window is long shut.
      // NOTE: the worker reads `channels.last_inbound_at`, not the messages
      // table and not a per-conversation column — an old row in `messages`
      // leaves the window wide open, and the first version of this test sent a
      // real message because of it. Set the fact the gate actually reads.
      await sql`update channels set last_inbound_at = now() - interval '3 days'
                 where business_id=${M22_BIZ} and kind='whatsapp'`.execute(tx as never);
      return c.conversationId;
    });
    const effects = await withTenantTx(prod.db, bid, (tx) =>
      driveConversationOutbound(
        { store: channelStore(tx as never, bid), adapter: sim.adapter, now: () => new Date() }, cid));

    // This is the one that happens every night in a real pilot, and the one
    // that was completely silent: canceled, no audit row, nothing shown.
    expect(effects).toContainEqual(expect.objectContaining({ kind: 'canceled', reason: 'window_closed' }));
    expect(effects.some((e) => e.kind === 'sent')).toBe(false);
    const shown = await loadRefusals(prod.db, M22_BIZ, { conversationId: cid });
    expect(shown.map((r) => r.reason)).toEqual(['window_closed']);
    expect(shown[0]?.buyer).toBe('M22 D');
  });

  it('the count Today shows equals the refusals it can list — never an estimate', async () => {
    const { countRefusals, loadRefusals } = await import('../../src/api/web/refusals.js');
    const n = await countRefusals(prod.db, M22_BIZ);
    const listed = await loadRefusals(prod.db, M22_BIZ, { limit: 500 });
    expect(n).toBe(listed.length);
    expect(n).toBeGreaterThan(0);                    // the cases above really landed
  });

  it('a refused message is never delivered, however it was refused', () => {
    // The simulator IS the provider here: anything that reaches it would have
    // reached a real buyer. Every message queued in this describe was refused
    // for a different reason, so the strongest true statement is that the
    // provider was never called at all.
    expect(sim.sendCount()).toBe(0);
    expect(sim.sentIds).toEqual([]);
  });

  it('activation refusals are their own event, not a send refusal (F-10)', async () => {
    const { activate } = await import('../../src/channels/activation.js');
    await setChannel(`activated_at = null, activated_by = null, status = 'disconnected'`);
    const before = await q((tx) => sql<{ n: number }>`
      select count(*)::int n from channel_audit
       where business_id=${M22_BIZ} and action='activation_refused'`
      .execute(tx as never).then((r) => r.rows[0]!.n));

    const r = await activate(prod.db, bid, 'owner', { providerConfigured: true });
    expect(r.ok).toBe(false);

    const after = await q((tx) => sql<{ n: number; detail: { blockers?: string[] } }>`
      select (select count(*)::int from channel_audit
               where business_id=${M22_BIZ} and action='activation_refused') as n,
             (select detail from channel_audit
               where business_id=${M22_BIZ} and action='activation_refused'
               order by at desc limit 1) as detail`
      .execute(tx as never).then((x) => x.rows[0]!));
    expect(after.n).toBe(before + 1);
    expect(after.detail?.blockers?.length).toBeGreaterThan(0);
    // and it did NOT masquerade as a blocked send
    expect(r.ok === false && r.code).toBeTruthy();
  });
});

/**
 * M23 — the tenant guard at the place it matters: BOOT.
 *
 * The pure tests cover every decision; the db tests cover the read. This proves
 * the guard is actually WIRED — a guard nothing calls is not a guard, which is
 * the exact lesson `assertSchemaCurrent` was hardened by in the release audit.
 */
d('M23 · boot refuses a wrong pilot tenant (requires DATABASE_URL)', () => {
  const SANDBOX = '5a4d0000-0000-4000-8000-0000000000b1';
  const cfg = (pilot: string) => ({
    provider: 'disabled' as const,
    DATABASE_URL: DATABASE_URL!,
    ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
    CREDENTIAL_KEY: 'c'.repeat(64),
    PORT: 0,
    __pilot: pilot,
  });

  /** buildProduction reads PILOT_BUSINESS_ID from process.env, not from cfg. */
  const bootWith = async (pilot: string | undefined, production: boolean) => {
    const { buildProduction } = await import('../../src/main.js');
    const prevPilot = process.env['PILOT_BUSINESS_ID'];
    const prevEnv = process.env['NODE_ENV'];
    if (pilot === undefined) delete process.env['PILOT_BUSINESS_ID'];
    else process.env['PILOT_BUSINESS_ID'] = pilot;
    if (production) process.env['NODE_ENV'] = 'production';
    try {
      const p = await buildProduction(cfg(pilot ?? '') as never, { logger: false });
      await p.close();
      return null;
    } catch (e) {
      return (e as Error).message;
    } finally {
      if (prevPilot === undefined) delete process.env['PILOT_BUSINESS_ID'];
      else process.env['PILOT_BUSINESS_ID'] = prevPilot;
      if (prevEnv === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = prevEnv;
    }
  };

  it('refuses to boot in production when the tenant does not exist', async () => {
    const err = await bootWith('00000000-0000-4000-8000-00000000dead', true);
    expect(err, 'production booted on a nonexistent tenant').not.toBeNull();
    expect(err).toMatch(/no business with that id exists/);
    expect(err).toContain('provision-factory.mjs');
  }, 30_000);

  it('refuses to boot in production when the tenant IS the practice sandbox', async () => {
    const err = await bootWith(SANDBOX, true);
    expect(err, 'production booted inside the practice sandbox').not.toBeNull();
    expect(err).toMatch(/PRACTICE SANDBOX/);
  }, 30_000);

  it('boots in production against a real, distinct factory', async () => {
    // This run's own seeded tenant — real, and not the sandbox.
    expect(await bootWith(DEMO_BIZ, true)).toBeNull();
  }, 30_000);

  it('outside production it warns and still serves — a developer is not locked out', async () => {
    expect(await bootWith('00000000-0000-4000-8000-00000000dead', false)).toBeNull();
  }, 30_000);
});
