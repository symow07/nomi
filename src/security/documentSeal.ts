import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * A4 (Phase 5) — A DOCUMENT AT REST IS SEALED: AES-256-GCM, its own key, bound to its workspace and its id.
 *
 * Receipts, invoices and bills are kept ten years (PHASE-5.md §6). A copy of the store — a database dump, a disk, a
 * backup — must not be a copy of a shop's papers. So every document's bytes are sealed before they are stored:
 *
 *   · the key is derived from CREDENTIAL_KEY with HKDF under its own label, so a document key is never a credential
 *     key and a leak of one says nothing about the other;
 *   · the workspace and the document's id are the AUTHENTICATED DATA: a sealed blob moved to another workspace's
 *     row, or to another document's, fails to open rather than showing someone else's papers;
 *   · the key version travels with the bytes, so a rotation re-seals (docs/SECRET-ROTATION.md) instead of
 *     stranding what the old key sealed: while CREDENTIAL_KEY_PREVIOUS is set, the key derived from it opens too
 *     (never seals), and tools/rekey.mjs seals each document again with the current one (B0).
 *
 * ONE document key per installation (and per key version), never one per document: what makes each document's
 * seal its own is a fresh IV and its workspace and id as authenticated data. The key itself lives nowhere but the
 * environment: no row holds it, so a copy of the database opens nothing.
 *
 * Packed: "NDS1" · key version (u16) · iv (12) · tag (16) · ciphertext.
 */
const MAGIC = Buffer.from('NDS1', 'ascii');

export type DocumentKey = { readonly key: Buffer; readonly version: number };

/** The document key, derived from the installation's credential key: one per key version. */
export function documentKeyFrom(credentialKey: Buffer, version = 1): DocumentKey {
  return { key: Buffer.from(hkdfSync('sha256', credentialKey, Buffer.alloc(0), `nomi-documents-v${version}`, 32)), version };
}

const aadOf = (businessId: string, documentId: string): Buffer => Buffer.from(`${businessId}/${documentId}`, 'utf8');

export function sealDocument(bytes: Buffer, k: DocumentKey, businessId: string, documentId: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', k.key, iv);
  cipher.setAAD(aadOf(businessId, documentId));
  const data = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const version = Buffer.alloc(2);
  version.writeUInt16BE(k.version);
  return Buffer.concat([MAGIC, version, iv, cipher.getAuthTag(), data]);
}

/**
 * The bytes back, or a thrown error: wrong key, wrong workspace, wrong document, or tampered with. Each key of the
 * packed version is tried in turn, the current first: during a rotation the previous credential key derives a key
 * of the same version, and the authentication tag says which one sealed it.
 */
export function openDocument(packed: Buffer, keys: readonly DocumentKey[], businessId: string, documentId: string): Buffer {
  if (packed.length < 34 || !packed.subarray(0, 4).equals(MAGIC)) throw new Error('document: not a sealed document');
  const version = packed.readUInt16BE(4);
  const candidates = keys.filter((x) => x.version === version);
  if (candidates.length === 0) throw new Error(`document: sealed with key version ${version}, which this installation does not hold`);
  let failure: unknown;
  for (const k of candidates) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', k.key, packed.subarray(6, 18));
      decipher.setAAD(aadOf(businessId, documentId));
      decipher.setAuthTag(packed.subarray(18, 34));
      return Buffer.concat([decipher.update(packed.subarray(34)), decipher.final()]);
    } catch (e) { failure = e; }
  }
  throw failure;
}
