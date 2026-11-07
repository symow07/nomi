import type { SETUP_MINUTES_EN } from '../../src/core/owner/i18n/setupMinutes.js';

/**
 * Approved screen-label quotations: the owner needs Shopify's exact words to
 * find these fields. Vocabulary tests remove only these quoted phrases from
 * their named messages; our words around them remain subject to every ban.
 */
export const SHOPIFY_SCREEN_LABELS: Readonly<Partial<Record<string, readonly string[]>>> = {
  'storeToken.token': ['“Admin API access token”'],
  'storeToken.dev.step4': ['“Credentials”'],
} as const satisfies Partial<Record<keyof typeof SETUP_MINUTES_EN, readonly string[]>>;

/** The exception belongs to an exact quoted phrase in one key, never the whole line. */
export const withoutShopifyScreenLabels = (key: string, text: string): string =>
  (SHOPIFY_SCREEN_LABELS[key] ?? []).reduce((rest, phrase) => rest.replaceAll(phrase, ''), text);
