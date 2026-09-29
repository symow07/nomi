import { describe, it, expect, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encryptSecret, decryptSecret, deriveKey, acceptRetiredKeys } from '../../src/security/credentials.js';
import { validateEnv } from '../../src/main.js';
// @ts-expect-error — a tool helper, plain JS on purpose (the integration job runs tools without a build).
import * as tool from '../../tools/lib/sealed.mjs';

/**
 * REKEY — rotating CREDENTIAL_KEY without a token lost
 * (docs/SECRET-ROTATION.md). The parts no database is needed for; the tool on
 * real rows is tests/integration/rekey.test.ts.
 */

const key = () => deriveKey(randomBytes(32).toString('hex'));

describe('REKEY · the app opens with the key it replaced, and never seals with it', () => {
  afterEach(() => acceptRetiredKeys([]));

  it('a token sealed with the previous key opens only while that key is retired, not current', () => {
    const [was, now] = [key(), key()];
    const sealed = encryptSecret('page-token', was);
    expect(() => decryptSecret(sealed, now)).toThrow();
    acceptRetiredKeys([was]);
    expect(decryptSecret(sealed, now)).toEqual({ plain: 'page-token', keyVersion: 1 });
    // the current key's own tokens open as before
    expect(decryptSecret(encryptSecret('mail-token', now, 3), now)).toEqual({ plain: 'mail-token', keyVersion: 3 });
    acceptRetiredKeys([]);
    expect(() => decryptSecret(sealed, now), 'the rotation over, the old key is forgotten').toThrow();
  });

  it('sealing always uses the key it is given — a retired key is never written with', () => {
    const [was, now] = [key(), key()];
    acceptRetiredKeys([was]);
    const sealed = encryptSecret('x', now);
    acceptRetiredKeys([]);
    expect(decryptSecret(sealed, now).plain).toBe('x');
  });

  it('a token no key opens still fails, and a malformed one says so', () => {
    acceptRetiredKeys([key()]);
    expect(() => decryptSecret(encryptSecret('x', key()), key())).toThrow();
    expect(() => decryptSecret('not-sealed', key())).toThrow('credential: unrecognized format');
  });

  it('CREDENTIAL_KEY_PREVIOUS is checked at boot: 64 hex characters or the boot refuses', () => {
    const base = {
      DATABASE_URL: 'postgres://x', WEBHOOK_VERIFY_TOKEN: 'a-verify-token-long-enough', CREDENTIAL_KEY: 'a'.repeat(64),
      LEGAL_CONTACT_EMAIL: 'privacy@example.com', ANTHROPIC_API_KEY: `sk-ant-${'x'.repeat(40)}`,
    };
    expect(validateEnv({ ...base, CREDENTIAL_KEY_PREVIOUS: 'b'.repeat(64) }).ok).toBe(true);
    const bad = validateEnv({ ...base, CREDENTIAL_KEY_PREVIOUS: 'not-a-key' });
    expect(bad.ok).toBe(false);
    expect(bad.ok ? [] : bad.problems).toContain('CREDENTIAL_KEY_PREVIOUS: invalid shape');
  });
});

describe('REKEY · the tool seals and opens exactly as the app does (its copy runs without a build)', () => {
  it('the app opens what the tool sealed, and the tool opens what the app sealed — never with the wrong key', () => {
    const k = key();
    expect(decryptSecret(tool.seal('from the tool', k, 4), k)).toEqual({ plain: 'from the tool', keyVersion: 4 });
    expect(tool.open(encryptSecret('from the app', k, 2), k)).toEqual({ plain: 'from the app', keyVersion: 2 });
    expect(tool.open(encryptSecret('x', k), key())).toBeNull();
    expect(tool.open('not-sealed', k)).toBeNull();
    const hex = 'c'.repeat(64);
    expect(tool.deriveKey(hex).equals(deriveKey(hex))).toBe(true);
    expect(tool.deriveKey('a passphrase').equals(deriveKey('a passphrase'))).toBe(true);
  });

  it('the tool knows every sealed column a migration declares', () => {
    const dir = fileURLToPath(new URL('../../migrations/', import.meta.url));
    const declared = new Set(readdirSync(dir).filter((f) => f.endsWith('.sql'))
      .flatMap((f) => [...readFileSync(join(dir, f), 'utf8').matchAll(/\b([a-z_]+_ciphertext)\s+text\b/g)].map((m) => m[1]!)));
    expect(declared.size).toBeGreaterThan(0);
    const known = new Set((tool.SEALED as { column: string }[]).map((s) => s.column));
    for (const col of declared) expect(known.has(col), `${col} is sealed but tools/lib/sealed.mjs SEALED does not name it`).toBe(true);
  });

  it('the tool takes no key from the command line, and prints no token', () => {
    const src = readFileSync(fileURLToPath(new URL('../../tools/rekey.mjs', import.meta.url)), 'utf8');
    expect(src).toContain("process.env['CREDENTIAL_KEY']");
    expect(src).toContain("process.env['CREDENTIAL_KEY_PREVIOUS']");
    // no value of a token is ever put into a line it prints
    expect(src).not.toMatch(/console\.(log|error)\([^;]*\$\{[^}]*\b(plain|sealed|again)\b/);
    expect('console.log(`${p.plain}`)').toMatch(/console\.(log|error)\([^;]*\$\{[^}]*\b(plain|sealed|again)\b/);
  });
});
