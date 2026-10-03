import type { Locale } from './locale.js';
import { type Money, currencySymbol } from '../../types/money.js';

/**
 * ADR-0008 — Locale-aware formatting. Pure (Intl only; clock/date injected).
 * Currencies are NEVER translated — USD stays USD, ￥ stays ￥. Numerals stay
 * Western (Arabic-Indic digits are avoided in a B2B trade UI). Only zh uses 万.
 */

/**
 * TZ (2026-09-30) — every date and time is said in the WORKSPACE's own zone
 * (`businesses.timezone`, chosen at sign-up), passed in by the caller. It was a
 * constant, Asia/Shanghai, for every workspace. The zone is a required
 * argument on purpose: a caller that forgets it does not compile.
 */
const INTL_TAG: Record<Locale, string> = { en: 'en-US', zh: 'zh-CN', ar: 'ar', es: 'es', fr: 'fr' };

/** Quantities: zh says 12000 → "1.2万" and small numbers ungrouped (5000);
 *  en/ar group Western (5,000). Western digits in every locale. */
export function formatQty(locale: Locale, n: number): string {
  if (locale === 'zh') {
    if (n < 10_000) return String(n);
    const wan = n / 10_000;
    const s = Number.isInteger(wan) ? String(wan) : wan.toFixed(1).replace(/\.0$/, '');
    return `${s}万`;
  }
  return n.toLocaleString('en-US');
}

/**
 * Trade money, grouped the same way everywhere.
 *
 * M43a — takes a Money, and the symbol comes from its currency. Before, the
 * function was named for the currency and the symbol was a literal, so every
 * screen in this product would have rendered "$" beside a non-dollar amount and
 * been correct in its own terms.
 */
