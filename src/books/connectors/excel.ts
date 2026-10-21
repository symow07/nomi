import { xlsxSheets, xlsxWrite, type XlsxCell, type XlsxSheet, type XlsxValue } from '../../net/xlsx.js';
import { parseDecimal, roundDecimal, type Decimal } from '../../core/types/decimal.js';
import { CURRENCIES } from '../../core/types/money.js';
import { readTypedAmount } from '../../core/commerce/amount.js';
import {
  ACCOUNT_KINDS, EMPTY_BOOKS, FIELD_APPLIES, FIELD_KINDS, JOURNAL_KINDS, PARTY_KINDS, TAX_KINDS, booksProblems, fieldKey, taxCodeKey,
  type BooksData, type BooksEntry, type BooksField, type BooksLine, type BooksProblem, type BooksProblemReason, type CustomValues, type RecordKind,
} from '../../core/books/interchange.js';
import { refused, type BooksConnector, type Grant, type Located } from '../../core/books/connector.js';

/**
 * B2 (Phase 5, §5 option A) — THE NOMI WORKBOOK, BY FILE. The first connector, because it has no outside party at all:
 * the plug-in shape (B1) is proven on what we fully control before it meets Odoo's sign-in, plans and expiring keys.
 *
 * One fixed workbook, versioned: a "Nomi" sheet that says what it is, then Accounts, Journals, Parties, Tax codes and
 * Journal (one row per LINE; the lines of an entry share its Entry key). Columns are found by their header, so their
 * order may move; every header must be there. Codes are text ("0012" stays "0012"); a figure is read from a number
 * cell exactly, or from text only when it has one reading (A1: "1.250" is refused, never guessed); a date is an Excel
 * date or YYYY-MM-DD, never "01/04/2026", which is two different days.
 *
 * A spreadsheet cannot keep double entry, locks or numbering, so it is never the record (decision 10): what is read
 * from it goes into Nomi's ledger, where the database keeps the rules, and what is posted goes out to it as a copy.
 */

export const WORKBOOK_VERSION = '1';
const MARK = 'Nomi workbook';
export const SHEETS = {
  about: 'Nomi', accounts: 'Accounts', journals: 'Journals', parties: 'Parties', taxCodes: 'Tax codes', journal: 'Journal',
} as const;
const HEADERS = {
  accounts: ['Code', 'Name', 'Kind', 'Parent'],
  journals: ['Code', 'Name', 'Kind'],
  parties: ['Code', 'Name', 'Kind', 'Country', 'ICE', 'Tax number'],
  taxCodes: ['Code', 'Label', 'Rate', 'Kind', 'Account', 'Valid from', 'Valid to'],
  journal: ['Entry', 'Journal', 'Date', 'Label', 'Document', 'Document date', 'State', 'Account', 'Party', 'Tax code',
    'Currency', 'Debit', 'Credit', 'Line label'],
} as const;
type Tab = keyof typeof HEADERS;
/**
 * D7 — the custom fields, on the "Nomi" sheet below this header row (a tab of their own would be a sheet older
 * workbooks lack, and Google Sheets refuses to read a tab that is not there). Their values are columns named by the
 * field: "party.segment" on Parties, "entry.project" and "line.weight_kg" on Journal — an entry's on each of its lines,
 * the same on every one, as an entry's other columns are.
 */
const FIELD_HEADERS = ['Applies to', 'Key', 'Label', 'Kind', 'Choices', 'Required', 'In use'] as const;
const FIELDS_TITLE = 'Custom fields';

const CODE = /^[0-9A-Za-z][0-9A-Za-z.\-]{0,19}$/;
const JOURNAL_CODE = /^[A-Z0-9]{1,8}$/;
const TAX_CODE = /^[A-Z0-9_-]{1,12}$/;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** An Excel date serial into YYYY-MM-DD (the 1900 system counts from 1899-12-30, the 1904 one from 1904-01-01). */
function dayOfSerial(serial: string, date1904: boolean): string | null {
  if (!/^\d{1,6}$/.test(serial)) return null;
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(base + Number(serial) * 86_400_000).toISOString().slice(0, 10);
}
const realDay = (s: string): boolean => {
  const m = ISO_DAY.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === s;
};

