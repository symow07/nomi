import https from 'node:https';
import { publicLookup } from './publicFetch.js';
import type { ShopifyRefusal } from '../core/onboard/setupMinutes.js';
import type { StoreItem, StoreVariant } from '../core/onboard/storeFeed.js';
import {
  SHOPIFY_API_VERSION, SHOPIFY_MAX_PRODUCTS, SHOPIFY_MAX_VARIANTS, SHOPIFY_PRODUCTS_QUERY, SHOPIFY_VARIANTS_QUERY,
  graphqlRefusal, readExchange, readProductsPage, readVariantsPage, type ShopifyCredential,
} from '../core/onboard/shopifyGraphql.js';

/**
 * BLOCK 4.4 — A PASSWORD-PROTECTED SHOPIFY STORE, READ WITH THE OWNER'S OWN APP: the requests. Its own reader, never
 * the public fetcher (which follows redirects) nor storeImport.ts.
 *
 *   · Only `https://<name>.myshopify.com`, port 443, through the public-address lookup (`publicLookup`: a name that
 *     resolves to any private, loopback or link-local address is refused at connect time). NO redirect is followed:
 *     a credential never goes anywhere but where the owner pointed it. 10 seconds and 5 MB a request.
 *   · Way A: the owner's Admin API token, sent as `X-Shopify-Access-Token`. Way B: one client-credentials exchange
 *     (`POST /admin/oauth/access_token`, form-encoded `grant_type=client_credentials`, `client_id`, `client_secret`,
 *     no `scope`), refused unless the answer's scope includes `read_products` or `write_products` (a write scope grants
 *     its read: shopify.dev/docs/api/usage/access-scopes); its token is used for this read and dropped.
 *   · The token, the ID and the secret travel only in the request: never in an address, a log line, an error, a
 *     refusal or anything kept. A refusal is a code (C0's `ShopifyRefusal`), never Shopify's own words.
 *   · Products: GraphQL Admin API 2026-10, ACTIVE only, cursor paging, at most 2,000 products and 2,048 variants each,
 *     and a fixed budget of requests; the shop's currency must be the workspace's (`currency_mismatch`).
 *
 * The transport is passed in: tests give one that records every request and answers as Shopify would.
 */

export type ShopifyRequest = {
  readonly method: 'GET' | 'POST';
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
};
export type ShopifyAnswer =
  | { readonly status: number; readonly location: string | null; readonly body: string }
  | { readonly failed: 'timeout' | 'not_found' | 'unavailable' };
export type ShopifyTransport = (req: ShopifyRequest) => Promise<ShopifyAnswer>;

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 5 * 1024 * 1024;
/** Requests in one read, at most: 100 pages of products and the extra variant pages beside them. */
export const SHOPIFY_REQUEST_BUDGET = 250;

/**
 * The production transport: one HTTPS request on 443, public addresses only, no redirect followed, nothing logged.
 * Anything carrying a credential (a token header or a body) goes only to a .myshopify.com host; the storefront's
 * password check, which carries none, may ask the store's own domain.
 */
