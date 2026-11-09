import { extractNumerals } from '../safety/numerals.js';
import { parseEmail } from '../types/ids.js';

/**
 * BLOCK 5.5 — SHOPIFY ORDERS IN THE CONVERSATION: the pure half. The requests are src/net/shopifyOrders.ts; the
 * connection and the audit are src/db/shopifyConnections.ts; the turn's port is src/pipeline/orderLookup.ts.
 *
 *   · What the customer typed (`readOrderAsk`): ONE order number written as Shopify writes a name, `#` first, and at
 *     most one e-mail. Never a phone. Two numbers or two e-mails are no question at all: nothing is looked up.
 *   · What is asked (`SHOPIFY_ORDER_QUERY`): only the order's name, its dates, its two display statuses, the e-mail
 *     (to COMPARE, never kept, never shown), and each fulfilment's status, delivery dates and tracking numbers. No
 *     carrier, no tracking link, no order id, no address, no phone, no name, no line, no total.
 *   · What is believed (`readOrderAnswer`): exactly one order whose name equals the number typed (spaces trimmed, case
 *     ignored) on a complete page, whose e-mail equals the customer's the same way, inside the store's scopes. Anything
 *     else is an outcome the customer never learns: they all get `ORDER_LOOKUP_REFUSAL`.
 *   · What the writer sees (`OrderContext`): the facts, dated in the workspace's day, nothing that is null.
 */

/** Every lookup that does not verify, whatever the reason, says this and only this. 43 bytes, ASCII. */
export const ORDER_LOOKUP_REFUSAL = "I couldn't find an order with those details";

export type OrderAsk = { readonly orderName: string; readonly email: string | null };

