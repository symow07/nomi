import { parseDecimal, signOf, type Decimal } from '../types/decimal.js';
import type { ShopifyRefusal } from './setupMinutes.js';
import type { StoreItem, StoreVariant } from './storeFeed.js';

/**
 * BLOCK 4.4 — A PASSWORD-PROTECTED SHOPIFY STORE, READ WITH THE OWNER'S OWN APP: the pure half. The requests are made
 * by src/net/shopifyAdmin.ts; here are the rules for what the owner typed, the two GraphQL queries, and how their
 * answers become the same `StoreItem`s a public store's feed becomes (src/core/onboard/storeFeed.ts), so the rows go
 * into the K1 review unchanged.
 *
 * The Admin API is GraphQL, version 2026-10 (the REST product listing is deprecated). Field names checked against
 * shopify.dev's public reference on 2026-11-08: `products(first, after, query, sortKey)` → `ProductConnection`
 * { `pageInfo { hasNextPage endCursor }`, `nodes` }; `Product` { `id`, `title`, `status`, `options { name }`,
 * `variants(first, after)` }; `ProductVariant` { `price: Money!` (a decimal string), `sku`, `selectedOptions { name
 * value }` }; `Shop.currencyCode`. A compare-at price is never asked for.
 */

export const SHOPIFY_API_VERSION = '2026-10';
/** Products per page and variants per product in one request: 20 × 40 keeps the query's cost near 820 of 1,000. */
export const SHOPIFY_PRODUCTS_PER_PAGE = 20;
export const SHOPIFY_VARIANTS_PER_PRODUCT = 40;
/** Products read at most, as the public store's reader (2,000); variants per product, as Shopify allows (2,048). */
export const SHOPIFY_MAX_PRODUCTS = 2000;
export const SHOPIFY_MAX_VARIANTS = 2048;
export const SHOPIFY_VARIANTS_PER_EXTRA_PAGE = 100;

export const SHOPIFY_PRODUCTS_QUERY = `query NomiProducts($cursor: String) {
  shop { currencyCode }
  products(first: ${SHOPIFY_PRODUCTS_PER_PAGE}, after: $cursor, query: "status:active", sortKey: ID) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title status
      options { name }
      variants(first: ${SHOPIFY_VARIANTS_PER_PRODUCT}) {
        pageInfo { hasNextPage endCursor }
        nodes { price sku selectedOptions { name value } }
      }
    }
  }
}`;

/** The rest of one product's variants, when it has more than fit beside it. */
export const SHOPIFY_VARIANTS_QUERY = `query NomiVariants($id: ID!, $cursor: String) {
  product(id: $id) {
    variants(first: ${SHOPIFY_VARIANTS_PER_EXTRA_PAGE}, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { price sku selectedOptions { name value } }
    }
  }
}`;

// ── what the owner typed ───────────────────────────────────────────────────────────────────────────────────────────

/** A store's .myshopify.com address, as `https://<name>.myshopify.com`; null when it is not one. */
export function readShopifyAddress(raw: string): string | null {
  const s = raw.trim();
  if (s === '' || /\s/.test(s)) return null;
  let url: URL;
  try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || (url.port !== '' && url.port !== '443')) return null;
  const host = url.hostname.toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,61}\.myshopify\.com$/.test(host) ? `https://${host}` : null;
}

export type ShopifyCredential =
  | { readonly way: 'token'; readonly token: string }
  | { readonly way: 'client'; readonly clientId: string; readonly clientSecret: string };

/**
 * Which way the owner chose: the token alone (A), or the Client ID and secret together (B). The address first, then a
 * field with spaces inside, then the way. Only codes come back — never anything typed but the address.
 */
export function readShopifyForm(fields: Readonly<Record<string, unknown>>):
  { readonly ok: true; readonly shop: string; readonly credential: ShopifyCredential } | { readonly ok: false; readonly refusal: ShopifyRefusal; readonly address: string } {
  const text = (k: string): string => (typeof fields[k] === 'string' ? (fields[k] as string).trim() : '');
  const shop = readShopifyAddress(text('address'));
  if (!shop) return { ok: false, refusal: 'not_myshopify', address: '' };
  const token = text('token');
  const clientId = text('client_id');
  const clientSecret = text('client_secret');
  if ([token, clientId, clientSecret].some((v) => /\s/.test(v))) return { ok: false, refusal: 'spaces', address: shop };
  if (token !== '' && (clientId !== '' || clientSecret !== '')) return { ok: false, refusal: 'both_ways', address: shop };
  if (token !== '') return { ok: true, shop, credential: { way: 'token', token } };
  if (clientId !== '' && clientSecret !== '') return { ok: true, shop, credential: { way: 'client', clientId, clientSecret } };
  if (clientId !== '' || clientSecret !== '') return { ok: false, refusal: 'half_pair', address: shop };
  return { ok: false, refusal: 'neither_way', address: shop };
}