export const shopifyTransport: ShopifyTransport = (req) => new Promise((resolve) => {
  let url: URL;
  try { url = new URL(req.url); } catch { return resolve({ failed: 'unavailable' }); }
  const credentialed = req.body !== undefined || Object.keys(req.headers).some((h) => h.toLowerCase() === 'x-shopify-access-token');
  if (url.protocol !== 'https:' || (url.port !== '' && url.port !== '443') || url.username !== '' || url.password !== ''
    || (credentialed && !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(url.hostname))) {
    return resolve({ failed: 'unavailable' });
  }
  let settled = false;
  const done = (a: ShopifyAnswer): void => { if (!settled) { settled = true; clearTimeout(deadline); resolve(a); } };
  const r = https.request(url, {
    method: req.method, lookup: publicLookup as never, timeout: TIMEOUT_MS, agent: false,
    headers: {
      ...req.headers, 'user-agent': 'NomiCatalogReader/1.0 (+https://nomidoes.com)',
      ...(req.body === undefined ? {} : { 'content-length': String(Buffer.byteLength(req.body)) }),
    },
  }, (res) => {
    const status = res.statusCode ?? 0;
    const location = typeof res.headers.location === 'string' ? res.headers.location : null;
    if (status >= 300 && status < 400) { res.resume(); return done({ status, location, body: '' }); }
    let size = 0;
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BYTES) { r.destroy(); done({ failed: 'unavailable' }); return; }
      chunks.push(c);
    });
    res.on('end', () => done({ status, location, body: Buffer.concat(chunks).toString('utf8') }));
    res.on('error', () => done({ failed: 'unavailable' }));
  });
  // The socket's own limit is idle time; this one is the whole request.
  const deadline = setTimeout(() => { r.destroy(); done({ failed: 'timeout' }); }, TIMEOUT_MS);
  r.on('timeout', () => { r.destroy(); done({ failed: 'timeout' }); });
  r.on('error', (e: NodeJS.ErrnoException) => done({ failed: e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN' ? 'not_found' : 'unavailable' }));
  r.end(req.body);
});

/** What any answer that is not a 200 means, wherever it came. */
function statusRefusal(a: ShopifyAnswer, unauthorised: ShopifyRefusal): ShopifyRefusal | null {
  if ('failed' in a) return a.failed;
  if (a.status === 200) return null;
  if (a.status >= 300 && a.status < 400) return 'redirect';
  if (a.status === 401) return unauthorised;
  // The design spec's table: a 403 is read as the app lacking the products scope. (Shopify's reference also names 403
  // for a shop it has closed to the API; either way nothing can be read, and the owner is told what to check.)
  if (a.status === 403) return 'scope_missing_read_products';
  if (a.status === 404) return 'not_found';
  if (a.status === 429) return 'rate_limited';
  return 'unavailable';
}

const json = (body: string): unknown => { try { return JSON.parse(body); } catch { return null; } };

/** Way B: the client-credentials exchange. The token, or why there is none. */
async function exchange(shop: string, clientId: string, clientSecret: string, transport: ShopifyTransport):
  Promise<{ readonly ok: true; readonly token: string } | { readonly ok: false; readonly refusal: ShopifyRefusal }> {
  const a = await transport({
    method: 'POST', url: `${shop}/admin/oauth/access_token`,
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString(),
  });
  if (!('failed' in a) && a.status >= 400 && a.status < 500) {
    // Shopify's client-credentials page names the first in its error text; the second is the owner's list.
    if (/shop_not_permitted/.test(a.body)) return { ok: false, refusal: 'shop_not_permitted' };
    if (/application_cannot_be_found/.test(a.body)) return { ok: false, refusal: 'application_cannot_be_found' };
    if (a.status === 400 && /invalid_client|invalid_request|unauthori[sz]ed/i.test(a.body)) return { ok: false, refusal: 'exchange_401' };
  }
  const refused = statusRefusal(a, 'exchange_401');
  if (refused) return { ok: false, refusal: refused };
  const read = readExchange(json((a as { body: string }).body));
  if (!read) return { ok: false, refusal: 'unavailable' };
  if (!read.readsProducts) return { ok: false, refusal: 'scope_missing_read_products' };
  return { ok: true, token: read.token };
}

export type ShopifyRead =
  | { readonly ok: true; readonly currency: string; readonly items: readonly StoreItem[] }
  | { readonly ok: false; readonly refusal: ShopifyRefusal };

/**
 * Every ACTIVE product of the store, read with the owner's credential, the shop's currency checked against the
 * workspace's before more than one page is read.
 */
export async function readShopifyStore(input: { readonly shop: string; readonly credential: ShopifyCredential; readonly currency: string },
  transport: ShopifyTransport): Promise<ShopifyRead> {
  let token: string;
  let unauthorised: ShopifyRefusal;
  if (input.credential.way === 'token') {
    token = input.credential.token;
    unauthorised = 'token_401';
  } else {
    const ex = await exchange(input.shop, input.credential.clientId, input.credential.clientSecret, transport);
    if (!ex.ok) return ex;
    token = ex.token;
    unauthorised = 'exchange_401';
  }
  let budget = SHOPIFY_REQUEST_BUDGET;
  const ask = async (query: string, variables: Record<string, unknown>): Promise<{ readonly ok: true; readonly json: unknown } | { readonly ok: false; readonly refusal: ShopifyRefusal }> => {
    if (budget-- <= 0) return { ok: false, refusal: 'unavailable' };
    const a = await transport({
      method: 'POST', url: `${input.shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      headers: { 'content-type': 'application/json', accept: 'application/json', 'x-shopify-access-token': token },
      body: JSON.stringify({ query, variables }),
    });
    const refused = statusRefusal(a, unauthorised);
    if (refused) return { ok: false, refusal: refused };
    const body = json((a as { body: string }).body);
    const graphql = graphqlRefusal(body);
    return graphql ? { ok: false, refusal: graphql } : { ok: true, json: body };
  };

  const items: StoreItem[] = [];
  let cursor: string | null = null;
  let currency: string | null = null;
  do {
    const page = await ask(SHOPIFY_PRODUCTS_QUERY, { cursor });
    if (!page.ok) return page;
    const read = readProductsPage(page.json);
    if (!read) return { ok: false, refusal: 'unavailable' };
    if (currency === null) {
      if (!read.currency) return { ok: false, refusal: 'unavailable' };
      if (read.currency.toUpperCase() !== input.currency.toUpperCase()) return { ok: false, refusal: 'currency_mismatch' };
      currency = read.currency.toUpperCase();
    }
    for (const p of read.products) {
      if (items.length >= SHOPIFY_MAX_PRODUCTS) break;
      const variants: StoreVariant[] = [...p.item.variants];
      let more = p.moreVariants;
      while (more && variants.length < SHOPIFY_MAX_VARIANTS) {
        const extra = await ask(SHOPIFY_VARIANTS_QUERY, { id: p.id, cursor: more });
        if (!extra.ok) return extra;
        const v = readVariantsPage(extra.json, p.item.optionNames);
        if (!v) return { ok: false, refusal: 'unavailable' };
        variants.push(...v.variants);
        more = v.next;
      }
      items.push({ ...p.item, variants: variants.slice(0, SHOPIFY_MAX_VARIANTS), currency });
    }
    cursor = items.length < SHOPIFY_MAX_PRODUCTS ? read.next : null;
  } while (cursor);
  return items.length === 0 || currency === null ? { ok: false, refusal: 'no_products' } : { ok: true, currency, items };
}

/**
 * Is this storefront closed by a password? Asked with NO credential, no redirect followed: Shopify answers a locked
 * store's product feed with a 401, or by sending the visitor to its /password page. Anything else (open, gone, not
 * answering) is not "password-protected".
 */
export async function storefrontLocked(origin: string, transport: ShopifyTransport): Promise<boolean> {
  const a = await transport({ method: 'GET', url: `${origin.replace(/\/+$/, '')}/products.json?limit=1`, headers: { accept: 'application/json' } });
  if ('failed' in a) return false;
  if (a.status === 401) return true;
  if (a.status >= 300 && a.status < 400 && a.location) {
    try { return /^\/password\/?$/.test(new URL(a.location, origin).pathname); } catch { return false; }
  }
  return false;
}
