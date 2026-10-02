import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant } from './tenant.js';

/**
 * Phase 9 (V1-305) — the product page's price box is the ENTRY price: the
 * lowest tier, the one the page shows in it. Saving it wrote a tier "from 1",
 * which no quote of 500 or more ever read (the most specific tier wins), so on
 * a product whose prices start at 500 the owner's new price changed nothing.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd930000-0000-4000-8000-${RUN}0001`;
const TIERED = `dd930000-0000-4000-8001-${RUN}0001`;
const BARE = `dd930000-0000-4000-8001-${RUN}0002`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

d('Phase 9 · the price box moves the entry tier (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let cookie = '';
  const CODE = 'entry-tier-owner-code';

  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };
  const post = (url: string, fields: Record<string, string>) =>
    app.inject({ method: 'POST', url, payload: new URLSearchParams(fields).toString(), headers: { cookie, ...FORM } });
  const tiers = (pid: string) => tx((t) => sql<{ min_qty: number; price: string }>`
    select min_qty, unit_price_usd::text as price from price_tiers where product_id = ${pid} order by min_qty`
    .execute(t).then((r) => r.rows.map((x) => [Number(x.min_qty), Number(x.price)])));

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    await tx(async (t) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'Tier Test Lights') on conflict (id) do nothing`.execute(t);
      await sql`insert into products (id, business_id, sku, name, unit, moq, currency, price_usd_per_unit, is_active)
                values (${TIERED}, ${BIZ}, ${`TL-${RUN}`}, 'LED string lights 10m', 'pcs', 500, 'USD', 1.05, true),
                       (${BARE}, ${BIZ}, ${`TB-${RUN}`}, 'Bare bulb', 'pcs', null, 'USD', 2.00, true)`.execute(t);
      for (const [q, p] of [[500, 1.05], [2000, 0.92], [10000, 0.85]] as const) {
        await sql`insert into price_tiers (product_id, min_qty, unit_price_usd, currency) values (${TIERED}, ${q}, ${p}, 'USD')`.execute(t);
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
    cookie = String((await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(CODE)}`, headers: FORM }))
      .headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 60_000);
  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('a product priced from 500: the 500 tier takes the new price, the others stay, and no tier "from 1" appears', async () => {
    const r = await post(`/app/products/${TIERED}/edit`, { price: '1.10', moq: '500', unit: 'pcs', isActive: 'on' });
    expect(r.statusCode).toBe(302);
    expect(await tiers(TIERED)).toEqual([[500, 1.1], [2000, 0.92], [10000, 0.85]]);
  });

  it('a product with no tier yet gets its entry tier from 1, as before', async () => {
    const r = await post(`/app/products/${BARE}/edit`, { price: '2.40', moq: '', unit: 'pcs', isActive: 'on' });
    expect(r.statusCode).toBe(302);
    expect(await tiers(BARE)).toEqual([[1, 2.4]]);
  });
});
