import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';

/**
 * G20 — ARCHIVE, NEVER ERASE, held by the database rather than by discipline.
 *
 * The rule is everywhere in this product: a product she stops selling is
 * `is_active = false`, a forbidden term she removes keeps its history, a
 * conversation that ends is closed. Every one of those is a decision a
 * developer made correctly. This is the one that cannot be got wrong — the
 * runtime role simply has no DELETE to give.
 *
 * THE EXCEPTION IS THE JOB QUEUE, and it is not ours. pg-boss owns the `pgboss`
 * schema: it deletes completed jobs as part of how a queue works, and its
 * tables hold no business fact — a deleted job is a job that ran, and what it
 * did is in the rows it wrote. Naming the exception here is the point: the next
 * DELETE grant outside that schema has to argue with this test.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

d('G20 · the app role cannot erase (requires DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
  });
  afterAll(async () => { await db?.destroy(); });

  it('holds DELETE on nothing outside the job queue', async () => {
    const rows = (await sql<{ table_schema: string; table_name: string }>`
      select table_schema, table_name
        from information_schema.role_table_grants
       where grantee = 'nomi_app' and privilege_type = 'DELETE'
       order by 1, 2
    `.execute(db)).rows;
    const outside = rows.filter((r) => r.table_schema !== 'pgboss');
    expect(outside.map((r) => `${r.table_schema}.${r.table_name}`),
      'a product table that can be erased').toEqual([]);
    // And the exception is real rather than theoretical — if pg-boss stopped
    // needing it, this rule would be simpler, not weaker.
    expect(rows.some((r) => r.table_schema === 'pgboss')).toBe(true);
  });

  it('and TRUNCATE is nobody’s either', async () => {
    const truncate = (await sql<{ table_name: string }>`
      select table_name from information_schema.role_table_grants
       where grantee = 'nomi_app' and privilege_type = 'TRUNCATE' and table_schema = 'public'
    `.execute(db)).rows;
    expect(truncate.map((r) => r.table_name)).toEqual([]);
  });

  it('the tables the owner’s own work lives in are all readable and writable, though', async () => {
    // The rule is "cannot erase", not "cannot act": a role that could not
    // UPDATE would archive nothing either.
    const grants = (await sql<{ table_name: string; privilege_type: string }>`
      select table_name, privilege_type from information_schema.role_table_grants
       where grantee = 'nomi_app' and table_schema = 'public'
         and table_name in ('products', 'quotes', 'orders', 'drafts', 'conversations', 'messages')
    `.execute(db)).rows;
    for (const table of ['products', 'quotes', 'orders', 'drafts', 'conversations', 'messages']) {
      const held = grants.filter((g) => g.table_name === table).map((g) => g.privilege_type).sort();
      expect(held, table).toContain('SELECT');
      expect(held, table).toContain('INSERT');
      expect(held, table).toContain('UPDATE');
      expect(held, table).not.toContain('DELETE');
    }
  });
});
