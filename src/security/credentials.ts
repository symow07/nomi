import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * M3 — Credential handling. AES-256-GCM at rest; a database dump must never
 * be a credential dump. The key lives ONLY in the environment
 * (CREDENTIAL_KEY); rotation = write with a new keyVersion, re-encrypt on
 * read-miss. Nothing here ever logs a secret — logging goes through
 * redactSecrets, and audit records carry fingerprints, never values.
 */

/** Accept a 64-hex key directly, or derive 32 bytes from a passphrase. */
export function deriveKey(envValue: string): Buffer {
  if (/^[0-9a-f]{64}$/i.test(envValue)) return Buffer.from(envValue, 'hex');
  return createHash('sha256').update(envValue, 'utf8').digest();
}

/** Packed format: v1.<keyVersion>.<iv b64>.<tag b64>.<ciphertext b64> */
export function encryptSecret(plain: string, key: Buffer, keyVersion = 1): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', String(keyVersion), iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join('.');
}

export function decryptSecret(packed: string, key: Buffer): { plain: string; keyVersion: number } {
  const [v, ver, ivB64, tagB64, dataB64] = packed.split('.');
  if (v !== 'v1' || !ver || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('credential: unrecognized format');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  return { plain, keyVersion: Number(ver) };
}

/** Short stable id for audit lines: proves WHICH credential without exposing it. */
export function credentialFingerprint(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex').slice(0, 12);
}

const PATTERNS: readonly RegExp[] = [
  /(D360-API-KEY['":\s=]+)[^\s'",}]+/gi,
  /(Bearer\s+)[A-Za-z0-9._~+/-]+=*/g,
  /(api[_-]?key['":\s=]+)[^\s'",}]+/gi,
  /(password['":\s=]+)[^\s'",}]+/gi,
];

/** Redact known secret values and common secret-shaped patterns from text. */
export function redactSecrets(text: string, knownSecrets: readonly string[] = []): string {
  let out = text;
  for (const s of knownSecrets) {
    if (s.length >= 6) out = out.split(s).join('[redacted]');
  }
  for (const p of PATTERNS) out = out.replace(p, '$1[redacted]');
  return out;
}
