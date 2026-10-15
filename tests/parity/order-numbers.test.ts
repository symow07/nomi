import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { formatOrderReference, numberingYear } from '../../src/db/orderNumbers.js';

/**
 * 0162 — each workspace numbers its own orders (the owner, 2026-10-15:
 * "Per-workspace numbering, no shared counter, no YW."). The database half —
 * two workspaces, a rollback, two at once, row security — is
 * tests/integration/order-numbers.test.ts.
 */

const ROOT = new URL('../../', import.meta.url).pathname;
const read = (p: string) => readFileSync(ROOT + p, 'utf8');
const code = (p: string) => read(p).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|--)/.test(l)).join('\n');

describe('0162 · an order reference is the workspace\'s own count', () => {
  it('the year, then that year\'s count: four digits at least, more when the year needs them', () => {
    expect(formatOrderReference(2026, 1)).toBe('2026-0001');
    expect(formatOrderReference(2026, 42)).toBe('2026-0042');
    expect(formatOrderReference(2027, 12345)).toBe('2027-12345');
  });

  it('the year is the workspace\'s calendar; a zone this build cannot read counts in UTC', () => {
    const eve = new Date('2026-12-31T20:00:00Z');
    expect(numberingYear(eve, 'UTC')).toBe(2026);
    expect(numberingYear(eve, 'Asia/Shanghai')).toBe(2027);
    expect(numberingYear(new Date('2027-01-01T03:00:00Z'), 'America/New_York')).toBe(2026);
    expect(numberingYear(eve, 'Not/AZone')).toBe(2026);
  });

  it('the order writer takes the workspace\'s count, never the shared counter, and no "YW" is left in the app', () => {
    const repos = code('src/db/repos.ts');
    expect(repos).toMatch(/const orderReference = await nextOrderReference\(tx, businessId\);/);
    expect(repos).not.toMatch(/generate_order_reference|order_seq/);
    let found = '';
    try {
      found = execFileSync('git', ['grep', '-l', 'YW-', '--', 'src', 'tools', 'prompts'], { cwd: ROOT, encoding: 'utf8' });
    } catch (e) {
      if ((e as { status?: number }).status !== 1) throw e;   // 1 = nothing found
    }
    const hits = found.split('\n').filter(Boolean);
    expect(hits).toEqual([]);
  });

  it('the migration: a count per workspace and year under row security, the reference unique per workspace, the old counter closed', () => {
    const m = code('migrations/0162_order_numbers.sql');
    expect(m).toMatch(/create table if not exists order_numbers/);
    expect(m).toMatch(/primary key \(business_id, year\)/);
    expect(m).toMatch(/alter table order_numbers enable row level security/);
    expect(m).toMatch(/using \(business_id = current_business_id\(\)\)\s+with check \(business_id = current_business_id\(\)\)/);
    expect(m).toMatch(/revoke delete, truncate on order_numbers from nomi_app/);
    expect(m).toMatch(/alter table orders drop constraint if exists orders_order_reference_key/);
    expect(m).toMatch(/create unique index if not exists orders_business_reference\s+on orders \(business_id, order_reference\)/);
    expect(m).toMatch(/revoke execute on function generate_order_reference\(\) from public/);
    expect(m).toMatch(/\('order_numbers', 'unrelated'/);
    expect(m).toMatch(/values \(162, 'order_numbers'\)/);
  });
});
