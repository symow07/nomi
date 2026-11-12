import type pg from 'pg';
import { createHash } from 'node:crypto';
import { openAdvisor, type AdvisorKeys } from '../../src/advisor/seal.js';
import { decryptSecret } from '../../src/security/credentials.js';
import { openDocument, type DocumentKey } from '../../src/security/documentSeal.js';

/**
 * The authorization walk's check (b): which of a workspace's rows hold one of the other workspace's ids — anywhere in
 * the row, key or text or JSON — judged on WHOLE values (the re-verification's R4, 2026-11-11: the walk used to keep
 * twelve shapes per column, each cut at 160 characters, and judged only those, so a reference after a long typed
 * label was forgiven).
 *
 * ONE EXEMPTION, judged value by value: the owner's typed words stored as typed. `label` is an id field (labels) and a
 * free-text one (a phone's label on the pilot list, the audit line that records it). A value is forgiven only when every
 * one of the other workspace's ids in it is, ALONE, the whole value of a column named `label` or of a JSON key named
 * `label`. Any other occurrence — in another key, in a key's name, beside other words, in a value that does not parse —
 * counts.
 */

const UUID_IN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ONLY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const holds = (s: string, theirs: ReadonlySet<string>): boolean => (s.match(UUID_IN) ?? []).some((u) => theirs.has(u.toLowerCase()));

/** True when every one of `theirs` in `value` is the whole value of a `label` (the column, or a JSON key). */
export function onlyTypedLabels(column: string, value: string, theirs: ReadonlySet<string>): boolean {
  if (!holds(value, theirs)) return true;
  if (column === 'label') return ONLY_UUID.test(value) && theirs.has(value.toLowerCase());
  const t = value.trimStart();
  if (!t.startsWith('{') && !t.startsWith('[')) return false;
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return false; }
  const ok = (node: unknown, key: string | null): boolean => {
    if (typeof node === 'string') return !holds(node, theirs) || (key === 'label' && ONLY_UUID.test(node));
    if (Array.isArray(node)) return node.every((x) => ok(x, null));
    if (node && typeof node === 'object') {
      return Object.entries(node as Record<string, unknown>).every(([k, v]) => !holds(k, theirs) && ok(v, k));
    }
    return true;
  };
  return ok(parsed, null);
}

export type Held = { readonly n: number; readonly shapes: readonly string[] };

/**
 * Per `table.column`: how many of W's rows hold one of `theirs` outside a typed label, with up to three of those values
 * in full (every id shown as `U`), for the failure's message. Every matching value is read and judged whole.
 */
export async function heldBy(
  admin: pg.Client, scopes: readonly { table: string; where: string }[], w: string, theirs: ReadonlySet<string>, sealed?: Sealed,
): Promise<Map<string, Held>> {
  const out = new Map<string, Held>();
  if (theirs.size === 0) return out;
  const any = `(${[...theirs].join('|')})`;
  for (const s of scopes) {
    const rows = (await admin.query(`select k.key as col, k.value as v
        from ${s.table} x cross join lateral jsonb_each_text(to_jsonb(x)) k
        where (${s.where}) and k.value ~* $2`, [w, any])).rows as { col: string; v: string }[];
    for (const r of rows) {
      if (onlyTypedLabels(r.col, r.v, theirs)) continue;
      const key = `${s.table}.${r.col}`;
      const was = out.get(key) ?? { n: 0, shapes: [] };
      const shape = r.v.replace(UUID_IN, 'U');
      out.set(key, { n: was.n + 1, shapes: was.shapes.length < 3 && !was.shapes.includes(shape) ? [...was.shapes, shape] : was.shapes });
    }
  }
  if (sealed) for (const [key, h] of await heldSealed(admin, scopes, w, theirs, sealed)) out.set(key, h);
  return out;
}

/**
 * THE SEALED COLUMNS (the follow-up's H1, 2026-11-12). A row read as text shows a sealed value as ciphertext, so one of
 * the other workspace's ids kept INSIDE one was invisible to the check above: the Copilot's kept turn sealing the
 * body's customer id passed the walk. The walk opens what it judges: every sealed column of every table it reads is
 * listed here with the key that seals it, each of W's values is opened with the walk's own test keys, and the PLAIN text
 * is searched — for the other workspace's ids (any occurrence: no typed-label exemption inside a seal), for its marker,
 * and, for a sealed file, for the bytes of a file the other workspace keeps.
 *
 * A value the walk's keys do not open is counted too (`[sealed, not opened]`): the walk never judges what it did not
 * read. The walk's own test fails when the database has a sealed column this list does not name (`sealedColumnsIn`),
 * or holds a sealed-looking value in any other column (`sealedShapedIn`).
 *
 *   · `credential` — CREDENTIAL_KEY, "v1.<version>.<iv>.<tag>.<data>" (src/security/credentials.ts);
 *   · `advisor`    — ADVISOR_KEY, "a1.<iv>.<tag>.<data>", named by the row's `sealed_with` (src/advisor/seal.ts);
 *   · `document`   — the document key, "NDS1…" bytes bound to the row's workspace and document (src/security/documentSeal.ts).
 */
