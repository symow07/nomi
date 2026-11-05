import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createDb, withTenantTx, type Db } from '../../src/db/client.js';
import { parseBusinessId } from '../../src/core/types/ids.js';
import { loadSplitSales } from '../../src/db/splitToday.js';
import { usd } from '../../src/core/types/money.js';

const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const suite = DATABASE_URL && ADMIN_URL ? describe : describe.skip;

suite('Today sales amounts across currencies (requires isolated DATABASE_URL)', () => {
  let db: Db;
  let admin: pg.Client;
  beforeAll(async () => {
    db = createDb(DATABASE_URL!);
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
  });
  afterAll(async () => { await admin?.end(); await db?.destroy(); });

  async function read(currencies: readonly string[]) {
    const raw = randomUUID();
    const bid = parseBusinessId(raw);
    if (!bid.ok) throw new Error('fixture business');
    await admin.query(`insert into businesses (id, name, currency, timezone) values ($1, 'Currency totals', 'USD', 'UTC')`, [raw]);
    const product = (await admin.query(`insert into products (business_id, sku, name) values ($1, 'BAG', 'Bag') returning id`, [raw])).rows[0].id;
    for (const [i, currency] of currencies.entries()) {
      const client = (await admin.query(`insert into clients (business_id, display_name) values ($1, 'Customer') returning id`, [raw])).rows[0].id;
      const conversation = (await admin.query(`insert into conversations (business_id, client_id, channel) values ($1, $2, 'whatsapp') returning id`, [raw, client])).rows[0].id;
      await admin.query(`insert into quotes (business_id, conversation_id, product_id, quantity, inputs, unit_price_usd, discount_pct, total_usd, currency, requires_human, applied_rules, engine_version)
        values ($1, $2, $3, 1, '{}', 25, 0, 25, $4, false, '{}', 'currency-test')`, [raw, conversation, product, currency]);
      // PRICE_GIVEN requires a message that actually left after the quote was recorded.
      await admin.query(`insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at)
        values ($1, $2, 'outbound', 'text', 'Here is your price.', now())`, [conversation, `${raw}-${i}`]);
      await admin.query(`insert into orders (order_reference, business_id, client_id, conversation_id, product_id, quantity, unit, total_value_usd, currency, status, confirmed_at)
        values ($1, $2, $3, $4, $5, 1, 'pcs', 90, $6, 'confirmed', now())`, [`CUR-${raw}-${i}`, raw, client, conversation, product, currency]);
    }
    return withTenantTx(db, bid.value, (tx) => loadSplitSales(tx, bid.value, 'UTC', new Date()));
  }

  it('keeps foreign-only counts while leaving the unavailable workspace-currency amount absent', async () => {
    const sales = await read(['EUR']);
    expect(sales.price).toEqual({ count: 1, value: null, otherCurrency: 1 });
    expect(sales.order).toEqual({ count: 1, value: null, otherCurrency: 1 });
  });

  it('discloses every excluded foreign-currency row without converting or dropping counts', async () => {
    const sales = await read(['USD', 'EUR', 'GBP']);
    expect(sales.price).toEqual({ count: 3, value: usd('25'), otherCurrency: 2 });
    expect(sales.order).toEqual({ count: 3, value: usd('90'), otherCurrency: 2 });
  });

  it('retains ordinary same-currency sums with no exclusions', async () => {
    const sales = await read(['USD', 'USD']);
    expect(sales.price).toEqual({ count: 2, value: usd('50'), otherCurrency: 0 });
    expect(sales.order).toEqual({ count: 2, value: usd('180'), otherCurrency: 0 });
  });
});
