import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/**
 * A1 — tools/money-sums.mjs, run for real: the before-and-after check of the deploy that carries A1
 * (docs/A1-EXACT-MONEY.md). What is proved: every numeric column is read, each workspace's sum is the exact text
 * Postgres holds (no float on the way), the compare mode passes only identical files and names what moved, and a
 * role that row security filters is refused rather than given a quietly smaller sum.
 *
 * The file owns every row it asserts: its own workspace, two products, two price tiers, two pricing policies, two
 * owner rates, one customer and conversation, two quotes and two orders (one cancelled — one open order per
 * conversation). Each pair holds 0.1 and 0.2, which a float adds to 0.30000000000000004, so each workspace line is
 * asserted whole: table, column, workspace, the exact sum at the column's scale, the row count. No line depends on
 * what another file left behind (owner_rates did, and failed on a shard that had none).
 *
 * `price_tiers` has no `business_id`, so the tool prints ONE line for the whole table (workspace "-"): no line can be
 * this workspace's alone. It is asserted exactly against the table as read just before and just after the run.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RUN = randomUUID().slice(0, 8);
const BIZ = `a1510000-0000-4000-8000-${RUN}0001`;
const PID = `a1510000-0000-4000-8000-${RUN}0002`;
const PID2 = `a1510000-0000-4000-8000-${RUN}0003`;

const tool = (args: string[], url = MIGRATE_URL) => {
  const r = spawnSync(process.execPath, ['tools/money-sums.mjs', ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: 120_000, env: { ...process.env, MIGRATE_DATABASE_URL: url ?? '' },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

d('A1 · money-sums reads every stored amount exactly (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let admin: pg.Client;
  let dir: string;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    await admin.query(`insert into businesses (id, name, engine) values ($1, 'Money Sums Test', 'service')`, [BIZ]);
    // Every pair below holds 0.1 and 0.2: added as floats they are 0.30000000000000004, never 0.3.
    await admin.query(`insert into products (id, business_id, sku, name, unit, is_active, price_usd_per_unit, currency)
                       values ($1, $3, $4, 'Tote', 'pcs', true, 0.1, 'USD'), ($2, $3, $5, 'Bag', 'pcs', true, 0.2, 'USD')`,
      [PID, PID2, BIZ, `MS-${RUN}-1`, `MS-${RUN}-2`]);
    await admin.query(`insert into price_tiers (product_id, min_qty, unit_price_usd, currency) values ($1, 1, 0.1, 'USD'), ($1, 10, 0.2, 'USD')`, [PID]);
    await admin.query(`insert into pricing_policy (business_id, product_id, floor_price_usd, currency)
                       values ($1, $2, 0.1, 'USD'), ($1, $3, 0.2, 'USD')`, [BIZ, PID, PID2]);
    await admin.query(`insert into owner_rates (business_id, from_currency, to_currency, rate)
                       values ($1, 'CNY', 'USD', 0.1), ($1, 'AED', 'USD', 0.2)`, [BIZ]);
    const client = (await admin.query(`insert into clients (business_id, display_name) values ($1, 'Money Sums Customer') returning id`, [BIZ])).rows[0].id;
    const conv = (await admin.query(`insert into conversations (business_id, client_id, channel) values ($1, $2, 'whatsapp') returning id`, [BIZ, client])).rows[0].id;
    await admin.query(`insert into quotes (business_id, conversation_id, product_id, quantity, inputs, unit_price_usd, total_usd, engine_version, currency)
                       values ($1, $2, $3, 1, '{}', 0.1, 0.10, 'money-sums-test', 'USD'), ($1, $2, $4, 1, '{}', 0.2, 0.20, 'money-sums-test', 'USD')`,
      [BIZ, conv, PID, PID2]);
    await admin.query(`insert into orders (order_reference, business_id, client_id, conversation_id, product_id, quantity, unit, agreed_unit_price_usd, total_value_usd, status, currency)
                       values ($1, $3, $4, $5, $6, 1, 'pcs', 0.1, 0.10, 'confirmed', 'USD'), ($2, $3, $4, $5, $7, 1, 'pcs', 0.2, 0.20, 'cancelled', 'USD')`,
      [`MS-${RUN}-1`, `MS-${RUN}-2`, BIZ, client, conv, PID, PID2]);
    dir = mkdtempSync(join(tmpdir(), 'money-sums-'));
  });
  afterAll(async () => {
    try {
      // Children first: quotes and orders do not cascade from their workspace. A failed delete fails the file.
      for (const q of ['delete from orders where business_id = $1', 'delete from quotes where business_id = $1',
        'delete from conversations where business_id = $1', 'delete from clients where business_id = $1',
        'delete from pricing_policy where business_id = $1', 'delete from owner_rates where business_id = $1',
        'delete from products where business_id = $1', 'delete from businesses where id = $1']) await admin.query(q, [BIZ]);
    } finally {
      await admin.end();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('every numeric column, and each workspace\'s sum as the exact text Postgres holds', async () => {
    // price_tiers is one line for the whole table, holding whatever other files left there: read the table just before
    // and just after the tool, and take the run only when nothing moved in between (exact even if files ever ran side
    // by side; the runner runs them one at a time).
    const tiersNow = async (): Promise<string> => {
      const t = (await admin.query(`select coalesce(sum(unit_price_usd), 0)::text as s, count(unit_price_usd)::text as n from price_tiers`)).rows[0];
      return `price_tiers\tunit_price_usd\t-\t${t.s}\t${t.n}`;
    };
    let lines: string[] = [];
    let tiers: string | null = null;
    let err = '';
    for (let attempt = 0; attempt < 5 && tiers === null; attempt += 1) {
      const before = await tiersNow();
      const r = tool([]);
      expect(r.code, r.err).toBe(0);
      const after = await tiersNow();
      lines = r.out.split('\n');
      err = r.err;
      if (before === after && lines.includes(before)) tiers = before;
    }
    expect(tiers, 'price_tiers did not hold still across five runs').not.toBeNull();
    expect(lines[0]).toBe('# table\tcolumn\tworkspace\tsum\trows');
    // This workspace's own rows, each line whole: exact, never 0.30000000000000004.
    for (const line of [
      `products\tprice_usd_per_unit\t${BIZ}\t0.3000\t2`,
      `quotes\tunit_price_usd\t${BIZ}\t0.3000\t2`,
      `quotes\ttotal_usd\t${BIZ}\t0.30\t2`,
      `orders\ttotal_value_usd\t${BIZ}\t0.30\t2`,
      `orders\tagreed_unit_price_usd\t${BIZ}\t0.3000\t2`,
      `pricing_policy\tfloor_price_usd\t${BIZ}\t0.3000\t2`,
      `owner_rates\trate\t${BIZ}\t0.300000\t2`,
    ]) expect(lines, line).toContain(line);
    // The whole table's line, which holds this workspace's two tiers among whatever else is there.
    expect(Number(tiers!.split('\t')[4])).toBeGreaterThanOrEqual(2);
    expect(err).toMatch(/money-sums: \d+ numeric columns read/);
  });

  it('compare: identical files pass; one moved sum fails and is named', () => {
    const a = join(dir, 'a.tsv'), b = join(dir, 'b.tsv'), c = join(dir, 'c.tsv');
    const head = '# table\tcolumn\tworkspace\tsum\trows\n';
    writeFileSync(a, `${head}quotes\ttotal_usd\t${BIZ}\t25150.00\t1\norders\ttotal_value_usd\t${BIZ}\t25150.00\t1\n`);
    writeFileSync(b, `${head}orders\ttotal_value_usd\t${BIZ}\t25150.00\t1\nquotes\ttotal_usd\t${BIZ}\t25150.00\t1\n`);
    writeFileSync(c, `${head}quotes\ttotal_usd\t${BIZ}\t25200.00\t1\norders\ttotal_value_usd\t${BIZ}\t25150.00\t1\n`);
    const same = tool(['--compare', a, b]);
    expect(same.code).toBe(0);
    expect(same.err).toContain('identical — 2 sums');
    const moved = tool(['--compare', a, c]);
    expect(moved.code).toBe(1);
    expect(moved.out).toContain(`quotes\ttotal_usd\t${BIZ}\tbefore 25150.00\t1\tafter 25200.00\t1`);
    expect(moved.err).toContain('1 of 2 sums DIFFER');
  });

  it('a role that row security filters is refused, and nothing is printed as a sum', () => {
    const r = tool([], DATABASE_URL);
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/filtered by row security/);
    expect(r.out.split('\n').filter((l) => l && !l.startsWith('#'))).toEqual([]);
  });

  it('no URL, no run — and the URL is never an argument', () => {
    const r = tool([], '');
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/MIGRATE_DATABASE_URL is not set/);
  });
});
