import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant } from './tenant.js';

/**
 * M43a — the currency is in the ROW, and the row refuses one this build cannot
 * price.
 *
 * The parity suite proves the type. It cannot prove that the column exists,
 * that the check constraint refuses an unknown currency, or that a tier written
 * in one the code cannot read is DROPPED rather than quoted in dollars — and
 * that last one is the whole safety argument, so it is asserted against a real
 * row read back through the real repository.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd430000-0000-4000-8000-${RUN}0001`;
const PID = `dd430000-0000-4000-8000-${RUN}0002`;

d('M43a · money carries its currency, in Postgres (requires DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;

  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    await tx(async (t) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'Currency Test Factory')
                on conflict (id) do nothing`.execute(t);
      await sql`insert into products (id, business_id, sku, name, unit, moq, is_active)
                values (${PID}, ${BIZ}, 'CUR-1', 'Currency test bag', 'pcs', 1000, true)
                on conflict (id) do nothing`.execute(t);
      await sql`insert into price_tiers (product_id, min_qty, max_qty, unit_price_usd, currency)
                values (${PID}, 1000, null, 0.45, 'USD')
                on conflict (product_id, min_qty) do nothing`.execute(t);
      await sql`insert into pricing_policy
                  (business_id, product_id, floor_price_usd, currency, max_discount_pct, human_required_above_pct)
                values (${BIZ}, ${PID}, 0.35, 'USD', 10, 7)
                on conflict (business_id, product_id) do nothing`.execute(t);
    });
  }, 60_000);

  afterAll(async () => { await db?.destroy(); });

  it('every money-bearing table has the column, defaulting to USD', async () => {
    const rows = await tx((t) => sql<{ table_name: string; column_default: string | null; is_nullable: string }>`
      select table_name, column_default, is_nullable
        from information_schema.columns
       where table_schema = 'public' and column_name = 'currency'
         and table_name in ('price_tiers','pricing_policy','quotes','orders','products')
       order by table_name
    `.execute(t).then((r) => r.rows));
    expect(rows.map((r) => r.table_name))
      .toEqual(['orders', 'price_tiers', 'pricing_policy', 'products', 'quotes']);
    for (const r of rows) {
      expect(r.is_nullable, r.table_name).toBe('NO');
      expect(r.column_default, r.table_name).toContain('USD');
    }
  });

  it('THE CONSTRAINT BITES: a currency this build cannot price cannot be written', async () => {
    // Fail at the WRITE, not at the quote. A row the code cannot read is a row
    // that should never have entered the database.
    await expect(tx((t) => sql`
      insert into price_tiers (product_id, min_qty, unit_price_usd, currency)
      values (${PID}, 2000, 0.40, 'EUR')
    `.execute(t))).rejects.toThrow(/price_tiers_currency_known|violates check constraint/);
  });

  it('the repos read the currency FROM THE ROW', async () => {
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    const [tiers, policy] = await tx(async (t) => {
      const repos = tenantRepos(t, bid.value);
      return [await repos.catalog.priceTiers(PID), await repos.catalog.pricingPolicy(PID)] as const;
    });
    expect(tiers).toHaveLength(1);
    expect(tiers[0]!.unitPrice).toEqual({ amount: 0.45, currency: 'USD' });
    expect(policy!.floorPrice).toEqual({ amount: 0.35, currency: 'USD' });
  });

  it('A TIER IN A CURRENCY THIS BUILD CANNOT PRICE IS DROPPED, not quoted in dollars', async () => {
    // The constraint stops this from arriving through any supported path, so
    // the row is forced past it with the admin role. That is the point: this
    // asserts what the READ does when the impossible row exists anyway — a
    // future currency, a restored dump, a hand-edited fix at 2am.
    if (!MIGRATE_URL) {
      throw new Error('MIGRATE_DATABASE_URL is required: this assertion needs the admin role');
    }
    const { createDb } = await import('../../src/db/client.js');
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { withTenantTx } = await import('../../src/db/client.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    const admin = createDb(MIGRATE_URL);
    try {
      await sql`alter table price_tiers drop constraint price_tiers_currency_known`.execute(admin);
      await sql`insert into price_tiers (product_id, min_qty, unit_price_usd, currency)
                values (${PID}::uuid, 3000, 0.40, 'EUR')
                on conflict (product_id, min_qty) do update set currency = 'EUR'`.execute(admin);

      const tiers = await withTenantTx(db, bid.value, (t) => tenantRepos(t, bid.value).catalog.priceTiers(PID));
      // The USD tier survives; the EUR one is not there at all, and certainly
      // not there priced in dollars.
      expect(tiers.map((t) => t.minQty)).toEqual([1000]);
      expect(tiers.every((t) => t.unitPrice.currency === 'USD')).toBe(true);

      // And the quote engine, given what the repo returned, refuses for 3000
      // rather than quoting the euro price as $0.40.
      const { computeQuote } = await import('../../src/core/commerce/quote.js');
      const { parseProductId } = await import('../../src/core/types/ids.js');
      const pid = parseProductId(PID); if (!pid.ok) throw new Error('fixture');
      const r = computeQuote({
        product: {
          id: pid.value,
          businessId: bid.value, sku: 'CUR-1', name: 'Currency test bag',
          moq: 1000, unit: 'pcs', leadTimeDays: 25, customizable: false,
        },
        tiers, policy: null, rules: [], quantity: 3000,
      });
      expect(r.ok).toBe(true);
      // 3000 falls inside the surviving 1000+ tier, and is priced from it — the
      // USD row — never from the dropped one.
      if (r.ok) expect(r.value.unitPrice).toEqual({ amount: 0.45, currency: 'USD' });
    } finally {
      await sql`delete from price_tiers where product_id = ${PID}::uuid and min_qty = 3000`.execute(admin);
      await sql`alter table price_tiers add constraint price_tiers_currency_known check (currency in ('USD'))`
        .execute(admin);
      await admin.destroy();
    }
  }, 60_000);

  it('a recorded quote writes the currency it was computed in', async () => {
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { usd } = await import('../../src/core/types/money.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');

    const convId = await tx(async (t) => {
      const client = (await sql<{ id: string }>`
        insert into clients (business_id, phone, display_name)
        values (${BIZ}, ${`+8613${RUN}`}, 'Currency test buyer')
        returning id::text as id
      `.execute(t)).rows[0]!.id;
      return (await sql<{ id: string }>`
        insert into conversations (business_id, client_id, channel, phase)
        values (${BIZ}, ${client}::uuid, 'whatsapp', 'warm_intake')
        returning id::text as id
      `.execute(t)).rows[0]!.id;
    });
    expect(convId, 'no conversation to attach a quote to').not.toBe('');

    const { quoteId } = await tx((t) => tenantRepos(t, bid.value).audit.recordQuote({
      conversationId: convId as never,
      productId: PID,
      quantity: 20000,
      inputs: {},
      unitPrice: usd(0.38),
      discountPct: 0,
      total: usd(7600),
      requiresHuman: false,
      appliedRules: [],
    }));

    const row = await tx((t) => sql<{ currency: string; unit_price_usd: string }>`
      select currency, unit_price_usd from quotes where id = ${quoteId}::uuid
    `.execute(t).then((r) => r.rows[0]!));
    expect(row.currency).toBe('USD');
    expect(Number(row.unit_price_usd)).toBe(0.38);
  });
});