export type ExcelSource = { readonly bytes: Buffer };

/**
 * A number cell, at the precision the spreadsheet itself has. Excel keeps a number as a binary double and writes it
 * back with up to 17 digits: 33.34, typed by a person, is saved as "33.340000000000003" (found by saving the workbook
 * in Excel, 2026-10-22). Excel shows and computes to 15 significant digits, so that is what a number cell says: the
 * text is rounded there, as text — no float ever holds the amount. An exponent ("1.2E-5") is written out first.
 */
export function excelNumber(raw: string): Decimal | null {
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d{1,3}))?$/.exec(raw);
  if (!m) return null;
  const [, sign, int, frac = '', exp = '0'] = m;
  const digits = `${int}${frac}`;
  const point = int!.length + Number(exp);
  const whole = point <= 0 ? `0.${'0'.repeat(-point)}${digits}` : point >= digits.length
    ? `${digits}${'0'.repeat(point - digits.length)}` : `${digits.slice(0, point)}.${digits.slice(point)}`;
  const d = parseDecimal(`${sign}${whole}`);
  if (d === null) return null;
  const [i, f = ''] = d.replace('-', '').split('.');
  const lead = i !== '0' ? i!.length : -(f.length - f.replace(/^0+/, '').length);
  return roundDecimal(d, Math.max(0, 15 - lead));
}

/** The "Nomi" sheet's first row says it is the Nomi workbook, of a version this reads. */
function isNomiWorkbook(book: { readonly sheets: readonly XlsxSheet[] } | null): boolean {
  const about = book?.sheets.find((s) => s.name === SHEETS.about);
  if (!about) return false;
  const first = about.rows.get(Math.min(...about.rows.keys()));
  return first?.[0]?.text === MARK && first?.[1]?.text === WORKBOOK_VERSION;
}

/** The workbook as this file reads it, every problem named by sheet, row and column. */
export function workbookToBooks(raw: Buffer, bookCurrency: string): { data: BooksData; problems: BooksProblem[]; where: Located } {
  return sheetsToBooks(xlsxSheets(raw), bookCurrency);
}

/**
 * The Nomi workbook's sheets, wherever they came from — an .xlsx file (B2), or Google Sheets' values (B3): the same
 * sheets, the same columns, the same reading, so a spreadsheet is read one way whichever road it arrived by.
 */
