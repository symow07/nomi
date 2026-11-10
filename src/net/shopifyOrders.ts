import type { ShopifyAnswer, ShopifyTransport } from './shopifyAdmin.js';
import { SHOPIFY_API_VERSION, type ShopifyCredential } from '../core/onboard/shopifyGraphql.js';
import {
  SHOPIFY_ORDER_QUERY, SHOPIFY_SCOPES_QUERY, orderScopes, orderSearch, readGrantedScopes, readOrderAnswer,
  type OrderReading,
} from '../core/commerce/shopifyOrders.js';

/**
 * BLOCK 5.5 — SHOPIFY ORDERS: the requests, through #453's transport (HTTPS, `.myshopify.com` only for a credential,
 * public addresses, no redirect, 10 s and 5 MB a request). GraphQL Admin API 2026-10 only; a query, never a mutation.
 *
 *   · The credential travels only in the request: never in an address, a log line, an error or anything returned.
 *   · The client way exchanges for a token on each use (`client_credentials`, own organisation only); the token is
 *     never kept. Its answer's `scope` is the grant.
 *   · Shopify's own words never come back: a lookup is an outcome, a connect is a refusal code.
 *   · Pacing: Shopify meters cost per app and store (`extensions.cost.throttleStatus`); `ShopifyPacer` keeps what the
 *     last answer said for each store, and a request waits at most `MAX_WAIT_MS` for the bucket to hold its requested
 *     cost — longer, or a budget that cannot refill, is "unavailable" with no request made. No retry, ever.
 *   · The whole lookup — exchange, wait and query — has `LOOKUP_DEADLINE_MS`; past it, it is unavailable.
 */

/** The whole lookup, at most (t1r's condition 2): one exchange, the pacing wait and the query together. */
export const LOOKUP_DEADLINE_MS = 10_000;
/** The longest a lookup waits for Shopify's cost bucket before it gives up. */
export const MAX_WAIT_MS = 2_000;
/** Before Shopify has said what this query costs, it is assumed to cost this much. */
export const ASSUMED_QUERY_COST = 50;
/** A store's remembered budget is forgotten after this long. */
const BUDGET_KEPT_MS = 60_000;

export type Clock = { readonly now: () => number; readonly sleep: (ms: number) => Promise<void> };
export const realClock: Clock = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

type Budget = { readonly available: number; readonly maximum: number; readonly restore: number; readonly at: number; readonly cost: number };

/** Shopify's cost bucket per store, as its answers last described it. One per process. */
export class ShopifyPacer {
  private readonly budgets = new Map<string, Budget>();

  /** How long to wait before a request to `shop`, or null when it must not be made at all. Reserves the cost. */
  admit(shop: string, now: number): number | null {
    const b = this.budgets.get(shop);
    if (!b || now - b.at > BUDGET_KEPT_MS) { this.budgets.delete(shop); return 0; }
    if (b.restore <= 0 || b.cost > b.maximum) return null;
    const available = Math.min(b.maximum, b.available + (b.restore * (now - b.at)) / 1000);
    const wait = available >= b.cost ? 0 : Math.ceil(((b.cost - available) / b.restore) * 1000);
    if (wait > MAX_WAIT_MS) return null;
    // Spent at the moment it may start, so a second lookup on the same store waits behind this one.
    this.budgets.set(shop, { ...b, available: available + (b.restore * wait) / 1000 - b.cost, at: now + wait });
    return wait;
  }

  /** What an answer said. Anything malformed forgets the store's budget rather than guess one. */
  note(shop: string, extensions: unknown, now: number): void {
    const cost = extensions && typeof extensions === 'object' ? (extensions as Record<string, unknown>)['cost'] : null;
    const c = cost && typeof cost === 'object' ? cost as Record<string, unknown> : null;
    const t = c?.['throttleStatus'] && typeof c['throttleStatus'] === 'object' ? c['throttleStatus'] as Record<string, unknown> : null;
    const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
    const available = n(t?.['currentlyAvailable']);
    const maximum = n(t?.['maximumAvailable']);
    const restore = n(t?.['restoreRate']);
    const requested = n(c?.['requestedQueryCost']);
    if (available === null || maximum === null || restore === null || maximum <= 0 || available > maximum) {
      this.budgets.delete(shop);
      return;
    }
    this.budgets.set(shop, { available, maximum, restore, at: now, cost: requested ?? ASSUMED_QUERY_COST });
  }
}

const json = (body: string): unknown => { try { return JSON.parse(body); } catch { return null; } };
const ok200 = (a: ShopifyAnswer): a is Extract<ShopifyAnswer, { status: number }> => !('failed' in a) && a.status === 200;

export type TokenRead = { readonly ok: true; readonly token: string; readonly scopes: readonly string[] | null }
  | { readonly ok: false; readonly refusal: 'credential_refused' | 'unavailable' };