/** An order number: `#`, then letters, digits, `-` or `_` holding at least one digit; not part of a word or address. */
const ORDER_TOKEN = /(?<![\p{L}\p{N}_#/&=.-])#([A-Za-z0-9][A-Za-z0-9_-]{0,39})(?![\p{L}\p{N}_-])/gu;
const EMAIL_TOKEN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/**
 * The customer's order number and e-mail, by fixed rules. Null when there is no single `#` number (none, or two
 * different ones) or more than one e-mail: then no lookup happens, and the turn is what it was before 5.5.
 */
export function readOrderAsk(text: string): OrderAsk | null {
  const names = new Map<string, string>();
  for (const m of text.matchAll(ORDER_TOKEN)) {
    const token = m[1]!;
    if (!/\d/.test(token)) continue;          // #sale, #ootd: a hashtag, not an order
    names.set(token.toLowerCase(), `#${token}`);
  }
  if (names.size !== 1) return null;
  const emails = new Set<string>();
  for (const m of text.matchAll(EMAIL_TOKEN)) {
    const e = parseEmail(m[0]);
    if (e.ok) emails.add(e.value);
  }
  if (emails.size > 1) return null;
  return { orderName: [...names.values()][0]!, email: emails.size === 1 ? [...emails][0]! : null };
}

/** Orders read per lookup: a complete page of at most this many, or nothing is believed. */
export const SHOPIFY_ORDERS_PER_LOOKUP = 5;
export const SHOPIFY_FULFILLMENTS_PER_ORDER = 10;
export const SHOPIFY_TRACKING_PER_FULFILLMENT = 5;

/** The ONLY order query Nomi sends. `$q` is `name:"<the number typed>"`, its characters already restricted. */
export const SHOPIFY_ORDER_QUERY = `query NomiOrder($q: String!) {
  orders(first: ${SHOPIFY_ORDERS_PER_LOOKUP}, query: $q) {
    pageInfo { hasNextPage }
    nodes {
      name createdAt cancelledAt displayFinancialStatus displayFulfillmentStatus email
      fulfillments(first: ${SHOPIFY_FULFILLMENTS_PER_ORDER}) {
        status displayStatus deliveredAt estimatedDeliveryAt
        trackingInfo(first: ${SHOPIFY_TRACKING_PER_FULFILLMENT}) { number }
      }
    }
  }
}`;

/** The scopes the installation actually holds, asked once at connect. */
export const SHOPIFY_SCOPES_QUERY = `query NomiScopes {
  currentAppInstallation { accessScopes { handle } }
}`;

/** The search for one order name. Only `readOrderAsk`'s characters reach it, so it cannot widen the search. */
export function orderSearch(orderName: string): string | null {
  return /^#[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(orderName) ? `name:"${orderName}"` : null;
}

export type OrderShipment = {
  readonly status: string;
  readonly display_status?: string;
  readonly delivered_on?: string;
  readonly expected_on?: string;
  /**
   * The tracking numbers only. Never the carrier or a tracking link (its host names the carrier): the claims guard reads
   * a courier's name as a delivery promise the owner has not ticked, so the writer is never handed one.
   */
  readonly tracking?: readonly { readonly number: string }[];
};
/** What the writer is given: one verified order. No e-mail, no id, no address, no phone, no name. */
export type OrderContext = {
  readonly name: string;
  readonly placed_on: string;
  readonly cancelled_on?: string;
  readonly payment?: string;
  readonly fulfillment: string;
  readonly shipments: readonly OrderShipment[];
};

export type OrderOutcome = 'verified' | 'not_found' | 'mismatch' | 'redacted' | 'ambiguous' | 'out_of_scope' | 'unavailable';
export type OrderReading =
  | { readonly outcome: 'verified'; readonly order: OrderContext }
  | { readonly outcome: Exclude<OrderOutcome, 'verified'> };

/** `read_orders` alone sees orders created in the last 60 days (shopify.dev, access scopes, read 2026-11-10). */
export const RECENT_ORDER_DAYS = 60;
const DAY_MS = 86_400_000;

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const list = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : []);
/** A short line of Shopify's text: control characters gone, at most `max`. Null when nothing is left. */
function line(v: unknown, max = 120): string | null {
  if (typeof v !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const t = v.replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  return t === '' ? null : t.slice(0, max);
}
const LABEL = /^[A-Z][A-Z_]{0,40}$/;
const label = (v: unknown): string | null => (typeof v === 'string' && LABEL.test(v) ? v : null);
function instant(v: unknown): Date | null {
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A day in the workspace's zone, `YYYY-MM-DD`. */
export function dayIn(d: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** An e-mail as Shopify gave it, when it is one: null, empty, masked (`o***@…`) or malformed is no e-mail. */
function realEmail(v: unknown): string | null {
  if (typeof v !== 'string' || v.includes('*')) return null;
  const e = parseEmail(v);
  return e.ok ? e.value : null;
}

/**
 * Shopify's answer to `SHOPIFY_ORDER_QUERY`, judged. `errors` on an HTTP 200 are never a success: an error whose path
 * reaches an e-mail is the e-mail withheld (`redacted`); any other is `unavailable`, partial data or not.
 */
export function readOrderAnswer(json: unknown, ask: {
  readonly orderName: string; readonly email: string; readonly readsAllOrders: boolean; readonly now: Date; readonly zone: string;
}): OrderReading {
  const root = obj(json);
  const errors = list(root?.['errors']);
  if (errors.length > 0) {
    const emailWithheld = errors.some((e) => list(obj(e)?.['path']).some((p) => p === 'email'));
    return { outcome: emailWithheld ? 'redacted' : 'unavailable' };
  }
  const orders = obj(obj(root?.['data'])?.['orders']);
  if (!orders) return { outcome: 'unavailable' };
  const nodes = list(orders['nodes']);
  const pageInfo = obj(orders['pageInfo']);
  if (!pageInfo || typeof pageInfo['hasNextPage'] !== 'boolean') return { outcome: 'unavailable' };
  // A page that is not the last cannot prove there is only one.
  if (pageInfo['hasNextPage'] === true) return { outcome: 'ambiguous' };
  if (nodes.length > SHOPIFY_ORDERS_PER_LOOKUP) return { outcome: 'unavailable' };
  const named = nodes.map(obj).filter((n): n is Record<string, unknown> => n !== null
    && typeof n['name'] === 'string' && sameName(n['name'], ask.orderName));
  if (named.length === 0) return { outcome: 'not_found' };
  if (named.length > 1) return { outcome: 'ambiguous' };
  const o = named[0]!;
  const name = typeof o['name'] === 'string' ? o['name'].trim() : '';
  if (!/^#[A-Za-z0-9_-]{1,40}$/.test(name)) return { outcome: 'unavailable' };
  const email = realEmail(o['email']);
  if (email === null) return { outcome: 'redacted' };
  if (email !== ask.email.trim().toLowerCase()) return { outcome: 'mismatch' };
  const created = instant(o['createdAt']);
  const fulfillment = label(o['displayFulfillmentStatus']);
  if (!created || !fulfillment) return { outcome: 'unavailable' };
  if (!ask.readsAllOrders && ask.now.getTime() - created.getTime() > RECENT_ORDER_DAYS * DAY_MS) return { outcome: 'out_of_scope' };
  if (!Array.isArray(o['fulfillments'])) return { outcome: 'unavailable' };

  const shipments: OrderShipment[] = [];
  for (const f of list(o['fulfillments']).slice(0, SHOPIFY_FULFILLMENTS_PER_ORDER)) {
    const fo = obj(f);
    const status = label(fo?.['status']);
    if (!fo || !status) return { outcome: 'unavailable' };
    const display = label(fo['displayStatus']);
    const delivered = instant(fo['deliveredAt']);
    const expected = instant(fo['estimatedDeliveryAt']);
    const tracking = list(fo['trackingInfo']).slice(0, SHOPIFY_TRACKING_PER_FULFILLMENT).map((t) => {
      const to = obj(t);
      const number = line(obj(t)?.['number'], 80);
      return number ? { number } : null;
    }).filter((t): t is { number: string } => t !== null);
    shipments.push({
      status,
      ...(display ? { display_status: display } : {}),
      ...(delivered ? { delivered_on: dayIn(delivered, ask.zone) } : {}),
      ...(expected ? { expected_on: dayIn(expected, ask.zone) } : {}),
      ...(tracking.length ? { tracking } : {}),
    });
  }
  const cancelled = instant(o['cancelledAt']);
  const payment = label(o['displayFinancialStatus']);
  return {
    outcome: 'verified',
    order: {
      name,
      placed_on: dayIn(created, ask.zone),
      ...(cancelled ? { cancelled_on: dayIn(cancelled, ask.zone) } : {}),
      ...(payment ? { payment } : {}),
      fulfillment,
      shipments,
    },
  };
}

/** The granted scopes' handles, from `SHOPIFY_SCOPES_QUERY`'s answer; null when it is not one. */
export function readGrantedScopes(json: unknown): readonly string[] | null {
  const root = obj(json);
  if (list(root?.['errors']).length > 0) return null;
  const scopes = obj(obj(root?.['data'])?.['currentAppInstallation'])?.['accessScopes'];
  if (!Array.isArray(scopes)) return null;
  return [...new Set(scopes.map((s) => obj(s)?.['handle']).filter((h): h is string => typeof h === 'string' && /^[a-z_]{1,64}$/.test(h)))].sort();
}

/** The order scopes, read the way Shopify grants them: `read_all_orders` extends `read_orders`, never alone. */
export function orderScopes(scopes: readonly string[]): { readonly readsOrders: boolean; readonly readsAllOrders: boolean } {
  const readsOrders = scopes.includes('read_orders') || scopes.includes('write_orders');
  return { readsOrders, readsAllOrders: readsOrders && scopes.includes('read_all_orders') };
}

/**
 * The figures of a verified order, sourced for the numeral guard like her taught facts: every figure in every value,
 * and each date's year, month and day on their own ("12 November" says 12).
 */
export function orderFactNumbers(o: OrderContext): number[] {
  const words: string[] = [o.name, o.placed_on, o.cancelled_on ?? ''];
  const dates: string[] = [o.placed_on, o.cancelled_on ?? ''];
  for (const s of o.shipments) {
    words.push(s.delivered_on ?? '', s.expected_on ?? '');
    dates.push(s.delivered_on ?? '', s.expected_on ?? '');
    for (const t of s.tracking ?? []) words.push(t.number);
  }
  const out = words.flatMap((w) => extractNumerals(w).map((n) => n.value));
  for (const d of dates) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    if (m) out.push(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  return [...new Set(out)];
}

/**
 * A reply that says the order (or a parcel) WAS delivered, in the six languages the fixed sentences are written in. A
 * sentence that negates it ("has not been delivered yet", 还没送到) says no such thing. Read only on a reply built on
 * order facts, and only where no shipment has a delivery time: a fulfilment is not a delivery.
 */
const DELIVERED = [
  /\b(?:delivered|arrived)\b/i,
  /\b(?:entregad[oa]s?|lleg[óo]|llegaron)\b/iu,
  /(?:^|[^\p{L}])(?:livr[ée]e?s?|arriv[ée]e?s?)(?![\p{L}])/iu,
  /(?:^|[^\p{L}])(?:entregues?|chegou|chegaram)(?![\p{L}])/iu,
  /已送达|已签收|已经送到|送到了|已妥投|已收货/u,
  /تم\s+(?:التسليم|توصيل)|(?:^|\s)وصل(?:ت)?(?:\s|$|[.،!؟])/u,
];
const NEGATED = /\b(?:not|n['’]t|never|yet to|no)\b|(?:^|[^\p{L}])(?:pas|jamais|aún no|todavía no|ainda não|não|nao)(?![\p{L}])|还没|没有|未|尚未|لم|لا\s|ليس/iu;
export function saysDelivered(reply: string): boolean {
  return reply.split(/(?<=[.!?。！？؟\n])/u).some((sentence) => DELIVERED.some((re) => re.test(sentence)) && !NEGATED.test(sentence));
}
