import { parseDecimal, signOf, type Decimal } from '../types/decimal.js';
import { readTypedAmount } from '../commerce/amount.js';
import { CURRENCIES } from '../types/money.js';

/**
 * C3 (Phase 5, item 4; decision 8) — A BANK STATEMENT, READ FROM ITS FILE: CSV, OFX or CAMT.053. No bank connection
 * (§9): the owner downloads the statement from the bank and gives it here. Each line is what the bank said — the day
 * it booked, the amount (money in above zero, money out below), the currency, the wording, and the bank's own
 * reference where the file carries one. Pure: the reading only.
 *
 *   CSV       the Nomi layout: a header row naming Date, Amount (or Debit and Credit), Currency, Description and
 *             Reference, in any order, comma or semicolon; dates YYYY-MM-DD; a figure read as A1 reads a typed one
 *             (one reading, or refused — "1.250" is never guessed).
 *   OFX       1.x (SGML) and 2.x (XML): each STMTTRN's DTPOSTED, TRNAMT, FITID, NAME and MEMO; CURDEF for the currency.
 *   CAMT.053  ISO 20022: each booked Ntry's Amt and Ccy, CdtDbtInd, BookgDt, AcctSvcrRef, and its wording.
 *   OFX and CAMT write machine numbers (a dot, no thousands): read exactly, never through a float.
 *
 * Each line's FINGERPRINT is the bank's reference where there is one; else its day, amount and wording, and how
 * many identical lines came before it in the same file — two equal coffees on one day are two lines; the same
 * statement read twice adds none.
 */
export type StatementFormat = 'csv' | 'ofx' | 'camt053';
export type StatementLine = {
  readonly bookedOn: string; readonly amount: Decimal; readonly currency: string;
  readonly wording: string | null; readonly reference: string | null; readonly fingerprint: string;
};
export type StatementProblem = { readonly line: number; readonly reason: 'not_a_date' | 'not_an_amount' | 'ambiguous_amount' | 'unknown_currency' | 'missing_column' | 'zero' };
export type StatementRead =
  | { readonly kind: 'read'; readonly format: StatementFormat; readonly lines: readonly StatementLine[]; readonly problems: readonly StatementProblem[] }
  | { readonly kind: 'unreadable' };

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const realDay = (s: string): boolean => {
  const m = ISO.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  const days = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]!;
  return d <= days;
};
const known = (c: string) => (CURRENCIES as readonly string[]).includes(c);
const neg = (d: Decimal): Decimal => (d.startsWith('-') ? (d.slice(1) as Decimal) : (`-${d}` as Decimal));
const clean = (s: string | null | undefined): string | null => { const x = (s ?? '').replace(/\s+/g, ' ').trim(); return x ? x.slice(0, 300) : null; };

/** What kind of file this is, from its first bytes. */
export function statementFormatOf(text: string): StatementFormat | null {
  const head = text.slice(0, 2000);
  if (/OFXHEADER|<OFX>/i.test(head)) return 'ofx';
  if (/urn:iso:std:iso:20022:tech:xsd:camt\.053/.test(head) || /<BkToCstmrStmt>/.test(text.slice(0, 20000))) return 'camt053';
  if (/^﻿?[^\n]*(date|amount)/i.test(head)) return 'csv';
  return null;
}

/** The fingerprints, counting identical lines without a reference in the order they came. */
function fingerprinted(format: StatementFormat, raw: readonly Omit<StatementLine, 'fingerprint'>[]): StatementLine[] {
  const seen = new Map<string, number>();
  return raw.map((l) => {
    if (l.reference) return { ...l, fingerprint: `${format}:${l.reference}`.slice(0, 200) };
    const base = `${l.bookedOn}|${l.amount}|${l.currency}|${(l.wording ?? '').slice(0, 120)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...l, fingerprint: `${base}|#${n}`.slice(0, 200) };
  });
}

