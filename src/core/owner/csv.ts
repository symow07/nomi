/**
 * CC-12 — her own data, in a file she can open.
 *
 * WHY THIS IS HAND-WRITTEN. CSV is four rules long (RFC 4180) and this file is
 * the whole of them; a dependency here would be a parser of nothing, pulled in
 * to avoid writing forty lines. The five-dependency discipline applies: it is
 * about frameworks, not about a first-party writer for a format this small.
 *
 * TWO THINGS A NAIVE WRITER GETS WRONG, and both of them bite HERE
 * specifically, because every cell in this export is text a BUYER typed:
 *
 *   A FORMULA. A spreadsheet reads a cell beginning with `=`, `+`, `-`, `@`,
 *   a tab or a carriage return as a formula, not as words. A buyer who writes
 *   `=HYPERLINK("http://…","click")` into WhatsApp has written a clickable
 *   link into the owner's Excel, and `=cmd|…` has been a remote-execution
 *   vector in Excel for years. So a cell that STARTS like a formula and is not
 *   a number is prefixed with an apostrophe — the spreadsheet convention for
 *   "this is text", which Excel, Numbers and LibreOffice all strip on display.
 *   A number is left alone, so `-5` stays −5 rather than becoming `'-5`.
 *
 *   A LANGUAGE. Two of this product's three languages are not Latin. Excel on
 *   Windows reads a UTF-8 file as the system code page unless it begins with a
 *   byte-order mark, so 你好 arrives as ä½ å¥½ and the export is useless to
 *   exactly the customer it was built for. `csvFile` writes the mark; `csvRows`
 *   does not, so the same writer serves a test that wants only the text.
 */

/** A cell, as this product has it: text, a number, or nothing at all. */
export type Cell = string | number | boolean | Date | null | undefined;

/**
 * Phase 9 (V1-383) — how the fields are parted and how a decimal is written.
 * RFC 4180's comma and point are the default. A spreadsheet set up where a
 * decimal is written with a comma (Spain, France) splits fields on ";" and
 * reads "1.0500" as ten thousand five hundred, so a file for an owner there is
 * written its way (the caller decides: `csvDialectFor` in values.ts).
 */
export type CsvDialect = { readonly sep: ',' | ';'; readonly decimal: '.' | ',' };
export const RFC4180: CsvDialect = { sep: ',', decimal: '.' };
/** A figure as this product writes one into a cell ("1.05", "-0.5"): the only text whose point is a decimal. */
const PLAIN_DECIMAL = /^[+-]?\d+\.\d+$/;

const STARTS_A_FORMULA = /^[=+\-@\t\r]/;
/** What a spreadsheet would read as a number anyway, so it needs no apostrophe. */
const IS_A_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * One cell, quoted only where it must be. `null` and `undefined` are the EMPTY
 * cell, never the word "null": a buyer with no name has no name, and a file
 * that says `null` teaches the owner to read it as a value.
 */
export function csvCell(v: Cell, d: CsvDialect = RFC4180): string {
  if (v === null || v === undefined) return '';
  // An instant is written as ISO-8601 in UTC: unambiguous, sortable as text,
  // and the one format every spreadsheet and every script agrees on. A local
  // rendering would need a zone this product does not ask her for.
  const raw = v instanceof Date ? v.toISOString() : String(v);
  const safe = STARTS_A_FORMULA.test(raw) && !IS_A_NUMBER.test(raw) ? `'${raw}` : raw;
  const local = d.decimal === ',' && (typeof v === 'number' || PLAIN_DECIMAL.test(safe)) ? safe.replace('.', ',') : safe;
  return (d.sep === ';' ? /[";\r\n]/ : /[",\r\n]/).test(local) ? `"${local.replace(/"/g, '""')}"` : local;
}

/** One row. */
export const csvRow = (cells: readonly Cell[], d: CsvDialect = RFC4180): string => cells.map((c) => csvCell(c, d)).join(d.sep);

/**
 * A header and its rows, CRLF-separated as the format says. No trailing
 * newline decision is left to the caller: a file that ends without one reads
 * as truncated to some tools, so it always ends with one.
 */
export function csvRows(header: readonly string[], rows: Iterable<readonly Cell[]>, d: CsvDialect = RFC4180): string {
  const out = [csvRow(header, d)];
  for (const r of rows) out.push(csvRow(r, d));
  return `${out.join('\r\n')}\r\n`;
}

/** The byte-order mark Excel needs to believe the file is UTF-8. */
export const CSV_BOM = '﻿';

/** The same, as a file: the mark, then the rows. */
export const csvFile = (header: readonly string[], rows: Iterable<readonly Cell[]>, d: CsvDialect = RFC4180): string =>
  CSV_BOM + csvRows(header, rows, d);

/**
 * A filename a browser and three operating systems will all accept, and that
 * says what is inside without naming the business — the header travels in
 * plain text through every proxy between here and her laptop.
 */
export const csvFilename = (subject: string, on: Date): string =>
  `nomi-${subject}-${on.toISOString().slice(0, 10)}.csv`;
