import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

/**
 * 0156 — a Chinese product name is found from the part of it a buyer says (the owner, 2026-10-14, the language
 * sweep's finding 2): «购物袋多少钱？» against the name «无纺布购物袋» scored 0.077 — a literal substring, read as
 * unrelated, because trigrams are cut at spaces and Chinese has none. The tokenizer changed, not the 0.15: the owner,
 * "lowering it would buy this query and sell a false match on every other".
 *
 * Over the real `retrieve_products`, in a catalogue of four products named in English and Chinese, as a workspace
 * that typed both has them (`aliasRowsFor`: the name, the Chinese name, the names customers use). FOUND lists what a
 * Chinese buyer says and the product it must find first; NOT_FOUND is the point — the words that must offer nothing.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `cc000000-0000-4000-8000-${RUN}0001`;

const CATALOGUE = [
  { sku: `NW-${RUN}`, name: 'Non-woven shopping bag', zh: '无纺布购物袋', more: ['shopping bag', 'non woven bag'] },
  { sku: `CV-${RUN}`, name: 'Canvas tote', zh: '帆布袋', more: [] },
  { sku: `KP-${RUN}`, name: 'Kraft paper bag', zh: '牛皮纸袋', more: [] },
  { sku: `IC-${RUN}`, name: 'Insulated cup', zh: '保温杯', more: [] },
] as const;

/** [the buyer's words, the product's English name it must find first, why] */
const FOUND: readonly (readonly [string, string, string])[] = [
  ['购物袋多少钱？', 'Non-woven shopping bag', 'the sweep\'s case: a substring of the name (0.077 before)'],
  ['我想我需要那种无纺布袋，大概5000个？', 'Non-woven shopping bag', 'the sweep\'s case: «无纺布袋» (0.038 before)'],
  ['你们有无纺布购物袋吗？', 'Non-woven shopping bag', 'the whole name inside a question'],
  ['帆布袋有黑色的吗', 'Canvas tote', 'a short name, whole'],
  ['布袋多少钱', 'Canvas tote', 'the name\'s last pair — in Chinese the thing itself comes last'],
  ['纸袋多少钱', 'Kraft paper bag', 'the last pair of «牛皮纸袋»'],
  ['牛皮纸袋起订量多少', 'Kraft paper bag', 'the whole name, then a question'],
  ['保温杯能印logo吗', 'Insulated cup', 'Chinese with a Latin word in it'],
  ['I think I need those non-woven bags, maybe 5000?', 'Non-woven shopping bag', 'English: trigrams, as before (0.302)'],
];

/** [the buyer's words, why nothing may be offered] */
const NOT_FOUND: readonly (readonly [string, string])[] = [
  ['我们是做购物的', '«购物» ("shopping") is one pair from the middle of a name: never enough alone'],
  ['我们可以确定下5000个。你们最低能给到什么价格？', 'finding 3\'s message: a price, no product named'],
  ['价格是多少？', 'a price, no product named'],
  ['你们卖手机壳吗？', 'a product this catalogue does not have'],
  ['袋子多少钱', '«袋子» is no pair of any name'],
  ['杯子多少钱', '«杯子» is not «保温杯»\'s last pair («温杯»)'],
  ['好的', 'a yes, nothing more'],
  ['Do you sell phone cases?', 'English, unrelated: as before'],
];

d('0156 · a Chinese product name is found from the part of it a buyer says (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let admin: pg.Client;
  const found = async (words: string) => (await admin.query(
    `select p.name from retrieve_products($1::uuid, $2::text, null, 5) r join products p on p.id = r.product_id
      order by r.relevance desc`, [BIZ, words])).rows.map((r) => r.name as string);

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    await admin.query(`insert into businesses (id, name) values ($1, $2) on conflict (id) do nothing`, [BIZ, `CJK ${RUN}`]);
    const { aliasRowsFor } = await import('../../src/core/onboard/aliases.js');
    for (const p of CATALOGUE) {
      const id = (await admin.query(`insert into products (business_id, sku, name, name_zh, category, unit, moq, lead_time_days)
        values ($1, $2, $3, $4, 'bags', 'pcs', 100, 10) returning id`, [BIZ, p.sku, p.name, p.zh])).rows[0].id;
      for (const a of aliasRowsFor([p.name, p.zh, ...p.more])) {
        await admin.query(`insert into product_aliases (product_id, alias, language, alias_type) values ($1, $2, $3, $4)`,
          [id, a.alias, a.language, a.aliasType]);
      }
    }
  });
  afterAll(async () => { await admin?.end(); });

  for (const [words, product, why] of FOUND) {
    it(`finds ${product} — ${why}: ${words}`, async () => {
      expect((await found(words))[0], words).toBe(product);
    });
  }
  for (const [words, why] of NOT_FOUND) {
    it(`offers nothing — ${why}: ${words}`, async () => {
      expect(await found(words), words).toEqual([]);
    });
  }

  it('a substring of a name scores well above the line — and the line is still 0.15', async () => {
    const score = async (a: string, q: string) => Number((await admin.query(`select alias_match($1, $2) as s`, [a, q])).rows[0].s);
    expect(await score('无纺布购物袋', '购物袋多少钱？')).toBeGreaterThanOrEqual(0.4);
    expect(await score('无纺布购物袋', '我们是做购物的')).toBe(0);
    const sql = readFileSync('migrations/0156_cjk_name_match.sql', 'utf8');
    expect(sql.match(/alias_match\(pa\.alias, (?:p_query|%L)\) > 0\.15/g)).toHaveLength(2);
  });
});
