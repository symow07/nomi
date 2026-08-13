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
 * Enforced at BOOT (see `assertSchemaCurrent`, wired into buildProduction), and
 * again at activation. The boot gate is the one that matters: a release audit
 * found that a stale database booted clean and reported `{"ok":true,"db":true}`,
 * because the only caller was `activationPreconditions` — a function with no
 * production call site. A guard nothing calls is not a guard.
 *
 * It is deliberately NOT on /health — a public probe should not advertise the
 * schema version, for the same reason it does not advertise the commit (M17.1).
 */

/**
 * The migration this build requires. BUMP THIS when adding a migration whose
 * columns or tables the code reads — that is what makes the guard meaningful.
 * 26 = the runtime role is `nomi_app` (0026). This build accepts that name
 *      ALONE, so a database whose role is still `yiwuflow_app` cannot serve it
 *      — the guard would refuse at boot anyway, and refusing on the schema
 *      version says why. The release before this one accepted both.
 *
 * 25 = the product_edited / price_rules_set audit verbs (0025). No new column
 *      is READ, so the usual "does the code read something new?" test says no —
 *      but `channel_audit.action` is CHECK-constrained, and this build WRITES
 *      both verbs. Against a database at 24 the constraint rejects them, and
 *      the failure lands the moment an owner saves a price. A build that cannot
 *      record an owner's edit has no business accepting one, so it refuses at
 *      boot instead. The rule is "bump when the build REQUIRES the migration",
 *      of which reading a new column is only the commonest case.
 *
 * 27 = the audio_unheard signal kind and transcript_corrected audit verb
 *      (0027, M34). Same reasoning as 25: both columns are CHECK-constrained
 *      and this build WRITES both values — the first voice note that cannot be
 *      heard records the signal, the first transcript correction records the
 *      verb. Against a 26 database either write is rejected exactly when a
 *      buyer or an owner is waiting on it.
 *
 * 30 = money carries its currency (0030, M43a). This build READS `currency`
 *      from price_tiers, pricing_policy, quotes, orders and products on every
 *      quote it computes, and WRITES it on every price rule, import and
 *      recorded quote. Against a 29 database the read is a missing column, so
 *      the tier query throws — which is the entire pricing path. It refuses at
 *      boot rather than at the first buyer.
 *
 * 31 = the rate she stated (0031, M43b). The build READS `owner_rates` on the
 *      conversation surface and WRITES it from her settings page. Against a 30
 *      database the read is a missing TABLE, so every conversation detail
 *      throws — and the write, which is the only way a rate can exist at all,
 *      has nowhere to go.
 *
 * 32 = the factory closure calendar (0032, M44). Every quote READS
 *      `factory_closures` to decide whether it may promise a delivery date.
 *      Against a 31 database that read is a missing table, so the quote path
 *      throws — and the alternative, treating the failure as "no closures",
 *      would quote a date through her shutdown, which is the exact lie this
 *      milestone exists to stop.
 *
 * 33 = samples (0033, M45). The turn READS `sample_policy` to decide whether a
 *      sample price may enter the numeral allow-set, and WRITES
 *      `sample_requests` the moment a buyer asks. Against a 32 database the
 *      write is a missing table on the exact turn a buyer is waiting, and the
 *      read failing would look like "she has stated no policy" — a refusal
 *      caused by a stale schema rather than by her.
 *
 * 34 = after the order (0034, M46). The turn READS `order_updates` to answer
 *      "where is my order?" from a row rather than from a model, and the owner
 *      surface WRITES it. Against a 33 database the read throws on the exact
 *      turn a buyer is asking, and the write — the only way a state can change
 *      at all — has nowhere to go.
 *
 * 35 = more than one human (0035, M47). Login READS `people` to resolve a
 *      staff code, and the Buyers list reads it to name who holds what.
 *      Against a 34 database no staff member can log in at all — and the
 *      OWNER still can, deliberately: her code is the environment's and her
 *      row is only her name.
 */
export const REQUIRED_SCHEMA_VERSION = 35;

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

/**
 * Boot gate. In production a database behind this build REFUSES to serve: the
 * alternative is a green deployment whose send path throws on the first real
 * buyer. Outside production it warns, so a developer mid-migration is not
 * locked out of their own machine.
 *
 * A schema AHEAD of the build is fine — migrations are additive and forward-only
 * (ADR-0007), so an older build runs correctly against a newer schema. That is
 * what makes a rollback safe, and this gate must not take that away.
 */
export async function assertSchemaCurrent(
  db: Db,
  opts: { readonly production: boolean; readonly warn?: (msg: string) => void },
): Promise<SchemaState> {
  return enforceSchemaState(await readSchemaState(db), opts);
}

/** The decision, separated from the read so it can be tested for every state. */
export function enforceSchemaState(
  state: SchemaState,
  opts: { readonly production: boolean; readonly warn?: (msg: string) => void },
): SchemaState {
  if (state.ok) return state;

  const detail = state.actual === null
    ? 'the applied-migration table could not be read'
    : `the database is at migration ${state.actual}, this build needs ${state.required}`;
  const message =
    `Database schema is not current: ${detail}.\n` +
    'Apply the pending migrations before starting this build:\n' +
    '  MIGRATE_DATABASE_URL=<admin url> node tools/migrate.mjs';

  if (opts.production) throw new Error(message);
  (opts.warn ?? ((m: string) => console.warn(m)))(
    `WARNING (not enforced outside production):\n${message}`,
  );
  return state;
}
