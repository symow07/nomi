/**
 * B0 — the sealed-document format, for tools/rekey.mjs, which runs without a build. A copy of
 * src/security/documentSeal.ts; tests/parity/rekey-documents.test.ts seals with each and opens with the other, so the
 * two cannot drift.
 *
 * Packed: "NDS1" · key version (u16) · iv (12) · tag (16) · ciphertext. The key is HKDF-SHA256 of the credential
 * key under the label `nomi-documents-v<version>`; the authenticated data is `<businessId>/<documentId>`.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const MAGIC = Buffer.from('NDS1', 'ascii');

/** The document key of one credential key (a Buffer, as tools/lib/sealed.mjs `deriveKey` gives it). */
export function documentKey(credentialKey, version = 1) {
  return { key: Buffer.from(hkdfSync('sha256', credentialKey, Buffer.alloc(0), `nomi-documents-v${version}`, 32)), version };
}

const aadOf = (businessId, documentId) => Buffer.from(`${businessId}/${documentId}`, 'utf8');

export function sealDocument(bytes, k, businessId, documentId) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', k.key, iv);
  cipher.setAAD(aadOf(businessId, documentId));
  const data = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const version = Buffer.alloc(2);
  version.writeUInt16BE(k.version);
  return Buffer.concat([MAGIC, version, iv, cipher.getAuthTag(), data]);
}

/** The bytes, or null when this key did not seal it for this workspace and document. */
export function openDocument(packed, k, businessId, documentId) {
  if (!Buffer.isBuffer(packed) || packed.length < 34 || !packed.subarray(0, 4).equals(MAGIC)) return null;
  if (packed.readUInt16BE(4) !== k.version) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', k.key, packed.subarray(6, 18));
    decipher.setAAD(aadOf(businessId, documentId));
    decipher.setAuthTag(packed.subarray(18, 34));
    return Buffer.concat([decipher.update(packed.subarray(34)), decipher.final()]);
  } catch {
    return null;
  }
}

/** DOCUMENT_STORES, read as the app reads it (src/db/documents.ts): residency → directory path, for directory stores. */
export function directoryStores(raw) {
  const out = new Map();
  if (!raw || raw.trim() === '') return out;
  const parsed = JSON.parse(raw);
  for (const [name, v] of Object.entries(parsed)) {
    const m = typeof v === 'string' ? /^directory:(\/.+)$/.exec(v) : null;
    if (m) out.set(name, m[1]);
  }
  return out;
}
