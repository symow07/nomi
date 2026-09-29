/**
 * T3 — FINDABILITY (the one-month build order, 2026-09-29).
 *
 * A customer's words reach a product only through `product_aliases`: the
 * retrieval every turn runs (`retrieve_products`, migration 0007) matches
 * aliases and nothing else, and a product the retrieval did not return is
 * dropped from the turn (`src/pipeline/turn.ts`). A product with no alias is
 * never found, never offered to the model, never quoted — and the import wrote
 * none, so nothing imported could ever be sold.
 *
 * The names a product is found by: its name, its Chinese name, and the names
 * customers use. Each is trimmed to one space between words, at most
 * `MAX_ALIAS_LENGTH` characters, and kept once whatever its case.
 */

export const MAX_ALIAS_LENGTH = 120;
/** How many names customers use may be added in one go. */
export const MAX_CUSTOMER_NAMES = 20;

export type AliasRow = {
  readonly alias: string;
  /** The script it is written in: `und` is any other (a Latin name may be English, Spanish or French). */
  readonly language: 'zh' | 'ar' | 'und';
  readonly aliasType: 'common' | 'zh' | 'ar';
};

const HAN = /\p{Script=Han}/u;
const ARABIC = /\p{Script=Arabic}/u;

/** One space between words, nothing around them; null when nothing is left. */
export function cleanName(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
  return s === '' ? null : s;
}

export function aliasRow(name: string): AliasRow {
  if (HAN.test(name)) return { alias: name, language: 'zh', aliasType: 'zh' };
  if (ARABIC.test(name)) return { alias: name, language: 'ar', aliasType: 'ar' };
  return { alias: name, language: 'und', aliasType: 'common' };
}

/** The rows for these names: cleaned, each once whatever its case, none too long. */
export function aliasRowsFor(names: readonly (string | null | undefined)[]): AliasRow[] {
  const seen = new Set<string>();
  const out: AliasRow[] = [];
  for (const raw of names) {
    const n = cleanName(raw);
    if (n === null || n.length > MAX_ALIAS_LENGTH) continue;
    const key = n.toLocaleLowerCase('und');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(aliasRow(n));
  }
  return out;
}

export type CustomerNames =
  | { readonly ok: true; readonly names: readonly string[] }
  | { readonly ok: false; readonly error: 'too_long' | 'too_many' };

/**
 * The owner's box of names customers use: one per line, or separated by
 * commas in any of the three scripts (, ， 、 ،). A name too long, or more than
 * `MAX_CUSTOMER_NAMES`, is refused whole — never silently cut.
 */
export function parseCustomerNames(raw: string | null | undefined): CustomerNames {
  const parts = (raw ?? '').split(/[\n\r,，、،]+/u).map(cleanName).filter((n): n is string => n !== null);
  if (parts.some((n) => n.length > MAX_ALIAS_LENGTH)) return { ok: false, error: 'too_long' };
  const names = aliasRowsFor(parts).map((r) => r.alias);
  if (names.length > MAX_CUSTOMER_NAMES) return { ok: false, error: 'too_many' };
  return { ok: true, names };
}
