import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant } from './tenant.js';
import type { StoreFetcher, FetchedPage } from '../../src/net/publicFetch.js';
import type { ShopifyAnswer, ShopifyRequest } from '../../src/net/shopifyAdmin.js';
import { SHOPIFY_API_VERSION } from '../../src/core/onboard/shopifyGraphql.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';

/**
 * BLOCK 4.4 — A PASSWORD-PROTECTED SHOPIFY STORE, through the real routes and into a real K1 review. The reader's
 * rules (every refusal code, paging, caps, the scopes) are held in tests/parity/shopify-admin.test.ts; what only the
 * routes and Postgres can hold is here:
 *
 *   · the Admin API token (way A) and the Client ID and secret (way B, a write scope enough — shopify.dev's access
 *     scopes page) each make a kept review of the store's ACTIVE products;
 *   · the credential travels in the outbound request and nowhere else: not in the kept import, not in a redirect,
 *     not in the page a refusal draws (its inputs empty), and not in the audit;
 *   · a store in another currency adds nothing;
 *   · a store with no public list that answers its feed with Shopify's password page is "password-protected", and
 *     the Shopify way in opens — the probe asked with no credential.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `dd232000-0000-4000-8000-${RUN}0003`;
const CODE = `shopify-import-owner-${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const SHOP = 'https://atlas-mode.myshopify.com';
const GRAPHQL = `${SHOP}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
const TOKEN = `test-admin-token-${RUN}0000`;
const CLIENT_ID = `client-id-${RUN}00000000000000`;
const CLIENT_SECRET = `test-client-secret-${RUN}0000`;
const EXCHANGED = `test-exchanged-token-${RUN}1111`;
const SECRETS = [TOKEN, CLIENT_ID, CLIENT_SECRET, EXCHANGED];

const ok = (body: unknown): ShopifyAnswer => ({ status: 200, location: null, body: JSON.stringify(body) });
const variant = (price: string, sku: string, size: string) => ({ price, sku, selectedOptions: [{ name: 'Size', value: size }] });
const product = (id: number, title: string, variants: unknown[], status = 'ACTIVE') => ({
  id: `gid://shopify/Product/${id}`, title, status, options: [{ name: 'Size' }],
  variants: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: variants },
});
const page = (nodes: unknown[], next: string | null, currencyCode: string) => ({
  data: { shop: { currencyCode }, products: { pageInfo: { hasNextPage: next !== null, endCursor: next }, nodes } },
});

d('4.4 · a Shopify store read with the owner\'s app (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let cookie = '';
  const seen: ShopifyRequest[] = [];
  let shopCurrency = 'USD';
  let graphqlStatus = 200;
  let exchangeScope = 'write_products';
  let storefront: ShopifyAnswer = { status: 404, location: null, body: '' };
  const publicAsked: string[] = [];
  const fetcher: StoreFetcher = { get: async (url): Promise<FetchedPage> => { publicAsked.push(url); return { status: 404, contentType: 'text/html', body: '' }; } };

  /** Answers as a Shopify store would; records every request. */
  const transport = async (req: ShopifyRequest): Promise<ShopifyAnswer> => {
    seen.push(req);
    if (req.url.endsWith('/admin/oauth/access_token')) return ok({ access_token: EXCHANGED, scope: exchangeScope, expires_in: 86399 });
    if (req.url === GRAPHQL) {
      if (graphqlStatus !== 200) return { status: graphqlStatus, location: null, body: '{"errors":"[API] Invalid API key or access token"}' };
      const vars = (JSON.parse(req.body ?? '{}') as { variables?: Record<string, unknown> }).variables ?? {};
      return vars['cursor'] === null
        ? ok(page([product(1, 'Linen tee', [variant('24.00', 'TEE-S', 'S'), variant('24.00', 'TEE-M', 'M')]),
          product(2, 'Old hat', [variant('9.00', 'HAT', 'One')], 'ARCHIVED')], 'p2', shopCurrency))
        : ok(page([product(3, 'Canvas bag', [variant('15.50', 'BAG', 'One')])], null, shopCurrency));
    }
    return storefront;
  };

  const inBiz = async <T>(fn: (tx: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };
  const post = (url: string, fields: Record<string, string>) =>
    app.inject({ method: 'POST', url, headers: { cookie, ...FORM }, payload: new URLSearchParams(fields).toString() });
  const imports = () => inBiz((tx) => sql<{ n: number }>`select count(*)::int as n from catalog_imports where business_id = ${BIZ}::uuid`.execute(tx).then((r) => r.rows[0]!.n));
  /** Every word the workspace kept about its imports and its audit, as text. */
  const keptText = () => inBiz((tx) => sql<{ text: string }>`
    select coalesce((select string_agg(row_to_json(ci)::text, ' ') from catalog_imports ci where ci.business_id = ${BIZ}::uuid), '')
        || coalesce((select string_agg(row_to_json(a)::text, ' ') from channel_audit a where a.business_id = ${BIZ}::uuid), '') as text`.execute(tx).then((r) => r.rows[0]!.text));
  const noSecretIn = (where: string, text: string) => { for (const s of SECRETS) expect(text.includes(s), `${where} holds a credential`).toBe(false); };

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    await inBiz((tx) => sql`insert into businesses (id, name, kind, country, currency) values (${BIZ}, 'Atlas Mode', 'brand', 'US', 'USD')
                            on conflict (id) do nothing`.execute(tx));
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', factsTtlMs: 0,
      secureCookie: false, messagingEnabled: false, storeFetcher: fetcher, shopifyTransport: transport,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    cookie = String((await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(CODE)}`, headers: FORM }))
      .headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 60_000);
  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('WAY A, THE TOKEN: the ACTIVE products become a kept review; the token went in one header and is kept nowhere', async () => {
    seen.length = 0;
    const r = await post('/app/products/add/shopify', { address: 'atlas-mode.myshopify.com', token: TOKEN });
    expect([r.statusCode, String(r.headers['location'])], r.body.slice(0, 400)).toEqual([303, expect.stringMatching(/^\/app\/products\/import\/[0-9a-f-]{36}$/)]);
    noSecretIn('the redirect', String(r.headers['location']));
    // Two GraphQL pages, each carrying the token in its header and nowhere else in the request.
    expect(seen.map((q) => [q.method, q.url])).toEqual([['POST', GRAPHQL], ['POST', GRAPHQL]]);
    for (const q of seen) {
      expect(q.headers['x-shopify-access-token']).toBe(TOKEN);
      noSecretIn('the request body or address', `${q.url} ${q.body ?? ''}`);
    }
    const review = await app.inject({ method: 'GET', url: String(r.headers['location']), headers: { cookie } });
    expect(review.statusCode).toBe(200);
    expect(review.body).toContain('Linen tee');
    expect(review.body).toContain('Canvas bag');
    expect(review.body).not.toContain('Old hat');                 // ARCHIVED: not offered
    noSecretIn('the review page', review.body);
    const kept = await inBiz((tx) => sql<{ kind: string; currency: string; source: string }>`
      select kind, currency, source_text as source from catalog_imports where business_id = ${BIZ}::uuid order by created_at desc limit 1`.execute(tx).then((x) => x.rows[0]));
    expect(kept).toEqual({ kind: 'store', currency: 'USD', source: SHOP });
    noSecretIn('the kept import and the audit', await keptText());
  });

  it('WAY B, THE CLIENT ID AND SECRET: exchanged form-encoded with no scope asked; a write scope reads products', async () => {
    seen.length = 0;
    exchangeScope = 'write_products';
    const r = await post('/app/products/add/shopify', { address: SHOP, client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
    expect(r.statusCode, r.body.slice(0, 400)).toBe(303);
    const [exchange, ...reads] = seen;
    expect([exchange!.method, exchange!.url]).toEqual(['POST', `${SHOP}/admin/oauth/access_token`]);
    expect(exchange!.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(exchange!.body ?? ''))).toEqual({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
    expect(reads.map((q) => q.headers['x-shopify-access-token'])).toEqual([EXCHANGED, EXCHANGED]);
    noSecretIn('the kept import and the audit', await keptText());
  });

  it('A TOKEN SHOPIFY REFUSES: the add page again, the address kept, every credential field empty, nothing kept', async () => {
    graphqlStatus = 401;
    const before = await imports();
    const r = await post('/app/products/add/shopify', { address: 'atlas-mode.myshopify.com', token: TOKEN });
    graphqlStatus = 200;
    expect(r.statusCode).toBe(400);
    expect(r.body).toContain(esc(t('en', 'storeToken.refused.rejected')));
    expect(r.body).toContain('<details class="store-token" open>');
    expect(r.body).toContain(`value="${SHOP}"`);
    for (const f of ['token', 'client_id', 'client_secret']) expect(r.body).toContain(`name="${f}" type="password" value=""`);
    noSecretIn('the refused page', r.body);
    expect(await imports()).toBe(before);
  });

  it('A STORE IN ANOTHER CURRENCY adds nothing — nothing is converted', async () => {
    shopCurrency = 'EUR';
    const before = await imports();
    const r = await post('/app/products/add/shopify', { address: 'atlas-mode.myshopify.com', token: TOKEN });
    shopCurrency = 'USD';
    expect(r.statusCode).toBe(400);
    expect(r.body).toContain(esc(t('en', 'storeToken.refused.currency_mismatch')));
    expect(await imports()).toBe(before);
  });

  it('NO PUBLIC LIST AND SHOPIFY\'S PASSWORD PAGE: "password-protected", the Shopify way in open; asked with no credential', async () => {
    seen.length = 0;
    storefront = { status: 302, location: '/password', body: '' };
    const locked = await post('/app/products/add/store', { address: 'boutique.example.com', currency: 'on' });
    expect(locked.statusCode).toBe(400);
    expect(locked.body).toContain(esc(t('en', 'import.store.refused.password_protected')));
    expect(locked.body).toContain('<details class="store-token" open>');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: 'GET', url: 'https://boutique.example.com/products.json?limit=1' });
    expect(Object.keys(seen[0]!.headers).map((h) => h.toLowerCase())).not.toContain('x-shopify-access-token');
    expect(seen[0]!.body).toBeUndefined();
    expect(publicAsked.length).toBeGreaterThan(0);              // the public list was asked for first

    // A store whose feed is simply missing is not "password-protected".
    storefront = { status: 404, location: null, body: '' };
    const open = await post('/app/products/add/store', { address: 'boutique.example.com', currency: 'on' });
    expect(open.body).toContain(esc(t('en', 'import.store.refused.no_feed')));
    expect(open.body).not.toContain(esc(t('en', 'import.store.refused.password_protected')));
  });

  it('STAFF cannot read a store with a credential: the owner decides', async () => {
    const { hashCode } = await import('../../src/api/web/people.js');
    const code = `SHOPSTAFF-${RUN.toUpperCase()}`;
    await inBiz((tx) => sql`insert into people (business_id, name, code_hash) values (${BIZ}, 'Staff Member', ${hashCode(SECRET, code)})`.execute(tx));
    const staff = String((await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`, headers: FORM })).headers['set-cookie'] ?? '').split(';')[0] ?? '';
    seen.length = 0;
    const r = await app.inject({ method: 'POST', url: '/app/products/add/shopify', headers: { cookie: staff, ...FORM },
      payload: new URLSearchParams({ address: SHOP, token: TOKEN }).toString() });
    expect(r.statusCode).toBe(302);
    expect(seen).toEqual([]);
  });
});
