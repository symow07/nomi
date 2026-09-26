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

/** "Today 09:15" / "昨天 23:40" / "Jul 17 09:15" — relative day words + time. */
export function formatRelative(locale: Locale, d: Date, now: Date): string {
  const time = formatTime(locale, d);
  if (dayKey(d) === dayKey(now)) return `${TODAY[locale]} ${time}`;
  if (dayKey(d) === dayKey(new Date(now.getTime() - 86_400_000))) return `${YESTERDAY[locale]} ${time}`;
  return `${formatDate(locale, d)} ${time}`;
}