export type SealKind = 'credential' | 'advisor' | 'document';
export const SEALED_COLUMNS: readonly { readonly table: string; readonly column: string; readonly kind: SealKind }[] = [
  { table: 'ad_spend_connections', column: 'token_ciphertext', kind: 'credential' },
  { table: 'channel_credentials', column: 'secret_ciphertext', kind: 'credential' },
  { table: 'channel_credentials', column: 'webhook_secret_ciphertext', kind: 'credential' },
  { table: 'connector_credentials', column: 'secret_ciphertext', kind: 'credential' },
  { table: 'mail_accounts', column: 'refresh_token_ciphertext', kind: 'credential' },
  { table: 'meta_accounts', column: 'token_ciphertext', kind: 'credential' },
  { table: 'shopify_connections', column: 'credential_ciphertext', kind: 'credential' },
  { table: 'tiktok_accounts', column: 'token_ciphertext', kind: 'credential' },
  { table: 'whatsapp_accounts', column: 'pin_ciphertext', kind: 'credential' },
  { table: 'whatsapp_accounts', column: 'token_ciphertext', kind: 'credential' },
  { table: 'advisor_threads', column: 'title_ciphertext', kind: 'advisor' },
  { table: 'advisor_turns', column: 'answer_ciphertext', kind: 'advisor' },
  { table: 'advisor_turns', column: 'facts_ciphertext', kind: 'advisor' },
  { table: 'advisor_turns', column: 'params_ciphertext', kind: 'advisor' },
  { table: 'advisor_turns', column: 'question_ciphertext', kind: 'advisor' },
  { table: 'document_blobs', column: 'sealed', kind: 'document' },
];

/** The keys the walk's own composition seals with. `credential` null: the walk composes none, so nothing of it opens. */
export type SealKeys = { readonly advisor: AdvisorKeys; readonly credential: Buffer | null; readonly documents: readonly DocumentKey[] };
/** `seen`: how many values of each sealed column were opened and read, for the walk to show it read some. */
export type Sealed = { readonly keys: SealKeys; readonly marks: readonly string[]; readonly blobs: ReadonlySet<string>; readonly seen?: Map<string, number> };

/** Every column of the database that is sealed by its name: `*_ciphertext`, and a bytea called `sealed`. */
export async function sealedColumnsIn(admin: pg.Client): Promise<string[]> {
  return (await admin.query(`select c.relname || '.' || a.attname as col from pg_class c
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p')
       and (a.attname ~ 'ciphertext' or (a.attname ~ '^sealed$|_sealed$' and a.atttypid = 'bytea'::regtype)) order by 1`)).rows.map((r) => r.col as string);
}

/** A value that LOOKS sealed, whatever its column is called: one of the three packed formats, anywhere in the value. */
const SEALED_SHAPE = String.raw`(v1\.[0-9]+|a1)\.[A-Za-z0-9+/]{16}\.[A-Za-z0-9+/]{22}==\.|^\\x4e445331`;
/** The `table.column`s of W's rows that hold a sealed-looking value. Each must be one of SEALED_COLUMNS. */
export async function sealedShapedIn(admin: pg.Client, scopes: readonly { table: string; where: string }[], w: string): Promise<string[]> {
  const out = new Set<string>();
  for (const s of scopes) {
    for (const r of (await admin.query(`select distinct k.key as col from ${s.table} x cross join lateral jsonb_each_text(to_jsonb(x)) k
        where (${s.where}) and k.value ~ $2`, [w, SEALED_SHAPE])).rows) out.add(`${s.table}.${r.col as string}`);
  }
  return [...out].sort();
}

const opened = (kind: SealKind, row: Record<string, unknown>, value: string, keys: SealKeys): Buffer | null => {
  try {
    if (kind === 'advisor') { const o = openAdvisor(keys.advisor, value, String(row['sealed_with'] ?? '')); return o ? Buffer.from(o.plain, 'utf8') : null; }
    if (kind === 'credential') return keys.credential ? Buffer.from(decryptSecret(value, keys.credential).plain, 'utf8') : null;
    if (!value.startsWith('\\x')) return null;
    return openDocument(Buffer.from(value.slice(2), 'hex'), keys.documents, String(row['business_id']), String(row['document_id']));
  } catch { return null; }
};

/** What W's sealed values hold of the other workspace, once opened: per `table.column [sealed]`, as `heldBy` counts. */
export async function heldSealed(
  admin: pg.Client, scopes: readonly { table: string; where: string }[], w: string, theirs: ReadonlySet<string>, sealed: Sealed,
): Promise<Map<string, Held>> {
  const out = new Map<string, Held>();
  const add = (key: string, shape: string) => {
    const was = out.get(key) ?? { n: 0, shapes: [] };
    out.set(key, { n: was.n + 1, shapes: was.shapes.length < 3 && !was.shapes.includes(shape) ? [...was.shapes, shape] : was.shapes });
  };
  for (const c of SEALED_COLUMNS) for (const s of scopes.filter((x) => x.table === c.table)) {
    const rows = (await admin.query(`select to_jsonb(x) as row from ${s.table} x where (${s.where}) and x.${c.column} is not null`, [w])).rows as { row: Record<string, unknown> }[];
    for (const { row } of rows) {
      const plain = opened(c.kind, row, String(row[c.column]), sealed.keys);
      if (plain === null) { add(`${c.table}.${c.column} [sealed, not opened]`, "a sealed value the walk's keys do not open"); continue; }
      sealed.seen?.set(`${c.table}.${c.column}`, (sealed.seen.get(`${c.table}.${c.column}`) ?? 0) + 1);
      const text = plain.toString('latin1');
      const theirFile = c.kind === 'document' && sealed.blobs.has(createHash('sha256').update(plain).digest('hex'));
      if (!holds(text, theirs) && !sealed.marks.some((m) => text.includes(m)) && !theirFile) continue;
      add(`${c.table}.${c.column} [sealed]`, theirFile ? "the other workspace's file, by its bytes" : text.slice(0, 600).replace(UUID_IN, 'U'));
    }
  }
  return out;
}
