import type { Cell } from '../owner/csv.js';

/**
 * A2.4 (Phase 5) — THE OWNER'S COPY OF THEIR BOOKS: every posted entry, every line, nothing left out.
 *
 * It exists for one rule (the owner, 2026-10-22): a workspace that closes keeps its books with us until the legal
 * date, so its owner must leave with them first — never their statutory record held where they can no longer sign
 * in. Closing is refused until a copy covering the last posting has been downloaded (0172).
 *
 * The columns are the 18 of CNC Avis n° 24 (art. 2), under its own names, plus the fiscal year (a journal numbers
 * per year, so the number alone repeats from one year to the next). This is NOT yet the Moroccan FEC: its file
 * name, separator and encoding are not published (PHASE-5.md D4), and D4 makes that file. Until then, this is the
 * whole record, in a file any spreadsheet opens.
 *
 * Amounts are the exact text the database holds, two places ("1200.50", "0.00"), written as stored and never
 * re-formed; a line's currency is `Id_devise`. `Montant_Devise` — the amount in a currency other than the books'
 * own — is A3's, and empty until then. No row is ever cut off:
 * a statutory copy that stopped at a row limit would be a lie about the record.
 *
 * Pure: the caller reads the rows and writes the file.
 */
export const BOOKS_FILE_HEADER = [
  'Code_Journal', 'Libelle_Journal', 'Num_Ecriture', 'Date_Ecriture', 'Num_Compte', 'Libelle_Compte',
  'Num_Compte_Aux', 'Libelle_Compte_Aux', 'Ref_Piece', 'Date_Piece', 'Libelle_Ecriture', 'Montant_Debit',
  'Montant_Credit', 'Lettrage_Ecriture', 'Date_Lettrage', 'Date_Validation', 'Montant_Devise', 'Id_devise',
  'Exercice',
] as const;

/** One posted line, with what the file says about its entry, its journal, its account and its party. */
export type BooksFileLine = {
  readonly journalCode: string;
  readonly journalName: string;
  readonly number: number;
  /** The entry's date, the document's date and the fiscal year's bounds, as `YYYY-MM-DD`. */
  readonly entryDate: string;
  readonly accountCode: string;
  readonly accountName: string;
  readonly partyCode: string | null;
  readonly partyName: string | null;
  readonly documentRef: string;
  readonly documentDate: string;
  /** The line's own label, or the entry's. */
  readonly label: string;
  /** As stored: `numeric(18,2)`'s own text. */
  readonly debit: string;
  readonly credit: string;
  readonly postedAt: Date;
  readonly currency: string;
  readonly yearStarts: string;
  readonly yearEnds: string;
};

/** The file's rows, in the order the records were kept: fiscal year, journal, number, line. */
export function booksFileRows(lines: readonly BooksFileLine[]): (readonly Cell[])[] {
  return lines.map((l) => [
    l.journalCode, l.journalName, l.number, l.entryDate, l.accountCode, l.accountName,
    l.partyCode, l.partyName, l.documentRef, l.documentDate, l.label, l.debit,
    l.credit, null, null, l.postedAt.toISOString().slice(0, 10), null, l.currency,
    `${l.yearStarts}/${l.yearEnds}`,
  ]);
}