function splitCsv(line: string, sep: string): string[] {
  const out: string[] = []; let cur = ''; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') quoted = false; else cur += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function readCsv(text: string, fallbackCurrency: string): StatementRead {
  const rows = text.replace(/^﻿/, '').split(/\r?\n/).filter((r) => r.trim() !== '');
  if (rows.length === 0) return { kind: 'unreadable' };
  const sep = (rows[0]!.match(/;/g) ?? []).length > (rows[0]!.match(/,/g) ?? []).length ? ';' : ',';
  const head = splitCsv(rows[0]!, sep).map((h) => h.toLowerCase());
  const at = (name: string) => head.indexOf(name);
  const problems: StatementProblem[] = [];
  if (at('date') < 0 || (at('amount') < 0 && (at('debit') < 0 || at('credit') < 0))) {
    return { kind: 'read', format: 'csv', lines: [], problems: [{ line: 1, reason: 'missing_column' }] };
  }
  const figure = (raw: string, n: number): Decimal | null | 'bad' => {
    const x = raw.trim();
    if (!x) return null;
    const minus = x.startsWith('-') || (x.startsWith('(') && x.endsWith(')'));
    const body = x.replace(/^[-+(]|\)$/g, '').trim();
    const r = readTypedAmount(body);
    if (r === 'ambiguous') { problems.push({ line: n, reason: 'ambiguous_amount' }); return 'bad'; }
    if (r === null) { problems.push({ line: n, reason: 'not_an_amount' }); return 'bad'; }
    return minus ? neg(r) : r;
  };
  const lines: Omit<StatementLine, 'fingerprint'>[] = [];
  rows.slice(1).forEach((row, i) => {
    const n = i + 2;
    const c = splitCsv(row, sep);
    const get = (name: string) => (at(name) >= 0 ? c[at(name)] ?? '' : '');
    const day = get('date');
    if (!realDay(day)) { problems.push({ line: n, reason: 'not_a_date' }); return; }
    let amount: Decimal | null | 'bad';
    if (at('amount') >= 0) amount = figure(get('amount'), n);
    else {
      const debit = figure(get('debit'), n); const credit = figure(get('credit'), n);
      if (debit === 'bad' || credit === 'bad') return;
      // a bank's "debit" is money OUT of the account
      amount = debit !== null && signOf(debit) !== 0 ? neg(debit.replace(/^-/, '') as Decimal) : credit !== null ? (credit.replace(/^-/, '') as Decimal) : null;
    }
    if (amount === 'bad') return;
    if (amount === null || signOf(amount) === 0) { problems.push({ line: n, reason: 'zero' }); return; }
    const currency = (get('currency') || fallbackCurrency).toUpperCase();
    if (!known(currency)) { problems.push({ line: n, reason: 'unknown_currency' }); return; }
    lines.push({ bookedOn: day, amount, currency, wording: clean(get('description')), reference: clean(get('reference')) });
  });
  return { kind: 'read', format: 'csv', lines: fingerprinted('csv', lines), problems };
}

/** An OFX tag's value inside one block: `<TAG>value` up to the next tag (SGML leaves it unclosed). */
const ofxTag = (block: string, tag: string): string | null => {
  const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i').exec(block);
  return m ? m[1]!.trim() : null;
};

function readOfx(text: string): StatementRead {
  const currency = (ofxTag(text, 'CURDEF') ?? '').toUpperCase();
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  const problems: StatementProblem[] = [];
  const lines: Omit<StatementLine, 'fingerprint'>[] = [];
  blocks.forEach((b, i) => {
    const n = i + 1;
    const posted = ofxTag(b, 'DTPOSTED') ?? '';
    const day = /^\d{8}/.test(posted) ? `${posted.slice(0, 4)}-${posted.slice(4, 6)}-${posted.slice(6, 8)}` : '';
    if (!realDay(day)) { problems.push({ line: n, reason: 'not_a_date' }); return; }
    const amount = parseDecimal((ofxTag(b, 'TRNAMT') ?? '').replace(/^\+/, ''));
    if (amount === null) { problems.push({ line: n, reason: 'not_an_amount' }); return; }
    if (signOf(amount) === 0) { problems.push({ line: n, reason: 'zero' }); return; }
    const cur = (ofxTag(b, 'CURRENCY') ?? currency).toUpperCase();
    if (!known(cur)) { problems.push({ line: n, reason: 'unknown_currency' }); return; }
    const wording = [ofxTag(b, 'NAME'), ofxTag(b, 'MEMO')].filter(Boolean).join(' · ');
    lines.push({ bookedOn: day, amount, currency: cur, wording: clean(wording), reference: clean(ofxTag(b, 'FITID')) });
  });
  return { kind: 'read', format: 'ofx', lines: fingerprinted('ofx', lines), problems };
}

