import { type Currency, DOT_THOUSANDS } from '../types/money.js';

/**
 * CUR — an amount the OWNER typed into a box, read the way her currency writes
 * it. Every price form read `Number(box)`, so an Indonesian owner's "15.000"
 * was fifteen rupiah, and a Brazilian's "12,50" was not a number at all.
 *
 *   · Reais and rupiah (`DOT_THOUSANDS`): a dot groups thousands, a comma marks
 *     the decimals — "15.000" is 15000, "1.250,50" is 1250.5, "12,50" is 12.5.
 *     A dot before one or two digits is still a decimal point ("12.50"): no
 *     thousands group is two digits long.
 *   · Every other: a comma groups thousands (and the rupee's lakhs, "1,50,000"),
 *     a dot marks the decimals. "12,50" could be either reading and is refused
 *     rather than guessed: a wrong reading is a price a customer is quoted.
 *
 * Spaces (and the no-break space) between groups are ignored. Returns null for
 * anything that is not one clear amount; the caller says "not a number".
 */
export function readTypedAmount(raw: string, currency: Currency): number | null {
  const typed = raw.trim().replace(/[\s\u00a0\u202f]/g, '');
  // A minus sign is read, so a box can say "must be above zero" about "-5"
  // rather than "not a number".
  const negative = typed.startsWith('-');
  const s = negative ? typed.slice(1) : typed;
  if (s === '') return null;
  let n: number;
  if (DOT_THOUSANDS.has(currency)) {
    if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(s)) n = Number(s.replace(/\./g, '').replace(',', '.'));
    else if (/^\d+,\d+$/.test(s)) n = Number(s.replace(',', '.'));
    else if (/^\d+(?:\.\d{1,2})?$/.test(s)) n = Number(s);
    else return null;
  } else {
    if (/^(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})+,\d{3})(?:\.\d+)?$/.test(s)) n = Number(s.replace(/,/g, ''));
    else if (/^\d+(?:\.\d+)?$/.test(s)) n = Number(s);
    else return null;
  }
  return Number.isFinite(n) ? (negative ? -n : n) : null;
}