export const formatMoney = (m: Money): string =>
  `${currencySymbol(m.currency)}${m.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A localized calendar date in the workspace's zone. */
export function formatDate(locale: Locale, d: Date, zone: string): string {
  return new Intl.DateTimeFormat(INTL_TAG[locale], {
    timeZone: zone, month: 'short', day: 'numeric', weekday: 'short',
  }).format(d);
}

/** Phase 9 (V1-193) — the same, with its year: "Wed, Sep 30, 2026", for a date a record keeps past the year. */
export function formatDateYear(locale: Locale, d: Date, zone: string): string {
  return new Intl.DateTimeFormat(INTL_TAG[locale], {
    timeZone: zone, year: 'numeric', month: 'short', day: 'numeric', weekday: 'short',
  }).format(d);
}

/** "Tuesday, September 29" / "9月29日星期二" / "الثلاثاء، 29 سبتمبر" — Today's own date, in the business timezone. */
export function formatDayLong(locale: Locale, d: Date, zone: string): string {
  return new Intl.DateTimeFormat(INTL_TAG[locale], {
    timeZone: zone, weekday: 'long', month: 'long', day: 'numeric',
  }).format(d);
}

/** HH:MM in the workspace's zone (24h). */
export function formatTime(locale: Locale, d: Date, zone: string): string {
  return new Intl.DateTimeFormat(INTL_TAG[locale], {
    timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}

const TODAY: Record<Locale, string> = { en: 'Today', zh: '今天', ar: 'اليوم', es: 'Hoy', fr: 'Aujourd’hui' };
const YESTERDAY: Record<Locale, string> = { en: 'Yesterday', zh: '昨天', ar: 'أمس', es: 'Ayer', fr: 'Hier' };
const TOMORROW: Record<Locale, string> = { en: 'Tomorrow', zh: '明天', ar: 'غدًا', es: 'Mañana', fr: 'Demain' };
/** The calendar day an instant falls on in the workspace's zone, as 'YYYY-MM-DD'. */
export const dayKey = (d: Date, zone: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

const ymdParts = (ymd: string): [number, number, number] => {
  const [y, m, d] = ymd.split('-').map(Number);
  return [y ?? 1970, m ?? 1, d ?? 1];
};

/** 'YYYY-MM-DD' moved by whole days. Calendar arithmetic, no timezone involved. */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymdParts(ymd);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** How far the zone is ahead of UTC at an instant, in ms. */
function zoneOffsetMs(at: Date, zone: string): number {
  const p: Record<string, number> = {};
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at)) p[part.type] = Number(part.value);
  const wall = Date.UTC(p['year'] ?? 1970, (p['month'] ?? 1) - 1, p['day'] ?? 1, p['hour'] ?? 0, p['minute'] ?? 0, p['second'] ?? 0);
  return wall - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * V2 — the instant a business-timezone day begins, for a 'YYYY-MM-DD'. The
 * inverse of `dayKey`: `dayKey(dayStart(x)) === x`. Computed from the zone
 * rather than assuming its offset, so it stays right if the zone ever changes.
 */
export function dayStart(ymd: string, zone: string): Date {
  const [y, m, d] = ymdParts(ymd);
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - zoneOffsetMs(new Date(guess), zone);
  return new Date(guess - zoneOffsetMs(new Date(first), zone));
}

/**
 * CC-13 — a label and what it labels, with the locale's own colon: "Last
 * action: …", "最近操作：…". The Chinese colon is full width and takes no
 * space after it; English and Arabic take the plain colon and a space. Pages
 * printed "Last contact：Today" to English readers.
 */
export const labelled = (locale: Locale, label: string, value: string): string =>
  // French sets a no-break space before the colon (phase 9).
  `${label}${locale === 'zh' ? '：' : locale === 'fr' ? '\u00a0: ' : ': '}${value}`;

/**
 * CC-13 — a figure and the unit it counts, the way each locale writes them:
 * Chinese sets them together ("5000个", "1.2万个"); English and Arabic put a
 * space between them ("5,000 pcs", "5,000 قطعة") — a no-break space, so the
 * pair never wraps apart at the end of a narrow row. The pages glued them in
 * every language, which Arabic cannot read as two words ("5,000قطعة").
 * `figure` is already written: a quantity, or a range of them ("1,000–4,999",
 * "5,000+").
 */
export const withUnit = (locale: Locale, figure: string, unit: string): string =>
  `${figure}${locale === 'zh' ? '' : '\u00a0'}${unit}`;

/** A quantity and its unit: `formatQty`, then `withUnit`. */
export const formatQtyUnit = (locale: Locale, n: number, unit: string): string =>
  withUnit(locale, formatQty(locale, n), unit);

/**
 * CC-13 — a list the way each locale writes one: "a, b and c", "a、b和c",
 * "a وb". The pages joined every list with the Chinese enumeration comma, in
 * every language.
 */
export const formatList = (locale: Locale, items: readonly string[]): string =>
  new Intl.ListFormat(INTL_TAG[locale], { type: 'conjunction' }).format(items);

/** "Today 09:15" / "昨天 23:40" / "Jul 17 09:15" — relative day words + time. */
export function formatRelative(locale: Locale, d: Date, now: Date, zone: string): string {
  const time = formatTime(locale, d, zone);
  if (dayKey(d, zone) === dayKey(now, zone)) return `${TODAY[locale]} ${time}`;
  if (dayKey(d, zone) === dayKey(new Date(now.getTime() - 86_400_000), zone)) return `${YESTERDAY[locale]} ${time}`;
  return `${formatDate(locale, d, zone)} ${time}`;
}

/**
 * Phase 9 (V1-267) — the day alone, for a transcript's divider: "Today",
 * "Yesterday", or the date. Every caption repeated "Today 12:13", "Today 12:48".
 */
export function formatDay(locale: Locale, d: Date, now: Date, zone: string): string {
  if (dayKey(d, zone) === dayKey(now, zone)) return TODAY[locale];
  if (dayKey(d, zone) === dayKey(new Date(now.getTime() - 86_400_000), zone)) return YESTERDAY[locale];
  return formatDate(locale, d, zone);
}

/** CH5 — time left, in words: "1 hour, 20 minutes", "1小时20分钟", "ساعة واحدة و20 دقيقة". Whole minutes, never below one. */
export function formatTimeLeft(locale: Locale, ms: number): string {
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  const parts = { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
  // Each unit said by the locale, then joined as the locale joins units.
  // Not Intl.DurationFormat: Node 22 (production, CI) does not have it.
  const unit = (n: number, u: 'hour' | 'minute') =>
    new Intl.NumberFormat(INTL_TAG[locale], { style: 'unit', unit: u, unitDisplay: 'long' }).format(n);
  const said = [...(parts.hours ? [unit(parts.hours, 'hour')] : []), ...(parts.minutes ? [unit(parts.minutes, 'minute')] : [])];
  return new Intl.ListFormat(INTL_TAG[locale], { type: 'unit', style: locale === 'zh' ? 'narrow' : 'long' }).format(said);
}

/** Phase 6 — a short length, in whole seconds, as the locale says it: "24 seconds", "24秒", "٢٤ ثانية". */
export function formatSeconds(locale: Locale, s: number): string {
  return new Intl.NumberFormat(INTL_TAG[locale], { style: 'unit', unit: 'second', unitDisplay: 'long' }).format(Math.round(s));
}

/** "September 2026", "2026年9月", "سبتمبر ٢٠٢٦" — the month a calendar page shows. */
export function formatMonth(locale: Locale, ymd: string): string {
  const first = `${ymd.slice(0, 7)}-01T00:00:00Z`;
  return new Intl.DateTimeFormat(INTL_TAG[locale], { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(first));
}

/** "Mon", "周一", "الاثنين" — a weekday's short name, for a day 'YYYY-MM-DD'. */
export function formatWeekday(locale: Locale, ymd: string): string {
  const midnight = `${ymd}T00:00:00Z`;
  return new Intl.DateTimeFormat(INTL_TAG[locale], { timeZone: 'UTC', weekday: 'short' }).format(new Date(midnight));
}

/**
 * A moment in a list's corner, as short as it can be said: the hour today,
 * "Yesterday", then the day and month ("14:02" / "Yesterday" / "Sep 28").
 */
export function formatShortWhen(locale: Locale, d: Date, now: Date, zone: string): string {
  if (dayKey(d, zone) === dayKey(now, zone)) return formatTime(locale, d, zone);
  if (dayKey(d, zone) === dayKey(new Date(now.getTime() - 86_400_000), zone)) return YESTERDAY[locale];
  return new Intl.DateTimeFormat(INTL_TAG[locale], { timeZone: zone, month: 'short', day: 'numeric' }).format(d);
}

/**
 * A time still to come, for "…until {time}": the hour alone today, the word
 * for tomorrow beside it, a date after that. "16:04" / "16:04 tomorrow" /
 * "明天 16:04" / "غدًا 16:04".
 */
export function formatUntil(locale: Locale, d: Date, now: Date, zone: string): string {
  const time = formatTime(locale, d, zone);
  if (dayKey(d, zone) === dayKey(now, zone)) return time;
  if (dayKey(d, zone) === dayKey(new Date(now.getTime() + 86_400_000), zone)) {
    // Phase 9 (V1-230) — said inside a sentence ("…until {time}"), so the day
    // takes no capital: "hasta mañana a las 17:18", not "hasta Mañana 17:18".
    return locale === 'en' ? `${time} tomorrow`
      : locale === 'es' ? `mañana a las ${time}`
      : locale === 'fr' ? `demain à ${time}`
      : `${TOMORROW[locale]} ${time}`;
  }
  return `${formatDate(locale, d, zone)} ${time}`;
}