export function sheetsToBooks(
  book: { readonly sheets: readonly XlsxSheet[]; readonly date1904: boolean } | null, bookCurrency: string,
): { data: BooksData; problems: BooksProblem[]; where: Located } {
  const problems: BooksProblem[] = [];
  const empty = EMPTY_BOOKS;
  const nowhere: Located = () => ({ sheet: '', row: 0 });
  if (!book) return { data: empty, problems: [{ sheet: '', row: 0, column: '', reason: 'missing_sheet' }], where: nowhere };
  const where = new Map<string, { sheet: string; row: number }>();

  /** Each tab's rows below its header, as header → cell, with the row's own number. */
  const headsOf = new Map<Tab, string[]>();
  const rowsOf = (tab: Tab): { n: number; get: (h: string) => XlsxCell }[] => {
    const name = SHEETS[tab];
    const sheet: XlsxSheet | undefined = book.sheets.find((s) => s.name === name);
    if (!sheet) { problems.push({ sheet: name, row: 0, column: '', reason: 'missing_sheet' }); return []; }
    const numbers = [...sheet.rows.keys()].sort((a, b) => a - b);
    if (numbers.length === 0) { problems.push({ sheet: name, row: 1, column: HEADERS[tab][0]!, reason: 'missing_column' }); return []; }
    const head = numbers[0]!;
    const index = new Map(sheet.rows.get(head)!.map((c, i) => [c.text, i] as const));
    headsOf.set(tab, [...index.keys()]);
    let complete = true;
    for (const h of HEADERS[tab]) if (!index.has(h)) { problems.push({ sheet: name, row: head, column: h, reason: 'missing_column' }); complete = false; }
    if (!complete) return [];
    const blank: XlsxCell = { text: '', number: false };
    return numbers.slice(1).map((n) => {
      const cells = sheet.rows.get(n)!;
      return { n, get: (h: string) => cells[index.get(h)!] ?? blank };
    });
  };
  const at = (tab: Tab, row: number, column: string, reason: BooksProblemReason) => problems.push({ sheet: SHEETS[tab], row, column, reason });
  const text = (c: XlsxCell): string | null => (c.text === '' ? null : c.text);
  const need = (tab: Tab, n: number, h: string, c: XlsxCell): string | null => {
    const v = text(c);
    if (v === null) at(tab, n, h, 'required');
    return v;
  };
  const day = (tab: Tab, n: number, h: string, c: XlsxCell, required: boolean): string | null => {
    if (c.text === '') { if (required) at(tab, n, h, 'required'); return null; }
    const d = c.number ? dayOfSerial(c.text, book.date1904) : realDay(c.text) ? c.text : null;
    if (d === null) at(tab, n, h, 'not_a_date');
    return d;
  };
  const amount = (tab: Tab, n: number, h: string, c: XlsxCell): Decimal | null => {
    if (c.text === '') return null;
    if (c.number) { const d = excelNumber(c.text); if (d === null) at(tab, n, h, 'not_an_amount'); return d; }
    const neg = c.text.startsWith('-');
    const r = readTypedAmount(neg ? c.text.slice(1) : c.text);
    if (r === 'ambiguous') { at(tab, n, h, 'ambiguous_amount'); return null; }
    if (r === null) { at(tab, n, h, 'not_an_amount'); return null; }
    return neg ? (`-${r}` as Decimal) : r;
  };
  const kind = <K extends string>(tab: Tab, n: number, h: string, c: XlsxCell, kinds: readonly K[]): K | null => {
    const v = need(tab, n, h, c);
    if (v === null) return null;
    if (!(kinds as readonly string[]).includes(v)) { at(tab, n, h, 'unknown_kind'); return null; }
    return v as K;
  };
  const code = (tab: Tab, n: number, h: string, c: XlsxCell, shape: RegExp, required = true): string | null => {
    const v = required ? need(tab, n, h, c) : text(c);
    if (v !== null && !shape.test(v)) { at(tab, n, h, 'bad_code'); return null; }
    return v;
  };
  const seen = (kindOf: RecordKind, key: string, tab: Tab, n: number, column: string): boolean => {
    const k = `${kindOf}:${key}`;
    if (where.has(k)) { at(tab, n, column, 'duplicate'); return true; }
    where.set(k, { sheet: SHEETS[tab], row: n });
    return false;
  };

  if (!isNomiWorkbook(book)) return { data: empty, problems: [{ sheet: SHEETS.about, row: 1, column: 'A', reason: 'missing_sheet' }], where: nowhere };

  // D7 — the custom fields, below their header row on the "Nomi" sheet (none: a workbook from before D7).
  const fields: BooksField[] = [];
  const about = book.sheets.find((s) => s.name === SHEETS.about)!;
  const aboutRows = [...about.rows.keys()].sort((a, b) => a - b);
  const fieldHead = aboutRows.find((n) => FIELD_HEADERS.every((h, i) => about.rows.get(n)![i]?.text === h));
  for (const n of fieldHead === undefined ? [] : aboutRows.filter((x) => x > fieldHead)) {
    const cells = about.rows.get(n)!;
    const cell = (i: number) => cells[i]?.text ?? '';
    if (cells.every((c) => c.text === '')) continue;
    const appliesTo = cell(0) as BooksField['appliesTo'];
    const k = cell(3) as BooksField['kind'];
    const where1 = { sheet: SHEETS.about, row: n };
    if (!(FIELD_APPLIES as readonly string[]).includes(appliesTo)) { problems.push({ ...where1, column: 'Applies to', reason: 'unknown_kind' }); continue; }
    if (!(FIELD_KINDS as readonly string[]).includes(k)) { problems.push({ ...where1, column: 'Kind', reason: 'unknown_kind' }); continue; }
    const required = cell(5) === 'yes' ? true : cell(5) === '' || cell(5) === 'no' ? false : null;
    if (required === null) { problems.push({ ...where1, column: 'Required', reason: 'unknown_kind' }); continue; }
    const inUse = cell(6) === '' || cell(6) === 'yes' ? true : cell(6) === 'no' ? false : null;
    if (inUse === null) { problems.push({ ...where1, column: 'In use', reason: 'unknown_kind' }); continue; }
    const f: BooksField = { appliesTo, key: cell(1), label: cell(2), kind: k,
      choices: cell(4) === '' ? null : cell(4).split('|').map((c) => c.trim()), required, ...(inUse ? {} : { retired: true as const }) };
    if (where.has(`field:${fieldKey(f)}`)) { problems.push({ ...where1, column: 'Key', reason: 'duplicate' }); continue; }
    where.set(`field:${fieldKey(f)}`, where1);
    fields.push(f);
  }
  const fieldBy = new Map(fields.map((f) => [fieldKey(f), f]));
  /** A row's custom values: each column named "<applies>.<key>", read for its field's kind (a date may be an Excel date). */
  const customOf = (tab: Tab, n: number, applies: BooksField['appliesTo'], heads: readonly string[], get: (h: string) => XlsxCell): CustomValues | undefined => {
    const out: Record<string, string> = {};
    for (const h of heads.filter((x) => x.startsWith(`${applies}.`))) {
      const c = get(h);
      if (c.text === '') continue;
      const f = fieldBy.get(h);
      const v = !c.number ? c.text : f?.kind === 'date' ? dayOfSerial(c.text, book.date1904) : excelNumber(c.text);
      if (v === null) { at(tab, n, h, f?.kind === 'date' ? 'not_a_date' : 'not_an_amount'); continue; }
      out[h.slice(applies.length + 1)] = v;
    }
    return Object.keys(out).length > 0 ? Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b))) : undefined;
  };

  const accounts: BooksData['accounts'][number][] = [];
  for (const r of rowsOf('accounts')) {
    const c = code('accounts', r.n, 'Code', r.get('Code'), CODE);
    const name = need('accounts', r.n, 'Name', r.get('Name'));
    const k = kind('accounts', r.n, 'Kind', r.get('Kind'), ACCOUNT_KINDS);
    const parent = code('accounts', r.n, 'Parent', r.get('Parent'), CODE, false);
    if (c && name && k && !seen('account', c, 'accounts', r.n, 'Code')) accounts.push({ code: c, name, kind: k, parent });
  }
  const journals: BooksData['journals'][number][] = [];
  for (const r of rowsOf('journals')) {
    const c = code('journals', r.n, 'Code', r.get('Code'), JOURNAL_CODE);
    const name = need('journals', r.n, 'Name', r.get('Name'));
    const k = kind('journals', r.n, 'Kind', r.get('Kind'), JOURNAL_KINDS);
    if (c && name && k && !seen('journal', c, 'journals', r.n, 'Code')) journals.push({ code: c, name, kind: k });
  }
  const parties: BooksData['parties'][number][] = [];
  for (const r of rowsOf('parties')) {
    const c = code('parties', r.n, 'Code', r.get('Code'), CODE);
    const name = need('parties', r.n, 'Name', r.get('Name'));
    const k = kind('parties', r.n, 'Kind', r.get('Kind'), PARTY_KINDS);
    const country = text(r.get('Country'));
    const ice = text(r.get('ICE'));
    if (ice !== null && !/^[0-9]{15}$/.test(ice)) at('parties', r.n, 'ICE', 'bad_ice');
    const taxNumber = text(r.get('Tax number'));
    const custom = customOf('parties', r.n, 'party', headsOf.get('parties') ?? [], r.get);
    if (c && name && k && !seen('party', c, 'parties', r.n, 'Code') && (ice === null || /^[0-9]{15}$/.test(ice))) {
      parties.push({ code: c, name, kind: k, country, ice, taxNumber, ...(custom ? { custom } : {}) });
    }
  }
  const taxCodes: BooksData['taxCodes'][number][] = [];
  for (const r of rowsOf('taxCodes')) {
    const c = code('taxCodes', r.n, 'Code', r.get('Code'), TAX_CODE);
    const label = need('taxCodes', r.n, 'Label', r.get('Label'));
    const rateCell = r.get('Rate');
    const rate = rateCell.text === '' ? (at('taxCodes', r.n, 'Rate', 'required'), null) : amount('taxCodes', r.n, 'Rate', rateCell);
    const k = kind('taxCodes', r.n, 'Kind', r.get('Kind'), TAX_KINDS);
    const account = code('taxCodes', r.n, 'Account', r.get('Account'), CODE, false);
    const validFrom = day('taxCodes', r.n, 'Valid from', r.get('Valid from'), true);
    const validTo = day('taxCodes', r.n, 'Valid to', r.get('Valid to'), false);
    if (c && label && rate !== null && k && validFrom && !seen('tax_code', taxCodeKey({ code: c, validFrom }), 'taxCodes', r.n, 'Code')) {
      taxCodes.push({ code: c, label, rate, kind: k, account, validFrom, validTo });
    }
  }

  // The journal: rows grouped by their Entry key, in the order the keys first appear.
  type Building = { entry: Omit<BooksEntry, 'lines'>; lines: BooksLine[]; rows: number[]; broken: boolean };
  const building = new Map<string, Building>();
  const journalHeads = () => headsOf.get('journal') ?? [];
  for (const r of rowsOf('journal')) {
    const key = need('journal', r.n, 'Entry', r.get('Entry'));
    if (key === null) continue;
    const entryCustom = customOf('journal', r.n, 'entry', journalHeads(), r.get);
    const head = {
      journal: text(r.get('Journal')), date: r.get('Date'), label: text(r.get('Label')), documentRef: text(r.get('Document')),
      documentDate: r.get('Document date'), state: text(r.get('State')),
    };
    let b = building.get(key);
    if (!b) {
      const journal = code('journal', r.n, 'Journal', r.get('Journal'), JOURNAL_CODE);
      const date = day('journal', r.n, 'Date', head.date, true);
      const label = need('journal', r.n, 'Label', r.get('Label'));
      const documentDate = day('journal', r.n, 'Document date', head.documentDate, false);
      const state = head.state === null || head.state === 'draft' ? 'draft' : head.state === 'posted' ? 'posted' : null;
      if (state === null) at('journal', r.n, 'State', 'unknown_kind');
      b = { entry: { key, journal: journal ?? '', date: date ?? '', label: label ?? '', documentRef: head.documentRef, documentDate, state: state ?? 'draft',
        ...(entryCustom ? { custom: entryCustom } : {}) },
        lines: [], rows: [], broken: !journal || !date || !label || state === null };
      building.set(key, b);
      where.set(`entry:${key}`, { sheet: SHEETS.journal, row: r.n });
    } else {
      // a later line of the same entry may leave the entry's columns empty, or repeat them — never contradict them
      const differs = (h: string, v: string | null, was: string | null) => { if (v !== null && v !== was) { at('journal', r.n, h, 'entry_fields_differ'); b!.broken = true; } };
      differs('Journal', head.journal, b.entry.journal);
      differs('Label', head.label, b.entry.label);
      differs('Document', head.documentRef, b.entry.documentRef);
      differs('State', head.state, b.entry.state);
      if (head.date.text !== '') differs('Date', day('journal', r.n, 'Date', head.date, false), b.entry.date);
      if (head.documentDate.text !== '') differs('Document date', day('journal', r.n, 'Document date', head.documentDate, false), b.entry.documentDate);
      for (const [k, v] of Object.entries(entryCustom ?? {})) differs(`entry.${k}`, v, b.entry.custom?.[k] ?? null);
    }
    const account = code('journal', r.n, 'Account', r.get('Account'), CODE);
    const party = code('journal', r.n, 'Party', r.get('Party'), CODE, false);
    const taxCode = code('journal', r.n, 'Tax code', r.get('Tax code'), TAX_CODE, false);
    const currency = need('journal', r.n, 'Currency', r.get('Currency'));
    if (currency !== null && !(CURRENCIES as readonly string[]).includes(currency)) at('journal', r.n, 'Currency', 'unknown_currency');
    const debit = amount('journal', r.n, 'Debit', r.get('Debit'));
    const credit = amount('journal', r.n, 'Credit', r.get('Credit'));
    const ok = account !== null && currency !== null && (CURRENCIES as readonly string[]).includes(currency);
    if (!ok) b.broken = true;
    const lineCustom = customOf('journal', r.n, 'line', journalHeads(), r.get);
    b.lines.push({ account: account ?? '', party, taxCode, currency: currency ?? '', debit, credit, label: text(r.get('Line label')), ...(lineCustom ? { custom: lineCustom } : {}) });
    b.rows.push(r.n);
  }
  const entries: BooksEntry[] = [];
  const lineRows = new Map<string, number[]>();
  for (const [key, b] of building) {
    if (b.broken) continue;
    entries.push({ ...b.entry, lines: b.lines });
    lineRows.set(key, b.rows);
  }

  const data: BooksData = { accounts, journals, parties, taxCodes, entries, ...(fields.length > 0 ? { fields } : {}) };
  const located: Located = (kindOf, key, line) => {
    if (kindOf === 'entry' && line !== undefined) return { sheet: SHEETS.journal, row: lineRows.get(key)?.[line] ?? 0 };
    return where.get(`${kindOf}:${key}`) ?? { sheet: '', row: 0 };
  };
  // What the workbook alone can say; what it names that Nomi already holds (a custom field too) is the read-in's to check.
  const none = new Set<string>();
  problems.push(...booksProblems(data, { accounts: none, journals: none, parties: none, taxCodes: none, bookCurrency }, located)
    .filter((p) => !['unknown_account', 'unknown_journal', 'unknown_party', 'unknown_tax_code', 'unknown_field'].includes(p.reason)));
  return { data, problems, where: located };
}

