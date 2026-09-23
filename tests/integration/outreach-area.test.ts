import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant } from './tenant.js';
import { NAV, CONTEXTUAL_ROUTES_BY_HUB, OUTREACH_PREFIXES, isOutreachRoute } from '../../src/api/web/layout.js';

/**
 * D — the outreach area (sequences, prospects, writing first) exists only for
 * a workspace whose `businesses.outreach_area` is on. OFF for a new workspace.
 *
 * "Hidden" was decided to mean three things, and only a real database and a
 * real request can prove all three: no route answers, no page links there,
 * and nothing is written first from it — whatever the per-channel switches
 * say. Turning it on brings all three back, and turning it off again pauses
 * rather than deletes.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd6a0000-0000-4000-8000-${RUN}0001`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const STRAY = /(href|action)="(\/app\/(contacts|prospects|sequences)|\/app\/channels\/outreach)/;

d('D · the outreach area exists only where it is switched on (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let cookie = '';
  const CODE = 'outreach-area-test-owner-code';

  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };
  const area = (on: boolean) => tx((t) => sql`update businesses set outreach_area = ${on} where id = ${BIZ}::uuid`.execute(t));
  const get = (url: string) => app.inject({ method: 'GET', url, headers: { cookie } });

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    await tx(async (t) => {
      await sql`insert into businesses (id, name, owner_locale) values (${BIZ}, 'Outreach Area Test Co', 'en')
                on conflict (id) do nothing`.execute(t);
    });
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled',
      secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
      // The facts are cached per business for a minute in production; this
      // test flips the switch and looks at once, so it asks for no cache.
      factsTtlMs: 0,
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(CODE)}`, headers: FORM });
    cookie = String(res.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 60_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('a new workspace has the area OFF', async () => {
    const r = (await tx((t) => sql<{ on: boolean }>`select outreach_area as on from businesses where id = ${BIZ}::uuid`.execute(t))).rows[0];
    expect(r?.on).toBe(false);
  });

  it('OFF: every address in the area is not found — GET and POST alike', async () => {
    for (const url of ['/app/contacts', '/app/contacts/write', '/app/contacts/suppress', '/app/prospects', '/app/sequences', '/app/sequences/abc', '/app/contacts?flash=x']) {
      expect(isOutreachRoute(url), url).toBe(true);
      expect((await get(url)).statusCode, url).toBe(404);
    }
    for (const url of ['/app/channels/outreach', '/app/channels/outreach/cap', '/app/contacts', '/app/sequences']) {
      const r = await app.inject({ method: 'POST', url, payload: 'channel=email&enabled=true', headers: { cookie, ...FORM } });
      expect(r.statusCode, `POST ${url}`).toBe(404);
    }
    // and the pages around it still answer
    expect((await get('/app/channels')).statusCode).toBe(200);
    expect((await get('/app/conversations')).statusCode).toBe(200);
  });

  it('OFF: no page links into the area — not the nav, not a hub, not a card, not a switch', async () => {
    const pages = [
      ...NAV.map((n) => n.href),
      ...CONTEXTUAL_ROUTES_BY_HUB.filter((g) => !g.outreach).flatMap((g) => g.routes),
      '/app/conversations',
    ].filter((u) => !isOutreachRoute(u));
    let checked = 0;
    for (const url of pages) {
      const r = await get(url);
      // The practice room is mounted only where a sandbox is configured; a
      // page this installation does not have has no links on it.
      if (url === '/app/sandbox' && r.statusCode === 404) continue;
      expect(r.statusCode, url).toBe(200);
      expect(r.body.match(STRAY)?.[0] ?? null, `${url} links into the hidden area`).toBeNull();
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(15);
  });

  it('OFF: nothing is written first, whatever the per-channel switch says', async () => {
    const { setOutreach, outreachFacts } = await import('../../src/db/outreach.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    await tx((t) => setOutreach(t, bid.value, { channel: 'email', enabled: true, by: 'test' }));
    const facts = () => tx((t) => outreachFacts(t, bid.value, {
      channel: 'email', identity: `buyer-${RUN}@example.com`, templateState: 'none', now: new Date(),
    }));
    expect((await facts()).enabled).toBe(false);   // the row says on; the area says no
    await area(true);
    expect((await facts()).enabled).toBe(true);
    await area(false);
    expect((await facts()).enabled).toBe(false);   // off again: paused, not deleted
    const rows = (await tx((t) => sql<{ n: number }>`select count(*)::int as n from outreach_settings where business_id = ${BIZ}::uuid`.execute(t))).rows[0]!.n;
    expect(rows).toBeGreaterThan(0);
  });

  it('ON: the area answers, and the hubs link into it', async () => {
    await area(true);
    for (const p of OUTREACH_PREFIXES.slice(0, 3)) expect((await get(p)).statusCode, p).toBe(200);
    for (const { hub, routes, outreach } of CONTEXTUAL_ROUTES_BY_HUB.filter((g) => g.outreach)) {
      expect(outreach).toBe(true);
      const page = await get(hub);
      for (const route of routes) expect(page.body, `${route} from ${hub}`).toContain(`href="${route}"`);
    }
    // and the switch on the channels page is back
    expect((await get('/app/channels')).body).toContain('action="/app/channels/outreach"');
  });

  it('OFF again: gone at once, nothing deleted', async () => {
    await area(false);
    expect((await get('/app/contacts')).statusCode).toBe(404);
    expect((await get('/app/channels')).body.match(STRAY)?.[0] ?? null).toBeNull();
  });
});
