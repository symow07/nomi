import type { Currency } from '../types/money.js';
import type { ExtractedProduct } from './catalogImport.js';

/**
 * G16 · M37 — a re-photographed price sheet updates what changed.
 *
 * Until now every imported line was an INSERT that skipped a product already
 * in her catalogue. So the one thing a printed price list is for — telling her
 * buyers this year's prices — could not reach her catalogue from a photograph:
 * she photographed the new sheet, confirmed, and was told the products were
 * "already here". Every changed price stayed at last year's.
 *
 * This compares the lines she confirmed against what she already sells, and
 * sorts each into exactly one pile:
 *
 *   added      not in her catalogue — becomes a product, not yet sellable
 *   changed    in her catalogue, and the page gives a different price or MOQ
 *   unchanged  in her catalogue, and the page agrees with it
 *   held       in her catalogue, but not something to change from a page
 *
 * ONE RULE, BOTH SCREENS. The review shows this diff and confirm applies this
 * diff, each computed by this function from the same staged lines. The recurring
 * bug in this repository is two paths deriving the same list by different rules;
 * there is one here.
 *
 * WHICH PRODUCT A LINE IS. Her article number, when the line carries one — it is
 * who the product is (M22). Without one, her product's name, and only when
 * exactly ONE product has it: a name two of her products share is not a match,
 * because guessing changes the price of the wrong one.
 *
 * WHAT A PAGE CAN CHANGE. The price and the MOQ, the two numbers on it. A line
 * that carries no price never erases the one she has; a line without an MOQ
 * never resets hers to a default. The name is not changed from a page: it is
 * how her buyers already know the product, and a misread letter would rename it.
 */

/** A product she already has, as the comparison needs to see it. */
export type CatalogueEntry = {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly nameZh: string | null;
  /** The list price, in `currency`. null: she has not given one yet. */
  readonly price: number | null;
  /** The product's currency; null when the row holds one this product does not know. */
  readonly currency: Currency | null;
  readonly moq: number;
  /** Her lowest price for this product, in `currency`, when she has stated one. */
  readonly floor: number | null;
};

export type LineChange = {
  readonly line: ExtractedProduct;
  readonly product: CatalogueEntry;
  readonly price: { readonly from: number | null; readonly to: number } | null;
  readonly moq: { readonly from: number; readonly to: number } | null;
};

/**
 * Why a line that names one of her products is not changed from this page.
 *
 *   matches_several  more than one of her products answers to this line
 *   twice_on_page    an earlier line on the page already named this product
 *   other_currency   the page prices it in a currency the product is not in
 *   below_floor      the page's price is under the lowest she allows — the
 *                    same refusal the product's own page gives (M29)
 */
export type HeldReason = 'matches_several' | 'twice_on_page' | 'other_currency' | 'below_floor';

export type CatalogueDiff = {
  readonly added: readonly ExtractedProduct[];
  readonly changed: readonly LineChange[];
  readonly unchanged: readonly { readonly line: ExtractedProduct; readonly product: CatalogueEntry }[];
  readonly held: readonly { readonly line: ExtractedProduct; readonly reason: HeldReason; readonly product: CatalogueEntry | null }[];
};

const key = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Four places, as the catalogue stores a price: 0.45 and 0.4500 are one price. */
const samePrice = (a: number, b: number): boolean => a.toFixed(4) === b.toFixed(4);

export function diffAgainstCatalogue(
  lines: readonly ExtractedProduct[], catalogue: readonly CatalogueEntry[],
): CatalogueDiff {
  const bySku = new Map<string, CatalogueEntry[]>();
  const byName = new Map<string, CatalogueEntry[]>();
  const file = (m: Map<string, CatalogueEntry[]>, k: string, e: CatalogueEntry) => {
    const list = m.get(k) ?? [];
    if (!list.includes(e)) list.push(e);
    m.set(k, list);
  };
  for (const e of catalogue) {
    file(bySku, key(e.sku), e);
    file(byName, key(e.name), e);
    if (e.nameZh) file(byName, key(e.nameZh), e);
  }

  const added: ExtractedProduct[] = [];
  const changed: LineChange[] = [];
  const unchanged: CatalogueDiff['unchanged'][number][] = [];
  const held: CatalogueDiff['held'][number][] = [];
  const named = new Set<string>();

  for (const line of lines) {
    const found = line.sku !== null ? bySku.get(key(line.sku)) ?? [] : byName.get(key(line.name)) ?? [];
    if (found.length === 0) { added.push(line); continue; }
    if (found.length > 1) { held.push({ line, reason: 'matches_several', product: null }); continue; }
    const product = found[0]!;
    if (named.has(product.id)) { held.push({ line, reason: 'twice_on_page', product }); continue; }
    named.add(product.id);

    let price: LineChange['price'] = null;
    if (line.price !== null) {
      if (product.currency !== line.price.currency) { held.push({ line, reason: 'other_currency', product }); continue; }
      if (product.price === null || !samePrice(product.price, line.price.amount)) {
        if (product.floor !== null && line.price.amount < product.floor) {
          held.push({ line, reason: 'below_floor', product }); continue;
        }
        price = { from: product.price, to: line.price.amount };
      }
    }
    const moq = line.moq !== null && line.moq !== product.moq ? { from: product.moq, to: line.moq } : null;

    if (price || moq) changed.push({ line, product, price, moq });
    else unchanged.push({ line, product });
  }
  return { added, changed, unchanged, held };
}