/** The books as the Nomi workbook: what an owner downloads, and what reading it back gives again, exactly. */
export function booksToWorkbook(d: BooksData): Buffer {
  return xlsxWrite(workbookSheets(d));
}

/** The workbook's sheets and rows for these books: written to a file (B2), or to Google Sheets (B3). */
export function workbookSheets(d: BooksData): { readonly name: string; readonly rows: readonly (readonly XlsxValue[])[] }[] {
  const n = (v: Decimal | null): XlsxValue => (v === null ? null : { number: v });
  // D7 — a column per custom field (and per value written under a field no longer defined, so nothing is lost).
  const fields = d.fields ?? [];
  const columns = (applies: BooksField['appliesTo'], values: readonly (CustomValues | undefined)[]) => [...new Set([
    ...fields.filter((f) => f.appliesTo === applies).map((f) => f.key), ...values.flatMap((v) => Object.keys(v ?? {})),
  ])].sort();
  const partyCols = columns('party', d.parties.map((p) => p.custom));
  const entryCols = columns('entry', d.entries.map((e) => e.custom));
  const lineCols = columns('line', d.entries.flatMap((e) => e.lines.map((l) => l.custom)));
  const values = (cols: readonly string[], v: CustomValues | undefined): XlsxValue[] => cols.map((k) => v?.[k] ?? null);
  return [
    { name: SHEETS.about, rows: [[MARK, WORKBOOK_VERSION],
      ['One row per line. The lines of an entry share its Entry key. Amounts as numbers; dates as YYYY-MM-DD.'],
      ...(fields.length === 0 ? [] : [[], [FIELDS_TITLE], [...FIELD_HEADERS],
        ...fields.map((f) => [f.appliesTo, f.key, f.label, f.kind, f.choices === null ? null : f.choices.join(' | '), f.required ? 'yes' : 'no', f.retired ? 'no' : 'yes'])])] },
    { name: SHEETS.accounts, rows: [[...HEADERS.accounts], ...d.accounts.map((a) => [a.code, a.name, a.kind, a.parent])] },
    { name: SHEETS.journals, rows: [[...HEADERS.journals], ...d.journals.map((j) => [j.code, j.name, j.kind])] },
    { name: SHEETS.parties, rows: [[...HEADERS.parties, ...partyCols.map((k) => `party.${k}`)],
      ...d.parties.map((p) => [p.code, p.name, p.kind, p.country, p.ice, p.taxNumber, ...values(partyCols, p.custom)])] },
    { name: SHEETS.taxCodes, rows: [[...HEADERS.taxCodes], ...d.taxCodes.map((t) => [t.code, t.label, n(t.rate), t.kind, t.account, t.validFrom, t.validTo])] },
    { name: SHEETS.journal, rows: [[...HEADERS.journal, ...entryCols.map((k) => `entry.${k}`), ...lineCols.map((k) => `line.${k}`)],
      ...d.entries.flatMap((e) => e.lines.map((l) => [
        e.key, e.journal, e.date, e.label, e.documentRef, e.documentDate, e.state, l.account, l.party, l.taxCode, l.currency, n(l.debit), n(l.credit), l.label,
        ...values(entryCols, e.custom), ...values(lineCols, l.custom),
      ]))] },
  ];
}

