import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant } from './tenant.js';

/**
 * G18 · M43a + M43b — what the database will actually hold, and what the
 * owner's totals do with it.
 *
 * The renderers are pinned in tests/parity/g18-currency.test.ts. Two things
 * only Postgres can say:
 *
 *  a · the columns still REFUSE a second currency — five of the six tables that
 *      carry one accept 'USD' and nothing else. That is why G18 changes no
 *      screen today, and it is the tripwire for the day someone widens one:
 *      this test fails, and the surfaces that read that table are the list of
 *      what must be looked at.
 *
 *  b · her month's total is grouped BY currency in SQL, not summed across it.
 *      The old query added `total_value_usd` over every order and called the
 *      result dollars.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd180000-0000-4000-8000-${RUN}0001`;

d('G18 · money keeps its currency (requires DATABASE_URL)', () => {
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
      await sql`insert into businesses (id, name) values (${BIZ}, 'Currency Factory')
                on conflict (id) do nothing`.execute(t);
      const client = (await sql<{ id: string }>`
        insert into clients (business_id, phone, display_name)
        values (${BIZ}, ${`+8614${RUN}1`}, 'Ahmed') returning id::text as id`.execute(t)).rows[0]!.id;
      const product = (await sql<{ id: string }>`
        insert into products (business_id, sku, name, unit, moq, price_usd_per_unit, is_active)
        values (${BIZ}, ${`CUR-${RUN}`}, 'Canvas Tote', 'pcs', 500, 0.92, true) returning id::text as id`.execute(t)).rows[0]!.id;
      // One open order per conversation, so the second order gets its own —
      // which is what happens in life too: confirming closes the first.
      for (const [ref, total] of [['A', 4600], ['B', 1400]] as const) {
        const conv = (await sql<{ id: string }>`
          insert into conversations (business_id, client_id, channel, phase)
          values (${BIZ}, ${client}::uuid, 'whatsapp', 'confirmation') returning id::text as id`.execute(t)).rows[0]!.id;
        await sql`insert into orders (business_id, conversation_id, client_id, product_id, order_reference,
                                      quantity, unit, agreed_unit_price_usd, total_value_usd, status)
                  values (${BIZ}, ${conv}::uuid, ${client}::uuid, ${product}::uuid, ${`YW-${RUN}-${ref}`},
                          5000, 'pcs', 0.92, ${total}, 'confirmed')`.execute(t);
      }
    });
  }, 60_000);

  afterAll(async () => { await db?.destroy(); });

  it('a · five tables still REFUSE a second currency — sample policy is the one exception', async () => {
    const rows = await tx((t) => sql<{ tbl: string; def: string }>`
      select conrelid::regclass::text as tbl, pg_get_constraintdef(oid) as def
        from pg_constraint where conname like '%currency_known%' or conname like '%currency%check%'
       order by 1
    `.execute(t).then((r) => r.rows));
    const byTable = new Map(rows.map((r) => [r.tbl, r.def]));
    for (const tbl of ['orders', 'products', 'price_tiers', 'pricing_policy', 'quotes']) {
      const def = byTable.get(tbl);
      expect(def, `${tbl} has no currency check at all`).toBeTruthy();
      // If this fails, that column now accepts a second currency — and every
      // owner surface reading it (G18) is the list of screens to look at first.
      expect(def, `${tbl} now accepts more than USD`).toContain(`'USD'`);
      expect(def, `${tbl} now accepts more than USD`).not.toContain(`'CNY'`);
    }
    expect(byTable.get('sample_policy'), 'the sample policy is where a second currency already lives').toContain(`'CNY'`);
  });

  it('b · her total is grouped BY currency, and equals that currency’s own sum', async () => {
    const { loadAnalytics } = await import('../../src/api/web/analytics.js');
    const data = await loadAnalytics(db, BIZ, 'month');
    expect(data.commerce.orders).toBe(2);
    // One currency in play, so exactly one total — and it is that currency's
    // sum, not a number assembled from every order whatever its column said.
    expect(data.commerce.totals).toHaveLength(1);
    expect(data.commerce.totals[0]).toEqual({ amount: 6000, currency: 'USD' });
  });

  it('b · and an order in a currency this build cannot price is left out, not counted as dollars', async () => {
    // The check constraint forbids writing one, so the row is made unreadable
    // the only other way it could be: by the constraint being dropped in a
    // future migration. Proven here against the loader's own rule instead.
    const { moneyFromRow } = await import('../../src/core/types/money.js');
    expect(moneyFromRow(4600, 'XYZ')).toBeNull();
    expect(moneyFromRow(4600, 'CNY')).toEqual({ amount: 4600, currency: 'CNY' });
  });
});
