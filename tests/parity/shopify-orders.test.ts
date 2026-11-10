import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import {
  ORDER_LOOKUP_REFUSAL, SHOPIFY_ORDER_QUERY, SHOPIFY_SCOPES_QUERY, orderSearch, readOrderAnswer, readOrderAsk, readGrantedScopes,
  orderScopes, orderFactNumbers, saysDelivered,
} from '../../src/core/commerce/shopifyOrders.js';
import { SHOPIFY_API_VERSION, type ShopifyCredential } from '../../src/core/onboard/shopifyGraphql.js';
import {
  ShopifyPacer, LOOKUP_DEADLINE_MS, lookUpShopifyOrder, readStoreGrant, type Clock,
} from '../../src/net/shopifyOrders.js';
import type { ShopifyAnswer, ShopifyRequest, ShopifyTransport } from '../../src/net/shopifyAdmin.js';

/**
 * BLOCK 5.5 — SHOPIFY ORDERS, THE PURE HALF AND THE REQUESTS, against a fake Shopify that records every request and
 * refuses anything but the two minimal queries. No network. Over Postgres and the turn: tests/integration/shopify-orders.
 */

const SHOP = 'https://atlas-mode.myshopify.com';
const TOKEN = 'test-admin-token-5505';
const CLIENT_ID = 'client-id-5505';
const CLIENT_SECRET = 'test-client-secret-5505';
const EXCHANGED = 'test-exchanged-token-5505';
const GRAPHQL = `${SHOP}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
const T0 = new Date('2026-11-09T00:00:00.000Z');
const DAY = 86_400_000;
const ZONE = 'Asia/Shanghai';

// ── the allowlist ────────────────────────────────────────────────────────────────────────────────────────────────

const ORDER_LEAVES = ['name', 'createdAt', 'cancelledAt', 'displayFinancialStatus', 'displayFulfillmentStatus', 'email'];
const FULFILMENT_LEAVES = ['status', 'displayStatus', 'deliveredAt', 'estimatedDeliveryAt'];
const TRACKING_LEAVES = ['number'];   // never `company` or `url`: the writer is never told the carrier (see below)
const STRUCTURE = ['query', 'NomiOrder', 'String', 'orders', 'first', 'pageInfo', 'hasNextPage', 'nodes', 'fulfillments', 'trackingInfo', 'q'];
/** Every name in a query, outside its string literals and its `$` variables' sigils. */
const namesIn = (q: string) => new Set(q.replace(/"[^"]*"/g, '').match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []);

/** A fake Shopify: the exchange, the scopes query and the order query only; anything else is refused and recorded. */
function fakeShopify(answer: { order?: () => ShopifyAnswer; scopes?: () => ShopifyAnswer; exchange?: () => ShopifyAnswer }) {
  const seen: ShopifyRequest[] = [];
  const refused: string[] = [];
  const transport: ShopifyTransport = async (req) => {
    seen.push(req);
    if (req.url === `${SHOP}/admin/oauth/access_token`) return answer.exchange?.() ?? { status: 200, location: null, body: JSON.stringify({ access_token: EXCHANGED, scope: 'read_orders', expires_in: 86399 }) };
    if (req.url !== GRAPHQL || req.method !== 'POST') { refused.push(`endpoint ${req.method} ${req.url}`); return { status: 404, location: null, body: '' }; }
    const { query, variables } = JSON.parse(req.body ?? '{}') as { query: string; variables: Record<string, unknown> };
    if (/\b(mutation|subscription|fragment)\b/.test(query) || /\.\.\./.test(query)) { refused.push('operation'); return { status: 400, location: null, body: '' }; }
    if (query === SHOPIFY_SCOPES_QUERY) return answer.scopes?.() ?? { status: 200, location: null, version: '2026-10', body: JSON.stringify({ data: { currentAppInstallation: { accessScopes: [{ handle: 'read_orders' }] } } }) };
    const extra = [...namesIn(query)].filter((n) => ![...ORDER_LEAVES, ...FULFILMENT_LEAVES, ...TRACKING_LEAVES, ...STRUCTURE].includes(n));
    if (extra.length) { refused.push(`fields ${extra.join(',')}`); return { status: 400, location: null, body: '' }; }
    if (typeof variables['q'] !== 'string' || !/^name:"#[A-Za-z0-9][A-Za-z0-9_-]{0,39}"$/.test(variables['q'])) { refused.push('search'); return { status: 400, location: null, body: '' }; }
    return answer.order?.() ?? { status: 200, location: null, version: '2026-10', body: JSON.stringify(found()) };
  };
  return { transport, seen, refused };
}

const fulfilment = (over: Record<string, unknown> = {}) => ({
  status: 'SUCCESS', displayStatus: 'IN_TRANSIT', deliveredAt: null, estimatedDeliveryAt: '2026-11-13T16:00:00Z',
  trackingInfo: [{ company: 'Atlas Post', number: 'AP5505-001', url: 'https://track.example.test/AP5505-001' }], ...over,
});
const node = (over: Record<string, unknown> = {}) => ({
  name: '#NOMI-5501', createdAt: new Date(T0.getTime() - 10 * DAY).toISOString(), cancelledAt: null,
  displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'FULFILLED', email: 'order5501@example.test',
  fulfillments: [fulfilment()], ...over,
});
const cost = { requestedQueryCost: 20, actualQueryCost: 8, throttleStatus: { maximumAvailable: 100, currentlyAvailable: 92, restoreRate: 10 } };
const found = (nodes: unknown[] = [node()], hasNextPage = false, extensions: unknown = { cost }) => ({ data: { orders: { pageInfo: { hasNextPage }, nodes } }, extensions });
const ask = { orderName: '#NOMI-5501', email: 'order5501@example.test', readsAllOrders: false, now: T0, zone: ZONE };

describe('5.5 · the customer-facing sentence', () => {
  it('is 43 bytes of ASCII, and its hash is pinned', () => {
    expect(Buffer.byteLength(ORDER_LOOKUP_REFUSAL, 'utf8')).toBe(43);
    expect(/^[\x20-\x7e]+$/.test(ORDER_LOOKUP_REFUSAL)).toBe(true);
    expect(createHash('sha256').update(ORDER_LOOKUP_REFUSAL).digest('hex').slice(0, 8)).toBe('91cece98');
  });
});

describe('5.5 · readOrderAsk — one `#` number, at most one e-mail, never a phone', () => {
  it('reads the number and the e-mail', () => {
    expect(readOrderAsk('Hi, where is #NOMI-5501? I used Order5501@Example.test')).toEqual({ orderName: '#NOMI-5501', email: 'order5501@example.test' });
    expect(readOrderAsk('order #1001 please')).toEqual({ orderName: '#1001', email: null });
  });
  it('a hashtag is not an order; a number inside an address or a word is not one', () => {
    expect(readOrderAsk('love the #ootd and #sale')).toBeNull();
    expect(readOrderAsk('see https://shop.example/#1001')).toBeNull();
    expect(readOrderAsk('abc#1001')).toBeNull();
  });
  it('two different numbers, or two e-mails, ask nothing', () => {
    expect(readOrderAsk('#1001 or #1002?')).toBeNull();
    expect(readOrderAsk('#1001 a@example.test b@example.test')).toBeNull();
    expect(readOrderAsk('#1001 and again #1001')).toEqual({ orderName: '#1001', email: null });
  });
  it('a phone number is never read as anything', () => {
    expect(readOrderAsk('#1001, call me on +52 55 1234 5678')).toEqual({ orderName: '#1001', email: null });
  });
  it('the search cannot be widened: quotes, OR, wildcards and spaces are refused before Shopify', () => {
    expect(orderSearch('#1001')).toBe('name:"#1001"');
    for (const bad of ['#1001" OR name:*', '#10*', '#1001 OR 1', '#(1001)', '#1001\\', '1001']) expect(orderSearch(bad)).toBeNull();
  });
});