/** Does this read as the Nomi workbook, of a version this reads? For a source other than a file (B3). */
export const isTheNomiWorkbook = (sheets: readonly XlsxSheet[]): boolean => isNomiWorkbook({ sheets });

/**
 * The connector (B1's shape): nothing to sign in to — the owner's file IS the source. Connecting opens it and refuses
 * anything that is not the Nomi workbook; there is no grant to refresh or revoke; and a file has no history, so
 * "changed since" hands in all of it, and the read-in (B5) decides what is new record by record.
 */
export function excelConnector(bookCurrency: string): BooksConnector<ExcelSource, Buffer> {
  return {
    config: { system: 'excel', fields: [{ name: 'workbook', kind: 'file', required: true }], signIn: 'none' },
    async connect(values) {
      const v = values['workbook'];
      if (!(v instanceof Uint8Array) || v.length === 0) return refused('not_a_nomi_workbook');
      const bytes = Buffer.from(v);
      if (!isNomiWorkbook(xlsxSheets(bytes))) return refused('not_a_nomi_workbook');
      return { kind: 'connected', source: { bytes }, grant: null };
    },
    async refresh(grant: Grant) { return grant; },
    async revoke() { /* nothing is held */ },
    toBooks: (raw) => workbookToBooks(raw, bookCurrency),
    fromBooks: booksToWorkbook,
    async changedSince(source) {
      const { data, problems, where } = workbookToBooks(source.bytes, bookCurrency);
      return { kind: 'read', data, problems, cursor: null, where };
    },
  };
}
