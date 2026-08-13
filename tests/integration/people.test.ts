import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant } from './tenant.js';

/**
 * M47 — more than one human, end to end.
 *
 * The parity suite proves the predicate and the page. Only Postgres and a real
 * request can prove that a staff code actually logs someone in, that the code
 * is not recoverable from the row, that a sales assistant is refused the four
 * owner-only things AND allowed everything else, and that `assigned_to` now
 * names WHICH human — while the AI-silent gate behaves exactly as before.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd470000-0000-4000-8000-${RUN}0001`;
const SECRET = 'a-test-session-secret-of-sufficient-length';

d('M47 · more than one human (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let ownerCookie = '';
  let staffCookie = '';
  let staffCode = '';
  let staffId = '';
  let convId = '';
  const CODE = 'people-test-owner-code';

  const login = async (code: string) => {
    const res = await app.inject({
      method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    return { status: res.statusCode, cookie: String(res.headers['set-cookie'] ?? '').split(';')[0] ?? '' };
  };

  const post = (cookie: string, url: string, payload?: string) =>
    app.inject({
      method: 'POST', url,
      headers: { cookie, ...(payload ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      ...(payload ? { payload } : {}),
    });

  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    convId = await tx(async (t) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'People Test Factory')
                on conflict (id) do nothing`.execute(t);
      // NO owner row is inserted here, on purpose: this business is created
      // AFTER 0035 ran, exactly like a new tenant or a freshly seeded demo.
      // Her first login is what creates it.
      const client = (await sql<{ id: string }>`
        insert into clients (business_id, phone, display_name)
        values (${BIZ}, ${`+8613${RUN}`}, 'Ahmed') returning id::text as id`.execute(t)).rows[0]!.id;
      return (await sql<{ id: string }>`
        insert into conversations (business_id, client_id, channel, phase)
        values (${BIZ}, ${client}::uuid, 'whatsapp', 'warm_intake') returning id::text as id
      `.execute(t)).rows[0]!.id;
    });

    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled',
      secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    ownerCookie = (await login(CODE)).cookie;
    expect(ownerCookie).not.toBe('');
  }, 60_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('THE PRODUCTION CALLER: the owner adds someone, and sees their code ONCE', async () => {
    const res = await post(ownerCookie, '/app/settings/people', 'name=Xiao%20Chen');
    expect(res.statusCode).toBe(302);
    const location = String(res.headers['location']);
    staffCode = decodeURIComponent(new URL(location, 'http://x').searchParams.get('code') ?? '');
    expect(staffCode).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);

    const page = await app.inject({ method: 'GET', url: location, headers: { cookie: ownerCookie } });
    expect(page.body).toContain(staffCode);
    expect(page.body).toContain('Xiao Chen');

    // And it is gone from the page the moment she navigates away from it.
    const again = await app.inject({ method: 'GET', url: '/app/settings/people', headers: { cookie: ownerCookie } });
    expect(again.body).not.toContain(staffCode);

    staffId = await tx((t) => sql<{ id: string }>`
      select id::text as id from people where business_id = ${BIZ} and not is_owner and archived_at is null
    `.execute(t).then((r) => r.rows[0]!.id));
  });

  it('THE CODE IS NOT IN THE ROW — the column holds an HMAC', async () => {
    const row = await tx((t) => sql<{ code_hash: string | null }>`
      select code_hash from people where id = ${staffId}::uuid
    `.execute(t).then((r) => r.rows[0]!));
    expect(row.code_hash).not.toBeNull();
    expect(row.code_hash).not.toContain(staffCode);
    // and it is the HMAC this installation would compute
    const { hashCode } = await import('../../src/api/web/people.js');
    expect(row.code_hash).toBe(hashCode(SECRET, staffCode));
  });

  it('THEY GET THEIR OWN WAY IN', async () => {
    const r = await login(staffCode);
    expect(r.status).toBe(302);
    expect(r.cookie).not.toBe('');
    staffCookie = r.cookie;
    expect(staffCookie).not.toBe(ownerCookie);

    const home = await app.inject({ method: 'GET', url: '/app', headers: { cookie: staffCookie } });
    expect(home.statusCode).toBe(200);
  });

  it('a wrong code is still refused, and sets no cookie', async () => {
    const r = await login('AAAAA-BBBBB');
    expect(r.status).toBe(401);
    expect(r.cookie).toBe('');
  });

  it('A SALES ASSISTANT MAY NOT do the four owner-only things', async () => {
    for (const [url, payload] of [
      ['/app/employee/capability/quote/promote', undefined],
      ['/app/factory/activate', 'confirm=yes'],
      ['/app/factory/prices', 'floor=0.30&maxDiscountPct=10&askAbovePct=7'],
      ['/app/settings/people', 'name=Someone%20Else'],
    ] as const) {
      const res = await post(staffCookie, url, payload);
      expect(res.statusCode, url).toBe(302);
      expect(decodeURIComponent(String(res.headers['location'])), url).toContain('Only the owner');
    }
    // and nothing happened: no second person, no price rule
    expect(await tx((t) => sql<{ n: number }>`
      select count(*)::int as n from people where business_id = ${BIZ} and archived_at is null
    `.execute(t).then((r) => r.rows[0]!.n))).toBe(2);
  });

  it('AND MAY DO THE JOB — takeover names WHICH human', async () => {
    const res = await post(staffCookie, `/app/inbox/${convId}/takeover`);
    expect(res.statusCode).toBe(302);

    const held = await tx((t) => sql<{ assigned_to: string | null }>`
      select assigned_to from conversations where id = ${convId}
    `.execute(t).then((r) => r.rows[0]!.assigned_to));
    expect(held).toBe(staffId);

    // The ownership model is unchanged: a person id still means a human holds
    // it, and the AI is still silent.
    const { ownershipOf, aiMaySpeak } = await import('../../src/core/conversation/ownership.js');
    expect(ownershipOf(held)).toBe('OWNER_CONTROLLED');
    expect(aiMaySpeak(ownershipOf(held))).toBe(false);
  });

  it('and Buyers says who is holding it', async () => {
    const res = await app.inject({ method: 'GET', url: '/app/inbox?filter=all', headers: { cookie: ownerCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Xiao Chen');
  });

  it('REMOVING archives — the conversation they held still names them', async () => {
    expect((await post(ownerCookie, `/app/settings/people/${staffId}/remove`)).statusCode).toBe(302);

    const row = await tx((t) => sql<{ archived_at: Date | null }>`
      select archived_at from people where id = ${staffId}::uuid
    `.execute(t).then((r) => r.rows[0]!));
    expect(row.archived_at).not.toBeNull();

    // assigned_to is untouched: the record of who held it is not rewritten.
    expect(await tx((t) => sql<{ assigned_to: string | null }>`
      select assigned_to from conversations where id = ${convId}
    `.execute(t).then((r) => r.rows[0]!.assigned_to))).toBe(staffId);

    // and their code no longer works
    expect((await login(staffCode)).status).toBe(401);
  });

  it('THE OWNER CANNOT BE REMOVED — a business with nobody who can grant is broken', async () => {
    const ownerId = await tx((t) => sql<{ id: string }>`
      select id::text as id from people where business_id = ${BIZ} and is_owner limit 1
    `.execute(t).then((r) => r.rows[0]!.id));
    await post(ownerCookie, `/app/settings/people/${ownerId}/remove`);
    expect(await tx((t) => sql<{ archived_at: Date | null }>`
      select archived_at from people where id = ${ownerId}::uuid
    `.execute(t).then((r) => r.rows[0]!.archived_at))).toBeNull();
  });

  it('HER ROW IS CREATED ON FIRST LOGIN — a business made after the migration has one', async () => {
    // The backfill covers businesses that existed when it ran. This one did
    // not, and the owner would otherwise have shown as a generic word on the
    // page that names who holds what.
    const owner = await tx((t) => sql<{ name: string }>`
      select name from people where business_id = ${BIZ} and is_owner and archived_at is null
    `.execute(t).then((r) => r.rows));
    expect(owner).toHaveLength(1);
    expect(owner[0]!.name).toBe('People Test Factory');
  });

  it('and HER login never depended on any of it', async () => {
    // Her code is the environment's. This is the guarantee that a people table
    // cannot lock the owner out of her own business.
    expect((await login(CODE)).status).toBe(302);
  });
});
