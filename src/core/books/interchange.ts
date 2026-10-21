import { addDecimal, compareDecimal, roundDecimal, signOf, type Decimal } from '../types/decimal.js';
import { MINOR_UNITS, type Currency } from '../types/money.js';

/**
 * B1 (Phase 5, item 12) — THE BOOKS AS EVERY CONNECTOR SEES THEM. One shape for what goes in and out of Nomi's ledger
 * (A2): a connector maps its own system to this and back, and never touches a table. Nomi's books are the record
 * (decision 10); a spreadsheet, Google Sheets or Odoo is a way in and a copy out.
 *
 * Everything is addressed by the key a person would recognise — an account by its code, a party by its code, a tax
 * code by its code and the day it took effect, an entry by the key its source gives it — never by Nomi's ids, which
 * no other system knows. Amounts are exact decimals (A1). Pure: no I/O, no clock.
 */

export const ACCOUNT_KINDS = ['asset', 'liability', 'equity', 'income', 'expense', 'off_balance'] as const;
export const JOURNAL_KINDS = ['sales', 'purchases', 'bank', 'cash', 'general', 'closing'] as const;
export const PARTY_KINDS = ['customer', 'supplier', 'other'] as const;
export const TAX_KINDS = ['collected', 'deductible', 'exempt'] as const;

export type BooksAccount = {
  readonly code: string; readonly name: string; readonly kind: (typeof ACCOUNT_KINDS)[number]; readonly parent: string | null;
};
export type BooksJournal = { readonly code: string; readonly name: string; readonly kind: (typeof JOURNAL_KINDS)[number] };
export type BooksParty = {
  readonly code: string; readonly name: string; readonly kind: (typeof PARTY_KINDS)[number];
  readonly country: string | null; readonly ice: string | null; readonly taxNumber: string | null;
};
export type BooksTaxCode = {
  readonly code: string; readonly label: string; readonly rate: Decimal; readonly kind: (typeof TAX_KINDS)[number];
  readonly account: string | null; readonly validFrom: string; readonly validTo: string | null;
};
export type BooksLine = {
  readonly account: string; readonly party: string | null; readonly taxCode: string | null; readonly currency: string;
  readonly debit: Decimal | null; readonly credit: Decimal | null; readonly label: string | null;
};
export type BooksEntry = {
  /** The source's own name for it: Nomi's journal, year and number for a posted entry; the row's key in a workbook. */
  readonly key: string;
  readonly journal: string; readonly date: string; readonly label: string;
  readonly documentRef: string | null; readonly documentDate: string | null;
  /** What the SOURCE says it is. Nomi takes nothing in as posted: what is read in is a draft for the owner to post. */
  readonly state: 'draft' | 'posted';
  readonly lines: readonly BooksLine[];
};

export type BooksData = {
  readonly accounts: readonly BooksAccount[];
  readonly journals: readonly BooksJournal[];
  readonly parties: readonly BooksParty[];
  readonly taxCodes: readonly BooksTaxCode[];
  readonly entries: readonly BooksEntry[];
};

export const EMPTY_BOOKS: BooksData = { accounts: [], journals: [], parties: [], taxCodes: [], entries: [] };

export const RECORD_KINDS = ['account', 'journal', 'party', 'tax_code', 'entry'] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

/** One record of the books, as a connector's "changed since" and the read-in compare it: what, which, and its text. */
export type BooksRecord = { readonly kind: RecordKind; readonly key: string; readonly content: string };

/**
 * Where a source's data is wrong, said so a person can find it: the sheet (or the system's model), the row (1-based,
 * as the source numbers it; 0 for the whole sheet) and the column (its header), and why — a closed vocabulary the
 * page translates, never a vendor's own words.
 */
export const BOOKS_PROBLEMS = [
  'missing_sheet', 'missing_column', 'required', 'not_a_date', 'not_an_amount', 'ambiguous_amount', 'unknown_kind',
  'bad_code', 'duplicate', 'unknown_account', 'unknown_journal', 'unknown_party', 'unknown_tax_code',
  'one_side_only', 'negative', 'unbalanced', 'no_lines', 'unknown_currency', 'bad_ice', 'entry_fields_differ', 'too_many_decimals',
  // against what Nomi already holds (the read-in, B2/B5)
  'differs_from_nomi', 'posted_differs', 'no_fiscal_year', 'period_closed',
] as const;
export type BooksProblemReason = (typeof BOOKS_PROBLEMS)[number];
export type BooksProblem = { readonly sheet: string; readonly row: number; readonly column: string; readonly reason: BooksProblemReason };

/** A stable text of any plain value: object keys sorted, so two equal records always have equal text. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}

export const taxCodeKey = (t: Pick<BooksTaxCode, 'code' | 'validFrom'>): string => `${t.code}@${t.validFrom}`;

/** Every record, keyed, with its text: the unit "changed since" and the read-in work in. */
export function recordsOf(d: BooksData): BooksRecord[] {
  return [
    ...d.accounts.map((r) => ({ kind: 'account' as const, key: r.code, content: canonical(r) })),
    ...d.journals.map((r) => ({ kind: 'journal' as const, key: r.code, content: canonical(r) })),
    ...d.parties.map((r) => ({ kind: 'party' as const, key: r.code, content: canonical(r) })),
    ...d.taxCodes.map((r) => ({ kind: 'tax_code' as const, key: taxCodeKey(r), content: canonical(r) })),
    ...d.entries.map((r) => ({ kind: 'entry' as const, key: r.key, content: canonical(r) })),
  ];
}