describe('5.5 · the query sent is the minimum', () => {
  it('names only the allowed leaves, one operation, a query', () => {
    expect(SHOPIFY_ORDER_QUERY.trimStart().startsWith('query NomiOrder(')).toBe(true);
    const names = namesIn(SHOPIFY_ORDER_QUERY);
    for (const n of names) expect([...ORDER_LEAVES, ...FULFILMENT_LEAVES, ...TRACKING_LEAVES, ...STRUCTURE]).toContain(n);
    for (const leaf of [...ORDER_LEAVES, ...FULFILMENT_LEAVES, ...TRACKING_LEAVES]) expect(names.has(leaf)).toBe(true);
    for (const never of ['company', 'url', 'id', 'phone', 'shippingAddress', 'billingAddress', 'customer', 'lineItems', 'totalPriceSet', 'note', 'tags', 'metafields']) expect(names.has(never)).toBe(false);
    expect(/\b(mutation|subscription|fragment)\b|\.\.\./.test(SHOPIFY_ORDER_QUERY)).toBe(false);
  });
});

describe('5.5 · readOrderAnswer — only one complete, exact, matching order is believed', () => {
  it('a match: the facts, dated in the workspace day, no e-mail', () => {
    const r = readOrderAnswer(found(), ask);
    expect(r).toEqual({ outcome: 'verified', order: {
      name: '#NOMI-5501', placed_on: '2026-10-30', payment: 'PAID', fulfillment: 'FULFILLED',
      shipments: [{ status: 'SUCCESS', display_status: 'IN_TRANSIT', expected_on: '2026-11-14', tracking: [{ number: 'AP5505-001' }] }],
    } });
    expect(JSON.stringify(r)).not.toContain('@');
  });
  it('a carrier or a tracking link Shopify sends anyway is dropped: the writer is never told who carries it', () => {
    // The claims guard reads a courier's name as a delivery promise the owner has not ticked (rule 48), and a tracking
    // link names the courier in its host. Neither is asked for; one that comes back regardless is not kept.
    const r = readOrderAnswer(found(), ask);
    const told = JSON.stringify(r);
    for (const gone of ['Atlas Post', 'track.example.test', 'carrier', 'url', 'company']) expect(told).not.toContain(gone);
    const ups = readOrderAnswer(found([node({ fulfillments: [fulfilment({ trackingInfo: [{ company: 'UPS', number: null, url: 'https://www.ups.com/track?tracknum=1Z' }] })] })]), ask);
    expect(JSON.stringify(ups)).not.toMatch(/UPS|ups\.com/);
  });
  it('the name and e-mail compare with case and spaces aside, nothing more', () => {
    expect(readOrderAnswer(found([node({ name: ' #nomi-5501 ', email: 'ORDER5501@example.test' })]), ask).outcome).toBe('verified');
    expect(readOrderAnswer(found([node({ email: 'order.5501@example.test' })]), ask).outcome).toBe('mismatch');
    expect(readOrderAnswer(found([node({ email: 'order5501+x@example.test' })]), ask).outcome).toBe('mismatch');
  });
  it('none, another name, two, or a page that is not the last', () => {
    expect(readOrderAnswer(found([]), ask).outcome).toBe('not_found');
    expect(readOrderAnswer(found([node({ name: '#NOMI-5502' })]), ask).outcome).toBe('not_found');
    expect(readOrderAnswer(found([node(), node({ email: 'other@example.test' })]), ask).outcome).toBe('ambiguous');
    expect(readOrderAnswer(found([node({ email: 'other@example.test' }), node()]), ask).outcome).toBe('ambiguous');
    expect(readOrderAnswer(found([node()], true), ask).outcome).toBe('ambiguous');
  });
  it('an e-mail null, empty, missing or masked is withheld; an error on its path is too', () => {
    for (const email of [null, '', 'o***@example.test', undefined]) expect(readOrderAnswer(found([node({ email })]), ask).outcome).toBe('redacted');
    const partial = { ...found([node({ email: null })]), errors: [{ message: 'redacted', path: ['orders', 'nodes', 0, 'email'] }] };
    expect(readOrderAnswer(partial, ask).outcome).toBe('redacted');
  });
  it('errors on an HTTP 200 are never a success', () => {
    for (const code of ['THROTTLED', 'ACCESS_DENIED', 'INTERNAL_SERVER_ERROR']) {
      expect(readOrderAnswer({ data: null, errors: [{ message: 'x', extensions: { code } }] }, ask).outcome).toBe('unavailable');
      expect(readOrderAnswer({ ...found(), errors: [{ message: 'x', extensions: { code } }] }, ask).outcome).toBe('unavailable');
    }
    expect(readOrderAnswer({ data: { orders: { nodes: [node()] } } }, ask).outcome).toBe('unavailable');
    expect(readOrderAnswer('not json', ask).outcome).toBe('unavailable');
  });
  it('older than 60 days needs read_all_orders', () => {
    const old = found([node({ createdAt: new Date(T0.getTime() - 61 * DAY).toISOString() })]);
    expect(readOrderAnswer(old, ask).outcome).toBe('out_of_scope');
    expect(readOrderAnswer(old, { ...ask, readsAllOrders: true }).outcome).toBe('verified');
    expect(readOrderAnswer(found([node({ createdAt: new Date(T0.getTime() - 60 * DAY).toISOString() })]), ask).outcome).toBe('verified');
    expect(orderScopes(['read_all_orders'])).toEqual({ readsOrders: false, readsAllOrders: false });
    expect(orderScopes(['read_orders', 'read_all_orders'])).toEqual({ readsOrders: true, readsAllOrders: true });
  });
  it('a fulfilment is not a delivery: no delivered_on without deliveredAt, no expected day invented', () => {
    const r = readOrderAnswer(found([node({ fulfillments: [fulfilment({ estimatedDeliveryAt: null }), fulfilment({ deliveredAt: '2026-11-08T02:00:00Z' })] })]), ask);
    expect(r.outcome).toBe('verified');
    if (r.outcome !== 'verified') return;
    expect(r.order.shipments[0]).not.toHaveProperty('delivered_on');
    expect(r.order.shipments[0]).not.toHaveProperty('expected_on');
    expect(r.order.shipments[1]?.delivered_on).toBe('2026-11-08');
    expect(orderFactNumbers(r.order)).toEqual(expect.arrayContaining([2026, 11, 8, 30, 10]));
  });
  it('says "delivered" only as a claim, not when it is denied', () => {
    expect(saysDelivered('Your parcel was delivered yesterday.')).toBe(true);
    expect(saysDelivered('It has not been delivered yet.')).toBe(false);
    expect(saysDelivered('您的包裹已签收。')).toBe(true);
    expect(saysDelivered('包裹还没送到。')).toBe(false);
    expect(saysDelivered('It is on its way.')).toBe(false);
  });
});

