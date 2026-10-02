/**
 * ADR-0008 — Owner-surface locale. Pure: parsing/resolution take strings and
 * return a Locale; no I/O, no reading of a request. The web layer extracts the
 * cookie + Accept-Language header and calls resolveLocale.
 */

// UI-es (0119, decision 39) — Spanish, the fourth. Phase 9 (0121, V1-001) — French, the fifth.
export type Locale = 'en' | 'zh' | 'ar' | 'es' | 'fr';

export const LOCALES: readonly Locale[] = ['en', 'zh', 'ar', 'es', 'fr'];
export const DEFAULT_LOCALE: Locale = 'en';

/** Endonyms — a locale's own name, invariant across the UI language. */
export const LOCALE_LABEL: Record<Locale, string> = { en: 'English', zh: '中文', ar: 'العربية', es: 'Español', fr: 'Français' };

/**
 * The positioning rewrite (0093): the languages a business may say it SERVES —
 * the nine the safety checks read (rule 18), each in its own name. Informational:
 * nothing gates on it. The owner's pages are in the five locales above.
 */
export const SERVED_LANGUAGES = ['en', 'zh', 'ar', 'es', 'fr', 'pt', 'de', 'tr', 'ru'] as const;
export type ServedLanguage = (typeof SERVED_LANGUAGES)[number];
export const SERVED_LABEL: Record<ServedLanguage, string> = {
  en: 'English', zh: '中文', ar: 'العربية', es: 'Español', fr: 'Français', pt: 'Português', de: 'Deutsch', tr: 'Türkçe', ru: 'Русский',
};

const RTL: ReadonlySet<Locale> = new Set<Locale>(['ar']);
export const isRtl = (l: Locale): boolean => RTL.has(l);
export const dirOf = (l: Locale): 'rtl' | 'ltr' => (isRtl(l) ? 'rtl' : 'ltr');

/** A value is a supported Locale, else null. */
export function parseLocale(raw: string | null | undefined): Locale | null {
  return raw === 'en' || raw === 'zh' || raw === 'ar' || raw === 'es' || raw === 'fr' ? raw : null;
}

/** First supported locale named in an Accept-Language header, else null. */
export function fromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  for (const part of header.split(',')) {
    const tag = (part.split(';')[0] ?? '').trim().toLowerCase();
    const primary = tag.split('-')[0];
    if (primary === 'en' || primary === 'zh' || primary === 'ar' || primary === 'es' || primary === 'fr') return primary;
  }
  return null;
}

/** Owner cookie wins; then the browser's Accept-Language; then the default. */
export function resolveLocale(cookieValue: string | null | undefined, acceptLanguage: string | null | undefined): Locale {
  return parseLocale(cookieValue) ?? fromAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE;
}
