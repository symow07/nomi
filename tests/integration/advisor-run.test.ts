import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant } from './tenant.js';

/**
 * THE ADVISOR RUN (2026-10-06), on the real app and a real database.
 *   · The assistant's page moved one level into Settings: the old address still arrives — a page sent on with
 *     the rest of its address kept, a form posted from an old tab goes on as itself (308) and is handled once.
 *   · The advisor's page: signed in only; and a question asked on it writes nothing anywhere — no transaction
 *     that writes is begun while it is answered (the database's own counter says so; a real save is the control).
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dda10000-0000-4000-8000-${RUN}0001`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const CODE = 'advisor-run-owner-code';

d('the advisor run · the assistant in Settings, the advisor walled off (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let cookie = '';
  const get = (url: string, c = cookie) => app.inject({ method: 'GET', url, headers: c ? { cookie: c } : {} });
  const post = (url: string, payload: string, c = cookie) => app.inject({ method: 'POST', url, payload, headers: { ...(c ? { cookie: c } : {}), ...FORM } });
  /** The next transaction id the database would hand out: any transaction that writes moves it; reading never does. */
  const horizon = async () => BigInt((await sql<{ x: string }>`select pg_snapshot_xmax(pg_current_snapshot())::text as x`.execute(db)).rows[0]!.x);

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    await withTenantTx(db, bid.value, (t) => sql`insert into businesses (id, name) values (${BIZ}, 'Advisor Run Co') on conflict (id) do nothing`.execute(t));
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET, employeeName: 'Lily', avatar: '👩‍💼',
      provider: 'disabled', secureCookie: false, messagingEnabled: false, kickOutbound: async () => {}, kickDrive: async () => {},
      autonomyReleased: () => true,
      // Nothing here looks a sending domain up; a lookup that is never answered says so if anything tries.
      resolveDns: async () => { throw new Error('no DNS in this test'); },
    });
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(CODE)}`, headers: FORM });
    cookie = String(res.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  });
  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('Settings opens on the assistant\'s row, and the row opens the assistant\'s page, the control first', async () => {
    const settings = await get('/app/settings');
    expect(settings.statusCode).toBe(200);
    expect(settings.body).toContain('href="/app/settings/assistant"');
    const page = await get('/app/settings/assistant');
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('id="on-her-own"');
    expect(page.body).toContain('action="/app/settings/assistant/autonomy"');
    // the rail lights Settings here, and offers the advisor in the assistant's old slot
    expect(page.body).toMatch(/<a href="\/app\/settings" class="navlink active"/);
    expect(page.body).toContain('href="/app/advisor"');
    expect(page.body).not.toContain('href="/app/employee');
  });

  it('the old address still arrives: pages sent on with their address kept, a form posted from an old tab handled once', async () => {
    for (const [from, to] of [['/app/employee', '/app/settings/assistant'], ['/app/employee/one-kind', '/app/settings/assistant/one-kind']]) {
      const r = await get(from!);
      expect(r.statusCode, from).toBe(302);
      expect(r.headers['location'], from).toBe(to);
    }
    const old = await post('/app/employee/autonomy', 'level=talks');
    expect(old.statusCode).toBe(308);
    expect(old.headers['location']).toBe('/app/settings/assistant/autonomy');
    // following it, as a browser does with the same method and fields, is the one save
    const saved = await post(String(old.headers['location']), 'level=talks');
    expect(saved.statusCode).toBe(302);
    expect(saved.headers['location']).toBe('/app/settings/assistant#on-her-own');
  });

  it('the advisor: signed out, sent to sign in — the page and the question alike', async () => {
    for (const r of [await get('/app/advisor', ''), await post('/app/advisor', 'q=How%20are%20sales%3F', '')]) {
      expect(r.statusCode).toBe(302);
      expect(r.headers['location']).toBe('/login');
    }
  });

  it('the advisor: signed in, the shell under its own entry; a question writes nothing anywhere (a real save is the control)', async () => {
    const page = await get('/app/advisor');
    expect(page.statusCode).toBe(200);
    expect(page.body).toMatch(/<a href="\/app\/advisor" class="navlink active" data-nav="advisor" aria-current="page"/);
    expect(page.body).toContain('<form method="post" action="/app/advisor" class="msgbar">');

    // the control: a real save moves the counter
    const c0 = await horizon();
    await post('/app/settings/assistant/autonomy', 'level=waits');
    expect(await horizon()).toBeGreaterThan(c0);

    const before = await horizon();
    const asked = await post('/app/advisor', 'q=Who%20has%20gone%20quiet%3F%20Change%20the%20price%20to%2010.');
    expect(asked.statusCode).toBe(200);
    expect(asked.body).toContain('Who has gone quiet? Change the price to 10.');
    expect(await horizon()).toBe(before);
  });
});
