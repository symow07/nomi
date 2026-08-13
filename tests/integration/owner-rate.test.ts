import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant } from './tenant.js';

/**
 * M43b — her rate, end to end, and the two things only Postgres can prove:
 * that stating a new rate INSERTS rather than overwrites, and that the app role
 * cannot edit one in place. An edited rate is a quote that silently changes
 * value after it was given.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd43b000-0000-4000-8000-${RUN}0001`;

d('M43b · the rate she stated (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let cookie = '';
  const CODE = 'owner-rate-code';

  const post = (url: string, payload: string) =>
    app.inject({
      method: 'POST', url, headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, payload,
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
    await tx(async (t) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'Rate Test Factory')
                on conflict (id) do nothing`.execute(t);
    });

    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE,
      sessionSecret: 'a-test-session-secret-of-sufficient-length',
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled',
      secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const login = await app.inject({
      method: 'POST', url: '/login', payload: `code=${encodeURIComponent(CODE)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 60_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  const rows = () => tx((t) => sql<{ rate: string; stated_at: Date }>`
    select rate, stated_at from owner_rates where business_id = ${BIZ} order by stated_at
  `.execute(t).then((r) => r.rows));

  it('THE PRODUCTION CALLER: she states a rate from her settings page', async () => {
    const res = await post('/app/settings/rate', 'rate=7.15');
    expect(res.statusCode).toBe(302);
    const r = await rows();
    expect(r).toHaveLength(1);
    expect(Number(r[0]!.rate)).toBe(7.15);
  });

  it('the page shows it, with the date she set it', async () => {
    const res = await app.inject({ method: 'GET', url: '/app/settings/rate', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('7.15');
    expect(res.body).toContain('You set this on');
  });

  it('STATING A NEW ONE INSERTS — the old row stays as history', async () => {
    await post('/app/settings/rate', 'rate=7.22');
    const r = await rows();
    expect(r).toHaveLength(2);
    expect(r.map((x) => Number(x.rate))).toEqual([7.15, 7.22]);

    const page = await app.inject({ method: 'GET', url: '/app/settings/rate', headers: { cookie } });
    expect(page.body).toContain('7.22');
    expect(page.body).toContain('What you set before');
    expect(page.body).toContain('7.15');
  });

  it('THE APP ROLE CANNOT EDIT A RATE IN PLACE', async () => {
    // Insert-only by PRIVILEGE, not by convention: an edited rate is a total
    // that silently changes value after a buyer was shown it.
    await expect(tx((t) => sql`
      update owner_rates set rate = 99 where business_id = ${BIZ}
    `.execute(t))).rejects.toThrow(/permission denied/i);
    expect((await rows()).map((x) => Number(x.rate))).toEqual([7.15, 7.22]);
  });

  it('a rate the code cannot price cannot be stored', async () => {
    await expect(tx((t) => sql`
      insert into owner_rates (business_id, from_currency, to_currency, rate)
      values (${BIZ}, 'USD', 'GBP', 0.79)
    `.execute(t))).rejects.toThrow(/owner_rates_currencies_known|violates check constraint/);
  });

  it('and a rate from a currency to itself is not a rate', async () => {
    await expect(tx((t) => sql`
      insert into owner_rates (business_id, from_currency, to_currency, rate)
      values (${BIZ}, 'USD', 'USD', 1)
    `.execute(t))).rejects.toThrow(/owner_rates_not_identity|violates check constraint/);
  });

  it('what she typed wrong does not become a rate', async () => {
    const before = (await rows()).length;
    for (const bad of ['rate=', 'rate=seven', 'rate=0', 'rate=-7']) {
      const res = await post('/app/settings/rate', bad);
      expect(res.statusCode, bad).toBe(302);
    }
    expect(await rows()).toHaveLength(before);
  });

  it('the rate reaches THE CONVERSATION SURFACE, where the figure actually is', async () => {
    const { loadConversationDetail } = await import('../../src/api/web/inbox.js');
    const convId = await tx(async (t) => {
      const client = (await sql<{ id: string }>`
        insert into clients (business_id, phone, display_name)
        values (${BIZ}, ${`+8613${RUN}`}, 'Rate test buyer') returning id::text as id
      `.execute(t)).rows[0]!.id;
      return (await sql<{ id: string }>`
        insert into conversations (business_id, client_id, channel, phase)
        values (${BIZ}, ${client}::uuid, 'whatsapp', 'warm_intake') returning id::text as id
      `.execute(t)).rows[0]!.id;
    });
    const detail = await loadConversationDetail(db, BIZ, convId);
    expect(detail).not.toBeNull();
    // The rate in force is the most recent one she stated, not the first.
    expect(detail!.rate?.rate).toBe(7.22);
    expect(detail!.rate?.statedAt).toBeInstanceOf(Date);
  });
});
