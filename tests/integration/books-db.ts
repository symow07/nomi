import pg from 'pg';

/**
 * Phase 5 — the books' integration tests talk to Postgres as the APP's role (`nomi_app`, row security on), the way
 * the product writes. One tenant transaction at a time: committed, or rolled back on any error and re-thrown.
 */
export type Q = (text: string, values?: unknown[]) => Promise<pg.QueryResult>;

export async function asTenant<T>(client: pg.Client, business: string, fn: (q: Q) => Promise<T>): Promise<T> {
  await client.query('begin');
  try {
    await client.query(`select set_config('app.business_id', $1, true)`, [business]);
    const out = await fn((t, v) => client.query(t, v));
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}

/** The database's refusal, as its message; a test fails if it was accepted. */
export async function refusal(client: pg.Client, business: string, fn: (q: Q) => Promise<unknown>): Promise<string> {
  try { await asTenant(client, business, fn); } catch (e) { return e instanceof Error ? e.message : String(e); }
  throw new Error('expected the database to refuse, and it accepted');
}

/** An operator's purge of test workspaces, books and all (0169 `books_purge_allowed`). */
export async function purgeBusinesses(admin: pg.Client, ids: readonly string[], why: string): Promise<void> {
  await admin.query('begin');
  await admin.query(`select set_config('nomi.books_purge', $1, true)`, [why]);
  await admin.query('delete from businesses where id = any($1)', [ids]);
  await admin.query('commit');
}
