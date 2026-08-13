import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant } from './tenant.js';

/**
 * M46 — after the order, end to end.
 *
 * The parity suite proves the sentence and the vocabulary. Only Postgres can
 * prove that the log and the materialised state agree, that the history is
 * append-only against the app role, that a tracking reference she typed once
 * survives a state change she typed later, and that the buyer's question is
 * answered from HER row.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd460000-0000-4000-8000-${RUN}0001`;
const PID = `dd460000-0000-4000-8000-${RUN}0002`;
// The reference is unique across the table, so it carries the run id: a fixed
// one passes the first time this file is run and never again.
const REF = `PI-AO-${RUN}`;

d('M46 · after the order (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let cookie = '';
  let convId = '';
  let orderId = '';
  const CODE = 'after-order-code';

  const post = (url: string, payload?: string) =>
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
    await tx(async (t) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'After Order Factory')
                on conflict (id) do nothing`.execute(t);
      await sql`insert into products (id, business_id, sku, name, unit, moq, is_active)
                values (${PID}, ${BIZ}, 'AO-1', 'Vacuum cup', 'pcs', 1000, true)
                on conflict (id) do nothing`.execute(t);
      const client = (await sql<{ id: string }>`
        insert into clients (business_id, phone, display_name)
        values (${BIZ}, ${`+8613${RUN}`}, 'Ahmed') returning id::text as id`.execute(t)).rows[0]!.id;
      convId = (await sql<{ id: string }>`
        insert into conversations (business_id, client_id, channel, phase)
        values (${BIZ}, ${client}::uuid, 'whatsapp', 'confirmation') returning id::text as id
      `.execute(t)).rows[0]!.id;
      orderId = (await sql<{ id: string }>`
        insert into orders (order_reference, business_id, client_id, conversation_id, product_id,
                            quantity, unit, agreed_unit_price_usd, total_value_usd, currency,
                            payment_terms, status, confirmed_at)
        values (${REF}, ${BIZ}, ${client}::uuid, ${convId}::uuid, ${PID}::uuid,
                5000, 'pcs', 0.92, 4600, 'USD', '30% deposit', 'confirmed', now())
        returning id::text as id`.execute(t)).rows[0]!.id;
      // The order's first entry, exactly as the migration backfills for rows
      // that existed before this milestone.
      await sql`insert into order_updates (business_id, order_id, state, at, by_actor)
                values (${BIZ}, ${orderId}::uuid, 'confirmed', now(), 'migration')`.execute(t);
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

  const order = () => tx((t) => sql<{ status: string; tracking_reference: string | null }>`
    select status, tracking_reference from orders where id = ${orderId}
  `.execute(t).then((r) => r.rows[0]!));

  const updates = () => tx((t) => sql<{ state: string; note: string | null; tracking_reference: string | null }>`
    select state, note, tracking_reference from order_updates
     where order_id = ${orderId} order by at, id
  `.execute(t).then((r) => r.rows));

  it('THE PRODUCTION CALLER: she records where it is', async () => {
    const res = await post(`/app/orders/${orderId}/update`,
      'state=in_production&tracking=&note=chase%20the%20dye%20lot');
    expect(res.statusCode).toBe(302);
    expect((await updates()).map((u) => u.state)).toEqual(['confirmed', 'in_production']);
  });

  it('THE LOG AND THE CURRENT STATE AGREE — one writer, one transaction', async () => {
    const [o, u] = [await order(), await updates()];
    expect(o.status).toBe(u.at(-1)!.state);
  });

  it('and they agree for EVERY order, not just the one under test', async () => {
    // The invariant, asserted over the table: `orders.status` is materialised
    // from the newest `order_updates` row, and two things that can drift are
    // only safe while something checks.
    const wrong = await tx((t) => sql<{ id: string; status: string; latest: string }>`
      select o.id::text as id, o.status, u.state as latest
        from orders o
        join lateral (
          select state from order_updates x
           where x.order_id = o.id order by x.at desc, x.id desc limit 1
        ) u on true
       where o.business_id = ${BIZ} and o.status <> u.state
    `.execute(t).then((r) => r.rows));
    expect(wrong, `status disagrees with the log: ${JSON.stringify(wrong)}`).toEqual([]);
  });

  it('A TRACKING REFERENCE TYPED ONCE SURVIVES A LATER STATE CHANGE', async () => {
    await post(`/app/orders/${orderId}/update`, 'state=shipped&tracking=SF1234567890');
    expect((await order()).tracking_reference).toBe('SF1234567890');

    // She records something else and does not retype the number.
    await post(`/app/orders/${orderId}/update`, 'state=shipped&note=buyer%20chased');
    expect((await order()).tracking_reference).toBe('SF1234567890');
  });

  it('THE HISTORY IS APPEND-ONLY — the app role cannot edit what she recorded', async () => {
    await expect(tx((t) => sql`
      update order_updates set state = 'cancelled' where order_id = ${orderId}
    `.execute(t))).rejects.toThrow(/permission denied/i);
  });

  it('a state that is not one of the four is refused', async () => {
    const before = (await updates()).length;
    const res = await post(`/app/orders/${orderId}/update`, 'state=almost_ready');
    expect(res.statusCode).toBe(302);
    expect((await updates())).toHaveLength(before);
  });

  it('THE BUYER IS ANSWERED FROM HER ROW — state and date, nothing more', async () => {
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { orderStatusReply } = await import('../../src/core/commerce/orderState.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');

    const latest = await tx((t) => tenantRepos(t, bid.value).orders.latestForConversation(convId as never));
    expect(latest).not.toBeNull();
    expect(latest!.reference).toBe(REF);
    expect(latest!.update.state).toBe('shipped');

    const said = orderStatusReply({
      reference: latest!.reference, update: latest!.update, formatDate: (x) => x.toISOString().slice(0, 10),
    });
    expect(said.reply).toContain('shipped');
    expect(said.reply).toContain('SF1234567890');
    // No estimate, and no note of hers.
    expect(said.reply.toLowerCase()).not.toMatch(/should|around|estimate|eta/);
    expect(said.reply).not.toContain('dye lot');
  });

  it('the owner page renders the order, its history and the proforma', async () => {
    const res = await app.inject({ method: 'GET', url: `/app/orders/${orderId}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(REF);
    expect(res.body).toContain('chase the dye lot');
    expect(res.body).toContain('SF1234567890');
    // invoice.ts, reachable from a production route for the first time.
    expect(res.body).toContain('PROFORMA INVOICE');
  });

  it('and the conversation links to it', async () => {
    const res = await app.inject({ method: 'GET', url: `/app/inbox/${convId}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(`/app/orders/${orderId}`);
  });

  it('another tenant’s order is not found, not forbidden', async () => {
    const res = await app.inject({
      method: 'GET', url: `/app/orders/${randomUUID()}`, headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('That order is not here');
  });
});
