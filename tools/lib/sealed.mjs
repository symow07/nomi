/**
 * REKEY — the sealed-token format, for operator tools that run without a build
 * (the integration job has no dist/). A copy of src/security/credentials.ts
 * `deriveKey` / `encryptSecret` / `decryptSecret`; tests/parity/rekey.test.ts
 * seals with each and opens with the other, so the two cannot drift.
 *
 * Packed format: v1.<keyVersion>.<iv b64>.<tag b64>.<ciphertext b64>
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export function deriveKey(envValue) {
  if (/^[0-9a-f]{64}$/i.test(envValue)) return Buffer.from(envValue, 'hex');
  return createHash('sha256').update(envValue, 'utf8').digest();
}

export function seal(plain, key, keyVersion = 1) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', String(keyVersion), iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join('.');
}

/** The plain text and the version it was sealed as — or null when this key did not seal it. */
export function open(packed, key) {
  const [v, ver, ivB64, tagB64, dataB64] = String(packed).split('.');
  if (v !== 'v1' || !ver || !ivB64 || !tagB64 || !dataB64) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
    return { plain, keyVersion: Number(ver) };
  } catch {
    return null;
  }
}

/**
 * Every column that holds a sealed token, for tools/rekey.mjs.
 * tests/parity/rekey.test.ts fails when a migration adds a `*_ciphertext`
 * column this list does not name.
 */
export const SEALED = [
  { table: 'channel_credentials', column: 'secret_ciphertext', version: 'secret_key_version' },
  { table: 'channel_credentials', column: 'webhook_secret_ciphertext' },
  { table: 'connector_credentials', column: 'secret_ciphertext' },
  { table: 'mail_accounts', column: 'refresh_token_ciphertext' },
  { table: 'meta_accounts', column: 'token_ciphertext' },
];
