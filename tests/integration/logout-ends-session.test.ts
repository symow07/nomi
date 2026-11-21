import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { createHmac } from 'node:crypto';
import { sql } from 'kysely';
import { seedRunTenant, RUN_BIZ } from './tenant.js';

/**
 * 0243 — Log out ends the session on the server, not only in the browser.
 *
 * Before: `/logout` told the browser to forget the cookie and nothing else, so a copy of it (a shared computer, a
 * stolen cookie) kept opening the app for the rest of its week. Found by the Block 5 tester on 2026-11-20 with a kept
 * cookie replayed after Log out. Here: the kept copy is refused, in this process and in another one that never saw the
 * Log out (the database row, not only memory); another browser of the same person stays signed in; a cookie signed
 * before 0243 still opens the app (nobody is logged out by the deploy).
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;
const CODE = 'logout-ends-session-owner-code';
const SECRET = 'a-test-session-secret-of-sufficient-length';

d('0243 · Log out ends the session on the server (requires DATABASE_URL)', { timeout: 120_000 }, () => {
  let app: import('fastify').FastifyInstance;
  let other: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  const cookieOf = (r: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=')) ?? '';
  const login = (a: import('fastify').FastifyInstance, code: string) => a.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const home = (a: import('fastify').FastifyInstance, cookie: string) => a.inject({ method: 'GET', url: '/app', headers: { cookie } });
  const logout = (a: import('fastify').FastifyInstance, cookie: string) => a.inject({ method: 'POST', url: '/logout', headers: { cookie } });
  const make = async (using?: import('../../src/db/client.js').Db) => {
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const a = Fastify({ logger: false });
    registerWebApp(a, {
      db: using ?? db, businessId: RUN_BIZ, accessCode: CODE, sessionSecret: SECRET, factsTtlMs: 0,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await a.ready();
    return a;
  };
  let staffCode = '';

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { addPerson } = await import('../../src/api/web/people.js');
    db = createDb(DATABASE_URL!);
    process.env['PILOT_BUSINESS_ID'] = RUN_BIZ;
    app = await make();
    // A second process: it never sees the Log out, so only the database can tell it.
    other = await make();
    const staff = await addPerson(db, RUN_BIZ, SECRET, `Logout staff ${Date.now()}`);
    if (staff.code !== 'added') throw new Error('fixture');
    staffCode = staff.accessCode;
  });
  afterAll(async () => { await app?.close(); await other?.close(); await db?.destroy(); });

  it('the access code\'s owner: a kept copy is refused after Log out; another browser stays signed in', async () => {
    const kept = cookieOf(await login(app, CODE));
    const elsewhere = cookieOf(await login(app, CODE));
    expect(kept).not.toBe(''); expect(elsewhere).not.toBe(''); expect(kept).not.toBe(elsewhere);
    expect((await home(app, kept)).statusCode, 'signed in before').toBe(200);
    const out = await logout(app, kept);
    expect(out.statusCode).toBe(302);
    expect(out.headers['location']).toBe('/login');
    const again = await home(app, kept);
    expect(again.statusCode, 'the kept copy after Log out').toBe(302);
    expect(again.headers['location']).toBe('/login');
    const there = await home(other, kept);
    expect(there.statusCode, 'the kept copy, in a process that never saw the Log out').toBe(302);
    expect(there.headers['location']).toBe('/login');
    expect((await home(app, elsewhere)).statusCode, 'the same owner in another browser').toBe(200);
    expect((await home(other, elsewhere)).statusCode).toBe(200);
  });

  it('a member of staff: the same, through a page and a form', async () => {
    const kept = cookieOf(await login(app, staffCode));
    expect(kept).not.toBe('');
    expect((await home(app, kept)).statusCode).toBe(200);
    await logout(app, kept);
    for (const a of [app, other]) {
      const page = await a.inject({ method: 'GET', url: '/app/inbox', headers: { cookie: kept } });
      expect(page.statusCode).toBe(302);
      expect(page.headers['location']).toBe('/login');
      const form = await a.inject({ method: 'POST', url: '/app/settings', headers: { cookie: kept, 'content-type': 'application/x-www-form-urlencoded' }, payload: 'name=Changed+after+logout' });
      expect(form.statusCode).toBe(302);
      expect(form.headers['location']).toBe('/login');
    }
  });

  it('a failed lookup is not an ended session: staff are sent to sign in with the cookie KEPT, and it works once the database answers', async () => {
    const kept = cookieOf(await login(app, staffCode));
    expect((await home(app, kept)).statusCode).toBe(200);
    // A process whose database does not answer (nothing listens on port 1): the gate's read fails.
    const { createDb } = await import('../../src/db/client.js');
    const down = createDb('postgresql://nobody@127.0.0.1:1/none');
    const broken = await make(down);
    try {
      const r = await home(broken, kept);
      expect(r.statusCode).toBe(302);
      expect(r.headers['location']).toBe('/login');
      expect(cookieOf(r), 'the cookie is not cleared on a failed read').toBe('');
    } finally { await broken.close(); await down.destroy().catch(() => {}); }
    expect((await home(app, kept)).statusCode, 'the same cookie, once the database answers').toBe(200);
  });

  it('Log out twice is one ended session; the table is the definer functions\' alone', async () => {
    const kept = cookieOf(await login(app, CODE));
    await logout(app, kept);
    expect((await logout(app, kept)).headers['location']).toBe('/login');
    const sid = (JSON.parse(Buffer.from(kept.slice('yf_session='.length).split('.')[0]!, 'base64url').toString('utf8')) as { sid?: string }).sid;
    expect(sid).toMatch(/^[0-9a-f-]{36}$/);
    expect((await sql<{ ended: boolean }>`select session_ended(${sid!}::uuid) as ended`.execute(db)).rows[0]!.ended).toBe(true);
    // The app role cannot read or write the table itself (DATABASE_URL is the app role's).
    await expect(sql`select count(*) from ended_sessions`.execute(db)).rejects.toThrow();
    await expect(sql`delete from ended_sessions`.execute(db)).rejects.toThrow();
  });

  it('a cookie signed before 0243 (no session id) still opens the app: the deploy logs nobody out', async () => {
    const payload = Buffer.from(JSON.stringify({ businessId: RUN_BIZ, exp: Date.now() + 3_600_000 })).toString('base64url');
    const old = `yf_session=${payload}.${createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
    expect((await home(app, old)).statusCode).toBe(200);
    // A forged id is refused outright (the codec takes only a UUID).
    const forgedPayload = Buffer.from(JSON.stringify({ businessId: RUN_BIZ, exp: Date.now() + 3_600_000, sid: "x' or '1'='1" })).toString('base64url');
    const forged = `yf_session=${forgedPayload}.${createHmac('sha256', SECRET).update(forgedPayload).digest('base64url')}`;
    expect((await home(app, forged)).statusCode).toBe(302);
  });
});
