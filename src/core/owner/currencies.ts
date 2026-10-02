import { canonicalCountry } from './business.js';
import type { Locale } from './i18n/locale.js';
import { type Currency, CURRENCIES, parseCurrency } from '../types/money.js';

/**
 * CUR (the owner's decision, 2026-09-30) — ONE CURRENCY PER WORKSPACE, chosen
 * at sign-up. USD (and ￥ beside it) for everyone was a leftover of the export
 * positioning.
 *
 * The money each country's shops count in, for the countries whose money is on
 * the first list (decision 19): a country here is given its currency without
 * being asked; any other is asked which of the list it sells in (sign-up comes
 * back with the question, like any missing answer). The owner can change it on
 * the profile page until the first price is set — after that every figure in
 * the workspace is in it, and nothing converts.
 *
 * Countries that use the US dollar as their own money are listed with it.
 * Pure: no I/O.
 */
const OWN: Readonly<Record<string, Currency>> = {
  US: 'USD', PR: 'USD', GU: 'USD', VI: 'USD', AS: 'USD', MP: 'USD', UM: 'USD', EC: 'USD', SV: 'USD', PA: 'USD',
  TL: 'USD', FM: 'USD', MH: 'USD', PW: 'USD', BQ: 'USD', TC: 'USD', VG: 'USD', IO: 'USD',
  CN: 'CNY', AE: 'AED', SA: 'SAR', BR: 'BRL', MX: 'MXN', IN: 'INR', ID: 'IDR',
};

/** The currency a country's own shops count in, when it is on the list; null otherwise. */
export const currencyOfCountry = (country: string | null | undefined): Currency | null =>
  country ? OWN[canonicalCountry(country.trim().toUpperCase())] ?? null : null;

/**
 * The currency a sign-up gives a workspace: the country's own, or the one the
 * owner picked from the list when the country's money is not on it; null when
 * the owner must still be asked.
 */
export function currencyForSignup(country: string, picked: string | null | undefined): Currency | null {
  return currencyOfCountry(country) ?? (picked ? parseCurrency(picked.trim().toUpperCase()) : null);
}

/** Does sign-up ask this country which currency? Only when its own is not on the list. */
export const asksCurrency = (country: string | null | undefined): boolean =>
  !!country?.trim() && currencyOfCountry(country) === null;

const INTL_TAG: Record<Locale, string> = { en: 'en-US', zh: 'zh-CN', ar: 'ar', es: 'es', fr: 'fr' };

/** "UAE dirham (AED)" / "阿联酋迪拉姆 (AED)" / «درهم إماراتي (AED)» — the name in the owner's language, then the code. */
export function currencyLabel(locale: Locale, c: Currency): string {
  let name = '';
  try {
    name = new Intl.DisplayNames([INTL_TAG[locale]], { type: 'currency' }).of(c) ?? '';
  } catch {
    name = '';
  }
  return name && name !== c ? `${name} (${c})` : c;
}

/** The list, in its own order, for a select. */
export const CURRENCY_CHOICES: readonly Currency[] = CURRENCIES;
