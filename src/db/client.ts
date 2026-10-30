import pg from 'pg';
import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import type { Database } from './schema.js';
import type { BusinessId } from '../core/types/ids.js';
import { viewerId } from './viewer.js';

/**
 * Connection + tenant binding. (ADR-0005)
 *
 * Two rules enforced here:
 *  1. The pool connects as `nomi_app` — a role WITHOUT BYPASSRLS. RLS the
 *     application can bypass is decoration.
 *  2. Every unit of work runs inside a transaction that has SET LOCAL
 *     app.business_id. `set_config(..., true)` is transaction-scoped, which is
 *     what makes this safe under PgBouncer transaction pooling at 1,000 tenants.
 *     B0 (0177) — and `app.viewer_id`, the signed-in person a request runs as (`asViewer`, ./viewer.ts), so the
 *     database itself keeps an accountant to the books.
 */

export type Db = Kysely<Database>;
export type Tx = Transaction<Database>;

/** Pool knobs — provider-independent, env-tunable, safe defaults. */
const intEnv = (name: string, fallback: number): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

/**
 * The pg pool under each Db, for what a graceful stop reports (borrowed, idle, waiting) — `Kysely.destroy()` ends the
 * pool, and `Pool.end()` waits for every borrowed connection to come back.
 */
const POOLS = new WeakMap<Db, pg.Pool>();
export type PoolState = { readonly borrowed: number; readonly idle: number; readonly waiting: number };
export const poolState = (db: Db): PoolState | null => {
  const p = POOLS.get(db);
  return p ? { borrowed: p.totalCount - p.idleCount, idle: p.idleCount, waiting: p.waitingCount } : null;
};

export function createDb(connectionString: string): Db {
  const pool = new pg.Pool({
    connectionString,
    max: intEnv('DATABASE_POOL_MAX', 10),
    connectionTimeoutMillis: intEnv('DATABASE_CONNECT_TIMEOUT_MS', 10_000),
    // Server-side ceiling on any single statement — a hung query returns
    // an error instead of holding a pool slot forever.
    options: `-c statement_timeout=${intEnv('DATABASE_QUERY_TIMEOUT_MS', 30_000)}`,
  });
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  POOLS.set(db, pool);
  return db;
}

/**
 * THE ADVISOR BATCH (2026-10-06) — the advisor's own pool: the same role (row security as ever), every
 * transaction read-only by the server's default (`default_transaction_read_only`), and small. The advisor
 * is handed this and nothing else, so a write it could ever attempt is refused by Postgres itself, not by
 * a convention (src/advisor/reads.ts also opens each read `read only`).
 */
export function createReadOnlyDb(connectionString: string): Db {
  const pool = new pg.Pool({
    connectionString,
    max: intEnv('ADVISOR_POOL_MAX', 2),
    connectionTimeoutMillis: intEnv('DATABASE_CONNECT_TIMEOUT_MS', 10_000),
    options: `-c statement_timeout=${intEnv('DATABASE_QUERY_TIMEOUT_MS', 30_000)} -c default_transaction_read_only=on`,
  });
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  POOLS.set(db, pool);
  return db;
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
    await sql`select set_config('app.business_id', ${businessId}, true), set_config('app.viewer_id', ${viewerId()}, true)`.execute(tx);
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
