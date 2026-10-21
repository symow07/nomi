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
