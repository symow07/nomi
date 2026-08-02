import { describe, it, expect } from 'vitest';
import {
  checkRuntimeRole, describeUnsafeRole, RUNTIME_ROLE, type RuntimeIdentity,
} from '../../src/db/runtimeIdentity.js';

/**
 * M19 (B0) — the runtime connection must be subject to RLS.
 *
 * This is the check that would have caught the real production finding:
 * `yiwuflow_app` was NOLOGIN, so the app could not have been connecting as the
 * role every policy targets — while all tests passed and /health stayed green.
 */

const app: RuntimeIdentity = { currentUser: RUNTIME_ROLE, isSuperuser: false, bypassesRls: false };
const superuser: RuntimeIdentity = { currentUser: 'postgres', isSuperuser: true, bypassesRls: true };

describe('M19 · runtime database identity', () => {
  it('ACCEPTS yiwuflow_app with no superuser and no bypass', () => {
    expect(checkRuntimeRole(app, { expectRole: true })).toMatchObject({ safe: true, problems: [] });
    expect(checkRuntimeRole(app, { expectRole: false })).toMatchObject({ safe: true });
  });

  it('REFUSES the exact production shape: postgres, superuser, bypassrls', () => {
    const v = checkRuntimeRole(superuser, { expectRole: true });
    expect(v.safe).toBe(false);
    expect(v.problems).toEqual(['superuser', 'bypasses_rls', 'wrong_role']);
  });

  it('REFUSES a superuser even when the role name is right', () => {
    // a yiwuflow_app that had been granted SUPERUSER would still bypass RLS
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
