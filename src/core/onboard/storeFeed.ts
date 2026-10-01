import type { ImportRow } from './importReview.js';

/**
 * K8 — A STORE'S OWN CATALOGUE, AS REVIEW ROWS (the onboarding plan, decision
 * 30; the owner's instruction of 2026-10-01).
 *
 * An online shop's products live in its store, not on a price list. Two ways
 * in, one shape out:
 *   · the store's public product list — Shopify's `/products.json`,
 *     WooCommerce's Store API (read by src/api/web/storeImport.ts);
 *   · a file the store exported, its columns mapped (csvTable.ts).
 * Either becomes StoreItems, and StoreItems become K1's rows, reviewed like
 * any list. These are the owner's own figures — customers already see them —
 * so the tick rule is a paste's: flagged rows one by one, the rest as a block.
 *
 * THE VARIANT RULE (decision 31, v1): each priced variant is its own product;
 * variants that share a price stay one product, and their options (sizes,
 * colours, shades) become that product's knowledge — "Size: S, M, L". So a
 * range of 30 products in 4 sizes and 3 colours stays 30 rows, not 360.
 * A compare-at price is never the price. Pure: no I/O.
 */

export type StoreVariant = {
  /** In the store's own figures, major units; null when the store gives none. */
  readonly price: number | null;
  readonly sku: string | null;
  /** This variant's value for each of the item's options, in order. */
  readonly options: readonly string[];
};

