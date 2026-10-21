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
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RUN = randomUUID().slice(0, 8);
const BIZ = `a1510000-0000-4000-8000-${RUN}0001`;
const PID = `a1510000-0000-4000-8000-${RUN}0002`;

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
    // Two products whose prices, added as floats, would not come out exact: 0.1 + 0.2 is 0.30000000000000004.
    await admin.query(`insert into products (id, business_id, sku, name, unit, is_active, price_usd_per_unit, currency)
                       values ($1, $2, $3, 'Tote', 'pcs', true, 0.1, 'USD')`, [PID, BIZ, `MS-${RUN}-1`]);
    await admin.query(`insert into products (business_id, sku, name, unit, is_active, price_usd_per_unit, currency)
                       values ($1, $2, 'Bag', 'pcs', true, 0.2, 'USD')`, [BIZ, `MS-${RUN}-2`]);
    dir = mkdtempSync(join(tmpdir(), 'money-sums-'));
  });
  afterAll(async () => {
    await admin.query('delete from products where business_id = $1', [BIZ]).catch(() => {});
    await admin.query('delete from businesses where id = $1', [BIZ]).catch(() => {});
    await admin.end();
    rmSync(dir, { recursive: true, force: true });
  });

  it('every numeric column, and each workspace\'s sum as the exact text Postgres holds', () => {
    const r = tool([]);
    expect(r.code, r.err).toBe(0);
    const lines = r.out.split('\n');
    expect(lines[0]).toBe('# table\tcolumn\tworkspace\tsum\trows');
    expect(lines).toContain(`products\tprice_usd_per_unit\t${BIZ}\t0.3000\t2`);   // exact: never 0.30000000000000004
    for (const col of ['quotes\tunit_price_usd', 'quotes\ttotal_usd', 'orders\ttotal_value_usd', 'price_tiers\tunit_price_usd',
      'pricing_policy\tfloor_price_usd', 'owner_rates\trate']) {
      expect(lines.some((l) => l.startsWith(`${col}\t`)), col).toBe(true);
    }
    expect(r.err).toMatch(/money-sums: \d+ numeric columns read/);
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
