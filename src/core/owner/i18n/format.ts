import type { Locale } from './locale.js';

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

/** Trade money stays USD, grouped the same way everywhere. */
export const formatUsd = (n: number): string =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
