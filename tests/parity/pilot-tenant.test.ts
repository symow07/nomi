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

/**
 * M27 — the two operational defects a first factory would actually meet.
 * Neither is a feature; both are ways the product breaks for a real owner at
 * the worst possible moment, and both had already happened here.
 */
describe('M27 · prompts load wherever the process starts', () => {
  it('resolves from the module, not the working directory', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/llm/anthropic.ts', import.meta.url), 'utf8');
    // `readFileSync(\`prompts/${f}\`)` resolves against process.cwd(). Correct
    // only while the process happens to start in the repository root, and it
    // would have thrown ENOENT on the FIRST buyer message — after the webhook,
    // after tenant resolution, with a real person waiting. Never exercised in
    // production, because messaging has never been on.
    expect(src).not.toContain('readFileSync(`prompts/');
    expect(src).toContain("new URL('../../prompts/', import.meta.url)");
  });

  it('every prompt the client loads really exists at that path', async () => {
    const { readFile } = await import('node:fs/promises');
    const dir = new URL('../../prompts/', import.meta.url);
    for (const f of ['analysis.txt', 'response.txt', 'image_analysis.txt']) {
      const text = await readFile(new URL(f, dir), 'utf8');
      expect(text.trim().length, f).toBeGreaterThan(100);
    }
  });
});

describe('CREDENTIAL_KEY must be supplied, not generated', () => {
  it('refuses to boot in production when the key was generated', async () => {
    const { assertStableCredentialKey } = await import('../../src/main.js');
    expect(() => assertStableCredentialKey(['CREDENTIAL_KEY'], { production: true }))
      .toThrow(/CREDENTIAL_KEY was generated at boot/);
  });

  it('names the consequences and the fix, not just "misconfigured"', async () => {
    const { assertStableCredentialKey } = await import('../../src/main.js');
    let message = '';
    try {
      assertStableCredentialKey(['CREDENTIAL_KEY'], { production: true });
    } catch (e) { message = (e as Error).message; }
    // The person reading this has a deployment that just refused to start.
    expect(message).toMatch(/undecryptable/);
    expect(message).toMatch(/session/);
    expect(message).toMatch(/grep \^CREDENTIAL_KEY= \.env/);
  });

  it('warns but does not refuse outside production', async () => {
    const { assertStableCredentialKey } = await import('../../src/main.js');
    const warnings: string[] = [];
    expect(() => assertStableCredentialKey(
      ['CREDENTIAL_KEY'], { production: false, warn: (m) => warnings.push(m) },
    )).not.toThrow();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/not enforced outside production/);
  });

  it('is silent when the key came from the environment', async () => {
    const { assertStableCredentialKey } = await import('../../src/main.js');
    const warnings: string[] = [];
    // Other secrets being generated is fine; only CREDENTIAL_KEY is fatal.
    expect(() => assertStableCredentialKey(
      ['WEBHOOK_SECRET', 'WEBHOOK_VERIFY_TOKEN'],
      { production: true, warn: (m) => warnings.push(m) },
    )).not.toThrow();
    expect(() => assertStableCredentialKey([], { production: true })).not.toThrow();
    expect(warnings).toHaveLength(0);
  });

  it('reports stability to the OPERATOR without carrying the key', async () => {
    const { readDeployment } = await import('../../src/api/web/deployment.js');
    const now = new Date('2026-08-08T10:00:00Z');
    expect(readDeployment({}, now, 60).credentialKeyStable).toBe(false);
    expect(readDeployment({ CREDENTIAL_KEY: '   ' }, now, 60).credentialKeyStable).toBe(false);

    const secret = 'deadbeef'.repeat(8);
    const info = readDeployment({ CREDENTIAL_KEY: secret }, now, 60);
    expect(info.credentialKeyStable).toBe(true);
    expect(JSON.stringify(info)).not.toContain(secret);

    // Presence only: the rendered panel must never interpolate the value.
    const { readFile } = await import('node:fs/promises');
    const panel = await readFile(new URL('../../src/api/web/pilot.ts', import.meta.url), 'utf8');
    expect(panel).not.toMatch(/CREDENTIAL_KEY/);
    expect(panel).toMatch(/credentialKeyStable \? '' :/);
  });
});

describe('M27 · the owner is not locked out by a deploy', () => {
  it('an unset OWNER_ACCESS_CODE is reported to the OPERATOR', async () => {
    const { readDeployment } = await import('../../src/api/web/deployment.js');
    const now = new Date('2026-08-06T10:00:00Z');
    expect(readDeployment({}, now, 60).ownerCodeStable).toBe(false);
    expect(readDeployment({ OWNER_ACCESS_CODE: '   ' }, now, 60).ownerCodeStable).toBe(false);
    expect(readDeployment({ OWNER_ACCESS_CODE: 'a-long-stable-phrase' }, now, 60).ownerCodeStable).toBe(true);
  });

  it('the code itself is never carried or rendered', async () => {
    const { readDeployment } = await import('../../src/api/web/deployment.js');
    const secret = 'super-secret-owner-code';
    const info = readDeployment({ OWNER_ACCESS_CODE: secret }, new Date(), 60);
    expect(JSON.stringify(info)).not.toContain(secret);
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/api/web/deployment.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/ownerAccessCode\s*:/);          // presence only
  });

  it('the warning names the fix, and appears only when it applies', async () => {
    const { t } = await import('../../src/core/owner/i18n/messages.js');
    const { LOCALES } = await import('../../src/core/owner/i18n/locale.js');
    for (const l of LOCALES) {
      const msg = t(l, 'runbook.deploy.codeUnstable');
      expect(msg.length, l).toBeGreaterThan(20);
      expect(msg, l).toContain('OWNER_ACCESS_CODE');
    }
  });
});
