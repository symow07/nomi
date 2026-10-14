/**
 * A NAME IN EVERY SCRIPT THE BUYERS WRITE (the owner, 2026-10-14): "Put the Chinese names requirement in the
 * onboarding path itself, not only in the pilot kit — any owner selling to Chinese buyers has this problem on day one."
 *
 * A buyer names a product in their own words: «无纺布袋多少钱？», not "how much is the non-woven bag?". The catalogue
 * search (0156) finds a product only by a name it has, so a product named in English alone is invisible to a
 * buyer writing Chinese — whatever the model understands. A served language written in its OWN script therefore
 * needs, on every product, a name in that script: the product's name, its Chinese name, or one of the names
 * customers use. Chinese, Arabic and Russian are told apart by script; Spanish, French, Portuguese, German and
 * Turkish share the English letters, so no check can tell a Spanish name from an English one, and none is made.
 *
 * Pure. The same pattern is the database's (`~`, in `src/db/setup.ts`) and the page's (`writtenIn`).
 */
export type ScriptLanguage = 'zh' | 'ar' | 'ru';
export const SCRIPT_LANGUAGES: readonly ScriptLanguage[] = ['zh', 'ar', 'ru'];

const RANGES: Readonly<Record<ScriptLanguage, readonly (readonly [number, number])[]>> = {
  // CJK Unified Ideographs, Extension A, and the compatibility ideographs.
  zh: [[0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xf900, 0xfaff]],
  // Arabic, its supplement and extended-A, and both presentation-form blocks.
  ar: [[0x0600, 0x06ff], [0x0750, 0x077f], [0x08a0, 0x08ff], [0xfb50, 0xfdff], [0xfe70, 0xfeff]],
  ru: [[0x0400, 0x04ff]],
};

/** One bracket expression, read the same by Postgres's `~` and by JavaScript. */
export const scriptPattern = (l: ScriptLanguage): string =>
  `[${RANGES[l].map(([a, b]) => `${String.fromCodePoint(a)}-${String.fromCodePoint(b)}`).join('')}]`;

const COMPILED = new Map(SCRIPT_LANGUAGES.map((l) => [l, new RegExp(scriptPattern(l), 'u')] as const));

export const writtenIn = (l: ScriptLanguage, text: string): boolean => COMPILED.get(l)!.test(text);

/** The served languages that have a script of their own, in a fixed order. */
export const scriptLanguagesOf = (served: readonly string[]): readonly ScriptLanguage[] =>
  SCRIPT_LANGUAGES.filter((l) => served.includes(l));

/** The served script languages none of these names is written in. */
export const namesWanted = (served: readonly string[], names: readonly (string | null)[]): readonly ScriptLanguage[] =>
  scriptLanguagesOf(served).filter((l) => !names.some((n) => n !== null && writtenIn(l, n)));
