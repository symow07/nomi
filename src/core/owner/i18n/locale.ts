/**
 * ADR-0008 — Owner-surface locale. Pure: parsing/resolution take strings and
 * return a Locale; no I/O, no reading of a request. The web layer extracts the
 * cookie + Accept-Language header and calls resolveLocale.
 */

export type Locale = 'en' | 'zh' | 'ar';

export const LOCALES: readonly Locale[] = ['en', 'zh', 'ar'];
export const DEFAULT_LOCALE: Locale = 'en';

/** Endonyms — a locale's own name, invariant across the UI language. */
export const LOCALE_LABEL: Record<Locale, string> = { en: 'English', zh: '中文', ar: 'العربية' };

const RTL: ReadonlySet<Locale> = new Set<Locale>(['ar']);
export const isRtl = (l: Locale): boolean => RTL.has(l);
export const dirOf = (l: Locale): 'rtl' | 'ltr' => (isRtl(l) ? 'rtl' : 'ltr');

/** A value is a supported Locale, else null. */
export function parseLocale(raw: string | null | undefined): Locale | null {
  return raw === 'en' || raw === 'zh' || raw === 'ar' ? raw : null;
}

/** First supported locale named in an Accept-Language header, else null. */
export function fromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  for (const part of header.split(',')) {
    const tag = (part.split(';')[0] ?? '').trim().toLowerCase();
    const primary = tag.split('-')[0];
    if (primary === 'en' || primary === 'zh' || primary === 'ar') return primary;
  }
  return null;
}

/** Owner cookie wins; then the browser's Accept-Language; then the default. */
export function resolveLocale(cookieValue: string | null | undefined, acceptLanguage: string | null | undefined): Locale {
  return parseLocale(cookieValue) ?? fromAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE;
}
