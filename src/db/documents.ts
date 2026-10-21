import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { sql } from 'kysely';
import type { Tx } from './client.js';
import { documentKeyFrom, openDocument, sealDocument, type DocumentKey } from '../security/documentSeal.js';
import { deriveKey } from '../security/credentials.js';

/**
 * A4 (0174; decision 14) — WHERE A WORKSPACE'S PAPERS LIVE IS A PARAMETER, NOT AN ASSUMPTION.
 *
 * `DOCUMENT_STORES` (the installation's environment) maps each residency to a store:
 *
 *   DOCUMENT_STORES={"default":"database","ma":"directory:/data/ma"}
 *
 *   · `database` — the sealed bytes in this database (`document_blobs`);
 *   · `directory:<absolute path>` — the sealed bytes in a file on a volume in that place, one per document.
 *
 * Unset, every residency is `default`, in this database. A workspace's residency is `books_settings.residency`.
 * A document goes to its workspace's residency's store or NOWHERE: a residency with no store is a refusal, never a
 * quiet fallback to some other place — where the papers live is a promise the owner was made.
 *
 * Bytes are sealed before they leave this file (src/security/documentSeal.ts) and opened only here, checked against
 * the SHA-256 they were stored with.
 */
type DocumentStoreSpec = { readonly kind: 'database' } | { readonly kind: 'directory'; readonly path: string };

class DocumentRefusal extends Error {
  constructor(readonly reason: 'no_store_for_residency' | 'empty' | 'too_large', message: string) { super(message); }
}

const MAX_BYTES = 25 * 1024 * 1024;

/** The map from the environment, checked: a store that cannot be read is a boot error, not a later surprise. */
function storesFrom(raw: string | undefined): ReadonlyMap<string, DocumentStoreSpec> {
  if (!raw || raw.trim() === '') return new Map([['default', { kind: 'database' }]]);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('DOCUMENT_STORES: not JSON — e.g. {"default":"database"}'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('DOCUMENT_STORES: an object of residency → store');
  const out = new Map<string, DocumentStoreSpec>();
  for (const [name, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (!/^[a-z0-9-]{1,32}$/.test(name)) throw new Error(`DOCUMENT_STORES: "${name}" is not a residency name (a-z, 0-9, -)`);
    if (v === 'database') { out.set(name, { kind: 'database' }); continue; }
    const m = typeof v === 'string' ? /^directory:(.+)$/.exec(v) : null;
    if (!m || !isAbsolute(m[1]!)) throw new Error(`DOCUMENT_STORES: "${name}" is "database" or "directory:<absolute path>"`);
    out.set(name, { kind: 'directory', path: m[1]! });
  }
  if (out.size === 0) throw new Error('DOCUMENT_STORES: names no store at all');
  return out;
}

type StoredDocument = { readonly id: string; readonly keepUntil: string; readonly residency: string; readonly store: 'database' | 'directory' };
type OpenedDocument = { readonly name: string; readonly mediaType: string; readonly bytes: Buffer; readonly keepUntil: string };

export type DocumentStores = {
  /** Store one document in the calling workspace's residency, inside the caller's tenant transaction. */
  put(tx: Tx, input: { readonly businessId: string; readonly entryId?: string | null; readonly name: string;
    readonly mediaType: string; readonly bytes: Buffer; readonly by: string }): Promise<StoredDocument>;
  /** One document of the calling workspace, opened; null when there is none (another workspace's included). */
  open(tx: Tx, documentId: string): Promise<OpenedDocument | null>;
};

export function documentStoresFrom(env: Record<string, string | undefined>, credentialKey: Buffer): DocumentStores {
  const stores = storesFrom(env['DOCUMENT_STORES']);
  // B0 — during a CREDENTIAL_KEY rotation the previous key still OPENS (never seals) what it sealed, until
  // tools/rekey.mjs seals it again with the current one (docs/SECRET-ROTATION.md).
  const retired = env['CREDENTIAL_KEY_PREVIOUS'];
  const current = documentKeyFrom(credentialKey, 1);
  const keys: readonly DocumentKey[] = retired ? [current, documentKeyFrom(deriveKey(retired), 1)] : [current];
  const fileOf = (path: string, businessId: string, id: string) => join(path, businessId, `${id}.sealed`);

  return {
    async put(tx, input) {
      if (input.bytes.length === 0) throw new DocumentRefusal('empty', 'document: nothing to store');
      if (input.bytes.length > MAX_BYTES) throw new DocumentRefusal('too_large', 'document: larger than 25 MB');
      const residency = (await sql<{ r: string }>`
        select coalesce((select residency from books_settings where business_id = ${input.businessId}::uuid), 'default') as r`
        .execute(tx)).rows[0]!.r;
      const spec = stores.get(residency);
      if (!spec) {
        throw new DocumentRefusal('no_store_for_residency',
          `document: this workspace's papers live in "${residency}", and this installation has no store there — nothing was stored`);
      }
      const id = randomUUID();
      const sha256 = createHash('sha256').update(input.bytes).digest('hex');
      const sealed = sealDocument(input.bytes, current, input.businessId, id);
      const row = (await sql<{ keep_until: string }>`
        insert into documents (id, business_id, entry_id, name, media_type, bytes, sha256, residency, store, key_version, created_by)
        values (${id}::uuid, ${input.businessId}::uuid, ${input.entryId ?? null}, ${input.name}, ${input.mediaType},
                ${input.bytes.length}, ${sha256}, ${residency}, ${spec.kind}, ${current.version}, ${input.by})
        returning keep_until::text`.execute(tx)).rows[0]!;
      if (spec.kind === 'database') {
        await sql`insert into document_blobs (document_id, business_id, sealed) values (${id}::uuid, ${input.businessId}::uuid, ${sealed})`.execute(tx);
      } else {
        // Written inside the transaction: a failed write rolls the row back with it. A row rolled back after the
        // write leaves a sealed file no row names: unreadable without its row and its key. Sweeping such files is
        // open (PHASE-5.md A4).
        await mkdir(join(spec.path, input.businessId), { recursive: true });
        await writeFile(fileOf(spec.path, input.businessId, id), sealed, { flag: 'wx' });
      }
      return { id, keepUntil: row.keep_until, residency, store: spec.kind };
    },

    async open(tx, documentId) {
      if (!/^[0-9a-f-]{36}$/i.test(documentId)) return null;
      const d = (await sql<{ business_id: string; name: string; media_type: string; sha256: string; residency: string;
        store: 'database' | 'directory'; keep_until: string; sealed: Buffer | null }>`
        select d.business_id::text, d.name, d.media_type, d.sha256, d.residency, d.store, d.keep_until::text, b.sealed
          from documents d left join document_blobs b on b.document_id = d.id
         where d.id = ${documentId}::uuid`.execute(tx)).rows[0];
      if (!d) return null;
      let sealed = d.sealed;
      if (d.store === 'directory') {
        const spec = stores.get(d.residency);
        if (!spec || spec.kind !== 'directory') throw new Error(`document: its store (${d.residency}, a directory) is not configured here`);
        sealed = await readFile(fileOf(spec.path, d.business_id, documentId));
      }
      if (!sealed) throw new Error('document: its sealed bytes are missing');
      const bytes = openDocument(sealed, keys, d.business_id, documentId);
      if (createHash('sha256').update(bytes).digest('hex') !== d.sha256) throw new Error('document: its bytes are not the ones stored');
      return { name: d.name, mediaType: d.media_type, bytes, keepUntil: d.keep_until };
    },
  };
}
