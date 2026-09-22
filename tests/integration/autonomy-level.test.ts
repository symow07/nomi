import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant, flashSaid} from './tenant.js';

/**
 * T1 — the owner chooses how much she does on her own, from day one.
 *
 * Postgres and a real request prove what the rules cannot: that one press moves
 * every capability the level means and no other, that `confirm_order` is never
 * among them, that the record says HE decided it (not that she earned it), that
 * choosing again writes only what changes, and that a sales assistant cannot.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd710000-0000-4000-8000-${RUN}0001`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

d('T1 · how much she does on her own (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let ownerCookie = '';
  const CODE = 'autonomy-test-owner-code';

  const login = async (code: string) => {
    const res = await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`, headers: FORM });
    return String(res.headers['set-cookie'] ?? '').split(';')[0] ?? '';
  };
  const post = (cookie: string, url: string, payload = '') => app.inject({ method: 'POST', url, payload, headers: { cookie, ...FORM } });
  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };
  const modes = () => tx(async (t) => Object.fromEntries((await sql<{ capability: string; mode: string }>`
    select capability, mode from autonomy_policy where business_id = ${BIZ}::uuid`.execute(t)).rows.map((r) => [r.capability, r.mode])));
  const events = () => tx(async (t) => (await sql<{ capability: string; to_mode: string; reasons: string[]; actor: string }>`
    select capability, to_mode, reasons, actor from capability_events where business_id = ${BIZ}::uuid order by at, capability`.execute(t)).rows);

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    await tx(async (t) => { await sql`insert into businesses (id, name) values (${BIZ}, 'Autonomy Test Co') on conflict (id) do nothing`.execute(t); });
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET, employeeName: 'Lily', avatar: '👩‍💼',
      provider: 'disabled', secureCookie: false, messagingEnabled: false, kickOutbound: async () => {}, kickDrive: async () => {},
      // This file is about what the route does once autonomy is RELEASED. The
      // gate itself — refused until the zh/ar disclosure has had native
      // review — is proved in its own describe below, against the real flag.
      autonomyReleased: () => true,
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    ownerCookie = await login(CODE);
    expect(ownerCookie).not.toBe('');
  }, 60_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('her page offers the choice, and a new workspace starts with everything waiting', async () => {
    const page = await app.inject({ method: 'GET', url: '/app/employee', headers: { cookie: ownerCookie } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('id="on-her-own"');
    expect(page.body).toMatch(/name="level" value="waits" checked/);
  });

  it('THE PRODUCTION CALLER: she chooses "talks" — four kinds of reply go out alone, prices and orders still wait', async () => {
    const res = await post(ownerCookie, '/app/employee/autonomy', 'level=talks');
    expect(res.statusCode).toBe(302);
    expect(flashSaid(res, SECRET)).toContain('works this way');
    const m = await modes();
    for (const c of ['greet', 'qualify', 'recommend', 'follow_up']) expect(m[c], c).toBe('auto');
    for (const c of ['quote', 'negotiate', 'confirm_order']) expect(m[c] ?? 'draft', c).toBe('draft');
    const e = await events();
    expect(e.map((x) => x.capability).sort()).toEqual(['follow_up', 'greet', 'qualify', 'recommend']);
    expect(e.every((x) => x.reasons.includes('owner_chose_talks') && x.to_mode === 'auto' && x.actor !== '')).toBe(true);
    const page = await app.inject({ method: 'GET', url: '/app/employee', headers: { cookie: ownerCookie } });
    expect(page.body).toMatch(/name="level" value="talks" checked/);
  });

  it('"sells" adds quoting and negotiating, writes ONLY those two, and never an order', async () => {
    await post(ownerCookie, '/app/employee/autonomy', 'level=sells');
    const m = await modes();
    expect(m['quote']).toBe('auto'); expect(m['negotiate']).toBe('auto');
    expect(m['confirm_order'] ?? 'draft').toBe('draft');
    const added = (await events()).filter((x) => x.reasons.includes('owner_chose_sells'));
    expect(added.map((x) => x.capability).sort()).toEqual(['negotiate', 'quote']);
  });

  it('she can take it all back in one press, and the record keeps every step', async () => {
    await post(ownerCookie, '/app/employee/autonomy', 'level=waits');
    expect(Object.values(await modes()).every((v) => v === 'draft')).toBe(true);
    const back = (await events()).filter((x) => x.reasons.includes('owner_chose_waits'));
    expect(back).toHaveLength(6);
    expect(back.every((x) => x.to_mode === 'draft')).toBe(true);
  });

  it('a level nobody defined changes nothing', async () => {
    const before = await events();
    const res = await post(ownerCookie, '/app/employee/autonomy', 'level=everything');
    expect(flashSaid(res, SECRET)).toContain('did not save');
    expect(await events()).toEqual(before);
  });

  it('a sales assistant cannot decide it, and is not shown it', async () => {
    const add = await post(ownerCookie, '/app/settings/people', 'name=Xiao%20Chen');
    const issued = String(add.headers['set-cookie'] ?? '').split(';')[0]!;
    const people = await app.inject({ method: 'GET', url: '/app/settings/people', headers: { cookie: `${ownerCookie}; ${issued}` } });
    const staff = await login(/class="code"><bdi>([^<]+)</.exec(people.body)?.[1] ?? '');
    expect(staff).not.toBe('');
    const before = await modes();
    await post(staff, '/app/employee/autonomy', 'level=sells');
    expect(await modes()).toEqual(before);
    const page = await app.inject({ method: 'GET', url: '/app/employee', headers: { cookie: staff } });
    expect(page.body).not.toContain('id="on-her-own"');
  });
});

d('T1 · no autonomy until the disclosure has had native review (requires DATABASE_URL)', () => {
  /**
   * The hard rule: no workspace turns on any autonomy capability in production
   * until the zh and ar disclosure text has been read by a native speaker. This
   * drives the REAL route with the REAL product flag — no override — so it fails
   * the day someone flips the flag without meaning to, and passes again only
   * when this test is changed on purpose alongside it.
   */
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  const GATE_BIZ = `dd720000-0000-4000-8000-${RUN}0001`;
  const GATE_CODE = 'autonomy-gate-owner-code';

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    const bid = parseBusinessId(GATE_BIZ); if (!bid.ok) throw new Error('fixture');
    await withTenantTx(db, bid.value, (t) =>
      sql`insert into businesses (id, name) values (${GATE_BIZ}, 'Gate Test Co') on conflict (id) do nothing`.execute(t));
    process.env['PILOT_BUSINESS_ID'] = GATE_BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: GATE_BIZ, accessCode: GATE_CODE, sessionSecret: SECRET, employeeName: 'Lily', avatar: '👩‍💼',
      provider: 'disabled', secureCookie: false, messagingEnabled: false, kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
  }, 60_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('the flag is down today: zh and ar have not been reviewed', async () => {
    const { disclosureAwaitingReview, autonomyReleased } = await import('../../src/core/conversation/disclosure.js');
    expect(disclosureAwaitingReview()).toEqual(['zh', 'ar']);
    expect(autonomyReleased()).toBe(false);
  });

  it('"talks" and "sells" are REFUSED by the route, and nothing is written', async () => {
    const res0 = await app.inject({ method: 'POST', url: '/login', payload: `code=${GATE_CODE}`, headers: FORM });
    const cookie = String(res0.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    for (const level of ['talks', 'sells']) {
      const res = await app.inject({ method: 'POST', url: '/app/employee/autonomy', payload: `level=${level}`, headers: { cookie, ...FORM } });
      expect(flashSaid(res, SECRET), level).toContain('still being checked');
    }
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(GATE_BIZ); if (!bid.ok) throw new Error('fixture');
    const auto = await withTenantTx(db, bid.value, (t) => sql<{ n: number }>`
      select count(*)::int as n from autonomy_policy where business_id = ${GATE_BIZ}::uuid and mode = 'auto'`
      .execute(t).then((r) => r.rows[0]!.n));
    expect(auto).toBe(0);
  });

  it('"waits" is always allowed — it sends nothing without her', async () => {
    const res0 = await app.inject({ method: 'POST', url: '/login', payload: `code=${GATE_CODE}`, headers: FORM });
    const cookie = String(res0.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    const res = await app.inject({ method: 'POST', url: '/app/employee/autonomy', payload: 'level=waits', headers: { cookie, ...FORM } });
    expect(flashSaid(res, SECRET)).not.toContain('still being checked');
  });

  it('and the page says why, above the levels', async () => {
    const res0 = await app.inject({ method: 'POST', url: '/login', payload: `code=${GATE_CODE}`, headers: FORM });
    const cookie = String(res0.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    const page = await app.inject({ method: 'GET', url: '/app/employee', headers: { cookie } });
    expect(page.body).toContain('has not been read by a native speaker');
  });
});
