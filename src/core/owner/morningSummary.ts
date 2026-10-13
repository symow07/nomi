import type { Locale } from './i18n/locale.js';
import { t } from './i18n/messages.js';
import { formatList } from './i18n/format.js';

/**
 * Phase 2a (the owner's roadmap, 2026-10-13) — THE MORNING SUMMARY, in words. Pure: the facts are the database's
 * (src/db/morningSummary.ts), already counted; this says them. Three lines at most — how many customers wait for
 * the owner, how many went quiet, what sold yesterday — each only when there is something to say; nothing at all
 * on a day with nothing (null), so no empty letter ever leaves.
 *
 * COUNTS, NEVER NAMES: like every other alert that leaves Nomi ("a customer said yes", "a customer wants to talk"),
 * the summary names no customer. A name in it would travel through Nomi's own mail and the owner's phone, which
 * the privacy page does not list among those who see a customer's data. The names are one tap away, in Nomi.
 */

export type MorningFacts = {
  readonly waiting: number;
  readonly quiet: number;
  /** Orders confirmed in the business's yesterday, and their totals, one per currency, already written. */
  readonly sold: { readonly n: number; readonly totals: readonly string[] };
};

/** The summary's lines, or null when there is nothing to say. */
export function morningLines(locale: Locale, f: MorningFacts): string[] | null {
  const lines = [
    ...(f.waiting > 0 ? [t(locale, 'summary.waiting', { n: f.waiting })] : []),
    ...(f.quiet > 0 ? [t(locale, 'summary.quiet', { n: f.quiet })] : []),
    ...(f.sold.n > 0 ? [f.sold.totals.length
      ? t(locale, 'summary.sold', { n: f.sold.n, totals: formatList(locale, [...f.sold.totals]) })
      : t(locale, 'summary.soldBare', { n: f.sold.n })] : []),
  ];
  return lines.length > 0 ? lines : null;
}

/** Quiet hours as the form gives them: both or neither, whole hours, never the same hour twice. */
export function parseQuietHours(from: unknown, until: unknown): { readonly from: number | null; readonly until: number | null } | null {
  const hour = (v: unknown): number | null | undefined => {
    if (v === undefined || v === null || v === '') return null;
    const n = typeof v === 'string' && /^\d{1,2}$/.test(v) ? Number(v) : NaN;
    return Number.isInteger(n) && n >= 0 && n <= 23 ? n : undefined;
  };
  const f = hour(from); const u = hour(until);
  if (f === undefined || u === undefined) return null;
  if ((f === null) !== (u === null)) return null;
  if (f !== null && f === u) return null;
  return { from: f, until: u };
}
