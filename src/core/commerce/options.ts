/**
 * VAR (decision 31) — A PRODUCT'S OPTIONS: what tells one of it from another
 * (a size, a colour, a shade, a version), with no price and no stock of their
 * own. A variant with a price of its own is its own product (the store import
 * splits those); a question about stock goes to the owner (prompts/response.txt).
 *
 * Written the way the store import already wrote them, and the way an owner
 * types them: one option a line, its name, a colon, its values —
 *
 *     Size: S, M, L
 *     Colour: black, white
 *
 * — or on one line joined by " · ". Values split on commas (any script's) or a
 * semicolon — never a slash: "S/M" is one size.
 */
export type ProductOption = { readonly name: string; readonly values: readonly string[] };

export const MAX_OPTIONS = 5;
export const MAX_VALUES = 40;
export const MAX_OPTION_TEXT = 40;

export type OptionsError = 'no_name' | 'no_values' | 'too_many_options' | 'too_many_values' | 'too_long';

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** The owner's text, as options; empty text is no options. Never half-read: one bad line refuses all. */
export function parseOptions(text: string): { readonly ok: true; readonly options: readonly ProductOption[] } | { readonly ok: false; readonly error: OptionsError } {
  const parts = (text ?? '').split(/\r?\n|\s+·\s+/).map(clean).filter(Boolean);
  if (parts.length > MAX_OPTIONS) return { ok: false, error: 'too_many_options' };
  const options: ProductOption[] = [];
  for (const part of parts) {
    const at = part.search(/[:：]/);
    if (at <= 0) return { ok: false, error: 'no_name' };
    const name = clean(part.slice(0, at));
    const seen = new Set<string>();
    const values = part.slice(at + 1).split(/[,，、;；]/).map(clean).filter((v) => {
      const k = v.toLowerCase();
      if (!v || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (values.length === 0) return { ok: false, error: 'no_values' };
    if (values.length > MAX_VALUES) return { ok: false, error: 'too_many_values' };
    if (name.length > MAX_OPTION_TEXT || values.some((v) => v.length > MAX_OPTION_TEXT)) return { ok: false, error: 'too_long' };
    options.push({ name, values });
  }
  return { ok: true, options };
}

/** As the owner reads them and as they are typed back: "Size: S, M, L · Colour: black". */
export const formatOptions = (options: readonly ProductOption[], joiner = ' · '): string =>
  options.map((o) => `${o.name}: ${o.values.join(', ')}`).join(joiner);

/** What the database holds is options only if it is exactly their shape; anything else is none. */
export function optionsOf(v: unknown): readonly ProductOption[] {
  if (!Array.isArray(v)) return [];
  const out: ProductOption[] = [];
  for (const o of v) {
    if (typeof o !== 'object' || o === null) return [];
    const { name, values } = o as { name?: unknown; values?: unknown };
    if (typeof name !== 'string' || !Array.isArray(values) || !values.every((x) => typeof x === 'string')) return [];
    out.push({ name, values: values as string[] });
  }
  return out;
}
