import pg from 'pg';
import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import type { Database } from './schema.js';
import type { BusinessId } from '../core/types/ids.js';

/**
 * Connection + tenant binding. (ADR-0005)
 *
 * Two rules enforced here:
 *  1. The pool connects as `yiwuflow_app` — a role WITHOUT BYPASSRLS. RLS the
 *     application can bypass is decoration.
 *  2. Every unit of work runs inside a transaction that has SET LOCAL
 *     app.business_id. `set_config(..., true)` is transaction-scoped, which is
 *     what makes this safe under PgBouncer transaction pooling at 1,000 tenants.
 */

export type Db = Kysely<Database>;
export type Tx = Transaction<Database>;

export function createDb(connectionString: string): Db {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString, max: 10 }),
    }),
  });
}

/**
 * The ONLY entry point for tenant-scoped work. Application code never touches
 * the raw pool: a query that forgets its WHERE clause returns zero rows, not
 * another customer's order book — the database refuses, not the developer.
 */
export async function withTenantTx<T>(
  db: Db,
  businessId: BusinessId,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (tx) => {
    await sql`select set_config('app.business_id', ${businessId}, true)`.execute(tx);
    return fn(tx);
  });
}

/**
 * Per-conversation serialisation (ADR-0004): two messages from one client must
 * never race on state. The advisory lock is transaction-scoped and released on
 * commit/rollback automatically.
 */
export async function lockConversation(tx: Tx, conversationId: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${conversationId}, 0))`.execute(tx);
}
