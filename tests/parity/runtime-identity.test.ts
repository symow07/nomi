import { describe, it, expect } from 'vitest';
import {
  checkRuntimeRole, describeUnsafeRole, RUNTIME_ROLE, type RuntimeIdentity,
} from '../../src/db/runtimeIdentity.js';

/**
 * M19 (B0) — the runtime connection must be subject to RLS.
 *
 * This is the check that would have caught the real production finding:
 * `nomi_app` was NOLOGIN, so the app could not have been connecting as the
 * role every policy targets — while all tests passed and /health stayed green.
 */

const app: RuntimeIdentity = { currentUser: RUNTIME_ROLE, isSuperuser: false, bypassesRls: false };
const superuser: RuntimeIdentity = { currentUser: 'postgres', isSuperuser: true, bypassesRls: true };

describe('M19 · runtime database identity', () => {
  it('ACCEPTS nomi_app with no superuser and no bypass', () => {
    expect(checkRuntimeRole(app, { expectRole: true })).toMatchObject({ safe: true, problems: [] });
    expect(checkRuntimeRole(app, { expectRole: false })).toMatchObject({ safe: true });
  });

  it('REFUSES the exact production shape: postgres, superuser, bypassrls', () => {
    const v = checkRuntimeRole(superuser, { expectRole: true });
    expect(v.safe).toBe(false);
    expect(v.problems).toEqual(['superuser', 'bypasses_rls', 'wrong_role']);
  });

  it('REFUSES a superuser even when the role name is right', () => {
    // a nomi_app that had been granted SUPERUSER would still bypass RLS
    const v = checkRuntimeRole({ ...app, isSuperuser: true }, { expectRole: true });
    expect(v.safe).toBe(false);
    expect(v.problems).toContain('superuser');
  });

  it('REFUSES BYPASSRLS even without superuser — row security still does not apply', () => {
    const v = checkRuntimeRole({ ...app, bypassesRls: true }, { expectRole: true });
    expect(v.safe).toBe(false);
    expect(v.problems).toEqual(['bypasses_rls']);
  });

  it('superuser/bypass are problems in EVERY environment; the role name only where required', () => {
    // local dev may legitimately use another non-superuser role…
    expect(checkRuntimeRole({ currentUser: 'dev_role', isSuperuser: false, bypassesRls: false },
      { expectRole: false }).safe).toBe(true);
    // …but never a superuser, anywhere
    expect(checkRuntimeRole({ currentUser: 'dev_role', isSuperuser: true, bypassesRls: false },
      { expectRole: false }).safe).toBe(false);
    // and in production the role name is required
    expect(checkRuntimeRole({ currentUser: 'dev_role', isSuperuser: false, bypassesRls: false },
      { expectRole: true }).problems).toEqual(['wrong_role']);
  });

  it('the message says what is wrong, what is expected, and how to fix it — without a credential', () => {
    const msg = describeUnsafeRole(checkRuntimeRole(superuser, { expectRole: true }));
    expect(msg).toContain('Runtime database role is unsafe for tenant isolation');
    expect(msg).toContain('role:         postgres');
    expect(msg).toContain('rolsuper:     true');
    expect(msg).toContain('rolbypassrls: true');
    expect(msg).toContain(RUNTIME_ROLE);
    expect(msg).toContain('tenants are NOT isolated');
    // never leaks a connection string or password
    expect(msg).not.toMatch(/postgres(ql)?:\/\//);
    expect(msg.toLowerCase()).not.toContain('password');
  });

  it('an unresolvable identity is treated as UNSAFE, never as safe-by-default', () => {
    const unknown: RuntimeIdentity = { currentUser: 'unknown', isSuperuser: true, bypassesRls: true };
    expect(checkRuntimeRole(unknown, { expectRole: true }).safe).toBe(false);
    expect(checkRuntimeRole(unknown, { expectRole: false }).safe).toBe(false);
  });
});

/**
 * Release hardening — the schema guard must be a guard, not a library.
 * The audit found `readSchemaState` had exactly one caller,
 * `activationPreconditions`, which itself has no production call site: a stale
 * database booted clean and reported {"ok":true,"db":true}.
 */
describe('Release hardening · a stale database refuses to serve', () => {
  const at = (actual: number | null, required: number) => ({
    required, actual,
    ok: actual !== null && actual >= required,
    stale: actual !== null && actual < required,
  });

  it('production: behind the build → throws, and says how to fix it', async () => {
    const { enforceSchemaState, REQUIRED_SCHEMA_VERSION: R } = await import('../../src/db/schemaVersion.js');
    expect(() => enforceSchemaState(at(R - 1, R), { production: true }))
      .toThrow(/not current/);
    expect(() => enforceSchemaState(at(R - 1, R), { production: true }))
      .toThrow(/tools\/migrate\.mjs/);
    expect(() => enforceSchemaState(at(R - 1, R), { production: true }))
      .toThrow(new RegExp(`at migration ${R - 1}.*needs ${R}`));
  });

  it('production: an unreadable _migrations table is also a refusal', async () => {
    const { enforceSchemaState, REQUIRED_SCHEMA_VERSION: R } = await import('../../src/db/schemaVersion.js');
    expect(() => enforceSchemaState(at(null, R), { production: true })).toThrow(/could not be read/);
  });

  it('production: equal or AHEAD boots — additive migrations keep rollback safe', async () => {
    const { enforceSchemaState, REQUIRED_SCHEMA_VERSION: R } = await import('../../src/db/schemaVersion.js');
    expect(enforceSchemaState(at(R, R), { production: true }).ok).toBe(true);
    expect(enforceSchemaState(at(R + 5, R), { production: true }).ok).toBe(true);
  });

  it('outside production it warns and continues — a developer mid-migration is not locked out', async () => {
    const { enforceSchemaState, REQUIRED_SCHEMA_VERSION: R } = await import('../../src/db/schemaVersion.js');
    const warnings: string[] = [];
    const state = enforceSchemaState(at(R - 1, R), { production: false, warn: (m) => warnings.push(m) });
    expect(state.stale).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('not enforced outside production');
  });

  it('the required version tracks the migrations actually on disk', async () => {
    const { REQUIRED_SCHEMA_VERSION } = await import('../../src/db/schemaVersion.js');
    const { readdir } = await import('node:fs/promises');
    const files = (await readdir(new URL('../../migrations/', import.meta.url))).filter((f) => f.endsWith('.sql'));
    const highest = Math.max(...files.map((f) => Number(f.slice(0, 4))));
    expect(REQUIRED_SCHEMA_VERSION).toBe(highest);
  });

  it('the guard is wired into the production boot path, not just exported', async () => {
    // The defect was a guard nobody called. Prove main.ts calls it.
    const { readFile } = await import('node:fs/promises');
    const main = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8');
    expect(main).toContain('assertSchemaCurrent(db');
    expect(main).toMatch(/assertSchemaCurrent\(db, \{ production: process\.env\['NODE_ENV'\] === 'production' \}\)/);
  });
});
