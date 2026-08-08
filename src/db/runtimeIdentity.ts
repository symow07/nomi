import { sql } from 'kysely';
import type { Db } from './client.js';

/**
 * M19 (B0) — is the runtime connection actually subject to tenant isolation?
 *
 * Every RLS policy in this schema targets `nomi_app`. PostgreSQL lets
 * superusers and BYPASSRLS roles ignore row security entirely, so an app that
 * connects as `postgres` has NO tenant isolation — while every test still
 * passes (they connect as the app role) and `/health` still reports green.
 * That is exactly what was found in production: the app role was NOLOGIN, so
 * the running app could not have been using it.
 *
 * This check closes that gap at boot, where it is cheap and unambiguous. It is
 * NOT exposed on /health — a public probe must not advertise the database role,
 * for the same reason it does not advertise the commit (M17.1).
 *
 * Deliberately NOT solved with FORCE ROW LEVEL SECURITY: FORCE binds the table
 * OWNER, not a superuser, so it would not have caught this at all — while
 * breaking seeds, fresh-database bootstrap, and pg_dump.
 */

/**
 * The role the RLS policies are written for.
 *
 * `nomi_app` is the name. `yiwuflow_app` is what it was called before the
 * product took one name (B1), and it is accepted for EXACTLY ONE RELEASE.
 *
 * WHY A TRANSITION SET AT ALL. This guard compares `current_user` at boot and
 * refuses to serve on a mismatch, so the role, the connection string and this
 * constant must move together. Migration 0026 renames the role, and a build
 * pinned to a single name cannot survive the moment in between — which would
 * make 0026 the first migration in this repo that an older build cannot run
 * against, spending the rollback property ADR-0007 exists to provide.
 * Accepting both names for one release costs a deploy cycle and keeps it.
 *
 * This is not a weakened guard. The security property is `rolsuper=false` and
 * `rolbypassrls=false`, and both still hold for either name; all that widens is
 * which non-superuser role is expected.
 *
 * REMOVAL: the release immediately after 0026 is applied narrows this back to
 * `nomi_app` alone and bumps REQUIRED_SCHEMA_VERSION to 26. A test asserts the
 * set has at most two entries so it cannot quietly become a permanent list.
 */
export const RUNTIME_ROLE = 'nomi_app';

/** Accepted during the rename only. See RUNTIME_ROLE. */
export const RUNTIME_ROLE_LEGACY = 'yiwuflow_app';

/** Every name this build will serve under. */
export const ACCEPTED_RUNTIME_ROLES: readonly string[] = [RUNTIME_ROLE, RUNTIME_ROLE_LEGACY];

export type RuntimeIdentity = {
  readonly currentUser: string;
  readonly isSuperuser: boolean;
  readonly bypassesRls: boolean;
};

export type RoleVerdict = {
  readonly safe: boolean;
  /** Neutral problem codes, most severe first. Empty when safe. */
  readonly problems: readonly ('superuser' | 'bypasses_rls' | 'wrong_role')[];
  readonly identity: RuntimeIdentity;
};

/**
 * Pure decision. `expectRole` is enforced only where a specific runtime role is
 * required (production); a local developer may legitimately run as another
 * non-superuser role. Superuser / BYPASSRLS are ALWAYS problems, because in
 * both cases row security silently does not apply.
 */
export function checkRuntimeRole(
  identity: RuntimeIdentity, opts: { readonly expectRole: boolean },
): RoleVerdict {
  const problems: ('superuser' | 'bypasses_rls' | 'wrong_role')[] = [];
  if (identity.isSuperuser) problems.push('superuser');
  if (identity.bypassesRls) problems.push('bypasses_rls');
  if (opts.expectRole && !ACCEPTED_RUNTIME_ROLES.includes(identity.currentUser)) problems.push('wrong_role');
  return { safe: problems.length === 0, problems, identity };
}

/** Human-readable, and specific enough to act on without leaking a credential. */
export function describeUnsafeRole(v: RoleVerdict): string {
  const i = v.identity;
  return [
    'Runtime database role is unsafe for tenant isolation',
    `  role:         ${i.currentUser}`,
    `  rolsuper:     ${i.isSuperuser}`,
    `  rolbypassrls: ${i.bypassesRls}`,
    `  problems:     ${v.problems.join(', ')}`,
    `  expected:     ${ACCEPTED_RUNTIME_ROLES.join(' or ')} with rolsuper=false, rolbypassrls=false`,
    '  Every RLS policy targets ' + RUNTIME_ROLE + '; a superuser or BYPASSRLS',
    '  connection ignores row security, so tenants are NOT isolated.',
    '  Fix: point the runtime DATABASE_URL at ' + RUNTIME_ROLE +
      ' (keep the admin role for migrations, seeds and backups).',
  ].join('\n');
}

/** Read who this pool actually connects as. Throws only if the query fails. */
export async function readRuntimeIdentity(db: Db): Promise<RuntimeIdentity> {
  const r = await sql<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>`
    select current_user, rolsuper, rolbypassrls
      from pg_roles where rolname = current_user
  `.execute(db);
  const row = r.rows[0];
  if (!row) {
    // No matching pg_roles row: cannot prove the connection is safe → treat as unsafe.
    return { currentUser: 'unknown', isSuperuser: true, bypassesRls: true };
  }
  return {
    currentUser: row.current_user,
    isSuperuser: row.rolsuper === true,
    bypassesRls: row.rolbypassrls === true,
  };
}

/**
 * Boot-time gate for the RUNTIME application connection only.
 *
 * In production this THROWS — refusing to start is the correct outcome when
 * tenant isolation is not in force. Elsewhere it warns loudly and continues, so
 * local development, migrations, seed scripts and tests are unaffected (they
 * connect as the admin role on purpose).
 */
export async function assertSafeRuntimeRole(
  db: Db,
  opts: { readonly production: boolean; readonly warn?: (msg: string) => void },
): Promise<RoleVerdict> {
  const identity = await readRuntimeIdentity(db);
  const verdict = checkRuntimeRole(identity, { expectRole: opts.production });
  if (verdict.safe) return verdict;

  const message = describeUnsafeRole(verdict);
  if (opts.production) throw new Error(message);
  (opts.warn ?? ((m: string) => console.warn(m)))(
    `WARNING (not enforced outside production):\n${message}`,
  );
  return verdict;
}
