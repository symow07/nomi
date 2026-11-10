import { describe, it, expect } from 'vitest';
import {
  SHOPIFY_API_VERSION, readShopifyAddress, readShopifyForm, type ShopifyCredential,
} from '../../src/core/onboard/shopifyGraphql.js';
import {
  readShopifyStore, storefrontLocked, type ShopifyAnswer, type ShopifyRequest, type ShopifyTransport,
} from '../../src/net/shopifyAdmin.js';
import type { ShopifyRefusal } from '../../src/core/onboard/setupMinutes.js';

/**
 * Block 4.4 — a password-protected Shopify store read with the owner's own app (src/net/shopifyAdmin.ts,
 * src/core/onboard/shopifyGraphql.ts), against a fake Shopify that records every request. Every refusal C0 names is
 * reached here; no credential appears anywhere but the request that carries it. Nothing here touches the network.
 */
const SHOP = 'https://atlas-mode.myshopify.com';
const TOKEN = 'test-admin-token-0000';
const CLIENT_ID = 'client-id-0000000000000000';
const CLIENT_SECRET = 'test-client-secret-0000';
const EXCHANGED = 'test-exchanged-token-1111';
const SECRETS = [TOKEN, CLIENT_ID, CLIENT_SECRET, EXCHANGED];
const GRAPHQL = `${SHOP}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

const ok = (body: unknown): ShopifyAnswer => ({ status: 200, location: null, body: JSON.stringify(body) });
const status = (n: number, body = '', location: string | null = null): ShopifyAnswer => ({ status: n, location, body });
const variant = (price: string, sku: string, size: string) => ({ price, sku, selectedOptions: [{ name: 'Size', value: size }] });
const product = (id: number, title: string, variants: unknown[], more: string | null = null, productStatus = 'ACTIVE') => ({
  id: `gid://shopify/Product/${id}`, title, status: productStatus, options: [{ name: 'Size' }],
  variants: { pageInfo: { hasNextPage: more !== null, endCursor: more }, nodes: variants },
});
const page = (nodes: unknown[], next: string | null, currencyCode = 'USD') => ({
  data: { shop: { currencyCode }, products: { pageInfo: { hasNextPage: next !== null, endCursor: next }, nodes } },
});

/** A fake Shopify: answers by URL and the GraphQL variables; records every request. */
function fake(answer: (req: ShopifyRequest, vars: Record<string, unknown>) => ShopifyAnswer): { transport: ShopifyTransport; seen: ShopifyRequest[] } {
  const seen: ShopifyRequest[] = [];
  return {
    seen,
    transport: async (req) => {
      seen.push(req);
      const vars = req.body && req.url.endsWith('graphql.json') ? (JSON.parse(req.body) as { variables: Record<string, unknown> }).variables : {};
      return answer(req, vars);
    },
  };
}

/** The happy store: two pages of products, one ARCHIVED (left out), one with a second page of variants. */
const happy = (req: ShopifyRequest, vars: Record<string, unknown>): ShopifyAnswer => {
  if (req.url.endsWith('/admin/oauth/access_token')) return ok({ access_token: EXCHANGED, scope: 'read_products,read_inventory', expires_in: 86399 });
  if ('id' in vars) return ok({ data: { product: { variants: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [variant('30.00', 'TEE-XL', 'XL')] } } } });
  if (vars['cursor'] === null) {
    return ok(page([
      product(1, 'Linen tee', [variant('24.00', 'TEE-S', 'S'), variant('24.00', 'TEE-M', 'M')], 'v-cursor'),
      product(2, 'Old hat', [variant('9.00', 'HAT', 'One')], null, 'ARCHIVED'),
    ], 'p-cursor'));
  }
  return ok(page([product(3, 'Canvas bag', [variant('15.50', 'BAG', 'One')])], null));
};

const run = (credential: ShopifyCredential, answer = happy, currency = 'USD') => {
  const f = fake(answer);
  return readShopifyStore({ shop: SHOP, credential, currency }, f.transport).then((r) => ({ r, seen: f.seen }));
};

const noSecretIn = (x: unknown): void => {
  const s = JSON.stringify(x);
  for (const secret of SECRETS) expect(s.includes(secret)).toBe(false);
};