/** The token to use: the owner's own, or one client-credentials exchange (whose `scope` is the grant). */
export async function tokenFor(shop: string, credential: ShopifyCredential, transport: ShopifyTransport): Promise<TokenRead> {
  if (credential.way === 'token') return { ok: true, token: credential.token, scopes: null };
  const a = await transport({
    method: 'POST', url: `${shop}/admin/oauth/access_token`,
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: credential.clientId, client_secret: credential.clientSecret }).toString(),
  });
  if ('failed' in a) return { ok: false, refusal: 'unavailable' };
  if (a.status === 400 || a.status === 401 || a.status === 403) return { ok: false, refusal: 'credential_refused' };
  if (a.status !== 200) return { ok: false, refusal: 'unavailable' };
  const o = json(a.body) as Record<string, unknown> | null;
  const token = o && typeof o['access_token'] === 'string' && o['access_token'].trim() !== '' ? o['access_token'].trim() : null;
  if (!token) return { ok: false, refusal: 'unavailable' };
  const scopes = typeof o!['scope'] === 'string' ? [...new Set(o!['scope'].split(/[\s,]+/).filter((s) => /^[a-z_]{1,64}$/.test(s)))].sort() : null;
  return { ok: true, token, scopes };
}

const graphql = (shop: string, token: string, query: string, variables: Record<string, unknown>) => ({
  method: 'POST' as const,
  url: `${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
  headers: { 'content-type': 'application/json', accept: 'application/json', 'x-shopify-access-token': token },
  body: JSON.stringify({ query, variables }),
});

export type ConnectRefusal = 'credential_refused' | 'scope_missing_read_orders' | 'unavailable';
export type ConnectRead =
  | { readonly ok: true; readonly scopes: readonly string[]; readonly version: string | null }
  | { readonly ok: false; readonly refusal: ConnectRefusal };

/**
 * Connecting: the scopes the installation really holds (`currentAppInstallation.accessScopes`) and the version
 * Shopify answered with. `read_orders` (or `write_orders`, which grants it) is required; nothing is asked for, and a
 * write scope a token already holds is shown, never used.
 */
export async function readStoreGrant(shop: string, credential: ShopifyCredential, transport: ShopifyTransport): Promise<ConnectRead> {
  const t = await tokenFor(shop, credential, transport);
  if (!t.ok) return t;
  const a = await transport(graphql(shop, t.token, SHOPIFY_SCOPES_QUERY, {}));
  if ('failed' in a) return { ok: false, refusal: 'unavailable' };
  if (a.status === 401 || a.status === 403) return { ok: false, refusal: 'credential_refused' };
  if (!ok200(a)) return { ok: false, refusal: 'unavailable' };
  const scopes = readGrantedScopes(json(a.body));
  if (!scopes) return { ok: false, refusal: 'unavailable' };
  if (!orderScopes(scopes).readsOrders) return { ok: false, refusal: 'scope_missing_read_orders' };
  return { ok: true, scopes, version: a.version ?? null };
}

export type LookupRead = { readonly reading: OrderReading; readonly version: string | null | undefined };

/**
 * One lookup: the token, the pacing wait, ONE query. `version` is what Shopify said it served (undefined when no
 * answer came back at all). Never throws for anything Shopify does.
 */
export async function lookUpShopifyOrder(input: {
  readonly shop: string; readonly credential: ShopifyCredential; readonly scopes: readonly string[];
  readonly orderName: string; readonly email: string; readonly zone: string;
}, deps: { readonly transport: ShopifyTransport; readonly pacer: ShopifyPacer; readonly clock: Clock }): Promise<LookupRead> {
  const unavailable: LookupRead = { reading: { outcome: 'unavailable' }, version: undefined };
  const q = orderSearch(input.orderName);
  if (!q || !orderScopes(input.scopes).readsOrders) return unavailable;
  const started = deps.clock.now();
  const run = async (): Promise<LookupRead> => {
    const t = await tokenFor(input.shop, input.credential, deps.transport);
    if (!t.ok) return unavailable;
    // The client way's grant is the one Shopify just gave; the token way's was read at connect.
    const scopes = t.scopes ?? input.scopes;
    const { readsOrders, readsAllOrders } = orderScopes(scopes);
    if (!readsOrders) return unavailable;
    const wait = deps.pacer.admit(input.shop, deps.clock.now());
    if (wait === null || deps.clock.now() + wait - started > LOOKUP_DEADLINE_MS) return unavailable;
    if (wait > 0) await deps.clock.sleep(wait);
    const a = await deps.transport(graphql(input.shop, t.token, SHOPIFY_ORDER_QUERY, { q }));
    if ('failed' in a) return unavailable;
    const body = json(a.body);
    deps.pacer.note(input.shop, (body as Record<string, unknown> | null)?.['extensions'], deps.clock.now());
    if (a.status !== 200) return { reading: { outcome: 'unavailable' }, version: a.version ?? null };
    return {
      reading: readOrderAnswer(body, { orderName: input.orderName, email: input.email, readsAllOrders, now: new Date(deps.clock.now()), zone: input.zone }),
      version: a.version ?? null,
    };
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<LookupRead>((resolve) => { timer = setTimeout(() => resolve(unavailable), LOOKUP_DEADLINE_MS); }),
    ]);
  } catch {
    return unavailable;
  } finally {
    clearTimeout(timer);
  }
}
