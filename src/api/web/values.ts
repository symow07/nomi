import type { Locale } from '../../core/owner/i18n/locale.js';
import type { Money } from '../../core/types/money.js';
import * as f from '../../core/owner/i18n/format.js';
import { formatMoneyCompact } from '../../core/owner/format.js';

/**
 * RIGHT TO LEFT, BY DESIGN (the design pass §9, 2026-09-30).
 *
 * One function per kind of value the owner's pages show — money, a quantity
 * and its unit, a count, a date, a time, a phone number, an order number —
 * each written the way the locale writes it and, on a page that runs right to
 * left, handed back inside an ISOLATE, so the words around it cannot reorder
 * it. The calendar's "1.95$" was exactly an un-isolated value: in Arabic the
 * locale's own form is "1.95 US$" (after a right-to-left mark), read as one unit.
 *
 * The isolate is U+2068 FIRST STRONG ISOLATE … U+2069 POP DIRECTIONAL ISOLATE:
 * what `<bdi>` does, as two characters. Unlike an element it can stand inside a
 * sentence the catalogue writes, an `<option>`, an attribute or the page title,
 * and it passes through `esc` untouched — so one function serves every place a
 * value goes. Left-to-right pages need none and get none.
 *
 * Arabic keeps Western digits (`ar-u-nu-latn`), as it always has; the native
 * reader confirms that, with the month names.
 *
 * Pages take their values from here, never from the formatters in
 * `core/owner/i18n/format.ts` directly (`tests/parity/rtl-values.test.ts`
 * holds that). Messages to the owner outside a page — e-mail, WhatsApp — keep
 * the plain formatters.
 */

const FSI = '\u2068';
const PDI = '\u2069';

/** Is this page drawn right to left? */
export const rtl = (locale: Locale): boolean => locale === 'ar';

/** Any value, isolated where the page runs right to left. Already isolated: as it is. */
export const isolate = (locale: Locale, s: string): string =>
  !rtl(locale) || s === '' || (s.startsWith(FSI) && s.endsWith(PDI)) ? s : `${FSI}${s}${PDI}`;

/**
 * A run of figures as one reads it: digits with the separators inside them
 * ("1,000–4,999", "1/5", "09:30"), a currency sign on either side, a trailing
 * "+" or a percent sign. Arabic-Indic digits count too.
 */
const FIGURE_RUN = /(?:\p{Sc}\s?)?[0-9\u0660-\u0669\u06F0-\u06F9](?:[0-9\u0660-\u0669\u06F0-\u06F9.,:/\u066B\u066C\u2013-]*[0-9\u0660-\u0669\u06F0-\u06F9])?(?:\+|%|\u066A|\s?\p{Sc})?|\p{Sc}/gu;

/**
 * Every figure run in a finished sentence isolated, leaving what is already
 * isolated alone — the catalogue's own numbers ("within 30 days", "{done}/{total}")
 * as much as the values put into it. Right-to-left pages only.
 */
export function isolateFigures(locale: Locale, s: string): string {
  if (!rtl(locale) || !hasFigure(s)) return s;
  let out = '';
  let plain = '';
  let depth = 0;
  const flush = () => { out += plain.replace(FIGURE_RUN, (run) => `${FSI}${run}${PDI}`); plain = ''; };
  for (const ch of s) {
    if (ch === '\u2066' || ch === '\u2067' || ch === FSI) { if (depth === 0) flush(); depth++; out += ch; continue; }
    if (ch === PDI && depth > 0) { depth--; out += ch; continue; }
    if (depth > 0) out += ch; else plain += ch;
  }
  flush();
  return out;
}

/** Does this text carry a figure or a currency sign — something the words around it could reorder? */
export const hasFigure = (s: string): boolean => /[0-9\u0660-\u0669\u06F0-\u06F9]|\p{Sc}/u.test(s);

const AR = 'ar-u-nu-latn';

/** Money: "$1.95" in English and Chinese, "1.95 US$" (the locale's own form) in Arabic. */
export const money = (locale: Locale, m: Money): string => isolate(locale, rtl(locale)
  ? new Intl.NumberFormat(AR, { style: 'currency', currency: m.currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(m.amount)
  : f.formatMoney(m));

/** Money in whole units, for a summary line. */
export const moneyWhole = (locale: Locale, m: Money): string => isolate(locale, rtl(locale)
  ? new Intl.NumberFormat(AR, { style: 'currency', currency: m.currency, maximumFractionDigits: 0 }).format(Math.round(m.amount))
  : formatMoneyCompact(m));

/** A quantity alone: "5,000", "1.2万", "5,000". */
export const quantity = (locale: Locale, n: number): string => isolate(locale, f.formatQty(locale, n));

/** A quantity and what it counts, as one: "5,000 pcs", "5000个", "5,000 قطعة". */
export const quantityOf = (locale: Locale, n: number, unit: string): string => isolate(locale, f.formatQtyUnit(locale, n, unit));

/** A figure already written (a range, "5,000+") and its unit, as one. */
export const figureOf = (locale: Locale, figure: string, unit: string): string => isolate(locale, f.withUnit(locale, figure, unit));

/** A count on its own: "12". */
export const count = (locale: Locale, n: number): string =>
  isolate(locale, new Intl.NumberFormat(rtl(locale) ? AR : locale).format(n));

/** A date: "Tue, Sep 29", "9月29日周二", "الثلاثاء، 29 سبتمبر". */
export const date = (locale: Locale, d: Date): string => isolate(locale, f.formatDate(locale, d));

/** A day in full, for a page's title line. */
export const dayLong = (locale: Locale, d: Date): string => isolate(locale, f.formatDayLong(locale, d));

/** A time of day: "14:02". */
export const time = (locale: Locale, d: Date): string => isolate(locale, f.formatTime(locale, d));

/** "Today 09:15", "Yesterday 23:40", "Jul 17 09:15". */
export const when = (locale: Locale, d: Date, now: Date): string => isolate(locale, f.formatRelative(locale, d, now));

/** "14:02", "Yesterday", "Sep 28" — a list's corner. */
export const shortWhen = (locale: Locale, d: Date, now: Date): string => isolate(locale, f.formatShortWhen(locale, d, now));

/** "16:04", "16:04 tomorrow", a date after that. */
export const until = (locale: Locale, d: Date, now: Date): string => isolate(locale, f.formatUntil(locale, d, now));

/** "1 hour, 20 minutes". */
export const timeLeft = (locale: Locale, ms: number): string => isolate(locale, f.formatTimeLeft(locale, ms));

/** "September 2026". */
export const month = (locale: Locale, ymd: string): string => isolate(locale, f.formatMonth(locale, ymd));

/** A phone number, as stored: "+971 50 123 4567" reads left to right on every page. */
export const phone = (locale: Locale, p: string): string => isolate(locale, p);

/** An order's number or reference: "PO-2231", "LND-7". */
export const orderNumber = (locale: Locale, ref: string): string => isolate(locale, ref);
