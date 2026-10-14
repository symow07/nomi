import { t } from './say.js';
import { esc } from './layout.js';
import * as show from './values.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import type { NamesWanted } from '../../db/setup.js';
import type { ScriptLanguage } from '../../core/onboard/scriptNames.js';

/**
 * 2026-10-14 (the owner) — the products a buyer writing Chinese (or Arabic, or Russian) cannot find by name, said where
 * setting up is done: Getting started's products step, Home's next step, the list, the product's page. One wording.
 */
export const languageCalled = (locale: Locale, lang: ScriptLanguage): string => {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(lang) ?? lang;
  } catch {
    return lang;
  }
};

/** One line per language with products missing a name: "Products with no name in Chinese: 3 of 5…". */
export const namesWantedLines = (locale: Locale, names: readonly NamesWanted[]): string =>
  names.map((w) => `<p class="fwarn">${esc(t(locale, 'setup.names.missing', {
    language: languageCalled(locale, w.lang), n: show.count(locale, w.missing), total: show.count(locale, w.of),
  }))}</p>`).join('');
