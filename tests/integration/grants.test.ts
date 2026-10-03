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

  /**
   * 0126 — THE OWNER ERASES, AND THE ROLE STILL CANNOT. A customer's data is
   * deleted when they ask, a workspace when it closes, through two definer
   * functions that take the workspace from the transaction and check who is
   * asking. Those two are all the app may call; the rest of the erasure — the
   * contract, the steps, the operator's and the replay's doors — is the
   * migration role's alone, and so is the ledger.
   */
  it('0126 · EXECUTE on exactly the two erasures the owner may run, and nothing else of the erasure', async () => {
    const may = async (fn: string) => (await sql<{ ok: boolean }>`
      select has_function_privilege('nomi_app', ${fn}, 'EXECUTE') as ok`.execute(db)).rows[0]!.ok;
    expect(await may('erase_customer(uuid, text)')).toBe(true);
    expect(await may('close_workspace(text, text)')).toBe(true);
    for (const fn of [
      'erase_customer_rows(uuid, uuid, uuid, boolean)', 'carry_out_customer_request(uuid, uuid, text, text)',
      'erase_workspace_rows(uuid, boolean, boolean)', 'carry_out_workspace_erasure(uuid, uuid, text)',
      'workspace_erasure_steps()', 'customer_erasure_problems()', 'customer_erasure_contract()', 'customer_erasure_edges()',
      'erasure_ledger_unkept()', 'erasure_owner_of(uuid, text)', 'erasure_note(jsonb, text)',
      'erasure_prune(jsonb, text[])', 'erasure_mentions(jsonb, text[])', 'erasure_identity(text, text)',
    ]) expect(await may(fn), fn).toBe(false);
    // The ledger: nothing granted at all, and nothing readable through row security either.
    const held = (await sql<{ p: string }>`
      select privilege_type as p from information_schema.role_table_grants
       where grantee = 'nomi_app' and table_name = 'erasure_ledger'`.execute(db)).rows;
    expect(held).toEqual([]);
    await expect(sql`select count(*) from erasure_ledger`.execute(db)).rejects.toThrow(/permission denied/);
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
