import { sql } from 'kysely';
import type { Db } from './client.js';

/**
 * M19.1 — does the database actually have the schema this build needs?
 *
 * The failure this prevents is specific and nasty: deploy code that expects
 * migration N while the database is still at N-1. `/health` probes with
 * `select 1`, which succeeds on the OLD schema, so the deployment looks green
 * while the send path is broken. In `disabled` mode nothing drives outbound, so
 * the breakage stays invisible until the exact moment WhatsApp is switched
 * on — the one step that cannot be undone.
 *
 * So the check is enforced where it matters most: activation refuses on a stale
 * schema, and the owner-authenticated runbook shows the state. It is
 * deliberately NOT on /health — a public probe should not advertise the
 * schema version, for the same reason it does not advertise the commit (M17.1).
 */

/**
 * The migration this build requires. BUMP THIS when adding a migration whose
 * columns or tables the code reads — that is what makes the guard meaningful.
 * 21 = pilot_allowlist + channels.pilot_mode (M18.2), read by channelStore.
 */
export const REQUIRED_SCHEMA_VERSION = 21;

export type SchemaState = {
  readonly required: number;
  readonly actual: number | null;   // null = _migrations unreadable
  readonly ok: boolean;             // actual >= required
  readonly stale: boolean;          // actual < required — the dangerous case
};

/** Read the applied migration version. Never throws; an unreadable table is
 *  reported as null and treated as NOT ok. */
export async function readSchemaState(db: Db): Promise<SchemaState> {
  let actual: number | null = null;
  try {
    const r = await sql<{ v: number | null }>`select max(version)::int as v from _migrations`.execute(db);
    actual = r.rows[0]?.v ?? null;
  } catch {
    actual = null;                  // no _migrations table, or no permission
  }
  const ok = actual !== null && actual >= REQUIRED_SCHEMA_VERSION;
  return { required: REQUIRED_SCHEMA_VERSION, actual, ok, stale: actual !== null && actual < REQUIRED_SCHEMA_VERSION };
}
