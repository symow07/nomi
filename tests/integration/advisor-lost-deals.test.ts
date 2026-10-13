import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

/**
 * Phase 2b (the owner's word, 2026-10-13) — C5, THE DEALS THAT WENT NOWHERE, from evidence on record and never
 * a guessed label: a price given and nothing from the customer for 14 days or more (Home's own rule); an order
 * the owner set aside; an order cancelled — Home's 30-day window, the owner's own tests left out — and a line that
 * says Nomi does not record why. Payments, costs and stock stay "I don't know" until Phase 5.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const id = (n: number) => `dda50000-0000-4000-8000-${RUN}${String(n).padStart(4, '0')}`;
const BIZ = id(1); const EMPTY = id(2);

d('Phase 2b · the deals that went nowhere (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let admin: pg.Client;
  let ro: import('../../src/db/client.js').Db;
  const who: Record<string, { client: string; conv: string }> = {};
  const customer = async (name: string, testing = false) => {
    const client = (await admin.query(`insert into clients (business_id, display_name) values ($1, $2) returning id::text as id`, [BIZ, name])).rows[0].id;
    const conv = (await admin.query(`insert into conversations (business_id, client_id, channel, owner_testing) values ($1, $2, 'whatsapp', $3) returning id::text as id`,
      [BIZ, client, testing])).rows[0].id;
    who[name] = { client, conv };
    return who[name]!;
  };
  /** A price given `days` ago: the quote, and the reply that carried it. */
  const priced = async (c: { conv: string }, product: string, days: number) => {
    await admin.query(`insert into quotes (business_id, conversation_id, product_id, quantity, inputs, unit_price_usd, total_usd, engine_version, currency, created_at)
      values ($1, $2, $3, 100, '{}'::jsonb, 2, 200, 'test', 'USD', now() - make_interval(days => $4))`, [BIZ, c.conv, product, days]);
    await admin.query(`insert into messages (conversation_id, direction, text_content, sent_at) values ($1, 'outbound', 'That is $200 for 100.', now() - make_interval(days => $2) + interval '1 minute')`,
      [c.conv, days]);
  };
  const read = async (biz: string) => {
    const { READS } = await import('../../src/advisor/reads.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(biz); if (!b.ok) throw new Error('fixture');
    return READS['C5']!({ db: ro, businessId: b.value, viewerId: 'owner', locale: 'en', now: new Date(),
      params: { period: null, customer: null, product: null, reference: null } } as import('../../src/advisor/reads.js').ReadCtx);
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL }); await admin.connect();
    const { createReadOnlyDb } = await import('../../src/db/client.js');
    ro = createReadOnlyDb(DATABASE_URL!);
    await admin.query(`insert into businesses (id, name, timezone) values ($1, $2, 'UTC'), ($3, $4, 'UTC')`, [BIZ, `Lost ${RUN}`, EMPTY, `Empty ${RUN}`]);
    const product = (await admin.query(`insert into products (business_id, sku, name) values ($1, $2, 'Tote') returning id::text as id`, [BIZ, `LD-${RUN}`])).rows[0].id;
    await priced(await customer('Silent Sam'), product, 20);           // went nowhere: no order, nothing since
    await priced(await customer('Recent Rita'), product, 5);           // too recent to say
    const ans = await customer('Answered Ali');
    await priced(ans, product, 20);
    await admin.query(`insert into messages (conversation_id, direction, text_content, sent_at) values ($1, 'inbound', 'Thinking about it', now() - interval '10 days')`, [ans.conv]);
    await priced(await customer('Testing Tom', true), product, 20);     // the owner's own test
    const set = await customer('Set-aside Sara');
    await admin.query(`insert into order_proposals (business_id, conversation_id, client_id, product_id, quantity, unit, unit_price, total, currency, client_email, state, decided_at)
      values ($1, $2, $3, $4, 100, 'pcs', 2, 200, 'USD', 'sara@example.com', 'set_aside', now() - interval '3 days')`, [BIZ, set.conv, set.client, product]);
    const can = await customer('Cancelled Carl');
    await admin.query(`insert into orders (order_reference, business_id, client_id, conversation_id, product_id, quantity, unit, total_value_usd, currency, status)
      values ($1, $2, $3, $4, $5, 10, 'pcs', 20, 'USD', 'cancelled')`, [`LD-${RUN}-C`, BIZ, can.client, can.conv, product]);
  }, 60_000);
  afterAll(async () => { await ro?.destroy(); await admin?.end(); });

  it('each kind of evidence, said as what happened — and that Nomi does not record why', async () => {
    const sheet = await read(BIZ);
    expect(sheet.empty).toBe(false);
    const text = sheet.lines.join('\n');
    expect(text).toMatch(/Silent Sam: given a price on .+, no order and nothing since/);
    expect(text).not.toMatch(/\d+ (days|months)/);
    expect(text).toMatch(/Set-aside Sara: an order set aside on /);
    expect(text).toMatch(new RegExp(`Cancelled Carl: order LD-${RUN}-C cancelled on `));
    expect(sheet.lines.at(-1)).toBe("Nomi doesn't record why a deal went nowhere.");
    for (const not of ['Recent Rita', 'Answered Ali', 'Testing Tom']) expect(text, not).not.toContain(not);
    // The customers it names are its subjects (the advisor's memory and the erasure find them).
    expect([...sheet.subjects].sort()).toEqual([who['Silent Sam']!.client, who['Set-aside Sara']!.client, who['Cancelled Carl']!.client].sort());
  });

  it('nothing on record: the fixed sentence, no lines', async () => {
    const sheet = await read(EMPTY);
    expect(sheet).toMatchObject({ empty: true, none: 'advisor.none.lost', lines: [] });
  });
});