// ── what Shopify answered ──────────────────────────────────────────────────────────────────────────────────────────

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const list = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** A Money scalar: a decimal string, exact; null when it is not a positive amount. */
function money(v: unknown): Decimal | null {
  const t = typeof v === 'string' ? v.trim() : null;
  if (t === null || !/^\d+(?:\.\d+)?$/.test(t)) return null;
  const d = parseDecimal(t);
  return d !== null && signOf(d) > 0 ? d : null;
}

/**
 * A GraphQL answer's errors, as a refusal: access denied is a missing scope, throttled is "slow down", anything else
 * is Shopify not answering as it should. Null when there are none.
 */
export function graphqlRefusal(json: unknown): ShopifyRefusal | null {
  const errors = list(obj(json)?.['errors']);
  if (errors.length === 0) return null;
  const codes = errors.map((e) => str(obj(obj(e)?.['extensions'])?.['code']) ?? '');
  if (codes.includes('ACCESS_DENIED')) return 'scope_missing_read_products';
  if (codes.includes('THROTTLED')) return 'rate_limited';
  return 'unavailable';
}

export type ShopifyVariantsPage = { readonly variants: readonly StoreVariant[]; readonly next: string | null };
export type ShopifyProductRead = { readonly id: string; readonly item: StoreItem; readonly moreVariants: string | null };
export type ShopifyProductsPage = { readonly currency: string | null; readonly products: readonly ShopifyProductRead[]; readonly next: string | null };

function variantsOf(connection: unknown, optionNames: readonly string[]): ShopifyVariantsPage | null {
  const c = obj(connection);
  if (!c) return null;
  const info = obj(c['pageInfo']);
  const variants = list(c['nodes']).map((n): StoreVariant => {
    const v = obj(n) ?? {};
    const chosen = new Map(list(v['selectedOptions']).map((o) => [str(obj(o)?.['name']) ?? '', str(obj(o)?.['value']) ?? '']));
    return { price: money(v['price']), sku: str(v['sku']), options: optionNames.map((name) => chosen.get(name) ?? '') };
  });
  return { variants, next: info?.['hasNextPage'] === true ? str(info['endCursor']) : null };
}

/** One page of `SHOPIFY_PRODUCTS_QUERY`'s answer; null when it is not one. Only ACTIVE products, whatever was asked. */
export function readProductsPage(json: unknown): ShopifyProductsPage | null {
  const data = obj(obj(json)?.['data']);
  const products = obj(data?.['products']);
  if (!data || !products) return null;
  const info = obj(products['pageInfo']);
  const out: ShopifyProductRead[] = [];
  for (const n of list(products['nodes'])) {
    const p = obj(n);
    const id = str(p?.['id']);
    const title = str(p?.['title']);
    if (!p || !id || !title || p['status'] !== 'ACTIVE') continue;
    const optionNames = list(p['options']).map((o) => str(obj(o)?.['name']) ?? '').slice(0, 3);
    const variants = variantsOf(p['variants'], optionNames);
    if (!variants) continue;
    out.push({ id, item: { title: title.replace(/\s+/g, ' '), optionNames, variants: variants.variants, currency: null }, moreVariants: variants.next });
  }
  return {
    currency: str(obj(data['shop'])?.['currencyCode']),
    products: out,
    next: info?.['hasNextPage'] === true ? str(info['endCursor']) : null,
  };
}

/** One page of `SHOPIFY_VARIANTS_QUERY`'s answer; null when it is not one. */
export function readVariantsPage(json: unknown, optionNames: readonly string[]): ShopifyVariantsPage | null {
  return variantsOf(obj(obj(obj(json)?.['data'])?.['product'])?.['variants'], optionNames);
}

/**
 * The client-credentials exchange's answer: the token, and whether its scopes let it read products. A write scope
 * also grants its read counterpart (Shopify, "API access scopes", https://shopify.dev/docs/api/usage/access-scopes,
 * read 2026-11-08), so `read_products` OR `write_products` reads them; a token with neither is refused.
 */
const PRODUCT_READING_SCOPES = ['read_products', 'write_products'] as const;
export function readExchange(json: unknown): { readonly token: string; readonly readsProducts: boolean } | null {
  const o = obj(json);
  const token = str(o?.['access_token']);
  if (!o || !token) return null;
  const scopes = (str(o['scope']) ?? '').split(/[\s,]+/).filter(Boolean);
  return { token, readsProducts: PRODUCT_READING_SCOPES.some((s) => scopes.includes(s)) };
}
