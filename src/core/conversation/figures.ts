/**
 * G10 (decision 38) — THE FIGURES IN A REPLY, IN WESTERN DIGITS, taken from
 * the reply itself. A draft in a language the owner may not read still shows
 * them every number it would send — a price, a quantity, a percentage, a date
 * — so a wrong figure can be caught without reading the sentence round it.
 *
 * Digits in other scripts are read as the digits they are: Arabic-Indic
 * (٠–٩), Extended Arabic-Indic (۰–۹), Devanagari (०–९), full-width (０–９).
 * Arabic's decimal and thousands marks (٫ ٬) become "." and ",". Each figure
 * once, in the order it first appears. Pure: no I/O.
 */
const DIGIT_BASES = [0x0660, 0x06f0, 0x0966, 0xff10] as const;

export function westernDigits(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    const base = DIGIT_BASES.find((b) => code >= b && code <= b + 9);
    out += base !== undefined ? String(code - base) : ch === '٫' ? '.' : ch === '٬' ? ',' : ch;
  }
  return out;
}

export function figuresIn(text: string): string[] {
  const seen = new Set<string>();
  for (const m of westernDigits(text).matchAll(/\d+(?:[.,]\d+)*%?/g)) seen.add(m[0]);
  return [...seen];
}
