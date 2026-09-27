/**
 * CC-31 — the article number an import makes up, and how a page tells it from
 * one the owner typed.
 *
 * A product's SKU is who the product IS to her, her buyers and her factory
 * floor (M22 F-02), so an imported line keeps the number it carried. A line
 * that carried none still needs one — `products.sku` is required and unique per
 * business — and gets `NEW-<the moment, in base 36>-<its line>`. That number
 * was then printed beside every such product's name, on the list, the
 * product's page and the buyer's proof, as though she had chosen it.
 *
 * A page shows a SKU only when it is hers (`ownSku`); the generated one stays
 * in the row, where it keeps the product unique and re-imports honest. The
 * shape below is the generator's own: `Date.now()` in base 36 is eight
 * characters that begin with a letter (from 2019 until 2059), so a number an
 * owner types — `NEW-2024-01`, `NEW-20240101-1`, anything in capitals — is
 * never taken for one.
 */

/** The number an imported line with none is given. The only place one is made. */
export const generatedSku = (at: number, line: number): string => `NEW-${at.toString(36)}-${line}`;

const GENERATED = /^NEW-[a-z][0-9a-z]{7}-\d+$/;

/** Was this SKU made up by the import rather than typed by the owner? */
export const isGeneratedSku = (sku: string): boolean => GENERATED.test(sku);

/** The SKU as a page may show it: the owner's own, or nothing. */
export const ownSku = (sku: string | null | undefined): string | null =>
  sku && sku.trim() !== '' && !isGeneratedSku(sku) ? sku : null;