export type StoreItem = {
  readonly title: string;
  readonly optionNames: readonly string[];
  readonly variants: readonly StoreVariant[];
  /** The currency the store states (WooCommerce, Etsy), when it states one. */
  readonly currency: string | null;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const clean = (s: string): string => s.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/** A figure as a store writes it: "24.00", "24", 24. */
function amount(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/,/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

/** Shopify's placeholder for a product with one variant and no real option. */
const PLACEHOLDER = /^(title|default title)$/i;

/** Shopify's public `/products.json`; null when the page is not one. */
export function parseShopify(json: unknown): StoreItem[] | null {
  const products = (json as { products?: unknown } | null)?.products;
  if (!Array.isArray(products)) return null;
  const out: StoreItem[] = [];
  for (const p of products) {
    const title = str((p as Record<string, unknown>)['title']);
    if (!title) continue;
    const options = Array.isArray((p as Record<string, unknown>)['options']) ? (p as { options: unknown[] }).options : [];
    const optionNames = options.map((o) => str((o as Record<string, unknown>)['name']) ?? '').slice(0, 3);
    const variants = Array.isArray((p as Record<string, unknown>)['variants']) ? (p as { variants: unknown[] }).variants : [];
    out.push({
      title: clean(title),
      optionNames,
      currency: null,
      variants: variants.map((v): StoreVariant => {
        const r = v as Record<string, unknown>;
        return {
          // `price` is what the shop sells at; `compare_at_price` is the struck
          // one beside it, and is never read.
          price: amount(r['price']),
          sku: str(r['sku']),
          options: [r['option1'], r['option2'], r['option3']].slice(0, optionNames.length).map((x) => str(x) ?? ''),
        };
      }),
    });
  }
  return out;
}

/** A WooCommerce Store API price: minor units as a string, and how many there are. */
function wooPrice(prices: unknown): number | null {
  const p = prices as Record<string, unknown> | null;
  if (!p) return null;
  const minor = typeof p['currency_minor_unit'] === 'number' ? p['currency_minor_unit'] : 2;
  const raw = str(p['price']);
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw) / 10 ** minor;
  return n > 0 ? n : null;
}

export type WooProduct = {
  readonly id: number;
  readonly item: StoreItem;
  /** Variation ids to read, when a variable product's price differs by option. */
  readonly variationIds: readonly number[];
};

/** WooCommerce's public Store API product list; null when the page is not one. */
export function parseWoo(json: unknown): WooProduct[] | null {
  if (!Array.isArray(json)) return null;
  if (json.length > 0 && typeof (json[0] as Record<string, unknown>)?.['prices'] !== 'object') return null;
  const out: WooProduct[] = [];
  for (const p of json) {
    const r = p as Record<string, unknown>;
    const title = str(r['name']);
    if (!title) continue;
    const attrs = Array.isArray(r['attributes']) ? (r['attributes'] as Record<string, unknown>[]) : [];
    const optionNames = attrs.map((a) => str(a['name']) ?? '').slice(0, 3);
    const values = attrs.slice(0, 3).map((a) => (Array.isArray(a['terms']) ? (a['terms'] as Record<string, unknown>[]).map((t) => str(t['name']) ?? '').filter(Boolean) : []));
    const prices = r['prices'] as Record<string, unknown> | undefined;
    const currency = str(prices?.['currency_code']);
    const range = prices?.['price_range'] as Record<string, unknown> | null | undefined;
    const varies = range !== null && range !== undefined && str(range['min_amount']) !== str(range['max_amount']);
    const ids = Array.isArray(r['variations']) ? (r['variations'] as Record<string, unknown>[]).map((v) => Number(v['id'])).filter((n) => Number.isInteger(n) && n > 0) : [];
    out.push({
      id: Number(r['id']),
      variationIds: varies ? ids : [],
      item: {
        title: clean(title), optionNames, currency,
        // One variant carrying every value, until the variations' own prices are read.
        variants: [{ price: wooPrice(prices), sku: str(r['sku']), options: values.map((v) => v.join(', ')) }],
      },
    });
  }
  return out;
}

/** A WooCommerce variation read on its own: its price and its values. */
export function parseWooVariation(json: unknown, optionNames: readonly string[]): StoreVariant | null {
  const r = json as Record<string, unknown> | null;
  if (!r || typeof r['prices'] !== 'object') return null;
  const attrs = Array.isArray(r['variation']) ? (r['variation'] as Record<string, unknown>[])
    : Array.isArray(r['attributes']) ? (r['attributes'] as Record<string, unknown>[]) : [];
  const valueOf = (name: string): string => {
    const a = attrs.find((x) => (str(x['attribute']) ?? str(x['name']) ?? '').toLowerCase() === name.toLowerCase());
    return a ? (str(a['value']) ?? '') : '';
  };
  return { price: wooPrice(r['prices']), sku: str(r['sku']), options: optionNames.map(valueOf) };
}

const cents = (n: number | null): string => (n === null ? 'none' : String(Math.round(n * 100)));

/**
 * The rows for these items. One row per distinct price of an item; its name
 * says which options it is when the price differs by option; its options go
 * with it as knowledge. `line` is what the review shows it was read from.
 */
export function itemsToRows(items: readonly StoreItem[], opts: { readonly defaultUnit: string; readonly startAt?: number; readonly source: string }): ImportRow[] {
  const rows: ImportRow[] = [];
  let n = opts.startAt ?? 1;
  for (const item of items) {
    const real = item.optionNames.map((name, i) => ({ name, i })).filter(({ name, i }) =>
      name !== '' && !(PLACEHOLDER.test(name) && item.variants.every((v) => !v.options[i] || PLACEHOLDER.test(v.options[i]!))));
    const groups = new Map<string, StoreVariant[]>();
    for (const v of item.variants) groups.set(cents(v.price), [...(groups.get(cents(v.price)) ?? []), v]);
    if (groups.size === 0) groups.set('none', []);
    const several = groups.size > 1;
    for (const group of groups.values()) {
      const valuesOf = (i: number) => [...new Set(group.flatMap((v) => (v.options[i] ?? '').split(/,\s*/)).filter(Boolean))];
      // Which option decides the price: one value per group, different between groups.
      const decider = several ? real.find(({ i }) => valuesOf(i).length === 1) : undefined;
      const label = !several ? '' : decider ? valuesOf(decider.i)[0]!
        : group.slice(0, 3).map((v) => real.map(({ i }) => v.options[i]).filter(Boolean).join(' / ')).join(', ') + (group.length > 3 ? ` +${group.length - 3}` : '');
      const name = several && label ? `${item.title} — ${label}` : item.title;
      const knowledge = real.map(({ name: optName, i }) => {
        const vals = valuesOf(i);
        return vals.length ? `${optName}: ${vals.join(', ')}` : '';
      }).filter(Boolean).join(' · ');
      const price = group[0]?.price ?? null;
      rows.push({
        key: `s${n}`, photo: null,
        line: [opts.source, item.title, label, price === null ? '' : String(price)].filter(Boolean).join(' · '),
        sku: group.length === 1 ? group[0]!.sku : null,
        name: name.slice(0, 120), nameZh: /[一-鿿]/.test(name) ? name.slice(0, 120) : null,
        price, unit: opts.defaultUnit, moq: null, names: [],
        refused: null, removed: false, ticked: false, challenge: null, reopened: false, edited: false,
        ...(knowledge ? { options: knowledge.slice(0, 600) } : {}),
      });
      n++;
    }
  }
  return rows;
}
