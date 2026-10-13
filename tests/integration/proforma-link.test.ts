import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant } from './tenant.js';

/**
 * Phase 2c (the owner's roadmap, 2026-10-13; 0151) — THE PROFORMA LINK, end to end against real Postgres and the
 * real route table:
 *
 *   owner makes it from the conversation (idempotent, written on the trail) → the customer opens it with no
 *   session, in their language, and sees the document and nothing else of the order → the owner turns it off from
 *   the order page → 404, byte for byte the page of a link that never existed.
 *
 * And the refusals: an order without what a proforma needs, another workspace's order, an order that loses its
 * delivery term after the link was made.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const id = (n: number) => `cc2c0000-0000-4000-8000-${RUN}${String(n).padStart(4, '0')}`;
const BIZ = id(1); const CLIENT = id(2); const CONV = id(3); const PROD = id(4); const ORDER = id(5);
const CLIENT2 = id(6); const CONV2 = id(7); const ORDER2 = id(8);
const BIZ2 = id(9); const CLIENT3 = id(10); const CONV3 = id(11); const PROD3 = id(12); const ORDER3 = id(13);
const EMAIL = `khalid-${RUN}@buyer.example`;
const NOTE = `call after five ${RUN}`;
const BASE = 'https://nomi.example.com';

d('Phase 2c · the proforma link (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let cookie = '';
  const CODE = 'proforma-test-code';
  let token = '';

  const asTenant = async <T>(biz: string, fn: (tx: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(biz); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };
  const tokenOf = (biz: string, order: string) => asTenant(biz, (tx) =>
    sql<{ t: string | null }>`select proforma_token as t from orders where id = ${order}`.execute(tx).then((r) => r.rows[0]?.t ?? null));
  const post = (url: string, from: 'conversation' | 'order') => app.inject({
    method: 'POST', url, payload: `from=${from}`,
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
  });
  /** Where the action went, and the notice that page then shows. */
  const landed = async (res: Awaited<ReturnType<typeof post>>) => {
    expect(res.statusCode).toBe(302);
    const flash = String(res.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    const to = String(res.headers.location);
    const page = await app.inject({ method: 'GET', url: to.replace(/#.*$/, ''), headers: { cookie: `${cookie}; ${flash}` } });
    return { to, body: page.body };
  };

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);

    const order = (tx: import('../../src/db/client.js').Tx, o: {
      id: string; biz: string; client: string; conv: string; prod: string; ref: string; incoterm: string | null;
    }) => sql`
      insert into orders (id, order_reference, business_id, client_id, conversation_id, product_id, quantity, unit, status,
                          agreed_unit_price_usd, total_value_usd, currency, payment_terms, incoterm, client_email, notes, confirmed_at)
      values (${o.id}, ${o.ref}, ${o.biz}, ${o.client}, ${o.conv}, ${o.prod}, 5000, 'pcs', 'confirmed',
              0.38, 1900, 'USD', '30% deposit, 70% before shipment', ${o.incoterm}, ${EMAIL}, ${NOTE}, now())`.execute(tx);

    await asTenant(BIZ, async (tx) => {
      await sql`insert into businesses (id, name, postal_address) values (${BIZ}, 'Westlake Test Canvas', ${`Futian Market ${RUN}, Yiwu`})`.execute(tx);
      await sql`insert into clients (id, business_id, display_name) values (${CLIENT}, ${BIZ}, 'Khalid Mansoor'), (${CLIENT2}, ${BIZ}, 'Bao Lin')`.execute(tx);
      await sql`insert into conversations (id, business_id, client_id, channel)
                values (${CONV}, ${BIZ}, ${CLIENT}, 'whatsapp'), (${CONV2}, ${BIZ}, ${CLIENT2}, 'whatsapp')`.execute(tx);
      await sql`insert into products (id, business_id, sku, name, unit) values (${PROD}, ${BIZ}, ${'PI-' + RUN}, 'Canvas tote bag', 'pcs')`.execute(tx);
      await order(tx, { id: ORDER, biz: BIZ, client: CLIENT, conv: CONV, prod: PROD, ref: `YW-PI-${RUN}-A`, incoterm: 'FOB Ningbo' });
      // Confirmed under payment terms with no delivery term: a proforma names one, so there is none to link.
      await order(tx, { id: ORDER2, biz: BIZ, client: CLIENT2, conv: CONV2, prod: PROD, ref: `YW-PI-${RUN}-B`, incoterm: null });
    });
    await asTenant(BIZ2, async (tx) => {
      await sql`insert into businesses (id, name) values (${BIZ2}, 'Another Workshop')`.execute(tx);
      await sql`insert into clients (id, business_id, display_name) values (${CLIENT3}, ${BIZ2}, 'Someone Else')`.execute(tx);
      await sql`insert into conversations (id, business_id, client_id, channel) values (${CONV3}, ${BIZ2}, ${CLIENT3}, 'whatsapp')`.execute(tx);
      await sql`insert into products (id, business_id, sku, name, unit) values (${PROD3}, ${BIZ2}, ${'PJ-' + RUN}, 'Jute bag', 'pcs')`.execute(tx);
      await order(tx, { id: ORDER3, biz: BIZ2, client: CLIENT3, conv: CONV3, prod: PROD3, ref: `YW-PI-${RUN}-C`, incoterm: 'FOB Ningbo' });
    });

    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE,
      sessionSecret: 'a-test-session-secret-of-sufficient-length',
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled',
      secureCookie: false, messagingEnabled: false, publicBaseUrl: BASE,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const login = await app.inject({
      method: 'POST', url: '/login', payload: `code=${encodeURIComponent(CODE)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie, 'the owner must be able to sign in for this test').not.toBe('');
  }, 60_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('the conversation offers it beside the order; one tap makes it, sends nothing, and comes back there', async () => {
    const conv = await app.inject({ method: 'GET', url: `/app/inbox/${CONV}`, headers: { cookie } });
    expect(conv.body).toContain(`action="/app/orders/${ORDER}/proforma-link"`);
    const outbound = () => asTenant(BIZ, (tx) => sql<{ n: number }>`
      select count(*)::int as n from outbound_messages where conversation_id = ${CONV}`.execute(tx).then((r) => r.rows[0]!.n));
    const before = await outbound();

    const { to, body } = await landed(await post(`/app/orders/${ORDER}/proforma-link`, 'conversation'));
    expect(to).toContain(`/app/inbox/${CONV}`);
    expect(body).toContain('Proforma link ready. Paste it to the customer.');
    token = (await tokenOf(BIZ, ORDER))!;
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(body).toContain(`${BASE}/pi/${token}`);
    expect(await outbound()).toBe(before);
  });

  it('a second tap returns the same link, and the trail says it was made once', async () => {
    await post(`/app/orders/${ORDER}/proforma-link`, 'order');
    expect(await tokenOf(BIZ, ORDER)).toBe(token);
    const made = await asTenant(BIZ, (tx) => sql<{ n: number }>`
      select count(*)::int as n from conversation_events where conversation_id = ${CONV} and type = 'proforma_link_made'
         and payload->>'orderId' = ${ORDER}`.execute(tx).then((r) => r.rows[0]!.n));
    expect(made).toBe(1);
  });

  it('the customer opens it with no session: the document, and nothing else of the order', async () => {
    const res = await app.inject({ method: 'GET', url: `/pi/${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    for (const s of ['Westlake Test Canvas', `Futian Market ${RUN}, Yiwu`, 'Khalid Mansoor', `YW-PI-${RUN}-A`, 'Canvas tote bag',
      '$0.38', '$1,900.00', 'FOB Ningbo', '30% deposit, 70% before shipment']) expect(res.body, s).toContain(s);
    for (const never of [EMAIL, NOTE, CONV, ORDER, BIZ]) expect(res.body, never).not.toContain(never);
  });

  it('in the language the customer writes in', async () => {
    await asTenant(BIZ, (tx) => sql`update clients set preferred_language = 'ar' where id = ${CLIENT}`.execute(tx));
    const res = await app.inject({ method: 'GET', url: `/pi/${token}` });
    expect(res.body).toContain('<html lang="ar" dir="rtl"');
    expect(res.body).toContain('فاتورة مبدئية');
    await asTenant(BIZ, (tx) => sql`update clients set preferred_language = null where id = ${CLIENT}`.execute(tx));
  });

  it('the order page shows the same link, to copy, and a look as the customer sees it', async () => {
    const res = await app.inject({ method: 'GET', url: `/app/orders/${ORDER}`, headers: { cookie } });
    expect(res.body).toContain(`<code class="prooflink"><bdi>${BASE}/pi/${token}</bdi></code>`);
    expect(res.body).toContain(`action="/app/orders/${ORDER}/proforma-link/off"`);
  });

  it('REFUSED, changing nothing: an order without a delivery term — and another workspace’s order', async () => {
    const page = await app.inject({ method: 'GET', url: `/app/orders/${ORDER2}`, headers: { cookie } });
    expect(page.body).not.toContain('/proforma-link');
    const { body } = await landed(await post(`/app/orders/${ORDER2}/proforma-link`, 'order'));
    expect(body).toContain('Could not make a proforma link for this order.');
    expect(await tokenOf(BIZ, ORDER2)).toBeNull();

    const theirs = await post(`/app/orders/${ORDER3}/proforma-link`, 'conversation');
    expect(theirs.statusCode).toBe(302);
    expect(await tokenOf(BIZ2, ORDER3)).toBeNull();
  });

  it('turning it off: the link answers 404, byte for byte a link that never existed; the trail says so', async () => {
    const { to, body } = await landed(await post(`/app/orders/${ORDER}/proforma-link/off`, 'order'));
    expect(to).toBe(`/app/orders/${ORDER}`);
    expect(body).toContain('Turned off. That link no longer opens.');
    expect(await tokenOf(BIZ, ORDER)).toBeNull();
    const off = await app.inject({ method: 'GET', url: `/pi/${token}` });
    const never = await app.inject({ method: 'GET', url: `/pi/${'q'.repeat(43)}` });
    expect(off.statusCode).toBe(404);
    expect(off.body).toBe(never.body);
    expect(off.body).toContain('This proforma link does not work');
    const offs = await asTenant(BIZ, (tx) => sql<{ n: number }>`
      select count(*)::int as n from conversation_events where conversation_id = ${CONV} and type = 'proforma_link_off'`
      .execute(tx).then((r) => r.rows[0]!.n));
    expect(offs).toBe(1);
  });

  it('a fresh link is a new one; an order that loses its delivery term stops opening, its link left as it was', async () => {
    await post(`/app/orders/${ORDER}/proforma-link`, 'order');
    const fresh = (await tokenOf(BIZ, ORDER))!;
    expect(fresh).not.toBe(token);
    expect((await app.inject({ method: 'GET', url: `/pi/${fresh}` })).statusCode).toBe(200);
    await asTenant(BIZ, (tx) => sql`update orders set incoterm = null where id = ${ORDER}`.execute(tx));
    expect((await app.inject({ method: 'GET', url: `/pi/${fresh}` })).statusCode).toBe(404);
    expect(await tokenOf(BIZ, ORDER)).toBe(fresh);
  });

  it('the resolver gives a stranger nothing for a short or unknown token', async () => {
    for (const probe of ['', 'short', 'q'.repeat(43)]) {
      const r = await sql<{ n: number }>`select count(*)::int as n from resolve_proforma(${probe})`.execute(db);
      expect(r.rows[0]!.n, probe).toBe(0);
    }
  });
});