const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const xmlText = (block: string, tag: string): string | null => {
  const m = new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`).exec(block);
  return m ? unxml(m[1]!.replace(/<[^>]+>/g, ' ')).trim() : null;
};

function readCamt(text: string): StatementRead {
  const entries = [...text.matchAll(/<(?:\w+:)?Ntry>([\s\S]*?)<\/(?:\w+:)?Ntry>/g)].map((m) => m[1]!);
  const problems: StatementProblem[] = [];
  const lines: Omit<StatementLine, 'fingerprint'>[] = [];
  entries.forEach((e, i) => {
    const n = i + 1;
    const status = xmlText(e, 'Sts') ?? '';
    if (!/BOOK/.test(status)) return;                         // only what the bank booked; pending entries wait
    const amt = /<(?:\w+:)?Amt\s+Ccy="([A-Z]{3})"\s*>\s*([0-9.]+)\s*</.exec(e);
    if (!amt) { problems.push({ line: n, reason: 'not_an_amount' }); return; }
    const value = parseDecimal(amt[2]!);
    if (value === null) { problems.push({ line: n, reason: 'not_an_amount' }); return; }
    if (signOf(value) === 0) { problems.push({ line: n, reason: 'zero' }); return; }
    if (!known(amt[1]!)) { problems.push({ line: n, reason: 'unknown_currency' }); return; }
    const booking = xmlText(e, 'BookgDt') ?? '';
    const day = (/\d{4}-\d{2}-\d{2}/.exec(booking) ?? [''])[0];
    if (!realDay(day)) { problems.push({ line: n, reason: 'not_a_date' }); return; }
    const debit = (xmlText(e, 'CdtDbtInd') ?? '').startsWith('DBIT');
    const wording = xmlText(e, 'Ustrd') ?? xmlText(e, 'AddtlNtryInf') ?? xmlText(e, 'AddtlTxInf');
    lines.push({ bookedOn: day, amount: debit ? neg(value) : value, currency: amt[1]!, wording: clean(wording), reference: clean(xmlText(e, 'AcctSvcrRef')) });
  });
  return { kind: 'read', format: 'camt053', lines: fingerprinted('camt053', lines), problems };
}

export function readStatement(text: string, fallbackCurrency: string): StatementRead {
  const format = statementFormatOf(text);
  if (format === 'ofx') return readOfx(text);
  if (format === 'camt053') return readCamt(text);
  if (format === 'csv') return readCsv(text, fallbackCurrency);
  return { kind: 'unreadable' };
}

/**
 * 0216 (d) — A BANK'S OWN CSV, ITS COLUMNS MAPPED ONCE (the owner, 2026-10-26: "not more fixed layouts"). A file the
 * Nomi layout above cannot read is shown to the owner, who says which row names the columns and which column is what;
 * the answer is kept on the bank account (`accounts.statement_layout`) and every later file from that bank is read
 * with it. Nothing is guessed at reading: the day in the format she named, the amount with the decimal mark she named
 * (the other mark, spaces and apostrophes are thousands; letters and signs of money are dropped), money out below
 * zero. A later file is read with the layout only when its header row says the same names at the same places.
 */
export const DATE_FORMATS = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD.MM.YYYY', 'DD-MM-YYYY', 'YYYY/MM/DD'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];
export type CsvLayout = {
  readonly v: 1;
  readonly sep: ',' | ';' | '\t';
  /** The header row's names, as `headerKey` makes them: how a later file is recognised. */
  readonly header: readonly string[];
  readonly date: number; readonly dateFormat: DateFormat;
  readonly amount: { readonly single: number } | { readonly out: number; readonly in: number };
  readonly decimal: '.' | ',';
  readonly currency: number | null; readonly description: number | null; readonly reference: number | null;
};
const SEPS = [',', ';', '\t'] as const;
/** A header cell as compared: its words, lowercased, no more than 80 characters. */
export const headerKey = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80);

/** The file's separator (the most frequent of comma, semicolon and tab on its first lines) and its rows, cells trimmed. */
export function csvRows(text: string): { readonly sep: CsvLayout['sep']; readonly rows: readonly string[][] } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((r) => r.trim() !== '');
  const sample = lines.slice(0, 10).join('\n');
  const sep = [...SEPS].sort((a, b) => sample.split(b).length - sample.split(a).length)[0]!;
  return { sep, rows: lines.map((l) => splitCsv(l, sep)) };
}

/** A layout as stored, checked whole; anything else is no layout. */
export function layoutOf(raw: unknown): CsvLayout | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const col = (x: unknown) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < 60 ? x : null);
  const opt = (x: unknown) => (x === null ? null : col(x));
  const header = Array.isArray(o['header']) && o['header'].length <= 60 && o['header'].every((h) => typeof h === 'string' && h.length <= 80) ? o['header'] as string[] : null;
  const a = o['amount'] as Record<string, unknown> | null | undefined;
  const amount = a && col(a['single']) !== null ? { single: col(a['single'])! }
    : a && col(a['out']) !== null && col(a['in']) !== null && a['out'] !== a['in'] ? { out: col(a['out'])!, in: col(a['in'])! } : null;
  if (o['v'] !== 1 || !(SEPS as readonly unknown[]).includes(o['sep']) || !header || col(o['date']) === null || amount === null
    || !(DATE_FORMATS as readonly unknown[]).includes(o['dateFormat']) || (o['decimal'] !== '.' && o['decimal'] !== ',')
    || [o['currency'], o['description'], o['reference']].some((x) => x !== null && col(x) === null)) return null;
  const used = [col(o['date'])!, ...('single' in amount ? [amount.single] : [amount.out, amount.in]), opt(o['currency']), opt(o['description']), opt(o['reference'])];
  if (used.some((c) => c !== null && c >= header.length)) return null;
  return { v: 1, sep: o['sep'] as CsvLayout['sep'], header, date: col(o['date'])!, dateFormat: o['dateFormat'] as DateFormat, amount,
    decimal: o['decimal'] as CsvLayout['decimal'], currency: opt(o['currency']), description: opt(o['description']), reference: opt(o['reference']) };
}

/** A day written in `format`, as YYYY-MM-DD; null when it is not one. */
export function dayIn(raw: string, format: DateFormat): string | null {
  const x = raw.trim().split(/[ T]/)[0] ?? '';
  const parts = x.split(/[-/.]/);
  if (parts.length !== 3) return null;
  const order: Record<DateFormat, readonly [number, number, number]> = {
    'YYYY-MM-DD': [0, 1, 2], 'YYYY/MM/DD': [0, 1, 2], 'DD/MM/YYYY': [2, 1, 0], 'DD.MM.YYYY': [2, 1, 0], 'DD-MM-YYYY': [2, 1, 0], 'MM/DD/YYYY': [2, 0, 1],
  };
  const [yi, mi, di] = order[format];
  const [y, m, d] = [parts[yi]!, parts[mi]!, parts[di]!];
  if (!/^\d{4}$/.test(y) || !/^\d{1,2}$/.test(m) || !/^\d{1,2}$/.test(d)) return null;
  const day = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return realDay(day) ? day : null;
}

/** An amount with the decimal mark she named: exact, or null (and "" is none). */
export function amountIn(raw: string, decimal: CsvLayout['decimal']): Decimal | null | 'none' {
  let x = raw.trim();
  if (!x) return 'none';
  const minus = /^-|^\(.*\)$|-$/.test(x) || /^−/.test(x);
  x = x.replace(/[^0-9.,]/g, '');
  const other = decimal === ',' ? '.' : ',';
  x = x.split(other).join('');
  if ((x.match(new RegExp(`\\${decimal}`, 'g')) ?? []).length > 1) return null;
  if (decimal === ',') x = x.replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(x)) return null;   // a bank writes cents; a third decimal is not read as one
  const d = parseDecimal(x);
  if (d === null) return null;
  return minus ? neg(d) : d;
}

/** Where the header row is in this file: the first of its first 20 rows naming the layout's columns, at their places. */
export function headerRowFor(rows: readonly (readonly string[])[], layout: CsvLayout): number | null {
  const wanted = [layout.date, ...('single' in layout.amount ? [layout.amount.single] : [layout.amount.out, layout.amount.in]),
    layout.currency, layout.description, layout.reference].filter((c): c is number => c !== null);
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    if (wanted.every((c) => headerKey(rows[i]![c] ?? '') === layout.header[c])) return i;
  }
  return null;
}

/** A CSV read with the bank's own layout; `differs` when the file is not laid out as she said. */
export function readCsvWithLayout(text: string, layout: CsvLayout, fallbackCurrency: string): StatementRead | { readonly kind: 'differs' } {
  const { rows } = csvRowsWith(text, layout.sep);
  const h = headerRowFor(rows, layout);
  if (h === null) return { kind: 'differs' };
  const problems: StatementProblem[] = [];
  const lines: Omit<StatementLine, 'fingerprint'>[] = [];
  rows.slice(h + 1).forEach((c, i) => {
    const n = h + i + 2;
    const get = (col: number | null) => (col === null ? '' : c[col] ?? '');
    if (c.every((x) => x === '')) return;
    const day = dayIn(get(layout.date), layout.dateFormat);
    if (!day) { problems.push({ line: n, reason: 'not_a_date' }); return; }
    let amount: Decimal | null;
    if ('single' in layout.amount) {
      const a = amountIn(get(layout.amount.single), layout.decimal);
      if (a === null) { problems.push({ line: n, reason: 'not_an_amount' }); return; }
      amount = a === 'none' ? null : a;
    } else {
      const out = amountIn(get(layout.amount.out), layout.decimal); const inn = amountIn(get(layout.amount.in), layout.decimal);
      if (out === null || inn === null) { problems.push({ line: n, reason: 'not_an_amount' }); return; }
      // money out of the account is below zero, whatever sign the bank wrote it with
      amount = out !== 'none' && signOf(out) !== 0 ? neg(out.replace(/^-/, '') as Decimal) : inn !== 'none' ? (inn.replace(/^-/, '') as Decimal) : null;
    }
    if (amount === null || signOf(amount) === 0) { problems.push({ line: n, reason: 'zero' }); return; }
    const currency = (get(layout.currency).trim() || fallbackCurrency).toUpperCase();
    if (!known(currency)) { problems.push({ line: n, reason: 'unknown_currency' }); return; }
    lines.push({ bookedOn: day, amount, currency, wording: clean(get(layout.description)), reference: clean(get(layout.reference)) });
  });
  return { kind: 'read', format: 'csv', lines: fingerprinted('csv', lines), problems };
}

function csvRowsWith(text: string, sep: string): { readonly rows: readonly string[][] } {
  return { rows: text.replace(/^﻿/, '').split(/\r?\n/).filter((r) => r.trim() !== '').map((l) => splitCsv(l, sep)) };
}

/** 0216 (d) — what the columns page starts from: its own guesses, each the owner's to change. */
export type LayoutGuess = Omit<CsvLayout, 'v' | 'header'> & { readonly headerRow: number };
export function guessLayout(rows: readonly (readonly string[])[], sep: CsvLayout['sep']): LayoutGuess {
  const headerRow = Math.max(0, rows.findIndex((r) => r.filter((c) => c !== '').length >= 2));
  const head = (rows[headerRow] ?? []).map(headerKey);
  const find = (re: RegExp, not: number[] = []) => { const i = head.findIndex((h, j) => re.test(h) && !not.includes(j)); return i < 0 ? null : i; };
  const date = find(/date|fecha|datum|日期|تاريخ/) ?? 0;
  const out = find(/d[ée]bit|cargo|withdraw|soll|money out|支出|مدين/);
  const inn = find(/cr[ée]dit|abono|deposit|haben|money in|收入|دائن/);
  const single = find(/amount|montant|importe|betrag|金额|المبلغ/, [date]);
  const amount = single === null && out !== null && inn !== null && out !== inn ? { out, in: inn } : { single: single ?? Math.min(1, head.length - 1) };
  const sample = rows.slice(headerRow + 1, headerRow + 6);
  const dates = sample.map((r) => r[date] ?? '');
  const dateFormat: DateFormat = dates.some((d) => /^\d{4}-/.test(d)) ? 'YYYY-MM-DD' : dates.some((d) => /^\d{4}\//.test(d)) ? 'YYYY/MM/DD'
    : dates.some((d) => /^\d{1,2}\.\d{1,2}\.\d{4}/.test(d)) ? 'DD.MM.YYYY' : dates.some((d) => /^\d{1,2}-\d{1,2}-\d{4}/.test(d)) ? 'DD-MM-YYYY'
    : dates.some((d) => Number(d.split('/')[1]) > 12) ? 'MM/DD/YYYY' : 'DD/MM/YYYY';
  const amounts = sample.flatMap((r) => ('single' in amount ? [r[amount.single] ?? ''] : [r[amount.out] ?? '', r[amount.in] ?? '']));
  const decimal = amounts.some((a) => /\d,\d{1,2}\s*\D*$/.test(a.trim())) ? ',' : '.';
  return { sep, headerRow, date, dateFormat, amount, decimal,
    currency: find(/currency|devise|moneda|ccy|币种|العملة/), description: find(/desc|libell|label|concepto|wording|memo|d[ée]tail|摘要|البيان/),
    reference: find(/^r[ée]f|r[ée]f[ée]rence|referencia|参考|مرجع/) };
}
