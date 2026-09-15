import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant } from './tenant.js';

/**
 * G22 — she writes a discount, and a buyer gets it.
 *
 * The parity suite proves the page and the engine separately. Only Postgres can
 * show the join between them: a row her own form wrote, read back by
 * `computeQuote` through the repo the turn uses, priced against her floor and
 * her ask-me line. That join is the whole milestone — the engine has always
 * been able to discount, and nothing could ever tell it to.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd220000-0000-4000-8000-${RUN}0001`;
const CODE = 'volume-discount-owner-code';

d('G22 · when she comes down on price (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let cookie = '';
  let productId = '';

  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };
  const post = (url: string, fields: Record<string, string>) => app.inject({
    method: 'POST', url, headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(fields).toString(),
  });
  /** The quote a buyer would get, through the repo the turn uses. */
  const quoteFor = async (quantity: number) => {
    const { computeQuote } = await import('../../src/core/commerce/quote.js');
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { parseBusinessId, parseProductId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    const pid = parseProductId(productId); if (!pid.ok) throw new Error('fixture');
    return tx(async (t) => {
      const c = tenantRepos(t, bid.value).catalog;
      const product = await c.product(pid.value);
      if (!product) throw new Error('no product');
      return computeQuote({
        product,
        tiers: await c.priceTiers(pid.value),
        policy: await c.pricingPolicy(pid.value),
        rules: await c.negotiationRules(),
        quantity,
      });
    });
  };

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    productId = await tx(async (t) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'Discount Factory')
                on conflict (id) do nothing`.execute(t);
      const id = (await sql<{ id: string }>`
        insert into products (business_id, sku, name, unit, moq, price_usd_per_unit, is_active)
        values (${BIZ}, ${`VD-${RUN}`}, 'Canvas Tote', 'pcs', 500, 1.00, true)
        returning id::text as id`.execute(t)).rows[0]!.id;
      await sql`insert into price_tiers (product_id, min_qty, unit_price_usd) values (${id}::uuid, 500, 1.00)`.execute(t);
      return id;
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

  it('WITH NO LIMITS STATED, a discount is refused — the floor is what makes one safe', async () => {
    const res = await post('/app/factory/prices/volume', { productId: '', minQty: '10000', discountPct: '3' });
    expect(res.statusCode).toBe(400);
    const rules = await tx((t) => sql<{ n: number }>`
      select count(*)::int as n from negotiation_rules where business_id = ${BIZ}`.execute(t).then((r) => r.rows[0]!.n));
    expect(rules).toBe(0);
  });

  it('and above the most she said may ever come off, it is refused with her own number', async () => {
    await post('/app/factory/prices', { productId: '', floor: '0.30', maxDiscountPct: '8', askAbovePct: '5' });
    const res = await post('/app/factory/prices/volume', { productId: '', minQty: '10000', discountPct: '30' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('more than the most you said may ever come off');
  });

  it('THE ONE SHE WRITES IS THE ONE A BUYER GETS', async () => {
    const res = await post('/app/factory/prices/volume', { productId: '', minQty: '10000', discountPct: '3' });
    expect(res.statusCode).toBe(302);
    const q = await quoteFor(10_000);
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    expect(q.value.discountPct).toBe(3);
    expect(q.value.unitPrice.amount).toBeCloseTo(0.97, 4);
    // Below her quantity, nothing comes off — the rule is hers, not a mood.
    const small = await quoteFor(1_000);
    expect(small.ok && small.value.discountPct).toBe(0);
  });

  it('past her ask-me line the quote WAITS FOR HER, which is what G7a built', async () => {
    await post('/app/factory/prices/volume', { productId: '', minQty: '50000', discountPct: '7' });
    const q = await quoteFor(50_000);
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    expect(q.value.discountPct).toBe(7);
    expect(q.value.requiresHuman).toBe(true);
  });

  it('she stops offering one, and it is ARCHIVED rather than erased', async () => {
    const id = await tx((t) => sql<{ id: string }>`
      select id::text as id from negotiation_rules
       where business_id = ${BIZ} and is_active and (condition->>'qtyGte')::int = 10000 limit 1
    `.execute(t).then((r) => r.rows[0]!.id));
    const res = await post(`/app/factory/prices/volume/${id}/archive`, {});
    expect(res.statusCode).toBe(302);

    const row = await tx((t) => sql<{ is_active: boolean }>`
      select is_active from negotiation_rules where id = ${id}::uuid`.execute(t).then((r) => r.rows[0]));
    expect(row?.is_active, 'the row was deleted rather than archived').toBe(false);
    const q = await quoteFor(10_000);
    expect(q.ok && q.value.discountPct, 'an archived rule still discounts').toBe(0);
  });

  it('every change is on her audit trail, as the price rule it is', async () => {
    const rows = await tx((t) => sql<{ detail: { kind?: string } }>`
      select detail from channel_audit
       where business_id = ${BIZ} and action = 'price_rules_set' order by at
    `.execute(t).then((r) => r.rows));
    const kinds = rows.map((r) => r.detail.kind ?? 'limits');
    expect(kinds).toContain('volume_discount');
    expect(kinds).toContain('volume_discount_archived');
  });
});
