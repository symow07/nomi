import type { Decimal } from '../types/decimal.js';
import { parseDecimal } from '../types/decimal.js';

/**
 * A1 (the owner, 2026-10-22) — A FIGURE IS READ ONE WAY, OR REFUSED. No meaning is taken from the separator, and
 * none from the currency.
 *
 * WHY. Before, the currency decided: in reais and rupiah (and, for one day, euros and dirhams) a dot grouped
 * thousands, so "1.250" was one thousand two hundred and fifty; everywhere else a comma did, so "1,250" was. An owner
 * who typed 1.250 meaning one and a quarter got a price a THOUSAND times too high, silently. "1.250" is a valid
 * reading either way, no locale guess settles it (Moroccan owners write a space, a dot or the English way), and a
 * silent misread is the one thing refused everywhere else.
 *
 * THE RULES, for every currency:
 *   · digits only — "1250";
 *   · ONE separator, then one or two digits — a decimal: "1.25", "1,25", "12,50" (no thousands group is two digits);
 *   · ONE separator, then four or more digits — a decimal: "0.4500" (no thousands group is four digits);
 *   · ONE separator, then exactly THREE digits, after a whole part of 1–3 digits that is not zero — AMBIGUOUS:
 *     "1.250", "1,250", "15.000". Refused, with a message that says both readings ("0.450" is a decimal: nobody
 *     groups a thousand behind a zero);
 *   · spaces between groups of three — thousands: "1 250", "1 250,50" (a space is never a decimal mark);
 *   · the same mark twice or more between groups of three (or the rupee's lakhs, "1,50,000") — thousands:
 *     "1.250.000" (a decimal mark appears once);
 *   · both marks — the last is the decimal, the other groups: "1.250,50", "1,250.50".
 * Anything else is not a number. The caller says which: `null` (not a figure) or 'ambiguous' (two readings).
 */
export type FigureReading = Decimal | 'ambiguous' | null;

const GROUPS = (g: string) => new RegExp(`^\\d{1,3}(?:${g}\\d{3})+$`);
const LAKHS = /^\d{1,2}(?:,\d{2})+,\d{3}$/;

/** The whole part of a figure with thousands marks in it, or null when its groups are not groups. */
function wholeOf(int: string, mark: '.' | ',' | ' '): string | null {
  const esc = mark === '.' ? '\\.' : mark;
  if (GROUPS(esc).test(int) || (mark === ',' && LAKHS.test(int))) return int.split(mark).join('');
  return null;
}

/** A figure as written, without a sign: one reading, 'ambiguous', or null. */
export function readWrittenFigure(raw: string): FigureReading {
  const s = raw.trim().replace(/[  ]/g, ' ');
  if (s === '') return null;
  if (s.includes(' ')) {
    const m = /^([\d ]+?)(?:([.,])(\d+))?$/.exec(s);
    if (!m) return null;
    const whole = wholeOf(m[1]!, ' ');
    return whole === null ? null : parseDecimal(m[3] ? `${whole}.${m[3]}` : whole);
  }
  if (/^\d+$/.test(s)) return parseDecimal(s);
  const dots = (s.match(/\./g) ?? []).length, commas = (s.match(/,/g) ?? []).length;
  if (dots + commas === 1) {
    const [int, frac] = s.split(/[.,]/) as [string, string];
    if (!/^\d+$/.test(int) || !/^\d+$/.test(frac)) return null;
    if (frac.length === 3 && /^[1-9]\d{0,2}$/.test(int)) return 'ambiguous';
    return parseDecimal(`${int}.${frac}`);
  }
  if (dots === 0 || commas === 0) {
    const whole = wholeOf(s, dots > 0 ? '.' : ',');
    return whole === null ? null : parseDecimal(whole);
  }
  // Both marks: the last one is the decimal, and it appears once.
  const decimalMark = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
  const group = decimalMark === '.' ? ',' : '.';
  const at = s.lastIndexOf(decimalMark);
  const [int, frac] = [s.slice(0, at), s.slice(at + 1)];
  if (int.includes(decimalMark) || !/^\d+$/.test(frac)) return null;
  const whole = wholeOf(int, group);
  return whole === null ? null : parseDecimal(`${whole}.${frac}`);
}

/**
 * CUR, then A1 — an amount the OWNER typed into a box. A minus sign is read, so a box can say "must be above zero"
 * about "-5" rather than "not a number". Exact: the figure as typed, as a decimal, never a float.
 */
export function readTypedAmount(raw: string): FigureReading {
  const typed = raw.trim();
  const negative = typed.startsWith('-');
  const r = readWrittenFigure(negative ? typed.slice(1) : typed);
  if (r === null || r === 'ambiguous' || !negative) return r;
  return r === '0' ? r : parseDecimal(`-${r}`);
}
