import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  enforcePilotTenant, pilotTenantProblem, describePilotTenantProblem,
  type PilotTenantState,
} from '../../src/db/pilotTenant.js';
import { SANDBOX_BUSINESS_ID } from '../../src/demo/sandbox.js';

/**
 * M23 — the pilot tenant must be a real, intentional factory. Never missing,
 * never the practice sandbox.
 *
 * Found on live production: the sole business was `Practice sandbox`, and
 * PILOT_BUSINESS_ID defaults to the DEMO id, which does not exist there. Both
 * outcomes were reachable and neither was visible from /health.
 */

const SANDBOX = SANDBOX_BUSINESS_ID;
const REAL = '0c8fca99-6637-4310-9161-fa4150f96d7c';

const state = (over: Partial<PilotTenantState> = {}): PilotTenantState => {
  const base = {
    configured: REAL, sandboxId: SANDBOX, exists: true, isSandbox: false,
    name: '义乌启明日用品厂', ...over,
  };
  return { ...base, ok: pilotTenantProblem({ ...base, ok: false }) === null };
};

const silent = { production: false, warn: () => {} };

describe('M23 · which tenant is this build serving?', () => {
  it('a real, distinct, existing factory passes', () => {
    const s = state();
    expect(pilotTenantProblem(s)).toBeNull();
    expect(s.ok).toBe(true);
    expect(() => enforcePilotTenant(s, { production: true })).not.toThrow();
  });

  it('an UNSET id fails — there is no factory to serve', () => {
    const s = state({ configured: '', exists: false, name: null });
    expect(pilotTenantProblem(s)).toBe('unset');
    expect(() => enforcePilotTenant(s, { production: true })).toThrow(/PILOT_BUSINESS_ID is not set/);
  });

  it('whitespace is not a configured id', () => {
    expect(pilotTenantProblem(state({ configured: '   ', exists: false }))).toBe('unset');
  });

  it('a NONEXISTENT tenant fails — the owner would reach an empty factory', () => {
    const s = state({ configured: 'de300000-0000-4000-8000-0000000000b1', exists: false, name: null });
    expect(pilotTenantProblem(s)).toBe('missing');
    expect(() => enforcePilotTenant(s, { production: true })).toThrow(/no business with that id exists/);
  });

  it('the PRACTICE SANDBOX fails — even though it exists and everything would work', () => {
    // The dangerous case: nothing breaks. She teaches her real catalogue into
    // the space whose reset button archives conversations.
    const s = state({ configured: SANDBOX, isSandbox: true, exists: true, name: 'Practice sandbox' });
    expect(pilotTenantProblem(s)).toBe('is_sandbox');
    expect(() => enforcePilotTenant(s, { production: true })).toThrow(/PRACTICE SANDBOX/);
  });

  it('sandbox is caught even when the row is somehow absent — identity beats existence', () => {
    expect(pilotTenantProblem(state({ configured: SANDBOX, isSandbox: true, exists: false })))
      .toBe('is_sandbox');
  });
});

describe('M23 · the guard behaves like the two guards beside it', () => {
  it('production REFUSES; elsewhere it warns and continues', () => {
    for (const s of [
      state({ configured: '', exists: false }),
      state({ configured: REAL, exists: false }),
      state({ configured: SANDBOX, isSandbox: true }),
    ]) {
      expect(() => enforcePilotTenant(s, { production: true })).toThrow();
      const warnings: string[] = [];
      expect(() => enforcePilotTenant(s, { production: false, warn: (m) => warnings.push(m) })).not.toThrow();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('not enforced outside production');
    }
  });

  it('a healthy tenant warns about nothing', () => {
    const warnings: string[] = [];
    enforcePilotTenant(state(), { production: false, warn: (m) => warnings.push(m) });
    expect(warnings).toEqual([]);
  });

  it('never silently falls back to another tenant', () => {
    // The returned state always reports what was CONFIGURED, never a substitute.
    for (const c of ['', SANDBOX, 'de300000-0000-4000-8000-0000000000b1']) {
      const s = enforcePilotTenant(state({ configured: c, exists: false, isSandbox: c === SANDBOX }), silent);
      expect(s.configured).toBe(c);
    }
  });
});

describe('M23 · the refusal tells the operator what to do', () => {
  it('every problem names the command that fixes it', () => {
    for (const p of ['unset', 'missing', 'is_sandbox'] as const) {
      const msg = describePilotTenantProblem(state({ configured: p === 'unset' ? '' : REAL }), p);
      expect(msg, p).toContain('node tools/provision-factory.mjs');
      expect(msg, p).toContain('PILOT_BUSINESS_ID');
      expect(msg.length, p).toBeGreaterThan(60);      // never a bare "misconfigured"
    }
  });

  it('the sandbox message explains WHY, not just that it is refused', () => {
    const msg = describePilotTenantProblem(state({ configured: SANDBOX, isSandbox: true }), 'is_sandbox');
    expect(msg).toContain('rehearses');
    expect(msg).toContain(SANDBOX);
  });

  it('a refusal never prints a credential', () => {
    for (const p of ['unset', 'missing', 'is_sandbox'] as const) {
      const msg = describePilotTenantProblem(state(), p);
      expect(msg).not.toMatch(/postgres(ql)?:\/\//);
      expect(msg.toLowerCase()).not.toContain('password');
    }
  });
});

describe('M23 · the guard makes no decision it is not entitled to', () => {
  it('it reads one table and changes nothing', async () => {
    const src = await readFile(new URL('../../src/db/pilotTenant.ts', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const write of ['insert into', 'update ', 'delete from', 'alter '])
      expect(code.toLowerCase().includes(write), `pilotTenant.ts writes: ${write}`).toBe(false);
    // and it does not reach into the send path or the trust model
    for (const forbidden of ['gateOutbound', 'activationPreconditions', 'scenarios', 'enqueueOutbound'])
      expect(code.includes(forbidden), `pilotTenant.ts reaches ${forbidden}`).toBe(false);
  });

  it('the provisioning tool cannot be handed an id, so it cannot be handed the sandbox one', async () => {
    const src = await readFile(new URL('../../tools/provision-factory.mjs', import.meta.url), 'utf8');
    expect(src).toContain('randomUUID()');
    // argv is name + language only; an id argument would reintroduce the exact
    // mistake the tool exists to prevent.
    expect(src).not.toMatch(/process\.argv\[4\]/);
    expect(src).toContain('MIGRATE_DATABASE_URL');
    // it must never seed anything: a new factory starts empty
    for (const seeded of ['insert into products', 'insert into product_knowledge',
                          'insert into claims_policy', 'insert into conversations',
                          'insert into channels'])
      expect(src.includes(seeded), `provisioning seeds ${seeded}`).toBe(false);
  });

  it('the sandbox id the tool refuses is the real one', async () => {
    const src = await readFile(new URL('../../tools/provision-factory.mjs', import.meta.url), 'utf8');
    expect(src).toContain(SANDBOX_BUSINESS_ID);
  });
});