describe('Block 4.4 · Shopify · what the owner typed', () => {
  it('only a .myshopify.com address, as https://<name>.myshopify.com', () => {
    for (const a of ['atlas-mode.myshopify.com', 'https://Atlas-Mode.myshopify.com/', 'https://atlas-mode.myshopify.com/admin/products', 'atlas-mode.myshopify.com:443']) {
      expect([a, readShopifyAddress(a)]).toEqual([a, SHOP]);
    }
    for (const a of ['', 'atlas.com', 'http://atlas-mode.myshopify.com', 'https://user:pw@atlas-mode.myshopify.com', 'atlas-mode.myshopify.com:8443',
      'https://admin.shopify.com/store/atlas-mode', 'atlas-mode.myshopify.com.evil.test', 'evil.test/atlas-mode.myshopify.com', 'atlas mode.myshopify.com']) {
      expect([a, readShopifyAddress(a)]).toEqual([a, null]);
    }
  });

  it('one way: the token alone, or the ID and secret together; spaces and halves refused; only the address comes back', () => {
    const f = (o: Record<string, string>) => readShopifyForm({ address: 'atlas-mode.myshopify.com', token: '', client_id: '', client_secret: '', ...o });
    expect(f({ token: ` ${TOKEN} ` })).toEqual({ ok: true, shop: SHOP, credential: { way: 'token', token: TOKEN } });
    expect(f({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET })).toEqual({ ok: true, shop: SHOP, credential: { way: 'client', clientId: CLIENT_ID, clientSecret: CLIENT_SECRET } });
    const cases: [Record<string, string>, ShopifyRefusal][] = [
      [{}, 'neither_way'],
      [{ token: TOKEN, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }, 'both_ways'],
      [{ token: TOKEN, client_secret: CLIENT_SECRET }, 'both_ways'],
      [{ client_id: CLIENT_ID }, 'half_pair'],
      [{ client_secret: CLIENT_SECRET }, 'half_pair'],
      [{ token: 'test admin token' }, 'spaces'],
      [{ client_id: CLIENT_ID, client_secret: 'test-client\tsecret' }, 'spaces'],
      [{ address: 'atlas.com', token: TOKEN }, 'not_myshopify'],
    ];
    for (const [o, refusal] of cases) {
      const r = f(o);
      expect([o, r.ok ? null : r.refusal]).toEqual([o, refusal]);
      noSecretIn(r);
    }
    expect(f({ address: 'atlas.com', token: TOKEN })).toEqual({ ok: false, refusal: 'not_myshopify', address: '' });
  });
});

