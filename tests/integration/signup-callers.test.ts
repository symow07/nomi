import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

/**
 * D2 (the data-protection audit, 2026-10-12; 0138) — A SIGN-UP'S CALLER IS
 * FORGOTTEN EVERY DAY.
 *
 * The sign-up guard keeps each caller's internet address as its SHA-256, per
 * hour, in `signup_throttles`. Old rows used to go only when someone else
 * signed up. `signup_throttles_forget` (the daily ops.signup_expiry job) takes
 * every row more than two days past its hour, whoever comes or not.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const hash = () => randomBytes(32).toString('hex');

d('D2 · the sign-up guard forgets its callers (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let admin: pg.Client;
  let app: pg.Client;
  const OLD = hash();
  const EDGE = hash();
  const FRESH = hash();

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    app = new pg.Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await app.connect();
    await admin.query(
      `insert into signup_throttles (kind, key_hash, hour, n) values
         ('caller', $1, date_trunc('hour', now()) - interval '3 days', 2),
         ('caller', $2, date_trunc('hour', now()) - interval '2 days' - interval '1 hour', 1),
         ('caller', $3, date_trunc('hour', now()) - interval '1 day', 1)`, [OLD, EDGE, FRESH]);
  });
  afterAll(async () => {
    await admin.query(`delete from signup_throttles where key_hash = any($1)`, [[OLD, EDGE, FRESH]]);
    await app.end();
    await admin.end();
  });

  const left = async () => (await admin.query<{ key_hash: string }>(
    `select key_hash from signup_throttles where key_hash = any($1)`, [[OLD, EDGE, FRESH]])).rows.map((r) => r.key_hash).sort();

  it('the app cannot read the table, only call the function', async () => {
    await expect(app.query(`select count(*) from signup_throttles`)).rejects.toThrow(/permission denied/);
  });

  it('the app role forgets every caller more than two days past its hour, and keeps the rest', async () => {
    expect(await left()).toEqual([OLD, EDGE, FRESH].sort());
    const n = Number((await app.query<{ n: string }>(`select signup_throttles_forget()::text as n`)).rows[0]!.n);
    expect(n).toBeGreaterThanOrEqual(2);
    expect(await left()).toEqual([FRESH]);
  });

  it('the daily sign-up job calls it', () => {
    const main = readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)), 'utf8');
    const job = main.slice(main.indexOf('boss.work(QUEUES.signupExpiry'));
    expect(job.slice(0, job.indexOf('});'))).toMatch(/select signup_throttles_forget\(\)/);
  });
});