/**
 * "CHANGED SINCE", for any source: the records whose text differs from what was last read of them (by digest), or
 * that were never read. A system with its own history (Odoo's write date) narrows what it hands in; one without (a
 * file) hands in everything, and this is what makes reading it again change nothing. The digest is injected: core
 * computes no hash of its own.
 */
export function changedRecords(
  records: readonly BooksRecord[], lastRead: ReadonlyMap<string, string>, digest: (content: string) => string,
): BooksRecord[] {
  return records.filter((r) => lastRead.get(`${r.kind}:${r.key}`) !== digest(r.content));
}

/**
 * What can be said of the books with nothing but the books: each line on one side and not below zero, each entry
 * with lines and balanced in each currency, every code it names present — in these books, or in `known` (what Nomi
 * already holds). Where it is, the caller says (`where` gives the sheet and row of a record).
 */
export function booksProblems(
  d: BooksData,
  known: {
    readonly accounts: ReadonlySet<string>; readonly journals: ReadonlySet<string>; readonly parties: ReadonlySet<string>;
    readonly taxCodes: ReadonlySet<string>;
    /** The currency the books are kept in (A3): with a foreign line beside it, it balances only after conversion. */
    readonly bookCurrency: string;
  },
  where: (kind: RecordKind, key: string, line?: number) => { readonly sheet: string; readonly row: number },
): BooksProblem[] {
  const out: BooksProblem[] = [];
  const at = (kind: RecordKind, key: string, column: string, reason: BooksProblemReason, line?: number) =>
    out.push({ ...where(kind, key, line), column, reason });
  const accounts = new Set([...known.accounts, ...d.accounts.map((a) => a.code)]);
  const journals = new Set([...known.journals, ...d.journals.map((j) => j.code)]);
  const parties = new Set([...known.parties, ...d.parties.map((p) => p.code)]);
  const taxCodes = new Set([...known.taxCodes, ...d.taxCodes.map((t) => t.code)]);
  for (const a of d.accounts) if (a.parent !== null && !accounts.has(a.parent)) at('account', a.code, 'Parent', 'unknown_account');
  for (const t of d.taxCodes) if (t.account !== null && !accounts.has(t.account)) at('tax_code', taxCodeKey(t), 'Account', 'unknown_account');
  for (const e of d.entries) {
    if (!journals.has(e.journal)) at('entry', e.key, 'Journal', 'unknown_journal');
    if (e.lines.length === 0) { at('entry', e.key, 'Entry', 'no_lines'); continue; }
    const totals = new Map<string, { debit: Decimal; credit: Decimal }>();
    e.lines.forEach((l, i) => {
      if (!accounts.has(l.account)) at('entry', e.key, 'Account', 'unknown_account', i);
      if (l.party !== null && !parties.has(l.party)) at('entry', e.key, 'Party', 'unknown_party', i);
      if (l.taxCode !== null && !taxCodes.has(l.taxCode)) at('entry', e.key, 'Tax code', 'unknown_tax_code', i);
      if ((l.debit === null) === (l.credit === null)) { at('entry', e.key, 'Debit', 'one_side_only', i); return; }
      const amount = (l.debit ?? l.credit)!;
      if (signOf(amount) < 0) { at('entry', e.key, l.debit !== null ? 'Debit' : 'Credit', 'negative', i); return; }
      // Never rounded on the way in: a figure with more decimals than its currency has (a formula's 33.3333…) is the
      // owner's to settle, not the ledger column's to round away.
      const places = MINOR_UNITS[l.currency as Currency];
      if (places !== undefined && roundDecimal(amount, places) !== amount) { at('entry', e.key, l.debit !== null ? 'Debit' : 'Credit', 'too_many_decimals', i); return; }
      const t = totals.get(l.currency) ?? { debit: '0' as Decimal, credit: '0' as Decimal };
      totals.set(l.currency, l.debit !== null ? { ...t, debit: addDecimal(t.debit, l.debit) } : { ...t, credit: addDecimal(t.credit, l.credit!) });
    });
    // Balanced in each FOREIGN currency on its own (A3). The books' own currency balances on its own only in an entry
    // with no foreign line; beside one, it holds the exchange difference and balances after conversion, which is the
    // database's to check at posting, with the owner's rates.
    const foreign = [...totals.keys()].some((c) => c !== known.bookCurrency);
    for (const [c, t] of totals) {
      if (c === known.bookCurrency && foreign) continue;
      if (compareDecimal(t.debit, t.credit) !== 0) { at('entry', e.key, 'Debit', 'unbalanced'); break; }
    }
  }
  return out;
}
