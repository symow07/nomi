import type { Locale } from './locale.js';
import { type Money, currencySymbol } from '../../types/money.js';

/**
 * ADR-0008 — Locale-aware formatting. Pure (Intl only; clock/date injected).
 * Currencies are NEVER translated — USD stays USD, ￥ stays ￥. Numerals stay
 * Western (Arabic-Indic digits are avoided in a B2B trade UI). Only zh uses 万.
 */

const BUSINESS_TZ = 'Asia/Shanghai';
const INTL_TAG: Record<Locale, string> = { en: 'en-US', zh: 'zh-CN', ar: 'ar' };

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

/** A localized calendar date in the business timezone. */
export function formatDate(locale: Locale, d: Date): string {
  return new Intl.DateTimeFormat(INTL_TAG[locale], {
    timeZone: BUSINESS_TZ, month: 'short', day: 'numeric', weekday: 'short',
  }).format(d);
}

/** HH:MM in the business timezone (24h). */
export function formatTime(locale: Locale, d: Date): string {
  return new Intl.DateTimeFormat(INTL_TAG[locale], {
    timeZone: BUSINESS_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}

const TODAY: Record<Locale, string> = { en: 'Today', zh: '今天', ar: 'اليوم' };
const YESTERDAY: Record<Locale, string> = { en: 'Yesterday', zh: '昨天', ar: 'أمس' };
const TOMORROW: Record<Locale, string> = { en: 'Tomorrow', zh: '明天', ar: 'غدًا' };
/** The calendar day an instant falls on in the business timezone, as 'YYYY-MM-DD'. */
export const dayKey = (d: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

const ymdParts = (ymd: string): [number, number, number] => {
  const [y, m, d] = ymd.split('-').map(Number);
  return [y ?? 1970, m ?? 1, d ?? 1];
};

/** 'YYYY-MM-DD' moved by whole days. Calendar arithmetic, no timezone involved. */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymdParts(ymd);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** How far the business timezone is ahead of UTC at an instant, in ms. */
function zoneOffsetMs(at: Date): number {
  const p: Record<string, number> = {};
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
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
export function dayStart(ymd: string): Date {
  const [y, m, d] = ymdParts(ymd);
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - zoneOffsetMs(new Date(guess));
  return new Date(guess - zoneOffsetMs(new Date(first)));
}

/**
 * CC-13 — a label and what it labels, with the locale's own colon: "Last
 * action: …", "最近操作：…". The Chinese colon is full width and takes no
 * space after it; English and Arabic take the plain colon and a space. Pages
 * printed "Last contact：Today" to English readers.
 */
export const labelled = (locale: Locale, label: string, value: string): string =>
  `${label}${locale === 'zh' ? '：' : ': '}${value}`;

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
export function formatRelative(locale: Locale, d: Date, now: Date): string {
  const time = formatTime(locale, d);
  if (dayKey(d) === dayKey(now)) return `${TODAY[locale]} ${time}`;
  if (dayKey(d) === dayKey(new Date(now.getTime() - 86_400_000))) return `${YESTERDAY[locale]} ${time}`;
  return `${formatDate(locale, d)} ${time}`;
}

/** CH5 — time left, in words: "1 hour, 20 minutes", "1小时20分钟", "ساعة واحدة و20 دقيقة". Whole minutes, never below one. */
export function formatTimeLeft(locale: Locale, ms: number): string {
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  const parts = { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
  type DurationFormatter = { format(d: { hours?: number; minutes?: number }): string };
  const DF = (Intl as unknown as { DurationFormat: new (l: string, o: { style: string }) => DurationFormatter }).DurationFormat;
  return new DF(INTL_TAG[locale], { style: 'long' }).format({
    ...(parts.hours ? { hours: parts.hours } : {}), ...(parts.minutes ? { minutes: parts.minutes } : {}),
  });
}

/** The hour (0–23) an instant falls in, in the business timezone — the row it sits in on a calendar. */
export function hourIn(d: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: BUSINESS_TZ, hour: '2-digit', hourCycle: 'h23' }).format(d));
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
export function formatShortWhen(locale: Locale, d: Date, now: Date): string {
  if (dayKey(d) === dayKey(now)) return formatTime(locale, d);
  if (dayKey(d) === dayKey(new Date(now.getTime() - 86_400_000))) return YESTERDAY[locale];
  return new Intl.DateTimeFormat(INTL_TAG[locale], { timeZone: BUSINESS_TZ, month: 'short', day: 'numeric' }).format(d);
}

/**
 * A time still to come, for "…until {time}": the hour alone today, the word
 * for tomorrow beside it, a date after that. "16:04" / "16:04 tomorrow" /
 * "明天 16:04" / "غدًا 16:04".
 */
export function formatUntil(locale: Locale, d: Date, now: Date): string {
  const time = formatTime(locale, d);
  if (dayKey(d) === dayKey(now)) return time;
  if (dayKey(d) === dayKey(new Date(now.getTime() + 86_400_000))) {
    return locale === 'en' ? `${time} tomorrow` : `${TOMORROW[locale]} ${time}`;
  }
  return `${formatDate(locale, d)} ${time}`;
}
