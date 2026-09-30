import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';

/**
 * PRACTICE IS NOT KEPT (P6, 0089; the P1 decision in docs/PRACTICE.md).
 * "Try it" puts a real customer's words into Practice, where a deletion request
 * cannot find them. So Start over erases a workspace's practice at once, and a
 * daily job erases practice nothing has happened in for thirty days — the
 * conversation and everything that hangs off it, on copies only.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const LIVE = `dd890000-0000-4000-8000-${RUN}0001`;
const OTHER = `dd890000-0000-4000-8000-${RUN}0002`;
const PRODUCT = `dd890000-0000-4000-8001-${RUN}0001`;

type Db = import('../../src/db/client.js').Db;

d('P6 · Practice is not kept (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let app: Db;
  let admin: Db;
  let copy = '';
  let other = '';

  const bid = async (raw: string) => {
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(raw); if (!b.ok) throw new Error('fixture'); return b.value;
  };
  /** A practice conversation on a copy, `days` old, with a turn, a draft, a quote, an order, an event and a promise. */
  const practised = async (onCopy: string, days: number, word: string): Promise<string> => {
    const conv = (await sql<{ id: string }>`
      with c as (insert into clients (business_id, display_name) values (${onCopy}, 'Practice') returning id)
      insert into conversations (business_id, client_id, channel, created_at)
      select ${onCopy}, id, 'instagram', now() - make_interval(days => ${days}) from c returning id::text as id`.execute(admin)).rows[0]!.id;
    const at = sql`now() - make_interval(days => ${days})`;
    await sql`insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at)
              values (${conv}::uuid, ${`${word}-${RUN}-in`}, 'inbound', 'text', ${`${word}: a customer asked this`}, ${at})`.execute(admin);
    const product = (await sql<{ id: string }>`select id::text as id from products where business_id = ${onCopy}::uuid limit 1`.execute(admin)).rows[0]!.id;
    const quote = (await sql<{ id: string }>`insert into quotes (business_id, conversation_id, product_id, quantity, inputs, unit_price_usd, total_usd, engine_version, created_at)
      values (${onCopy}, ${conv}::uuid, ${product}::uuid, 10, '{}'::jsonb, 2, 20, 'erase-test', ${at}) returning id::text as id`.execute(admin)).rows[0]!.id;
    await sql`insert into turns (business_id, conversation_id, message_id, state_before, input, decision, quote_id, engine_version, created_at)
              values (${onCopy}, ${conv}::uuid, ${`${word}-${RUN}-in`}, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, ${quote}::uuid, 'erase-test', ${at})`.execute(admin);
    await sql`insert into drafts (business_id, conversation_id, capability, draft_text, status, created_at)
              values (${onCopy}, ${conv}::uuid, 'quote', ${`${word}: a reply`}, 'pending', ${at})`.execute(admin);
    await sql`insert into orders (order_reference, business_id, client_id, conversation_id, product_id, quantity, unit,
                                  agreed_unit_price_usd, total_value_usd, currency, status, quote_id, created_at)
              select ${`ER-${RUN}-${word}`}, ${onCopy}, client_id, id, ${product}::uuid, 10, 'pcs', 2, 20, 'USD', 'confirmed', ${quote}::uuid, ${at}
                from conversations where id = ${conv}::uuid`.execute(admin);
    await sql`insert into conversation_events (business_id, conversation_id, type, payload, created_at)
              values (${onCopy}, ${conv}::uuid, 'sandbox_turn', '{}'::jsonb, ${at})`.execute(admin);
    return conv;
  };
  const left = async (conv: string) => (await sql<{ n: number }>`
    select ((select count(*) from conversations where id = ${conv}::uuid)
         + (select count(*) from messages where conversation_id = ${conv}::uuid)
         + (select count(*) from turns where conversation_id = ${conv}::uuid)
         + (select count(*) from drafts where conversation_id = ${conv}::uuid)
         + (select count(*) from quotes where conversation_id = ${conv}::uuid)
         + (select count(*) from orders where conversation_id = ${conv}::uuid)
         + (select count(*) from conversation_events where conversation_id = ${conv}::uuid))::int as n`.execute(admin)).rows[0]!.n;

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { refreshPractice } = await import('../../src/db/practice.js');
    app = createDb(DATABASE_URL!);
    admin = createDb(MIGRATE_URL!);
    await sql`insert into businesses (id, name) values (${LIVE}, 'Erase Co'), (${OTHER}, 'Keep Co')`.execute(admin);
    await sql`insert into products (id, business_id, sku, name, price_usd_per_unit) values (${PRODUCT}, ${LIVE}, ${`ER-${RUN}`}, 'A thing', 2)`.execute(admin);
    await sql`insert into products (business_id, sku, name, price_usd_per_unit) values (${OTHER}, ${`EK-${RUN}`}, 'Another', 3)`.execute(admin);
    copy = await refreshPractice(app, await bid(LIVE));
    other = await refreshPractice(app, await bid(OTHER));
  }, 60_000);
  afterAll(async () => { await app?.destroy(); await admin?.destroy(); });

  it('the daily erasure takes practice quiet for thirty days, and nothing younger, nothing real', async () => {
    const old = await practised(copy, 31, 'old');
    const young = await practised(copy, 29, 'young');
    // A REAL workspace's conversation of the same age is not Practice's to erase.
    const real = (await sql<{ id: string }>`
      with c as (insert into clients (business_id, display_name) values (${LIVE}, 'Real') returning id)
      insert into conversations (business_id, client_id, channel, created_at)
      select ${LIVE}, id, 'instagram', now() - interval '40 days' from c returning id::text as id`.execute(admin)).rows[0]!.id;
    const { expirePractice } = await import('../../src/db/practice.js');
    expect(await expirePractice(app)).toBeGreaterThanOrEqual(1);
    expect(await left(old)).toBe(0);
    expect(await left(young)).toBe(7);
    expect(await left(real)).toBe(1);
  });

  it('Start over erases every practice conversation of the workspace, at once — and nobody else\'s', async () => {
    const mine = await practised(copy, 0, 'mine');
    const theirs = await practised(other, 0, 'theirs');
    const { startPracticeOver } = await import('../../src/db/practice.js');
    expect(await startPracticeOver(app, await bid(LIVE))).toBeGreaterThanOrEqual(1);
    expect(await left(mine)).toBe(0);
    expect(await left(theirs)).toBe(7);
    // kept: the copy, its catalogue, and the practice customer's row
    const kept = (await sql<{ biz: number; products: number }>`
      select (select count(*)::int from businesses where id = ${copy}::uuid) as biz,
             (select count(*)::int from products where business_id = ${copy}::uuid) as products`.execute(admin)).rows[0]!;
    expect(kept).toEqual({ biz: 1, products: 1 });
  });

  it('only for the workspace you are in; the erasure itself is not the app\'s to call', async () => {
    await expect(app.transaction().execute(async (tx) => {
      await sql`select set_config('app.business_id', ${LIVE}, true)`.execute(tx);
      await sql`select practice_start_over(${OTHER}::uuid)`.execute(tx);
    })).rejects.toThrow(/only for the workspace you are in/);
    await expect(sql`select practice_erase(${other}::uuid, interval '0')`.execute(app)).rejects.toThrow(/permission denied/);
    // and it refuses a real workspace outright, whoever calls it
    await expect(sql`select practice_erase(${LIVE}::uuid, interval '0')`.execute(admin)).rejects.toThrow(/not a practice copy/);
  });
});
