import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { withTenantTx, type Db, type Tx } from './client.js';
import { parseBusinessId } from '../core/types/ids.js';
import { BOOKS_FILE_HEADER, booksFileRows, type BooksFileLine } from '../core/books/booksFile.js';
import { csvFile, type CsvDialect } from '../core/owner/csv.js';

/**
 * A2.4 (0172) — the owner's copy of their books, and its receipt. The file and the receipt are made in ONE
 * transaction: the receipt says exactly what the file holds (the last posting it covers, its entries and lines,
 * its SHA-256), and closing a workspace with books is refused until a receipt covers the last posting.
 */
export type BooksFile = { readonly csv: string; readonly entries: number; readonly lines: number; readonly sha256: string };

export async function makeBooksFile(db: Db, businessIdRaw: string, actor: string, dialect: CsvDialect): Promise<BooksFile | null> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return null;
  return withTenantTx(db, bid.value, async (tx) => {
    const rows = (await sql<{
      journal_code: string; journal_name: string; number: number; entry_date: string; account_code: string; account_name: string;
      party_code: string | null; party_name: string | null; document_ref: string; document_date: string; label: string;
      debit: string; credit: string; book_debit: string; book_credit: string; posted_at: Date; currency: string; book: string; year_starts: string; year_ends: string; entry_id: string;
      covers: string; entry_custom: Record<string, string>; line_custom: Record<string, string>;
    }>`
      select j.code as journal_code, j.name as journal_name, e.number, e.entry_date::text, a.code as account_code,
             a.name as account_name, p.code as party_code, p.name as party_name, e.document_ref, e.document_date::text,
             coalesce(l.label, e.label) as label, l.debit::text, l.credit::text, l.book_debit::text, l.book_credit::text,
             e.posted_at, l.currency, books_currency(e.business_id) as book,
             f.starts_on::text as year_starts, f.ends_on::text as year_ends, e.id::text as entry_id,
             e.custom as entry_custom, l.custom as line_custom,
             -- The last posting the file holds, at the database's own precision (a JS Date stops at milliseconds).
             (max(e.posted_at) over ())::text as covers
        from journal_entries e
        join journal_lines l on l.entry_id = e.id
        join journals j on j.id = e.journal_id
        join accounts a on a.id = l.account_id
        join fiscal_years f on f.id = e.fiscal_year_id
        left join parties p on p.id = l.party_id
       where e.business_id = ${bid.value} and e.state = 'posted'
       order by f.starts_on, j.code, e.number, l.line_no`.execute(tx)).rows;
    const lines: BooksFileLine[] = rows.map((r) => ({
      journalCode: r.journal_code, journalName: r.journal_name, number: r.number, entryDate: r.entry_date,
      accountCode: r.account_code, accountName: r.account_name, partyCode: r.party_code, partyName: r.party_name,
      documentRef: r.document_ref, documentDate: r.document_date, label: r.label,
      bookDebit: r.book_debit, bookCredit: r.book_credit, postedAt: r.posted_at,
      foreign: r.currency === r.book ? null : { currency: r.currency, amount: r.debit !== '0.00' ? r.debit : r.credit },
      yearStarts: r.year_starts, yearEnds: r.year_ends, custom: { entry: r.entry_custom, line: r.line_custom },
    }));
    const csv = csvFile(BOOKS_FILE_HEADER, booksFileRows(lines), dialect);
    const sha256 = createHash('sha256').update(csv, 'utf8').digest('hex');
    const entries = new Set(rows.map((r) => r.entry_id)).size;
    const covers = rows[0]?.covers ?? null;
    await sql`insert into books_exports (business_id, made_by, kind, covers_through, entries, lines, sha256)
              values (${bid.value}, ${actor}, 'books_csv', ${covers}::timestamptz, ${entries}, ${rows.length}, ${sha256})`.execute(tx);
    return { csv, entries, lines: rows.length, sha256 };
  });
}

/** What the owner's data page says about their books: whether there are any, until when they are kept, the copy. */
export type BooksHolding = {
  readonly hasBooks: boolean;
  readonly keepUntil: Date | null;
  readonly law: string | null;
  readonly lastCopyAt: Date | null;
  /** Does the last copy include the last posting? Closing waits for it. */
  readonly copyCoversAll: boolean;
};

export async function booksHoldingTx(tx: Tx, businessId: string): Promise<BooksHolding> {
  const r = (await sql<{ has_books: boolean; keep_until: string | null; law: string | null; last_copy: Date | null; covers: boolean }>`
    select exists (select 1 from journal_entries where business_id = ${businessId}::uuid and state = 'posted') as has_books,
           books_keep_until(${businessId}::uuid)::text as keep_until,
           (select coalesce(r.law, d.law) from businesses b
              left join books_retention r on r.country = b.country
              cross join (select law from books_retention where country = '*') d
             where b.id = ${businessId}::uuid) as law,
           (select max(made_at) from books_exports where business_id = ${businessId}::uuid) as last_copy,
           books_export_covers(${businessId}::uuid) as covers`.execute(tx)).rows[0];
  return {
    // A calendar day: at noon UTC, so no time zone the page writes it in moves it to the day before or after.
    hasBooks: r?.has_books === true, keepUntil: r?.keep_until ? new Date(`${r.keep_until}T12:00:00Z`) : null, law: r?.has_books ? (r.law ?? null) : null,
    lastCopyAt: r?.last_copy ?? null, copyCoversAll: r?.covers === true,
  };
}
