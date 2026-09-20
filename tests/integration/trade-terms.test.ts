import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant, flashSaid} from './tenant.js';

/**
 * G6 — the terms on a proforma are hers, end to end.
 *
 * The parity suite proves the validator, the renderer and that no literal is
 * left. Only Postgres and a real request can prove that stating terms inserts
 * (never edits), that the delivery term she puts on her document also becomes
 * one her employee may say, that staff cannot set them, and that an order keeps
 * the terms it was confirmed under after she changes hers.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd060000-0000-4000-8000-${RUN}0001`;
const PID = `dd060000-0000-4000-8000-${RUN}0002`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const CODE = 'terms-test-owner-code';
// Code hashes are unique across every business, so each run needs its own.
const STAFF_CODE = `TERMS-${RUN.toUpperCase()}`;
const HERS = '50% with order, balance against B/L copy';

d('G6 · her terms on a proforma (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let ownerCookie = '';
  let staffCookie = '';
  const convs: string[] = [];

  const login = async (code: string) => {
    const res = await app.inject({
      method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    return String(res.headers['set-cookie'] ?? '').split(';')[0] ?? '';
  };

  const post = (cookie: string, url: string, payload: string) =>
    app.inject({
      method: 'POST', url, payload,
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    });

  const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: { cookie } });

  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };

  const termsRows = () => tx((t) => sql<{ payment_terms: string; incoterm: string; stated_by: string }>`
    select payment_terms, incoterm, stated_by from trade_terms
     where business_id = ${BIZ} order by stated_at, id`.execute(t).then((r) => r.rows));

  /** An order through the one writer, carrying whatever terms are in force now — as the turn does. */
  const confirmOrder = async (conversationId: string): Promise<string> => {
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { usd } = await import('../../src/core/types/money.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return tx(async (t) => {
      const repos = tenantRepos(t, bid.value);
      const terms = await repos.catalog.tradeTerms();
      const order = {
        productId: PID, quantity: { value: 5000, unit: 'pcs' },
        unitPrice: usd(0.92), total: usd(4600), email: 'buyer@example.com',
        paymentTerms: terms?.paymentTerms ?? null, incoterm: terms?.incoterm ?? null,
      } as unknown as import('../../src/core/types/commerce.js').ConfirmableOrder;
      const created = await repos.orders.create(conversationId as never, order);
      return created.orderId as string;
    });
  };

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { hashCode } = await import('../../src/api/web/people.js');
    db = createDb(DATABASE_URL!);
    await tx(async (t) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'Terms Test Factory')
                on conflict (id) do nothing`.execute(t);
      await sql`insert into products (id, business_id, sku, name, unit, moq, is_active)
                values (${PID}, ${BIZ}, 'TT-1', 'Vacuum cup', 'pcs', 1000, true)`.execute(t);
      await sql`insert into people (business_id, name, code_hash)
                values (${BIZ}, 'Xiao Chen', ${hashCode(SECRET, STAFF_CODE)})`.execute(t);
      const client = (await sql<{ id: string }>`
        insert into clients (business_id, phone, display_name)
        values (${BIZ}, ${`+8613${RUN}`}, 'Ahmed') returning id::text as id`.execute(t)).rows[0]!.id;
      for (let i = 0; i < 2; i++) {
        convs.push((await sql<{ id: string }>`
          insert into conversations (business_id, client_id, channel, phase)
          values (${BIZ}, ${client}::uuid, 'whatsapp', 'confirmation') returning id::text as id
        `.execute(t)).rows[0]!.id);
      }
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
    ownerCookie = await login(CODE);
    staffCookie = await login(STAFF_CODE);
    expect(ownerCookie).not.toBe('');
    expect(staffCookie).not.toBe('');
    expect(staffCookie).not.toBe(ownerCookie);
  }, 60_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('BEFORE SHE STATES ANY — an order is still recorded, and it gets no proforma', async () => {
    const orderId = await confirmOrder(convs[0]!);
    const row = await tx((t) => sql<{ payment_terms: string | null; incoterm: string | null }>`
      select payment_terms, incoterm from orders where id = ${orderId}::uuid`.execute(t).then((r) => r.rows[0]!));
    expect(row).toEqual({ payment_terms: null, incoterm: null });

    const page = await get(ownerCookie, `/app/orders/${orderId}`);
    expect(page.statusCode).toBe(200);
    expect(page.body).not.toContain('PROFORMA INVOICE');
    expect(page.body).toContain('href="/app/settings/terms"');
    expect(page.body).not.toMatch(/deposit|\bFOB\b/);
  });

  it('staff may read the page but may not set her terms', async () => {
    expect((await get(staffCookie, '/app/settings/terms')).statusCode).toBe(200);
    const res = await post(staffCookie, '/app/settings/terms', `payment=${encodeURIComponent('100% up front')}&incoterm=EXW`);
    expect(res.statusCode).toBe(302);
    expect(await termsRows()).toEqual([]);
  });

  it('a term outside the guard’s vocabulary is refused, and nothing is written', async () => {
    const res = await post(ownerCookie, '/app/settings/terms', `payment=${encodeURIComponent(HERS)}&incoterm=XYZ`);
    expect(res.statusCode).toBe(302);
    expect(flashSaid(res, SECRET)).toContain('delivery term');
    expect(await termsRows()).toEqual([]);
  });

  it('THE OWNER STATES HER TERMS — one row, and the delivery term becomes sayable', async () => {
    const res = await post(ownerCookie, '/app/settings/terms', `payment=${encodeURIComponent(HERS)}&incoterm=CIF`);
    expect(res.statusCode).toBe(302);
    const rows = await termsRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ payment_terms: HERS, incoterm: 'CIF' });
    expect(rows[0]!.stated_by).not.toBe('');

    const claim = await tx((t) => sql<{ allowed: boolean }>`
      select allowed from claims_policy
       where business_id = ${BIZ} and kind = 'incoterm' and claim_key = 'CIF'`.execute(t).then((r) => r.rows));
    expect(claim).toEqual([{ allowed: true }]);

    const page = await get(ownerCookie, '/app/settings/terms');
    expect(page.body).toContain(HERS);
    expect(page.body).toContain('<option value="CIF" selected>');
  });

  it('AN ORDER KEEPS THE TERMS IT WAS CONFIRMED UNDER — changing hers later rewrites nothing', async () => {
    const orderId = await confirmOrder(convs[1]!);
    const before = await get(ownerCookie, `/app/orders/${orderId}`);
    expect(before.body).toContain('PROFORMA INVOICE');
    expect(before.body).toContain(HERS);
    expect(before.body).toContain('Unit price: $0.92 CIF');

    await post(ownerCookie, '/app/settings/terms', `payment=${encodeURIComponent('100% before shipment')}&incoterm=FOB`);
    expect(await termsRows()).toHaveLength(2);   // inserted, not edited

    const after = await get(ownerCookie, `/app/orders/${orderId}`);
    expect(after.body).toContain(HERS);
    expect(after.body).toContain('Unit price: $0.92 CIF');
    expect(after.body).not.toContain('100% before shipment');
  });

  it('the app role cannot edit a stated term', async () => {
    await expect(tx((t) => sql`update trade_terms set incoterm = 'DDP' where business_id = ${BIZ}`.execute(t)))
      .rejects.toThrow(/permission denied/);
  });
});
