import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { withTenantTx, type Db, type Tx } from './client.js';
import { parseBusinessId, type BusinessId } from '../core/types/ids.js';
import { csvFile, type CsvDialect } from '../core/owner/csv.js';
import { zipWrite } from '../net/zip.js';
import type { DocumentStores } from './documents.js';

/**
 * E1 (Phase 5; 0205) — THE OWNER'S COPY OF THEIR PAPERS: every paper of the workspace in one archive, each as it was
 * given (opened from its sealed store, its SHA-256 checked), with `index.csv` saying what each file is — its name,
 * type, size, fingerprint, when and by whom it was added, the entry it backs and until when it is kept.
 *
 * Made whole or not at all, in one transaction: a paper that cannot be opened stops it, nothing is returned and no
 * receipt is written, so a workspace whose copy failed does not close. The receipt (`books_exports`, kind
 * 'papers_zip') records who made it, how many papers it holds and the newest one's time — what closure reads
 * (`papers_export_covers`): the OWNER's copy of every paper.
 */
export const PAPERS_INDEX_HEADER = ['#', 'file', 'name', 'type', 'bytes', 'sha256', 'added', 'added_by', 'entry', 'keep_until'] as const;

export type PapersArchive = { readonly file: Buffer; readonly papers: number; readonly sha256: string };

/** A paper's name as a file in the archive: its number first (names repeat), no folder, no path, nothing a disk refuses. */
const fileName = (n: number, name: string): string =>
  `papers/${String(n).padStart(4, '0')}-${name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '_').slice(0, 150) || 'paper'}`;

export async function makePapersArchive(db: Db, businessIdRaw: string, actor: string, store: DocumentStores, dialect: CsvDialect):
  Promise<PapersArchive | null> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return null;
  return withTenantTx(db, bid.value, async (tx) => {
    const rows = (await sql<{
      id: string; name: string; media_type: string; bytes: number; sha256: string; created_at: string; created_by: string;
      entry: string | null; keep_until: string | null; newest: string;
    }>`select d.id::text as id, d.name, d.media_type, d.bytes, d.sha256, d.created_at::text, d.created_by,
              case when e.id is null then null else coalesce(j.code || ' ' || e.number::text, e.label) end as entry,
              d.keep_until::text, (max(d.created_at) over ())::text as newest
         from documents d
         left join journal_entries e on e.id = d.entry_id
         left join journals j on j.id = e.journal_id
        where d.business_id = ${bid.value}
        order by d.created_at, d.id`.execute(tx)).rows;
    const files: { name: string; data: Buffer }[] = [];
    const index: string[][] = [];
    for (const [i, r] of rows.entries()) {
      const opened = await store.open(tx, r.id);
      if (!opened) throw new Error(`papers: ${r.id} could not be opened; no copy was made`);
      const file = fileName(i + 1, r.name);
      files.push({ name: file, data: opened.bytes });
      index.push([String(i + 1), file, r.name, r.media_type, String(r.bytes), r.sha256, r.created_at, r.created_by, r.entry ?? '', r.keep_until ?? '']);
    }
    files.unshift({ name: 'index.csv', data: Buffer.from(csvFile(PAPERS_INDEX_HEADER, index, dialect), 'utf8') });
    const file = zipWrite(files);
    const sha256 = createHash('sha256').update(file).digest('hex');
    await sql`insert into books_exports (business_id, made_by, kind, covers_through, entries, lines, papers, sha256)
              values (${bid.value}, ${actor}, 'papers_zip', ${rows[0]?.newest ?? null}::timestamptz, 0, 0, ${rows.length}, ${sha256})`.execute(tx);
    return { file, papers: rows.length, sha256 };
  });
}

/** What the owner's data page says about their papers: how many, and whether the owner's own copy holds them all. */
export type PapersHolding = { readonly papers: number; readonly lastCopyAt: Date | null; readonly copyCoversAll: boolean };

export async function papersHoldingTx(tx: Tx, businessId: BusinessId): Promise<PapersHolding> {
  const r = (await sql<{ papers: number; last: Date | null; covers: boolean }>`
    select (select count(*)::int from documents where business_id = ${businessId}::uuid) as papers,
           (select max(made_at) from books_exports where business_id = ${businessId}::uuid and kind = 'papers_zip') as last,
           papers_export_covers(${businessId}::uuid) as covers`.execute(tx)).rows[0]!;
  return { papers: r.papers, lastCopyAt: r.last, copyCoversAll: r.covers };
}
