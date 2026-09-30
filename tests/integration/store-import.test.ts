import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant } from './tenant.js';
import { importAt, submitReview, formFields, BOUNDARY } from './importReview.js';
import type { StoreFetcher, FetchedPage } from '../../src/net/publicFetch.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * K8 — store import, through the real routes and into real rows (the
 * onboarding plan, decision 30).
 *
 * A fake store answers as Shopify and WooCommerce answer (their public lists);
 * the production fetcher's own rules — public internet only, checked at
 * connect time — are held in the parity file. What only Postgres can hold:
 * each priced variant became a product, its options became its knowledge,
 * the rows went through the review, and a store in another currency added
 * nothing.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `dd960000-0000-4000-8000-${RUN}0001`;
const CODE = 'store-import-owner-code';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

const SHOPIFY = { products: [
  { title: 'Wrap dress', options: [{ name: 'Size', values: ['S', 'M', 'L'] }, { name: 'Colour', values: ['Red', 'Navy'] }],
    variants: [
      { price: '68.00', compare_at_price: '90.00', sku: 'WD-S-R', option1: 'S', option2: 'Red' },
      { price: '68.00', compare_at_price: '90.00', sku: 'WD-M-R', option1: 'M', option2: 'Red' },
      { price: '68.00', sku: 'WD-L-N', option1: 'L', option2: 'Navy' },
    ] },
  { title: 'Silk scrunchie', options: [{ name: 'Title', values: ['Default Title'] }], variants: [{ price: '12.00', sku: 'SC-1', option1: 'Default Title' }] },
] };

