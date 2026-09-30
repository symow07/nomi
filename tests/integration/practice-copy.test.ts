import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { PRACTICE_COPY, PRACTICE_COPY_CHILDREN, PRACTICE_SKIP } from './practice-tables.js';

/**
 * PRACTICE, PER WORKSPACE — the copy (P2, 0086; docs/PRACTICE.md), against
 * Postgres: what `practice_refresh` copies and what it never does, that it
 * refreshes in place, and that a copy can reach nobody.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const LIVE = `dd860000-0000-4000-8000-${RUN}0001`;
const OTHER = `dd860000-0000-4000-8000-${RUN}0002`;
const P1 = `dd860000-0000-4000-8001-${RUN}0001`;
const P2 = `dd860000-0000-4000-8001-${RUN}0002`;
const P3 = `dd860000-0000-4000-8001-${RUN}0003`;

type Db = import('../../src/db/client.js').Db;

d('Practice · the per-workspace copy (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let app: Db;     // the app role: row security, no DELETE
  let admin: Db;   // setup the app role may not do
  let copy = '';

  /** `practice_refresh`, as the app calls it: inside the owner's workspace. */
  const refresh = (live = LIVE, asIf = live) => app.transaction().execute(async (tx) => {
    await sql`select set_config('app.business_id', ${asIf}, true)`.execute(tx);
    return (await sql<{ id: string }>`select practice_refresh(${live}::uuid)::text as id`.execute(tx)).rows[0]!.id;
  });
  const count = async (table: string, where: string, id: string) =>
    (await sql<{ n: number }>`select count(*)::int as n from ${sql.table(table)} where ${sql.raw(where)} = ${id}::uuid`.execute(admin)).rows[0]!.n;
  const ofCopy = (child: string) => sql<{ n: number }>`
    select count(*)::int as n from ${sql.table(child)} t join products p on p.id = t.product_id where p.business_id = ${copy}::uuid`;

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    app = createDb(DATABASE_URL!);
    admin = createDb(MIGRATE_URL!);
    await sql`insert into businesses (id, name, kind, country, timezone, description) values
      (${LIVE}, 'Yara Candles', 'brand', 'AE', 'Asia/Dubai', 'Hand-poured candles'),
      (${OTHER}, 'Someone Else', 'brand', 'GB', 'Europe/London', null)`.execute(admin);
    await sql`insert into products (id, business_id, sku, name, unit, moq, price_usd_per_unit, is_active) values
      (${P1}, ${LIVE}, 'C-100', 'Amber candle', 'pcs', null, 12, true),
      (${P2}, ${LIVE}, 'C-200', 'Cedar candle', 'pcs', 10, 14, true),
      (${P3}, ${LIVE}, 'C-300', 'Gift box', 'boxes', null, 30, true)`.execute(admin);
    await sql`insert into price_tiers (product_id, min_qty, unit_price_usd) values (${P1}, 1, 12), (${P1}, 50, 10), (${P2}, 10, 14)`.execute(admin);
    await sql`insert into product_aliases (product_id, alias, language) values (${P1}, 'amber candle', 'en'), (${P2}, 'شمعة الأرز', 'ar')`.execute(admin);
    await sql`insert into product_images (product_id, url, is_primary) values (${P1}, 'https://img.test/amber.jpg', true)`.execute(admin);
    await sql`insert into product_knowledge (business_id, product_id, kind, label, content, source, status) values
      (${LIVE}, ${P1}, 'material', 'Wax', 'Soy wax', 'owner_confirmed', 'active'),
      (${LIVE}, null, 'faq', 'Shipping', 'We ship across the UAE', 'owner_confirmed', 'active'),
      (${LIVE}, ${P2}, 'faq', 'Old answer', 'No longer true', 'owner_confirmed', 'archived')`.execute(admin);
    await sql`insert into pricing_policy (business_id, product_id, floor_price_usd, max_discount_pct) values
      (${LIVE}, null, 5, 10), (${LIVE}, ${P1}, 9, 15)`.execute(admin);
    await sql`insert into negotiation_rules (business_id, condition, action) values
      (${LIVE}, ${JSON.stringify({ qtyGte: 100 })}::jsonb, '{"kind":"discount_pct","value":5}'::jsonb),
      (${LIVE}, ${JSON.stringify({ productId: P2, qtyGte: 20 })}::jsonb, '{"kind":"free_shipping"}'::jsonb)`.execute(admin);
    await sql`insert into bundle_rules (business_id, name, requires, grants) values
      (${LIVE}, 'Candle and box', ${sql.raw(`array['${P1}','${P3}']::uuid[]`)}, '{"kind":"discount_pct","value":8}'::jsonb)`.execute(admin);
    await sql`insert into substitution_rules (business_id, product_id, substitute_id, reason) values (${LIVE}, ${P1}, ${P2}, 'out_of_stock')`.execute(admin);
    await sql`insert into claims_policy (business_id, kind, claim_key, allowed) values (${LIVE}, 'certification', 'vegan', true)`.execute(admin);
    await sql`insert into forbidden_terms (business_id, term) values (${LIVE}, 'cheap')`.execute(admin);
    await sql`insert into factory_closures (business_id, label, starts_on, ends_on) values (${LIVE}, 'Eid', '2026-12-01', '2026-12-03')`.execute(admin);
    await sql`insert into sample_policy (business_id, price_amount, currency, credited_on_first_order, stated_at) values
      (${LIVE}, 5, 'USD', false, now() - interval '2 days'), (${LIVE}, 7, 'USD', true, now())`.execute(admin);
    await sql`insert into trade_terms (business_id, payment_terms, incoterm, stated_at, stated_by) values
      (${LIVE}, 'Half now', 'EXW', now() - interval '1 day', 'owner'), (${LIVE}, 'All up front', 'FOB', now(), 'owner')`.execute(admin);
    await sql`insert into owner_rates (business_id, from_currency, to_currency, rate, stated_at) values
      (${LIVE}, 'USD', 'CNY', 7.0, now() - interval '3 days'), (${LIVE}, 'USD', 'CNY', 7.1, now())`.execute(admin);
    await sql`insert into assistants (business_id, name, is_default) values (${LIVE}, 'Noor', true)`.execute(admin);
    await sql`insert into assistants (business_id, name, is_default, archived_at) values (${LIVE}, 'Old', false, now())`.execute(admin);
    await sql`insert into onboarding_state (business_id, assistant_named_at) values (${LIVE}, now())`.execute(admin);
    await sql`insert into autonomy_policy (business_id, capability, mode) values (${LIVE}, 'quote', 'auto'), (${LIVE}, 'greet', 'draft')`.execute(admin);
    await sql`insert into ops_flags (business_id, flag, capability, reason, set_by) values (${LIVE}, 'force_draft', 'quote', 'test', 'ops')`.execute(admin);
    await sql`insert into ops_flags (business_id, flag, capability, reason, set_by, cleared_at) values (${LIVE}, 'force_draft', 'greet', 'old', 'ops', now())`.execute(admin);
    // Things that are the live workspace's alone: a customer and a conversation.
    await sql`with c as (insert into clients (business_id, display_name, phone) values (${LIVE}, 'Real Customer', ${`+97150${RUN}`}) returning id)
              insert into conversations (business_id, client_id, channel) select ${LIVE}, id, 'instagram' from c`.execute(admin);
    copy = await refresh();
  }, 60_000);
  afterAll(async () => { await app?.destroy(); await admin?.destroy(); });

  it('the classification is the schema: every business-scoped table copy or skip, once — and every copied table is in the refresh', async () => {
    const scoped = (await sql<{ t: string }>`
      select c.table_name as t from information_schema.columns c
        join information_schema.tables t on t.table_name = c.table_name and t.table_schema = c.table_schema
       where c.table_schema = 'public' and c.column_name = 'business_id' and t.table_type = 'BASE TABLE'`.execute(admin)).rows.map((r) => r.t);
    const classified = [...PRACTICE_COPY, ...PRACTICE_SKIP];
    expect(new Set(classified).size, 'named twice').toBe(classified.length);
    expect([...scoped].sort()).toEqual([...classified].sort());
    const fn = (await sql<{ def: string }>`select pg_get_functiondef('practice_refresh(uuid)'::regprocedure) as def`.execute(admin)).rows[0]!.def;
    for (const t of [...PRACTICE_COPY, ...PRACTICE_COPY_CHILDREN]) expect(fn, t).toMatch(new RegExp(`into ${t}\\b`));
    for (const t of PRACTICE_SKIP) expect(fn, t).not.toMatch(new RegExp(`(into|from|update) ${t}\\b`));
  });

  it('the copy: its own business row, practice_of the owner\'s, with the profile', async () => {
    const row = (await sql<{ practice_of: string; name: string; kind: string; timezone: string; outreach_area: boolean }>`
      select practice_of::text, name, kind, timezone, outreach_area from businesses where id = ${copy}::uuid`.execute(admin)).rows[0]!;
    expect(row).toMatchObject({ practice_of: LIVE, name: 'Yara Candles', kind: 'brand', timezone: 'Asia/Dubai', outreach_area: false });
    expect(copy).not.toBe(LIVE);
  });

  it('copies what she answers from — products and their rows pointing at the COPY\'s products, current history rows only, active facts only', async () => {
    const products = (await sql<{ id: string; source: string; sku: string }>`
      select id::text, source_id::text as source, sku from products where business_id = ${copy}::uuid order by sku`.execute(admin)).rows;
    expect(products.map((p) => [p.sku, p.source])).toEqual([['C-100', P1], ['C-200', P2], ['C-300', P3]]);
    for (const p of products) expect([P1, P2, P3]).not.toContain(p.id);
    expect((await ofCopy('price_tiers').execute(admin)).rows[0]!.n).toBe(3);
    expect((await ofCopy('product_aliases').execute(admin)).rows[0]!.n).toBe(2);
    expect((await ofCopy('product_images').execute(admin)).rows[0]!.n).toBe(1);
    expect(await count('product_knowledge', 'business_id', copy)).toBe(2);    // the archived fact stays behind
    const copyOf = Object.fromEntries(products.map((p) => [p.source, p.id]));
    const rules = (await sql<{ c: { productId?: string } }>`select condition as c from negotiation_rules where business_id = ${copy}::uuid`.execute(admin)).rows;
    expect(rules.map((r) => r.c.productId).filter(Boolean)).toEqual([copyOf[P2]]);
    const bundle = (await sql<{ r: string[] }>`select requires::text[] as r from bundle_rules where business_id = ${copy}::uuid`.execute(admin)).rows[0]!.r;
    expect([...bundle].sort()).toEqual([copyOf[P1], copyOf[P3]].sort());
    const sub = (await sql<{ a: string; b: string }>`select product_id::text as a, substitute_id::text as b from substitution_rules where business_id = ${copy}::uuid`.execute(admin)).rows[0]!;
    expect(sub).toEqual({ a: copyOf[P1], b: copyOf[P2] });
    expect(await count('pricing_policy', 'business_id', copy)).toBe(2);
    expect(await count('claims_policy', 'business_id', copy)).toBe(1);
    expect(await count('forbidden_terms', 'business_id', copy)).toBe(1);
    expect(await count('factory_closures', 'business_id', copy)).toBe(1);
    expect((await sql<{ p: string }>`select price_amount::text as p from sample_policy where business_id = ${copy}::uuid`.execute(admin)).rows.map((r) => Number(r.p))).toEqual([7]);
    expect((await sql<{ t: string }>`select payment_terms as t from trade_terms where business_id = ${copy}::uuid`.execute(admin)).rows.map((r) => r.t)).toEqual(['All up front']);
    expect((await sql<{ r: string }>`select rate::text as r from owner_rates where business_id = ${copy}::uuid`.execute(admin)).rows.map((r) => Number(r.r))).toEqual([7.1]);
    expect((await sql<{ name: string; archived: boolean }>`select name, archived_at is not null as archived from assistants where business_id = ${copy}::uuid order by name`.execute(admin)).rows)
      .toEqual([{ name: 'Noor', archived: false }, { name: 'Old', archived: true }]);
    expect((await sql<{ named: boolean }>`select assistant_named_at is not null as named from onboarding_state where business_id = ${copy}::uuid`.execute(admin)).rows[0]!.named).toBe(true);
    expect(await count('autonomy_policy', 'business_id', copy)).toBe(2);
    expect((await sql<{ c: string }>`select capability as c from ops_flags where business_id = ${copy}::uuid`.execute(admin)).rows.map((r) => r.c)).toEqual(['quote']);
  });

  it('copies nobody: no customer, conversation, channel, person or login', async () => {
    for (const t of ['clients', 'conversations', 'channels', 'channel_credentials', 'people', 'logins', 'drafts', 'turns', 'quotes', 'orders']) {
      expect(await count(t, 'business_id', copy), t).toBe(0);
    }
  });

  it('refreshes in place: the same copy, the same product rows — a price change, a SKU swap and a product taken away all follow', async () => {
    const before = (await sql<{ id: string; source: string }>`select id::text, source_id::text as source from products where business_id = ${copy}::uuid`.execute(admin)).rows;
    // Practice quoted the amber candle: a row of practice's own, pointing at the copy's product.
    const copyP1 = before.find((p) => p.source === P1)!.id;
    await sql`with c as (insert into clients (business_id, display_name) values (${copy}, 'Practice customer') returning id),
                   v as (insert into conversations (business_id, client_id, channel) select ${copy}, id, 'instagram' from c returning id)
              insert into quotes (business_id, conversation_id, product_id, quantity, inputs, unit_price_usd, total_usd, engine_version)
              select ${copy}, v.id, ${copyP1}, 10, '{}'::jsonb, 12, 120, 'practice-test' from v`.execute(admin);
    // The owner changes a price, swaps two SKUs and takes a product away.
    await sql`update products set sku = 'SWAP' where id = ${P2}`.execute(admin);
    await sql`update products set price_usd_per_unit = 11, sku = 'C-200' where id = ${P1}`.execute(admin);
    await sql`update products set sku = 'C-100' where id = ${P2}`.execute(admin);
    await sql`update price_tiers set unit_price_usd = 9 where product_id = ${P1} and min_qty = 50`.execute(admin);
    await sql`delete from product_images where product_id = ${P3}`.execute(admin);
    await sql`delete from product_aliases where product_id = ${P3}`.execute(admin);
    await sql`delete from price_tiers where product_id = ${P3}`.execute(admin);
    await sql`delete from bundle_rules where business_id = ${LIVE}`.execute(admin);
    await sql`delete from products where id = ${P3}`.execute(admin);

    expect(await refresh()).toBe(copy);
    const after = (await sql<{ id: string; source: string; sku: string; price: string; active: boolean }>`
      select id::text, source_id::text as source, sku, price_usd_per_unit::text as price, is_active as active
        from products where business_id = ${copy}::uuid`.execute(admin)).rows;
    expect(after.map((p) => p.id).sort()).toEqual(before.map((p) => p.id).sort());   // the same rows
    const amber = after.find((p) => p.source === P1)!;
    expect(amber).toMatchObject({ sku: 'C-200', active: true });
    expect(Number(amber.price)).toBe(11);
    expect(after.find((p) => p.source === P2)!.sku).toBe('C-100');
    expect(after.find((p) => p.source === P3)!.active).toBe(false);                   // taken away: no longer offered, not deleted
    expect(Number((await sql<{ p: string }>`select unit_price_usd::text as p from price_tiers where product_id = ${amber.id}::uuid and min_qty = 50`.execute(admin)).rows[0]!.p)).toBe(9);
    expect(await count('quotes', 'business_id', copy)).toBe(1);                       // practice's own quote survives
  });

  it('the owner\'s Stop binds Practice; Practice\'s own Stop binds on top of a live assistant', async () => {
    await sql`update businesses set assistant_stopped_at = now(), assistant_stopped_by = 'owner' where id = ${LIVE}`.execute(admin);
    await refresh();
    expect((await sql<{ by: string | null }>`select assistant_stopped_by as by from businesses where id = ${copy}::uuid`.execute(admin)).rows[0]!.by).toBe('owner');
    await sql`update businesses set assistant_stopped_at = null, assistant_stopped_by = null where id = ${LIVE}`.execute(admin);
    await sql`update businesses set practice_stopped_at = now() where id = ${copy}`.execute(admin);
    await refresh();
    expect((await sql<{ by: string | null }>`select assistant_stopped_by as by from businesses where id = ${copy}::uuid`.execute(admin)).rows[0]!.by).toBe('practice');
    await sql`update businesses set practice_stopped_at = null where id = ${copy}`.execute(admin);
    await refresh();
    expect((await sql<{ at: Date | null }>`select assistant_stopped_at as at from businesses where id = ${copy}::uuid`.execute(admin)).rows[0]!.at).toBeNull();
  });

  it('only for the workspace you are in — never another\'s, and a copy has no copy of its own', async () => {
    await expect(refresh(OTHER, LIVE)).rejects.toThrow(/only for the workspace you are in/);
    await expect(refresh(copy, copy)).rejects.toThrow(/no practice of its own/);
  });

  it('a copy can reach nobody: a channel, credential, person or login on it is refused by the database', async () => {
    for (const [t, row] of [
      ['channel_credentials', sql`(business_id, channel, external_ref, secret_ref) values (${copy}, 'instagram', ${`pr-${RUN}`}, 'x')`],
      ['people', sql`(business_id, name) values (${copy}, 'Someone')`],
      ['channels', sql`(business_id, kind, status) values (${copy}, 'whatsapp', 'connected')`],
    ] as const) {
      await expect(sql`insert into ${sql.table(t)} ${row}`.execute(admin), t).rejects.toThrow(/practice workspace has no channel/);
    }
  });

  it('copies are not workspaces: the Meta-errors check never counts a copy\'s sends', async () => {
    const conv = (await sql<{ id: string }>`
      with c as (insert into clients (business_id, display_name) values (${copy}, 'Practice customer') returning id)
      insert into conversations (business_id, client_id, channel) select ${copy}, id, 'instagram' from c returning id::text`.execute(admin)).rows[0]!.id;
    await sql`insert into outbound_messages (business_id, conversation_id, seq, body, origin, status, channel, sent_at)
              values (${copy}, ${conv}::uuid, 1, 'practice reply', 'employee', 'sent', 'instagram', now())`.execute(admin);
    const rows = (await sql<{ id: string }>`select business_id::text as id from meta_error_rates(now() - interval '1 hour')`.execute(admin)).rows;
    expect(rows.map((r) => r.id)).not.toContain(copy);
  });
});