describe('5.5 · the pacer — Shopify\'s own budget, never a guess', () => {
  it('requested 20, 5 left, 10 a second: not before 1,500 ms', () => {
    const pacer = new ShopifyPacer();
    pacer.note(SHOP, { cost: { requestedQueryCost: 20, actualQueryCost: 8, throttleStatus: { maximumAvailable: 100, currentlyAvailable: 5, restoreRate: 10 } } }, 0);
    expect(pacer.admit(SHOP, 0)).toBe(1500);
    // The reservation holds: a second lookup on the same store waits behind it, and past MAX_WAIT_MS is refused.
    expect(pacer.admit(SHOP, 0)).toBe(null);
  });
  it('at 1,499 ms it still waits; at 1,500 it may go', () => {
    const a = new ShopifyPacer();
    const at = (t: number) => { a.note(SHOP, { cost: { requestedQueryCost: 20, throttleStatus: { maximumAvailable: 100, currentlyAvailable: 5, restoreRate: 10 } } }, 0); return a.admit(SHOP, t); };
    expect(at(1499)).toBe(1);
    expect(at(1500)).toBe(0);
  });
  it('a bucket that cannot refill, a cost above the maximum, or a malformed answer', () => {
    const p = new ShopifyPacer();
    p.note(SHOP, { cost: { requestedQueryCost: 20, throttleStatus: { maximumAvailable: 100, currentlyAvailable: 0, restoreRate: 0 } } }, 0);
    expect(p.admit(SHOP, 0)).toBeNull();
    p.note(SHOP, { cost: { requestedQueryCost: 2000, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 1000, restoreRate: 50 } } }, 0);
    expect(p.admit(SHOP, 0)).toBeNull();
    p.note(SHOP, { cost: 'nonsense' }, 0);
    expect(p.admit(SHOP, 0)).toBe(0);
    p.note(SHOP, { cost: { throttleStatus: { maximumAvailable: 100, currentlyAvailable: 500, restoreRate: 10 } } }, 0);
    expect(p.admit(SHOP, 0)).toBe(0);
  });
  it('one store\'s budget is not another\'s', () => {
    const p = new ShopifyPacer();
    p.note(SHOP, { cost: { requestedQueryCost: 20, throttleStatus: { maximumAvailable: 100, currentlyAvailable: 0, restoreRate: 0 } } }, 0);
    expect(p.admit('https://other.myshopify.com', 0)).toBe(0);
  });
});