describe('Block 4.4 · Shopify · reading the store', () => {
  it('way A: every ACTIVE product, variants paged, the token only in its header, GraphQL 2026-10', async () => {
    const { r, seen } = await run({ way: 'token', token: TOKEN });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.currency).toBe('USD');
    expect(r.items.map((i) => [i.title, i.variants.map((v) => `${v.sku}:${String(v.price)}:${v.options.join('/')}`)])).toEqual([
      ['Linen tee', ['TEE-S:24:S', 'TEE-M:24:M', 'TEE-XL:30:XL']],
      ['Canvas bag', ['BAG:15.5:One']],
    ]);
    expect(seen.map((q) => [q.method, q.url])).toEqual([['POST', GRAPHQL], ['POST', GRAPHQL], ['POST', GRAPHQL]]);
    for (const q of seen) {
      expect(q.headers['x-shopify-access-token']).toBe(TOKEN);
      expect(q.url.includes(TOKEN)).toBe(false);
      expect(q.body?.includes(TOKEN)).toBe(false);
    }
    const first = JSON.parse(seen[0]!.body!) as { query: string; variables: unknown };
    expect(first.variables).toEqual({ cursor: null });
    expect(first.query).toContain('query: "status:active"');
    expect(first.query).not.toMatch(/compareAtPrice/);
    expect(JSON.parse(seen[1]!.body!).variables).toEqual({ id: 'gid://shopify/Product/1', cursor: 'v-cursor' });
    expect(JSON.parse(seen[2]!.body!).variables).toEqual({ cursor: 'p-cursor' });
  });

  it('way B: one form-encoded client-credentials exchange with no scope, then the exchanged token', async () => {
    const { r, seen } = await run({ way: 'client', clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    expect(r.ok).toBe(true);
    expect(seen[0]).toEqual({
      method: 'POST', url: `${SHOP}/admin/oauth/access_token`,
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: `grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`,
    });
    expect(seen[0]!.body).not.toMatch(/scope/);
    expect(seen.slice(1).every((q) => q.headers['x-shopify-access-token'] === EXCHANGED && q.url === GRAPHQL)).toBe(true);
    noSecretIn(r);
  });

  it('way B: write_products alone reads products (a write scope grants its read); neither products scope is refused', async () => {
    const scoped = (scope: string) => (req: ShopifyRequest, vars: Record<string, unknown>): ShopifyAnswer =>
      (req.url.endsWith('/access_token') ? ok({ access_token: EXCHANGED, scope, expires_in: 86399 }) : happy(req, vars));
    const B: ShopifyCredential = { way: 'client', clientId: CLIENT_ID, clientSecret: CLIENT_SECRET };
    for (const scope of ['read_products', 'write_products', 'write_products,read_inventory', 'read_orders write_products']) {
      const { r, seen } = await run(B, scoped(scope));
      expect(r.ok, scope).toBe(true);
      expect(seen.length, scope).toBeGreaterThan(1);
    }
    for (const scope of ['', 'read_orders,write_customers', 'read_product_listings', 'write_inventory']) {
      const { r, seen } = await run(B, scoped(scope));
      expect(r, scope).toEqual({ ok: false, refusal: 'scope_missing_read_products' });
      expect(seen, scope).toHaveLength(1);
    }
  });

  it('every refusal C0 names is reached, and none carries a credential', async () => {
    const graphqlError = (code: string) => (req: ShopifyRequest, vars: Record<string, unknown>) =>
      (req.url === GRAPHQL ? ok({ errors: [{ message: `Shopify says ${TOKEN}`, extensions: { code } }] }) : happy(req, vars));
    const exchangeAnswer = (a: ShopifyAnswer) => (req: ShopifyRequest, vars: Record<string, unknown>) =>
      (req.url.endsWith('/access_token') ? a : happy(req, vars));
    const readAnswer = (a: ShopifyAnswer) => (req: ShopifyRequest, vars: Record<string, unknown>) =>
      (req.url === GRAPHQL ? a : happy(req, vars));
    const A: ShopifyCredential = { way: 'token', token: TOKEN };
    const B: ShopifyCredential = { way: 'client', clientId: CLIENT_ID, clientSecret: CLIENT_SECRET };
    const cases: [ShopifyCredential, (req: ShopifyRequest, vars: Record<string, unknown>) => ShopifyAnswer, ShopifyRefusal, string?][] = [
      [B, exchangeAnswer(status(400, `{"error":"Oauth error shop_not_permitted: Client credentials cannot be performed on this shop"}`)), 'shop_not_permitted'],
      [B, exchangeAnswer(status(400, '{"error":"application_cannot_be_found"}')), 'application_cannot_be_found'],
      [B, exchangeAnswer(status(401, `{"error":"invalid_client ${CLIENT_SECRET}"}`)), 'exchange_401'],
      [B, exchangeAnswer(status(400, '{"error":"invalid_client"}')), 'exchange_401'],
      [B, exchangeAnswer(ok({ access_token: EXCHANGED, scope: 'read_orders,write_customers' })), 'scope_missing_read_products'],
      [B, exchangeAnswer(status(302, '', 'https://elsewhere.test/login')), 'redirect'],
      [A, readAnswer(status(401, `{"errors":"[API] Invalid API key or access token (unrecognized login or wrong password) ${TOKEN}"}`)), 'token_401'],
      [B, readAnswer(status(401)), 'exchange_401'],
      [A, readAnswer(status(403)), 'scope_missing_read_products'],
      [A, graphqlError('ACCESS_DENIED'), 'scope_missing_read_products'],
      [A, readAnswer(status(404)), 'not_found'],
      [A, readAnswer({ failed: 'not_found' }), 'not_found'],
      [A, readAnswer(status(429)), 'rate_limited'],
      [A, graphqlError('THROTTLED'), 'rate_limited'],
      [A, readAnswer({ failed: 'timeout' }), 'timeout'],
      [A, readAnswer(status(301, '', `${SHOP}/admin/api/2025-01/graphql.json`)), 'redirect'],
      [A, readAnswer(status(502)), 'unavailable'],
      [A, readAnswer(status(423)), 'unavailable'],
      [A, graphqlError('MAX_COST_EXCEEDED'), 'unavailable'],
      [A, readAnswer(status(200, 'not json')), 'unavailable'],
      [A, readAnswer(ok(page([product(1, 'Tee', [variant('24.00', 'T', 'S')])], null, 'EUR'))), 'currency_mismatch'],
      [A, readAnswer(ok(page([product(1, 'Draft only', [variant('24.00', 'T', 'S')], null, 'DRAFT')], null))), 'no_products'],
      [A, readAnswer(ok(page([], null))), 'no_products'],
    ];
    for (const [credential, answer, refusal] of cases) {
      const { r, seen } = await run(credential, answer);
      expect([refusal, r.ok ? 'ok' : r.refusal]).toEqual([refusal, refusal]);
      noSecretIn(r);
      for (const q of seen) {
        expect(q.url.startsWith(`${SHOP}/`)).toBe(true);
        for (const secret of SECRETS) expect(q.url.includes(secret)).toBe(false);
      }
    }
    // A store in another currency is stopped on its first page: nothing more is asked.
    const mismatch = await run(A, readAnswer(ok(page([product(1, 'Tee', [variant('24.00', 'T', 'S')])], 'more', 'EUR'))));
    expect(mismatch.seen).toHaveLength(1);
  });

  it('a password-protected storefront: a 401, or a redirect to /password, asked with no credential and not followed', async () => {
    const probe = async (a: ShopifyAnswer) => {
      const f = fake(() => a);
      const locked = await storefrontLocked('https://shop.example.test', f.transport);
      expect(f.seen).toEqual([{ method: 'GET', url: 'https://shop.example.test/products.json?limit=1', headers: { accept: 'application/json' } }]);
      return locked;
    };
    expect(await probe(status(401))).toBe(true);
    expect(await probe(status(302, '', '/password'))).toBe(true);
    expect(await probe(status(302, '', 'https://shop.example.test/password'))).toBe(true);
    expect(await probe(status(302, '', 'https://shop.example.test/collections'))).toBe(false);
    expect(await probe(ok({ products: [] }))).toBe(false);
    expect(await probe({ failed: 'timeout' })).toBe(false);
  });
});