d('K8 · store import (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let cookie = '';
  const asked: string[] = [];
  let answer: (url: string) => FetchedPage = () => ({ status: 404, contentType: 'text/html', body: 'not found' });
  const fetcher: StoreFetcher = { get: async (url) => { asked.push(url); return answer(url); } };

  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };
  const post = (url: string, fields: Record<string, string>) =>
    app.inject({ method: 'POST', url, headers: { cookie, ...FORM }, payload: new URLSearchParams(fields).toString() });
  const get = (url: string) => app.inject({ method: 'GET', url, headers: { cookie } });
  const product = (name: string) => tx((x) => sql<{ id: string; price: string | null; sku: string; unit: string }>`
    select id::text as id, price_usd_per_unit as price, sku, unit from products where business_id = ${BIZ} and name = ${name}`.execute(x).then((r) => r.rows[0]));
  const knowledge = (id: string) => tx((x) => sql<{ kind: string; label: string; content: string }>`
    select kind, label, content from product_knowledge where product_id = ${id}::uuid`.execute(x).then((r) => r.rows));

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    await tx((x) => sql`insert into businesses (id, name, kind, country, currency) values (${BIZ}, 'Store Import Boutique', 'brand', 'AE', 'AED')
                        on conflict (id) do nothing`.execute(x));
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: 'a-test-session-secret-of-sufficient-length',
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', factsTtlMs: 0,
      secureCookie: false, messagingEnabled: false, storeFetcher: fetcher,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    cookie = String((await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(CODE)}`, headers: FORM }))
      .headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 60_000);
  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('A SHOPIFY STORE: its priced variants are reviewed rows, and the options become each product\'s knowledge', async () => {
    answer = (url) => (url === 'https://boutique.example.com/products.json?limit=250&page=1'
      ? { status: 200, contentType: 'application/json', body: JSON.stringify(SHOPIFY) }
      : { status: 404, contentType: 'text/html', body: '' });
    // Shopify states no currency: without her word, nothing is read into the review.
    const unsure = await post('/app/products/add/store', { address: 'boutique.example.com' });
    expect(unsure.body).toContain(t('en', 'import.store.refused.currency_unconfirmed'));
    const at = importAt(await post('/app/products/add/store', { address: 'boutique.example.com', currency: 'on' }));
    expect(asked).toContain('https://boutique.example.com/products.json?limit=250&page=1');
    const review = await get(at);
    expect(review.body).toContain('We read 2 lines.');
    expect(review.body).toContain('Size: S, M, L · Colour: Red, Navy');
    const { res } = await submitReview(app, cookie, at, { tickAll: true });
    expect(res.statusCode).toBe(302);
    const dress = (await product('Wrap dress'))!;
    expect(Number(dress.price)).toBe(68);             // never the compare-at 90
    expect(dress.unit).toBe('item');                   // a brand counts in items (RT)
    expect(await knowledge(dress.id)).toEqual([{ kind: 'specification', label: 'Size, Colour', content: 'Size: S, M, L · Colour: Red, Navy' }]);
    const scrunchie = (await product('Silk scrunchie'))!;
    expect(scrunchie.sku).toBe('SC-1');
    expect(await knowledge(scrunchie.id)).toEqual([]);
  });

  it('A WOOCOMMERCE STORE THAT SELLS IN ANOTHER CURRENCY adds nothing — nothing is converted', async () => {
    answer = (url) => (url.startsWith('https://eu.example.com/wp-json/wc/store/v1/products')
      ? { status: 200, contentType: 'application/json', body: JSON.stringify([
          { id: 1, name: 'Beret', sku: 'B-1', prices: { price: '3500', currency_code: 'EUR', currency_minor_unit: 2 }, attributes: [], variations: [] }]) }
      : { status: 404, contentType: 'text/html', body: '' });
    const res = await post('/app/products/add/store', { address: 'https://eu.example.com' });
    expect(res.body).toContain('The store sells in EUR');
    expect(await product('Beret')).toBeUndefined();
  });

  it('A PRIVATE ADDRESS IS NOT ASKED AT ALL', async () => {
    const before = asked.length;
    for (const address of ['https://localhost', 'https://169.254.169.254', 'http://boutique.example.com']) {
      const res = await post('/app/products/add/store', { address });
      expect(res.statusCode, address).toBe(200);
      expect(res.body, address).toContain(t('en', 'import.store.refusedTitle'));
    }
    expect(asked.length).toBe(before);
  });

  it('A STORE WITH NO PUBLIC LIST says to export a file instead', async () => {
    answer = () => ({ status: 404, contentType: 'text/html', body: '<html>not here</html>' });
    const res = await post('/app/products/add/store', { address: 'closed.example.com', currency: 'on' });
    expect(res.body).toContain(t('en', 'import.store.refused.no_feed'));
  });

  it('A SHOPIFY EXPORT FILE: its columns first (filled in), then the review, then products', async () => {
    const csv = [
      'Handle,Title,Option1 Name,Option1 Value,Variant SKU,Variant Price,Variant Compare At Price',
      'kaftan,Linen kaftan,Size,S,K-S,120.00,150.00',
      'kaftan,,,M,K-M,120.00,150.00',
      'kaftan,,,XL,K-XL,135.00,160.00',
    ].join('\n');
    const upload = await app.inject({
      method: 'POST', url: '/app/products/add/file',
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
      payload: Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="products_export.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--${BOUNDARY}--\r\n`),
    });
    expect(upload.statusCode).toBe(303);
    const cols = String(upload.headers['location']);
    expect(cols).toMatch(/\/columns$/);
    const page = await get(cols);
    expect(page.body).toContain(t('en', 'import.columns.preset.shopify', { n: 3 }));
    // Without her word on the currency, the rows are not read.
    const fields = Object.fromEntries(formFields(page.body, cols));
    const unsure = await post(cols, fields);
    expect(unsure.statusCode).toBe(400);
    expect(unsure.body).toContain(t('en', 'import.columns.problem.unconfirmed', { currency: 'AED' }));
    const ok = await post(cols, { ...fields, currency: 'on' });
    expect(ok.statusCode).toBe(302);
    const at = cols.replace(/\/columns$/, '');
    const review = await get(at);
    expect(review.body).toContain('Linen kaftan — S, M');
    expect(review.body).toContain('Linen kaftan — XL');
    // "— none —" left as it is maps nothing: no Handle among the options.
    expect(review.body).not.toContain('Handle:');
    const { res } = await submitReview(app, cookie, at, { tickAll: true });
    expect(res.statusCode).toBe(302);
    expect(Number((await product('Linen kaftan — XL'))!.price)).toBe(135);
  });

  it('A PASTED SPREADSHEET TABLE goes to its columns, not the line parser', async () => {
    const res = await post('/app/products/add/review', { text: 'Name\tPrice\tStock\nBeaded bag\t85\t12\nClutch\t60\t4\n' });
    expect(res.statusCode).toBe(303);
    expect(String(res.headers['location'])).toMatch(/\/columns$/);
  });
});