const clock = (start = T0.getTime()): Clock & { slept: number[] } => {
  let now = start;
  const slept: number[] = [];
  return { slept, now: () => now, sleep: async (ms) => { slept.push(ms); now += ms; } };
};
const token: ShopifyCredential = { way: 'token', token: TOKEN };
const client: ShopifyCredential = { way: 'client', clientId: CLIENT_ID, clientSecret: CLIENT_SECRET };
const input = { shop: SHOP, credential: token, scopes: ['read_orders'], orderName: '#NOMI-5501', email: 'order5501@example.test', zone: ZONE };

describe('5.5 · one lookup through the transport', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('one request, pinned to 2026-10, the token in its header only; the version Shopify served is read', async () => {
    const f = fakeShopify({});
    const r = await lookUpShopifyOrder(input, { transport: f.transport, pacer: new ShopifyPacer(), clock: clock() });
    expect(r.reading.outcome).toBe('verified');
    expect(r.version).toBe('2026-10');
    expect(f.refused).toEqual([]);
    expect(f.seen).toHaveLength(1);
    expect(f.seen[0]!.url).toBe(GRAPHQL);
    expect(f.seen[0]!.headers['x-shopify-access-token']).toBe(TOKEN);
    expect(f.seen[0]!.url + (f.seen[0]!.body ?? '')).not.toContain(TOKEN);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
  it('another version served is reported, not repinned; none named is null', async () => {
    const other = fakeShopify({ order: () => ({ status: 200, location: null, version: '2026-07', body: JSON.stringify(found()) }) });
    expect((await lookUpShopifyOrder(input, { transport: other.transport, pacer: new ShopifyPacer(), clock: clock() })).version).toBe('2026-07');
    expect(other.seen[0]!.url).toBe(GRAPHQL);
    const none = fakeShopify({ order: () => ({ status: 200, location: null, body: JSON.stringify(found()) }) });
    expect((await lookUpShopifyOrder(input, { transport: none.transport, pacer: new ShopifyPacer(), clock: clock() })).version).toBeNull();
  });
  it('THROTTLED on a 200 is one request and unavailable — no retry, ever', async () => {
    const f = fakeShopify({ order: () => ({ status: 200, location: null, version: '2026-10', body: JSON.stringify({ data: null, errors: [{ message: 'synthetic throttle', extensions: { code: 'THROTTLED' } }], extensions: { cost } }) }) });
    const r = await lookUpShopifyOrder(input, { transport: f.transport, pacer: new ShopifyPacer(), clock: clock() });
    expect(r.reading.outcome).toBe('unavailable');
    expect(f.seen).toHaveLength(1);
  });
  it('429 and 5xx are unavailable, once', async () => {
    for (const s of [429, 500, 503]) {
      const f = fakeShopify({ order: () => ({ status: s, location: null, body: '' }) });
      expect((await lookUpShopifyOrder(input, { transport: f.transport, pacer: new ShopifyPacer(), clock: clock() })).reading.outcome).toBe('unavailable');
      expect(f.seen).toHaveLength(1);
    }
  });
  it('the pacer\'s wait is slept on the clock before the request', async () => {
    const f = fakeShopify({});
    const pacer = new ShopifyPacer();
    const c = clock();
    pacer.note(SHOP, { cost: { requestedQueryCost: 20, throttleStatus: { maximumAvailable: 100, currentlyAvailable: 5, restoreRate: 10 } } }, c.now());
    await lookUpShopifyOrder(input, { transport: f.transport, pacer, clock: c });
    expect(c.slept).toEqual([1500]);
  });
  it('a store that does not answer in 10 s is unavailable', async () => {
    vi.useFakeTimers();
    const transport: ShopifyTransport = () => new Promise<ShopifyAnswer>(() => {});
    const pending = lookUpShopifyOrder(input, { transport, pacer: new ShopifyPacer(), clock: clock() });
    await vi.advanceTimersByTimeAsync(LOOKUP_DEADLINE_MS);
    expect((await pending).reading.outcome).toBe('unavailable');
  });
  it('the client way exchanges once per lookup, and the grant it returns decides the scope', async () => {
    const f = fakeShopify({ exchange: () => ({ status: 200, location: null, body: JSON.stringify({ access_token: EXCHANGED, scope: 'read_products', expires_in: 86399 }) }) });
    const r = await lookUpShopifyOrder({ ...input, credential: client }, { transport: f.transport, pacer: new ShopifyPacer(), clock: clock() });
    expect(r.reading.outcome).toBe('unavailable');
    expect(f.seen).toHaveLength(1);
    const g = fakeShopify({});
    const ok = await lookUpShopifyOrder({ ...input, credential: client }, { transport: g.transport, pacer: new ShopifyPacer(), clock: clock() });
    expect(ok.reading.outcome).toBe('verified');
    expect(g.seen[1]!.headers['x-shopify-access-token']).toBe(EXCHANGED);
    expect(JSON.stringify(ok)).not.toContain(EXCHANGED);
    expect(JSON.stringify(ok)).not.toContain(CLIENT_SECRET);
  });
});

describe('5.5 · connecting reads the grant Shopify really gave', () => {
  const scopes = (handles: string[]) => () => ({ status: 200, location: null, version: '2026-10', body: JSON.stringify({ data: { currentAppInstallation: { accessScopes: handles.map((handle) => ({ handle })) } } }) });
  it('read_orders is required; read_all_orders alone is not enough; a write scope held is shown, not used', async () => {
    expect(await readStoreGrant(SHOP, token, fakeShopify({ scopes: scopes(['read_products']) }).transport)).toEqual({ ok: false, refusal: 'scope_missing_read_orders' });
    expect(await readStoreGrant(SHOP, token, fakeShopify({ scopes: scopes(['read_all_orders']) }).transport)).toEqual({ ok: false, refusal: 'scope_missing_read_orders' });
    expect(await readStoreGrant(SHOP, token, fakeShopify({ scopes: scopes(['write_orders', 'read_orders']) }).transport))
      .toEqual({ ok: true, scopes: ['read_orders', 'write_orders'], version: '2026-10' });
  });
  it('a refused credential, Shopify down, or an answer that is not a grant', async () => {
    expect(await readStoreGrant(SHOP, token, fakeShopify({ scopes: () => ({ status: 401, location: null, body: '' }) }).transport)).toEqual({ ok: false, refusal: 'credential_refused' });
    expect(await readStoreGrant(SHOP, client, fakeShopify({ exchange: () => ({ status: 400, location: null, body: '' }) }).transport)).toEqual({ ok: false, refusal: 'credential_refused' });
    expect(await readStoreGrant(SHOP, token, fakeShopify({ scopes: () => ({ status: 500, location: null, body: '' }) }).transport)).toEqual({ ok: false, refusal: 'unavailable' });
    expect(readGrantedScopes({ errors: [{ message: 'x' }] })).toBeNull();
  });
});

/*
 * t1r's ruling A (2026-11-10) — the owner's card reads where an order reply's figures came from. The worker keeps one
 * `order_sourced` record beside an `order_facts` draft: the order's name and the order's facts INTERSECTED with the
 * draft's own text. The reading names the order for those figures only; anything else still has no source.
 */
describe('5.5 · the card\'s reading of an order reply', async () => {
  const { orderSourcedFigures, orderSourcedOf, rememberingOrderLookup } = await import('../../src/pipeline/orderSourced.js');
  const { readReply } = await import('../../src/core/owner/reading.js');
  const ORDER = {
    name: '#NOMI-7701', placed_on: '2026-11-09', fulfillment: 'FULFILLED', payment: 'PAID',
    shipments: [{ status: 'SUCCESS', display_status: 'IN_TRANSIT', expected_on: '2026-11-14', tracking: [{ number: 'AP5505-0000-8821' }] }],
  } as const;
  const REPLY = 'Your order #NOMI-7701 was placed on 9 November 2026 and is on its way.';
  const read = (reply: string, orderFigures?: readonly number[]) =>
    readReply({ reply, includeSmallFigures: true, productNames: [], quote: null, theirTexts: [], heldQuantity: null, ...(orderFigures ? { orderFigures } : {}) });
  const sourceOf = (r: ReturnType<typeof read>, v: number): string | null => {
    const l = r.lines.find((x) => x.kind === 'figure' && x.value === v);
    return l?.kind === 'figure' ? l.source : null;
  };

  it('the record holds only the figures the reply writes: an order date, a tracking number or a month the reply does not state is not there', () => {
    const figures = orderSourcedFigures(ORDER, REPLY);
    expect(figures).toEqual([7701, 9, 2026]);
    // The expected day (14), the month as a number (11), the tracking number's digits: in the order, not in the reply.
    for (const absent of [14, 11, 5505, 8821]) expect(figures, String(absent)).not.toContain(absent);
    expect(orderSourcedFigures(ORDER, 'Thanks, how else can I help?')).toEqual([]);
  });

  it('a figure from the order reads "from the order in Shopify"; without the record it has no source, as before', () => {
    const withRecord = read(REPLY, orderSourcedFigures(ORDER, REPLY));
    expect(sourceOf(withRecord, 9)).toBe('order');
    expect(sourceOf(withRecord, 2026)).toBe('order');
    expect(withRecord.everyFigureSourced).toBe(true);
    const without = read(REPLY);
    expect(sourceOf(without, 9)).toBe('unsourced');
    expect(sourceOf(without, 2026)).toBe('unsourced');
    expect(without.everyFigureSourced).toBe(false);
  });

  it('an invented date, and an owner\'s edit with a figure the record does not hold, still read "no source"', () => {
    const recorded = orderSourcedFigures(ORDER, REPLY);
    const invented = read('Your order #NOMI-7701 was placed on 9 November 2026 and arrives on 21 November.', recorded);
    expect(sourceOf(invented, 9)).toBe('order');
    expect(sourceOf(invented, 21)).toBe('unsourced');
    // The owner's edit names the expected day: it IS in Shopify's order, but not in the record — so no source.
    const edited = read('Your order #NOMI-7701 should reach you on 14 November.', recorded);
    expect(sourceOf(edited, 14)).toBe('unsourced');
    expect(edited.everyFigureSourced).toBe(false);
  });

  it('a malformed record is no record', () => {
    expect(orderSourcedOf({ draftId: 'd', order: '#NOMI-7701', figures: [9, 2026] })).toEqual({ order: '#NOMI-7701', figures: [9, 2026] });
    for (const bad of [null, 'x', {}, { order: '', figures: [] }, { order: '#1', figures: ['9'] }, { order: '#1', figures: 9 },
      { order: 'x'.repeat(65), figures: [] }, { order: '#1', figures: Array.from({ length: 41 }, () => 1) }]) {
      expect(orderSourcedOf(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('the remembering port passes every answer through and keeps only a verified order, for this one turn', async () => {
    const answers = [{ kind: 'verified', order: ORDER }, { kind: 'refused' }, { kind: 'off' }] as const;
    const m = rememberingOrderLookup({ look: async () => answers[0] });
    expect(m.verified()).toBeNull();
    expect(await m.port.look({ conversationId: 'c', orderName: '#NOMI-7701', email: null })).toBe(answers[0]);
    expect(m.verified()).toBe(ORDER);
    let i = 1;
    const later = rememberingOrderLookup({ look: async () => answers[i]! });
    for (; i < answers.length; i++) {
      expect(await later.port.look({ conversationId: 'c', orderName: '#NOMI-7701', email: null })).toBe(answers[i]);
      expect(later.verified()).toBeNull();
    }
  });
});

/*
 * t1r's ruling on VERIFY-2 (2026-11-10). (a) The record may hold a tracking number's digits when the reply writes the
 * number — it holds nothing the draft does not. The card must not draw that code as a quantity: on an order-source
 * line, a figure that is part of a code (letters and digits together) or a long digit run (a tracking number) is shown
 * as the reply wrote it; quantities, amounts and dates keep their formats. (The observation) 5.5's English-only lines
 * on an Arabic page are set apart as English, left to right, so the full stop stays on the sentence's own side.
 */
describe('5.5 · a code from the order is shown as written; the English lines are set apart on an Arabic page', async () => {
  const { orderSourcedFigures } = await import('../../src/pipeline/orderSourced.js');
  const { readReply } = await import('../../src/core/owner/reading.js');
  const { renderConversationDetail, approvalCard } = await import('../../src/api/web/inbox.js');
  const { renderShopifyOrdersPage } = await import('../../src/api/web/shopifyOrders.js');
  const { moneyFromRow } = await import('../../src/core/types/money.js');
  const { t } = await import('../../src/core/owner/i18n/messages.js');
  const { esc } = await import('../../src/api/web/layout.js');
  const { withoutIsolates } = await import('./isolates.js');
  const ORDER = {
    name: '#T55-4401', placed_on: '2026-11-09', fulfillment: 'FULFILLED', payment: 'PAID',
    shipments: [{ status: 'SUCCESS', display_status: 'IN_TRANSIT', expected_on: '2026-11-15', tracking: [{ number: 'TRK4455667788' }] }],
  } as const;
  const BARE = { ...ORDER, shipments: [{ ...ORDER.shipments[0], tracking: [{ number: '4455667788' }] }] };
  const REPLY = 'Your order #T55-4401 was placed on 9 November 2026. Tracking number TRK4455667788, in 2 parcels.';
  const lineOf = (reply: string, figures: readonly number[], v: number, quote: Parameters<typeof readReply>[0]['quote'] = null) => {
    const l = readReply({ reply, includeSmallFigures: true, productNames: [], quote, theirTexts: [], heldQuantity: null, orderFigures: figures })
      .lines.find((x) => x.kind === 'figure' && x.value === v);
    return l?.kind === 'figure' ? l : null;
  };

  it('the tracking code reads as the reply wrote it, never as 4,455,667,788; the record still holds its digits (the storage stands)', () => {
    const figures = orderSourcedFigures(ORDER, REPLY);
    expect(figures).toContain(4455667788);
    const l = lineOf(REPLY, figures, 4455667788);
    expect(l).toMatchObject({ source: 'order', words: 'TRK4455667788' });
    // The order's name as a code: its two figures are one line, the code as written.
    const named = readReply({ reply: REPLY, includeSmallFigures: true, productNames: [], quote: null, theirTexts: [], heldQuantity: null, orderFigures: figures });
    expect(named.lines.filter((x) => x.kind === 'figure' && x.words === 'T55-4401')).toHaveLength(1);
    // A long digit run alone (a numeric tracking number) is an identifier too, as written.
    const bare = 'Tracking number 4455667788, placed on 9 November 2026.';
    expect(lineOf(bare, orderSourcedFigures(BARE, bare), 4455667788)).toMatchObject({ source: 'order', words: '4455667788' });
  });

  it('dates and amounts keep their formats: no "as written" override on them', () => {
    const figures = orderSourcedFigures(ORDER, REPLY);
    expect(lineOf(REPLY, figures, 2026)).toEqual({ kind: 'figure', value: 2026, source: 'order' });
    expect(lineOf(REPLY, figures, 9)).toMatchObject({ source: 'order', words: '9' });
    // An ordinal is a date, not a code; an amount is the quote's, not the order's.
    const ordinal = 'It should reach you on the 15th, and the parcel is 1250.00 in total.';
    expect(lineOf(ordinal, orderSourcedFigures(ORDER, ordinal), 15)).toEqual({ kind: 'figure', value: 15, source: 'order' });
    const quote = { unitPrice: 1250, total: 1250, quantity: 1, discountPct: 0, leadTimeDays: null, moq: null };
    expect(lineOf(ordinal, [], 1250, quote)).toEqual({ kind: 'figure', value: 1250, source: 'price' });
  });

  const NOW = new Date('2026-11-10T10:00:00Z');
  const detail = {
    conversationId: '0b0c3a3e-6a5c-4f0e-9a3b-1d2e3f405055', buyer: 'Ana', country: 'US', status: 'awaiting',
    product: { name: null, nameZh: null }, quantity: null,
    quote: { unitPrice: moneyFromRow('1250', 'USD')!, total: moneyFromRow('1250', 'USD')!, quantity: 1 }, order: null,
    messages: [{ direction: 'inbound', text: 'Where is my order? ana@example.test', at: new Date('2026-11-10T09:58:00Z') }],
    pendingDraft: { draftId: 'd-55', draftText: `${REPLY} The total was 1250.`, capability: 'greet', language: 'en',
      withheld: { reason: 'order_facts' }, orderSourced: { order: ORDER.name, figures: orderSourcedFigures(ORDER, REPLY) } },
    ownership: 'AI', refusals: [], uncertainSends: [], handoffReasons: [], unheardReason: null, lastHumanAction: null,
    knowledgeUsed: [], rate: null, leadTimeBlocked: null, sampleAsked: null, proof: { quoteId: null, token: null },
    channel: 'instagram',
  } as unknown as import('../../src/api/web/inbox.js').ConversationDetail;
  const card = (locale: 'en' | 'ar') => withoutIsolates(approvalCard(detail, locale, NOW, { act: '/app/inbox/x/act', handTo: '/app/inbox/x/takeover' }));

  for (const locale of ['en', 'ar'] as const) {
    it(`${locale} · the card draws the tracking code as written, beside "from the order", and the amount as money`, () => {
      const c = card(locale);
      expect(c).toContain('<bdi>TRK4455667788</bdi>');
      expect(c).not.toContain('4,455,667,788');
      expect(c).toContain(esc(t('en', 'card.source.order', { order: ORDER.name })));
      expect(c).toMatch(/1,250\.00/);
    });
  }

  it('ar · the card\'s English lines stand in a left-to-right isolate, each sentence whole inside it, its full stop last', () => {
    const c = card('ar');
    const held = esc(t('en', 'inbox.draft.held.order_facts'));
    expect(held.endsWith('.')).toBe(true);
    expect(c).toContain(`<bdi lang="en" dir="ltr">${held}</bdi>`);
    expect(c).toContain(`<bdi lang="en" dir="ltr">${esc(t('en', 'card.source.order', { order: ORDER.name }))}</bdi>`);
    // English pages are drawn as before: nothing set apart.
    expect(card('en')).not.toContain('<bdi lang="en" dir="ltr">');
    // The whole page too.
    expect(withoutIsolates(renderConversationDetail(detail, 'ar', NOW, null))).toContain(`<bdi lang="en" dir="ltr">${held}</bdi>`);
  });

  it('ar · the Shopify page\'s English lines are set apart the same way: the version line keeps its full stop on its own side', () => {
    const view = {
      owner: true, lookups: [], flash: null,
      connection: { shop: 'https://atlas-mode.myshopify.com', scopes: ['read_orders'], apiVersionSeen: '2026-07', answerOrders: true, connectedAt: NOW },
    } as unknown as Parameters<typeof renderShopifyOrdersPage>[1];
    const ar = withoutIsolates(renderShopifyOrdersPage('ar', view));
    const version = esc(t('en', 'shopifyOrders.version.other', { version: '2026-07' }));
    expect(version.endsWith('.')).toBe(true);
    expect(ar).toContain(`<bdi lang="en" dir="ltr">${version}</bdi>`);
    expect(ar).toContain(`<bdi lang="en" dir="ltr">${esc(t('en', 'shopifyOrders.lede'))}</bdi>`);
    // Never inside an attribute: the disconnect question stays plain text there.
    expect(ar).toContain(`data-confirm="${esc(t('en', 'shopifyOrders.disconnectAsk'))}"`);
    expect(withoutIsolates(renderShopifyOrdersPage('en', view))).not.toContain(`<bdi lang="en" dir="ltr">${version}`);
  });
});
