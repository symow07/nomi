import { sql } from 'kysely';
import type { Db } from './client.js';

/**
 * M23 — is the tenant this build serves a real, intentional factory?
 *
 * THE INVARIANT: the pilot tenant must never be missing, and must never be the
 * practice sandbox.
 *
 * The failure this prevents was found on live production. `PILOT_BUSINESS_ID`
 * decides which business every owner surface reads, and it defaults to the DEMO
 * id — a row that does not exist outside a seeded development database. The one
 * business in production was `Practice sandbox`. So whatever the variable held,
 * the owner was going to land somewhere wrong:
 *
 *   missing   the row is absent. Every read is empty and the first product
 *             INSERT dies on products_business_id_fkey. Loud, at least.
 *   sandbox   everything WORKS. She teaches her real catalogue into the space
 *             whose reset button archives conversations, alongside a seeded bag
 *             she never sold. Nothing warns her. This is the dangerous one.
 *
 * Neither is detectable from `/health`, both survive a green deployment, and
 * the second is silent for as long as the pilot lasts. So the process refuses
 * to serve — the same contract as `assertSafeRuntimeRole` (tenant isolation not
 * in force) and `assertSchemaCurrent` (schema behind the build). Three
 * questions a deployment must answer about itself before it takes an owner's
 * data: am I isolated, am I current, and whose factory am I?
 *
 * Deliberately NOT on /health — a public probe must not advertise a tenant id,
 * for the same reason it does not advertise the commit (M17.1).
 */

export type PilotTenantState = {
  /** The configured id, verbatim. Empty string when unset. */
  readonly configured: string;
  /** The sandbox id this installation resolves, for comparison. */
  readonly sandboxId: string;
  /** A `businesses` row with that id is readable. */
  readonly exists: boolean;
  /** The configured id IS the practice sandbox. */
  readonly isSandbox: boolean;
  /** Its name, when it exists — for the operator's confirmation line. */
  readonly name: string | null;
  readonly ok: boolean;
};

export type PilotTenantProblem = 'unset' | 'missing' | 'is_sandbox';

/** Which problem, or null. Ordered: unset before missing before sandbox. */
export function pilotTenantProblem(s: PilotTenantState): PilotTenantProblem | null {
  if (s.configured.trim() === '') return 'unset';
  if (s.isSandbox) return 'is_sandbox';
  if (!s.exists) return 'missing';
  return null;
}

/**
 * Read the configured tenant. Never throws: an unreadable `businesses` table is
 * reported as "does not exist" and treated as NOT ok, because a build that
 * cannot confirm whose data it is about to serve has no business serving it.
 */
export async function readPilotTenant(
  db: Db, opts: { readonly pilotBusinessId: string | undefined; readonly sandboxBusinessId: string },
): Promise<PilotTenantState> {
  const configured = (opts.pilotBusinessId ?? '').trim();
  const isSandbox = configured !== '' && configured === opts.sandboxBusinessId;

  let name: string | null = null;
  let exists = false;
  if (configured !== '') {
    try {
      // INSIDE a tenant transaction, scoped to the id being checked.
      //
      // The first version of this read ran on the bare connection and refused
      // EVERY tenant in production: `businesses` carries the policy
      // `id = current_business_id()`, so with no tenant context set the
      // comparison is against NULL and the row is invisible to the app role.
      // Setting the context to the id under test is also the honest question —
      // "will the owner's surfaces be able to read this?" — because it is
      // exactly how every one of them reads.
      const r = await db.transaction().execute(async (tx) => {
        await sql`select set_config('app.business_id', ${configured}, true)`.execute(tx);
        return sql<{ name: string }>`
          select name from businesses where id = ${configured}::uuid limit 1
        `.execute(tx);
      });
      const row = r.rows[0];
      if (row) { exists = true; name = row.name; }
    } catch {
      exists = false;              // malformed uuid, or the table is unreadable
    }
  }

  const state: Omit<PilotTenantState, 'ok'> = {
    configured, sandboxId: opts.sandboxBusinessId, exists, isSandbox, name,
  };
  return { ...state, ok: pilotTenantProblem({ ...state, ok: false }) === null };
}

/**
 * Boot gate. In production a wrong tenant REFUSES to serve; outside production
 * it warns, so a developer without a provisioned factory is not locked out of
 * their own machine — the same asymmetry the other two guards use.
 *
 * ROLLOUT ORDER MATTERS. Deploying this against an installation whose
 * PILOT_BUSINESS_ID is not yet correct will refuse to boot, by design. Provision
 * the factory and set the variable FIRST; see docs/FACTORY-PROVISIONING.md.
 */
export async function assertPilotTenant(
  db: Db,
  opts: {
    readonly pilotBusinessId: string | undefined;
    readonly sandboxBusinessId: string;
    readonly production: boolean;
    readonly warn?: (msg: string) => void;
  },
): Promise<PilotTenantState> {
  const state = await readPilotTenant(db, opts);
  return enforcePilotTenant(state, opts);
}

/** The decision, separated from the read so every state can be tested. */
export function enforcePilotTenant(
  state: PilotTenantState,
  opts: { readonly production: boolean; readonly warn?: (msg: string) => void },
): PilotTenantState {
  const problem = pilotTenantProblem(state);
  if (problem === null) return state;

  if (opts.production) throw new Error(describePilotTenantProblem(state, problem));
  (opts.warn ?? ((m: string) => console.warn(m)))(
    `WARNING (not enforced outside production):\n${describePilotTenantProblem(state, problem)}`,
  );
  return state;
}

/**
 * What the operator must actually do. Never a bare "misconfigured" — every
 * branch names the command that fixes it, because this message is read by
 * someone whose deployment has just refused to start.
 */
export function describePilotTenantProblem(state: PilotTenantState, problem: PilotTenantProblem): string {
  const provision =
    'Provision one, then set PILOT_BUSINESS_ID to the id it prints:\n' +
    '  MIGRATE_DATABASE_URL=<admin url> node tools/provision-factory.mjs "<Factory name>"';

  switch (problem) {
    case 'unset':
      return 'PILOT_BUSINESS_ID is not set, so there is no factory to serve.\n' + provision;
    case 'is_sandbox':
      return (
        `PILOT_BUSINESS_ID points at the PRACTICE SANDBOX (${state.sandboxId}).\n` +
        'The sandbox is where the owner rehearses: resetting it archives conversations, ' +
        'and it is seeded with a product nobody sold. A real factory must never share it.\n' +
        provision
      );
    case 'missing':
      return (
        `PILOT_BUSINESS_ID is ${state.configured}, but no business with that id exists.\n` +
        'The owner would reach an empty factory and the first product would be refused ' +
        'by the foreign key.\n' + provision
      );
  }
}
