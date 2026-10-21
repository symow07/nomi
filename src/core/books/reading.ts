import { readTypedAmount } from '../commerce/amount.js';
import { addDecimal, compareDecimal, signOf, subDecimal, type Decimal } from '../types/decimal.js';
import { CURRENCIES } from '../types/money.js';

/**
 * D6 (Phase 5, item 7) — A RECEIPT, INVOICE OR BILL, READ: what the reader says is printed on it, checked before
 * anyone may draft from it. The reader returns the figures as PRINTED TEXT; each is read here by A1's one rule
 * (`readTypedAmount`): a figure that can be read two ways is a problem, never a guess. The lines must add up to the
 * total, the day must be a day and the currency one the books keep — or the reading is shown with its problems,
 * and nothing is drafted from it. A reading never posts: it can only become a DRAFT the owner checks and posts.
 */
export type RawReading = {
  readonly kind: string; readonly supplierName: string; readonly supplierTaxId: string; readonly number: string; readonly date: string;
  readonly currency: string; readonly lines: readonly { readonly label: string; readonly net: string; readonly taxRate: string; readonly tax: string }[];
  readonly totalNet: string; readonly totalTax: string; readonly total: string;
};

export type ReadingLine = { readonly label: string; readonly net: Decimal; readonly taxRate: Decimal; readonly tax: Decimal };
export type CheckedReading = {
  readonly kind: 'invoice' | 'receipt' | 'bill' | 'other'; readonly supplierName: string | null; readonly supplierTaxId: string | null;
  readonly number: string | null; readonly date: string | null; readonly currency: string | null;
  readonly lines: readonly ReadingLine[]; readonly total: Decimal | null;
};
export type ReadingProblem =
  | { readonly kind: 'ambiguous'; readonly where: string } | { readonly kind: 'not_an_amount'; readonly where: string }
  | { readonly kind: 'no_total' } | { readonly kind: 'not_adding_up'; readonly lines: Decimal; readonly total: Decimal }
  | { readonly kind: 'no_date' } | { readonly kind: 'unknown_currency'; readonly currency: string } | { readonly kind: 'no_number' };

const ZERO = '0' as Decimal;
/** YYYY-MM-DD naming a day the calendar has (no clock: the year, the month's length, the leap day). */
const isCalendarDay = (s: string): boolean => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return days !== undefined && d >= 1 && d <= days;
};
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

/** The reader's JSON answer, as text fields; null when it is not the shape asked for (or says UNREADABLE). */
export function parseReadingAnswer(answer: string): RawReading | null {
  const s = answer.trim();
  if (s === 'UNREADABLE') return null;
  const json = /\{[\s\S]*\}/.exec(s)?.[0];
  if (!json) return null;
  let v: unknown;
  try { v = JSON.parse(json); } catch { return null; }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const sup = (o['supplier'] && typeof o['supplier'] === 'object' ? o['supplier'] : {}) as Record<string, unknown>;
  const lines = Array.isArray(o['lines']) ? (o['lines'] as unknown[]).slice(0, 50).map((l) => {
    const x = (l && typeof l === 'object' ? l : {}) as Record<string, unknown>;
    return { label: text(x['label']).slice(0, 200), net: text(x['net']), taxRate: text(x['taxRate']), tax: text(x['tax']) };
  }) : [];
  return { kind: text(o['kind']), supplierName: text(sup['name']).slice(0, 200), supplierTaxId: text(sup['taxId']).slice(0, 40),
    number: text(o['number']).slice(0, 100), date: text(o['date']), currency: text(o['currency']).toUpperCase(), lines,
    totalNet: text(o['totalNet']), totalTax: text(o['totalTax']), total: text(o['total']) };
}

export function checkReading(r: RawReading): { readonly reading: CheckedReading; readonly problems: readonly ReadingProblem[] } {
  const problems: ReadingProblem[] = [];
  const amount = (raw: string, where: string, optional = false): Decimal | null => {
    if (raw === '') { if (!optional) problems.push({ kind: 'not_an_amount', where }); return null; }
    const v = readTypedAmount(raw);
    if (v === 'ambiguous') { problems.push({ kind: 'ambiguous', where }); return null; }
    if (v === null || signOf(v) < 0) { problems.push({ kind: 'not_an_amount', where }); return null; }
    return v;
  };
  const total = r.total === '' ? null : amount(r.total, 'total');
  if (r.total === '') problems.push({ kind: 'no_total' });
  let lines: ReadingLine[] = r.lines.map((l, i) => ({ label: l.label || `${i + 1}`, net: amount(l.net, `line ${i + 1}`) ?? ZERO,
    taxRate: amount(l.taxRate, `line ${i + 1}`, true) ?? ZERO, tax: amount(l.tax, `line ${i + 1}`, true) ?? ZERO }));
  // No lines printed (a till receipt): one line from the totals.
  if (lines.length === 0 && total !== null) {
    const tax = amount(r.totalTax, 'tax', true) ?? ZERO;
    const net = r.totalNet !== '' ? (amount(r.totalNet, 'net') ?? ZERO) : subDecimal(total, tax);
    lines = [{ label: r.supplierName || r.number || '1', net, taxRate: ZERO, tax }];
  }
  if (total !== null && lines.length > 0) {
    const sum = lines.reduce((s, l) => addDecimal(s, addDecimal(l.net, l.tax)), ZERO);
    if (compareDecimal(sum, total) !== 0) problems.push({ kind: 'not_adding_up', lines: sum, total });
  }
  const date = isCalendarDay(r.date) ? r.date : null;
  if (date === null) problems.push({ kind: 'no_date' });
  const currency = (CURRENCIES as readonly string[]).includes(r.currency) ? r.currency : null;
  if (currency === null) problems.push({ kind: 'unknown_currency', currency: r.currency });
  if (r.number === '') problems.push({ kind: 'no_number' });
  const kind = (['invoice', 'receipt', 'bill'] as const).find((k) => k === r.kind) ?? 'other';
  return { reading: { kind, supplierName: r.supplierName || null, supplierTaxId: r.supplierTaxId || null, number: r.number || null, date, currency, lines, total },
    problems };
}
