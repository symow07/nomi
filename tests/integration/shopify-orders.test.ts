import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import pg from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { flashSaid } from './tenant.js';
import type { ShopifyAnswer, ShopifyRequest } from '../../src/net/shopifyAdmin.js';
import { SHOPIFY_API_VERSION } from '../../src/core/onboard/shopifyGraphql.js';
import { SHOPIFY_ORDER_QUERY, SHOPIFY_SCOPES_QUERY } from '../../src/core/commerce/shopifyOrders.js';
import { ShopifyPacer } from '../../src/net/shopifyOrders.js';
import { SHOPIFY_ORDERS_PAGE } from '../../src/api/web/shopifyOrders.js';
import { deriveKey, encryptSecret } from '../../src/security/credentials.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
// @ts-expect-error — the operator tools, plain JS on purpose (tools/ is not type-checked).
import { planErasure, sameCounts } from '../../tools/erase-buyer.mjs';

/**
 * BLOCK 5.5 — SHOPIFY ORDERS OVER POSTGRES (0237), with a fake Shopify that records every request and refuses anything
 * but the minimal queries. What the turn does with an answer is tests/pipeline/order-lookup; the requests' own rules
 * are tests/parity/shopify-orders. Here:
 *
 *   · the owner's page and routes — staff refused on connect, switch and disconnect, with nothing written and Shopify
 *     never asked; the credential sealed and never drawn, kept or logged in a row;
 *   · the lookup's three steps on the real database — 'off' asks nothing and writes nothing; the audit row holds the
 *     outcome and, only when verified, the order's name; five an hour per conversation; the e-mail channel's sender;
 *   · the reference trigger in place of the foreign key, as nomi_app scoped to A: B's conversation and one that does
 *     not exist are refused (t1r's correction of 2026-11-10);
 *   · condition 2 — a lookup completes under a 1.5 s statement timeout while a turn holds the conversation's advisory
 *     lock and its conversation and client rows FOR UPDATE; two turns of one conversation never deadlock;
 *   · erasure — a customer's leaves no lookup row; a closed workspace leaves no Shopify row; Practice never asks.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const A = `dd55a000-0000-4000-8000-${RUN}0001`;
const B = `dd55a000-0000-4000-8000-${RUN}0002`;
const B_NAME = `Shopify Other ${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const CODE = `shopify-orders-owner-${RUN}`;
const STAFF_CODE = `SHOPS-${RUN.toUpperCase()}`;
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const SHOP = `https://atlas-${RUN}.myshopify.com`;
const GRAPHQL = `${SHOP}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
const TOKEN = `shpat-test-${RUN}-0000`;
const KEY = deriveKey(randomBytes(32).toString('hex'));
const ORDER = '#NOMI-5501';
const ORDER_EMAIL = `order5501.${RUN}@example.test`;
const TRACKING = `AP5505-CANARY-${RUN}`;
const OWNER_NOTICE = t('en', 'staff.notAllowed');
const DECIDES = t('en', 'staff.ownerDecides');

type Conv = { client: string; conv: string };
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
/** Playwright's Chromium, where this machine has it (a developer's Mac does; CI installs none). */
const CHROMIUM = await import('playwright').then(({ chromium }) => existsSync(chromium.executablePath())).catch(() => false);

d('5.5 · Shopify orders over Postgres (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let lowDb: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let appRole: pg.Client;
  let owner = '';
  let staff = '';
  let B_OWNER = '';
  const C: Record<'chat' | 'mail' | 'held' | 'pair' | 'erased' | 'tool' | 'theirs', Conv> = {} as never;

  // ── the fake Shopify ──────────────────────────────────────────────────────────────────────────────────────────
  const seen: ShopifyRequest[] = [];
  const refused: string[] = [];
  let scopes = ['read_orders'];
  let tokenStatus = 200;
  const answer = (status: number, body: unknown, version: string | null = '2026-10'): ShopifyAnswer => ({ status, location: null, version, body: JSON.stringify(body) });
  const orderNode = () => ({
    name: ORDER, createdAt: new Date(Date.now() - 5 * 86_400_000).toISOString(), cancelledAt: null,
    displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'FULFILLED', email: ORDER_EMAIL,
    fulfillments: [{ status: 'SUCCESS', displayStatus: 'IN_TRANSIT', deliveredAt: null, estimatedDeliveryAt: null,
      trackingInfo: [{ company: 'Atlas Post', number: TRACKING, url: null }] }],
  });
  const transport = async (req: ShopifyRequest): Promise<ShopifyAnswer> => {
    seen.push(req);
    if (req.url !== GRAPHQL || req.method !== 'POST') { refused.push(`${req.method} ${req.url}`); return answer(404, {}); }
    if (req.headers['x-shopify-access-token'] !== TOKEN || tokenStatus !== 200) return answer(tokenStatus === 200 ? 401 : tokenStatus, {});
    const { query, variables } = JSON.parse(req.body ?? '{}') as { query: string; variables: Record<string, unknown> };
    if (/\b(mutation|subscription)\b/.test(query)) { refused.push('mutation'); return answer(400, {}); }
    if (query === SHOPIFY_SCOPES_QUERY) return answer(200, { data: { currentAppInstallation: { accessScopes: scopes.map((handle) => ({ handle })) } } });
    if (query !== SHOPIFY_ORDER_QUERY) { refused.push('another query'); return answer(400, {}); }
    const nodes = variables['q'] === `name:"${ORDER}"` ? [orderNode()] : [];
    return answer(200, { data: { orders: { pageInfo: { hasNextPage: false }, nodes } },
      extensions: { cost: { requestedQueryCost: 20, actualQueryCost: 8, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 990, restoreRate: 50 } } } });
  };
  const orderRequests = () => seen.filter((r) => (r.body ?? '').includes('NomiOrder')).length;

  // ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────────
  const post = (cookie: string, url: string, fields: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url, headers: { cookie, ...FORM }, payload: new URLSearchParams(fields).toString() });
  const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: { cookie } });
  const login = async (code: string) => String((await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`, headers: FORM }))
    .headers['set-cookie'] ?? '').split(';')[0] ?? '';
  const n = async (q: string, p: unknown[]) => Number((await admin.query(q, p)).rows[0].n);
  const connections = (biz: string) => admin.query(`select to_jsonb(s) as r from shopify_connections s where business_id = $1 order by connected_at`, [biz]).then((r) => r.rows.map((x) => x.r));
  const lookups = (conv: string) => admin.query(`select outcome, order_name from shopify_order_lookups where conversation_id = $1 order by asked_at`, [conv]).then((r) => r.rows as { outcome: string; order_name: string | null }[]);
  const lookupFor = async (biz: string, over: { db?: import('../../src/db/client.js').Db } = {}) => {
    const { shopifyOrderLookup } = await import('../../src/pipeline/orderLookup.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(biz); if (!bid.ok) throw new Error('fixture');
    return shopifyOrderLookup({ db: over.db ?? db, businessId: bid.value, credentialKey: KEY, transport, pacer: new ShopifyPacer() });
  };
  const customer = async (biz: string, key: string, channel: 'whatsapp' | 'email', i: number): Promise<Conv> => {
    const id = channel === 'email' ? `${key}.${RUN}@buyer.test` : `97${i}${String(parseInt(RUN, 16) % 1_000_000_000).padStart(9, '0')}`;
    const client = (await admin.query(`insert into clients (business_id, display_name, ${channel === 'email' ? 'email' : 'phone'}) values ($1, $2, $3) returning id::text as id`,
      [biz, `Customer ${key} ${RUN}`, id])).rows[0].id as string;
    await admin.query(`insert into client_channels (client_id, channel, channel_user_id, last_inbound_at) values ($1, $2, $3, now())`, [client, channel, channel === 'email' ? ORDER_EMAIL.replace('order5501', `${key}-order5501`) : id]);
    const conv = (await admin.query(`insert into conversations (business_id, client_id, channel) values ($1, $2, $3) returning id::text as id`, [biz, client, channel])).rows[0].id as string;
    return { client, conv };
  };
  /** As the application role, scoped to one business, in one transaction. */
  const asApp = async <T>(biz: string, fn: (q: (text: string, p?: unknown[]) => Promise<pg.QueryResult>) => Promise<T>): Promise<T> => {
    await appRole.query('begin');
    try {
      await appRole.query("select set_config('app.business_id', $1, true)", [biz]);
      const r = await fn((text, p) => appRole.query(text, p));
      await appRole.query('commit');
      return r;
    } catch (e) { await appRole.query('rollback').catch(() => {}); throw e; }
  };

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { hashCode } = await import('../../src/api/web/people.js');
    db = createDb(DATABASE_URL!);
    const was = process.env['DATABASE_QUERY_TIMEOUT_MS'];
    process.env['DATABASE_QUERY_TIMEOUT_MS'] = '1500';
    lowDb = createDb(DATABASE_URL!);
    if (was === undefined) delete process.env['DATABASE_QUERY_TIMEOUT_MS']; else process.env['DATABASE_QUERY_TIMEOUT_MS'] = was;
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    appRole = new pg.Client({ connectionString: DATABASE_URL });
    await appRole.connect();

    await admin.query(`insert into businesses (id, name, owner_locale, timezone) values ($1, $2, 'en', 'Asia/Shanghai'), ($3, $4, 'en', 'UTC')`,
      [A, `Shopify Shop ${RUN}`, B, B_NAME]);
    await admin.query(`insert into people (business_id, name, code_hash) values ($1, 'Xiao Chen', $2)`, [A, hashCode(SECRET, STAFF_CODE)]);
    B_OWNER = (await admin.query(`insert into people (business_id, name, is_owner) values ($1, 'Bo', true) returning id::text as id`, [B])).rows[0].id;
    C.chat = await customer(A, 'chat', 'whatsapp', 1);
    C.mail = await customer(A, 'mail', 'email', 2);
    C.held = await customer(A, 'held', 'whatsapp', 3);
    C.pair = await customer(A, 'pair', 'whatsapp', 4);
    C.erased = await customer(A, 'erased', 'whatsapp', 5);
    C.tool = await customer(A, 'tool', 'whatsapp', 7);
    C.theirs = await customer(B, 'theirs', 'whatsapp', 6);
    // The e-mail customer wrote from the address on the order.
    await admin.query(`update client_channels set channel_user_id = $2 where client_id = $1`, [C.mail.client, ORDER_EMAIL]);

    process.env['PILOT_BUSINESS_ID'] = A;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: A, accessCode: CODE, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', factsTtlMs: 0,
      secureCookie: false, messagingEnabled: false, shopifyTransport: transport, credentialKey: KEY,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    owner = await login(CODE);
    staff = await login(STAFF_CODE);
    expect([owner, staff].every((c) => c !== '') && owner !== staff).toBe(true);
  }, 60_000);
  afterAll(async () => {
    await app?.close(); await db?.destroy(); await lowDb?.destroy(); await admin?.end(); await appRole?.end();
  });

  // ── the page ────────────────────────────────────────────────────────────────────────────────────────────────
  it('NOTHING CONNECTED: the owner sees the form; staff see that the owner decides; Practice says nothing', async () => {
    const o = await get(owner, SHOPIFY_ORDERS_PAGE);
    expect(o.statusCode).toBe(200);
    expect(o.body).toContain(esc(t('en', 'shopifyOrders.notConnected')));
    expect(o.body).toContain(`action="${SHOPIFY_ORDERS_PAGE}/connect"`);
    const s = await get(staff, SHOPIFY_ORDERS_PAGE);
    expect(s.statusCode).toBe(200);
    expect(s.body).not.toContain(`action="${SHOPIFY_ORDERS_PAGE}/connect"`);
    expect(s.body).toContain(DECIDES);
    expect((await get(owner, '/app/assistant/practice')).body).not.toContain('id="shopify-practice"');
  });

  it('STAFF CONNECTING: refused, nothing written, Shopify never asked', async () => {
    seen.length = 0;
    const r = await post(staff, `${SHOPIFY_ORDERS_PAGE}/connect`, { address: SHOP, token: TOKEN });
    expect(flashSaid(r, SECRET)).toContain(OWNER_NOTICE);
    expect(seen).toHaveLength(0);
    expect(await connections(A)).toEqual([]);
  });

  it('A GRANT WITHOUT read_orders, A REFUSED TOKEN, AN ADDRESS NOT ON myshopify.com: the form again, nothing kept, the fields empty', async () => {
    scopes = ['read_products', 'read_all_orders'];
    const noScope = await post(owner, `${SHOPIFY_ORDERS_PAGE}/connect`, { address: SHOP, token: TOKEN });
    expect(noScope.statusCode).toBe(400);
    expect(noScope.body).toContain(esc(t('en', 'shopifyOrders.refused.scope_missing_read_orders')));
    expect(noScope.body).toContain('name="token" type="password" value=""');
    expect(noScope.body).not.toContain(TOKEN);
    scopes = ['read_orders'];
    tokenStatus = 401;
    const bad = await post(owner, `${SHOPIFY_ORDERS_PAGE}/connect`, { address: SHOP, token: TOKEN });
    tokenStatus = 200;
    expect(bad.body).toContain(esc(t('en', 'shopifyOrders.refused.credential_refused')));
    const elsewhere = await post(owner, `${SHOPIFY_ORDERS_PAGE}/connect`, { address: 'https://atlas.example.com', token: TOKEN });
    expect(elsewhere.body).toContain(esc(t('en', 'storeToken.refused.not_myshopify')));
    expect(await connections(A)).toEqual([]);
  });

  it('THE OWNER CONNECTS: the grant read, the credential sealed and never drawn; the switch starts off; Practice says it is not connected there', async () => {
    seen.length = 0;
    const r = await post(owner, `${SHOPIFY_ORDERS_PAGE}/connect`, { address: SHOP.replace('https://', ''), token: TOKEN });
    expect(r.statusCode, r.body.slice(0, 300)).toBe(302);
    expect(flashSaid(r, SECRET)).toBe(t('en', 'shopifyOrders.flash.connected'));
    expect(seen.map((q) => q.url)).toEqual([GRAPHQL]);
    expect(refused).toEqual([]);
    const [row] = await connections(A) as Record<string, unknown>[];
    expect(row).toMatchObject({ shop: SHOP, way: 'token', scopes: ['read_orders'], api_version_seen: '2026-10', answer_orders: false, archived_at: null });
    expect(String(row!['credential_ciphertext'])).toMatch(/^v1\./);
    expect(JSON.stringify(row)).not.toContain(TOKEN);
    const page = await get(owner, SHOPIFY_ORDERS_PAGE);
    expect(page.body).toContain('read_orders');
    expect(page.body).toContain(esc(t('en', 'shopifyOrders.scopes.recent')));
    expect(page.body).not.toContain(TOKEN);
    expect(page.body).not.toContain(String(row!['credential_ciphertext']));
    expect((await get(owner, '/app/assistant/practice')).body).toContain('id="shopify-practice"');
  });

  it('A VERSION SHOPIFY DID NOT ASK FOR is shown to the owner', async () => {
    await admin.query(`update shopify_connections set api_version_seen = '2026-07' where business_id = $1 and archived_at is null`, [A]);
    expect((await get(owner, SHOPIFY_ORDERS_PAGE)).body).toContain('2026-07');
    await admin.query(`update shopify_connections set api_version_seen = '2026-10' where business_id = $1 and archived_at is null`, [A]);
  });

  /*
   * 5.5's verification, criterion 9: the version sentence sat in a `.pill`, which never wraps, and the page ran 862 px
   * wide on a 390 px phone (en and ar, owner and staff). A sentence is the page's state line; a pill is for a state's
   * word. Measured in a real browser where this Mac has Playwright's Chromium (CI installs none: there the markup
   * check below still holds the defect).
   */
  it('THE VERSION SENTENCE WRAPS: never inside a pill, in en and ar, for the owner and for staff', async () => {
    await admin.query(`update shopify_connections set api_version_seen = '2026-07' where business_id = $1 and archived_at is null`, [A]);
    try {
      for (const locale of ['en', 'ar'] as const) for (const [who, cookie] of [['owner', owner], ['staff', staff]] as const) {
        const html = (await app.inject({ method: 'GET', url: SHOPIFY_ORDERS_PAGE, headers: { cookie, 'accept-language': locale } })).body;
        expect(html, `${locale}/${who}`).toContain(`<html lang="${locale}"`);
        const pills = [...html.matchAll(/<span class="pill[^"]*">([\s\S]*?)<\/span>/g)].map((m) => m[1]!);
        expect(pills.some((p) => p.includes('2026-07')), `${locale}/${who}: no pill holds the sentence`).toBe(false);
        expect(html, `${locale}/${who}: the sentence is the state line`).toMatch(/<p class="stateline" role="status"><span class="dot warn[^>]*><\/span> [^<]*2026-07/);
      }
    } finally {
      await admin.query(`update shopify_connections set api_version_seen = '2026-10' where business_id = $1 and archived_at is null`, [A]);
    }
  });

  it.skipIf(!CHROMIUM)('THE PAGE AT 390 px, in a real browser: no wider than the phone, en and ar, owner and staff', async () => {
    const { chromium } = await import('playwright');
    await admin.query(`update shopify_connections set api_version_seen = '2026-07' where business_id = $1 and archived_at is null`, [A]);
    const browser = await chromium.launch();
    try {
      for (const locale of ['en', 'ar'] as const) for (const [who, cookie] of [['owner', owner], ['staff', staff]] as const) {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        const page = await context.newPage();
        // Every request the page makes is answered by the app itself, never the network.
        await page.route('**/*', async (route) => {
          const url = new URL(route.request().url());
          if (url.host !== 'nomi.test') return route.abort();
          const r = await app.inject({ method: 'GET', url: url.pathname + url.search, headers: { cookie, 'accept-language': locale } });
          return route.fulfill({ status: r.statusCode, headers: { 'content-type': String(r.headers['content-type'] ?? 'text/plain') }, body: r.rawPayload });
        });
        await page.goto(`http://nomi.test${SHOPIFY_ORDERS_PAGE}`, { waitUntil: 'load' });
        const width = await page.evaluate<number>('document.documentElement.scrollWidth');
        expect(width, `${locale}/${who}: scrollWidth at 390`).toBe(390);
        expect(await page.locator('p.stateline[role="status"]').count(), `${locale}/${who}: the sentence on the page`).toBe(1);
        await context.close();
      }
    } finally {
      await browser.close();
      await admin.query(`update shopify_connections set api_version_seen = '2026-10' where business_id = $1 and archived_at is null`, [A]);
    }
  });

  it('SWITCH OFF: a lookup asks Shopify nothing and writes nothing', async () => {
    seen.length = 0;
    const r = await (await lookupFor(A)).look({ conversationId: C.chat.conv, orderName: ORDER, email: ORDER_EMAIL });
    expect(r).toEqual({ kind: 'off' });
    expect(seen).toHaveLength(0);
    expect(await lookups(C.chat.conv)).toEqual([]);
  });

  it('STAFF SWITCHING: refused; the owner switches on', async () => {
    expect(flashSaid(await post(staff, `${SHOPIFY_ORDERS_PAGE}/switch`, { on: '1' }), SECRET)).toContain(OWNER_NOTICE);
    expect((await connections(A))[0]).toMatchObject({ answer_orders: false });
    expect(flashSaid(await post(owner, `${SHOPIFY_ORDERS_PAGE}/switch`, { on: '1' }), SECRET)).toBe(t('en', 'shopifyOrders.flash.on'));
    expect((await connections(A))[0]).toMatchObject({ answer_orders: true });
  });

  it('A MATCH: the facts, one request with the token in its header; the audit keeps the outcome and the name, nothing else', async () => {
    seen.length = 0;
    const r = await (await lookupFor(A)).look({ conversationId: C.chat.conv, orderName: ORDER, email: ORDER_EMAIL.toUpperCase() });
    expect(r.kind).toBe('verified');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.headers['x-shopify-access-token']).toBe(TOKEN);
    expect(seen[0]!.url + (seen[0]!.body ?? '')).not.toContain(TOKEN);
    expect(await lookups(C.chat.conv)).toEqual([{ outcome: 'verified', order_name: ORDER }]);
  });

  it('A MISMATCH, A NUMBER SHOPIFY DOES NOT HAVE: refused; the audit names no order', async () => {
    const look = await lookupFor(A);
    expect(await look.look({ conversationId: C.chat.conv, orderName: ORDER, email: `someone.${RUN}@example.test` })).toEqual({ kind: 'refused' });
    expect(await look.look({ conversationId: C.chat.conv, orderName: '#NOMI-9999', email: ORDER_EMAIL })).toEqual({ kind: 'refused' });
    expect((await lookups(C.chat.conv)).slice(1)).toEqual([{ outcome: 'mismatch', order_name: null }, { outcome: 'not_found', order_name: null }]);
  });

  it('FIVE AN HOUR PER CONVERSATION: the sixth is refused with no request, and counted as rate_limited', async () => {
    const look = await lookupFor(A);
    await look.look({ conversationId: C.chat.conv, orderName: ORDER, email: ORDER_EMAIL });
    await look.look({ conversationId: C.chat.conv, orderName: ORDER, email: ORDER_EMAIL });
    expect(await n(`select count(*) as n from shopify_order_lookups where conversation_id = $1 and outcome <> 'rate_limited'`, [C.chat.conv])).toBe(5);
    const before = orderRequests();
    expect(await look.look({ conversationId: C.chat.conv, orderName: ORDER, email: ORDER_EMAIL })).toEqual({ kind: 'refused' });
    expect(orderRequests()).toBe(before);
    expect((await lookups(C.chat.conv)).at(-1)).toEqual({ outcome: 'rate_limited', order_name: null });
    // Another conversation has its own five.
    expect((await look.look({ conversationId: C.pair.conv, orderName: ORDER, email: ORDER_EMAIL })).kind).toBe('verified');
  });

  it('ON E-MAIL, the address the customer wrote from counts; on chat with no e-mail, nothing is asked', async () => {
    const look = await lookupFor(A);
    expect((await look.look({ conversationId: C.mail.conv, orderName: ORDER, email: null })).kind).toBe('verified');
    seen.length = 0;
    expect(await look.look({ conversationId: C.held.conv, orderName: ORDER, email: null })).toEqual({ kind: 'off' });
    expect(seen).toHaveLength(0);
    expect(await lookups(C.held.conv)).toEqual([]);
  });

  it('NOTHING OF THE ORDER IS KEPT: no e-mail, tracking number or token in any row of the workspace', async () => {
    const tables = (await admin.query(`
      select c.table_name as t from information_schema.columns c join information_schema.tables x
        on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
       where c.table_schema = 'public' and c.column_name = 'business_id'`)).rows.map((r) => r.t as string);
    const found: string[] = [];
    for (const tbl of tables) {
      for (const canary of [ORDER_EMAIL.split('@')[0]!, TRACKING, TOKEN]) {
        if (tbl === 'client_channels' || tbl === 'clients') continue;   // the e-mail customer's own address is theirs, written before any lookup
        if (await n(`select count(*) as n from ${tbl} x where business_id = $1 and to_jsonb(x)::text ilike $2`, [A, `%${canary}%`])) found.push(`${tbl}: ${canary}`);
      }
    }
    expect(found).toEqual([]);
  });

  // ── the reference, as the application role ──────────────────────────────────────────────────────────────────
  it('AS nomi_app SCOPED TO A: B\'s conversation and one that does not exist are refused; the table cannot be written directly', async () => {
    const who = (await appRole.query(`select current_user as u, r.rolsuper as s, r.rolbypassrls as b from pg_roles r where r.rolname = current_user`)).rows[0];
    expect(who).toEqual({ u: 'nomi_app', s: false, b: false });
    await expect(asApp(A, (q) => q('select claim_order_lookup($1::uuid)', [C.theirs.conv]))).rejects.toMatchObject({ code: '42501' });
    await expect(asApp(A, (q) => q('select claim_order_lookup($1::uuid)', [randomUUID()]))).rejects.toMatchObject({ code: '42501' });
    await expect(asApp(A, (q) => q(`insert into shopify_order_lookups (business_id, conversation_id, outcome) values ($1, $2, 'asking')`, [A, C.theirs.conv])))
      .rejects.toMatchObject({ code: '42501' });
    expect(await n(`select count(*) as n from shopify_order_lookups where conversation_id = $1`, [C.theirs.conv])).toBe(0);
    // The port refuses as well, before Shopify: a job for A naming B's conversation fails closed.
    seen.length = 0;
    await expect((await lookupFor(A)).look({ conversationId: C.theirs.conv, orderName: ORDER, email: ORDER_EMAIL })).rejects.toThrow();
    expect(seen).toHaveLength(0);
  });

  it('THE TRIGGER ITSELF, for whoever can write the table: another workspace\'s conversation, or none, is 23503', async () => {
    await expect(admin.query(`insert into shopify_order_lookups (business_id, conversation_id, outcome) values ($1, $2, 'asking')`, [A, C.theirs.conv]))
      .rejects.toMatchObject({ code: '23503' });
    await expect(admin.query(`insert into shopify_order_lookups (business_id, conversation_id, outcome) values ($1, $2, 'asking')`, [A, randomUUID()]))
      .rejects.toMatchObject({ code: '23503' });
    await expect(admin.query(`update shopify_order_lookups set conversation_id = $2 where conversation_id = $1`, [C.pair.conv, C.theirs.conv]))
      .rejects.toMatchObject({ code: '23503' });
  });

  it('A DEFINER INSERT, called by nomi_app scoped to A, meets the same trigger: B\'s conversation, or none, is 23503', async () => {
    // A definer that writes the table with no check of its own (claim_order_lookup checks first, so it answers 42501
    // before the trigger is reached). Made and dropped inside one transaction that is rolled back: nothing is kept.
    expect((await admin.query(`select rolsuper as s from pg_roles where rolname = current_user`)).rows[0].s).toBe(true);
    await admin.query('begin');
    try {
      await admin.query(`create function public.shopify_lookup_definer_probe(p_business uuid, p_conversation uuid) returns void
        language sql security definer set search_path = public, pg_temp as
        $$ insert into shopify_order_lookups (business_id, conversation_id, outcome) values (p_business, p_conversation, 'asking') $$`);
      await admin.query('grant execute on function public.shopify_lookup_definer_probe(uuid, uuid) to nomi_app');
      await admin.query('set local role nomi_app');
      await admin.query("select set_config('app.business_id', $1, true)", [A]);
      expect((await admin.query('select current_user as u')).rows[0].u).toBe('nomi_app');
      for (const conversation of [C.theirs.conv, randomUUID()]) {
        await admin.query('savepoint probe');
        await expect(admin.query('select public.shopify_lookup_definer_probe($1::uuid, $2::uuid)', [A, conversation]))
          .rejects.toMatchObject({ code: '23503' });
        await admin.query('rollback to savepoint probe');
      }
      // The control: A's own conversation is written through the same definer.
      await admin.query('select public.shopify_lookup_definer_probe($1::uuid, $2::uuid)', [A, C.held.conv]);
    } finally {
      await admin.query('rollback');
    }
    expect(await n(`select count(*) as n from pg_proc where proname = 'shopify_lookup_definer_probe'`, [])).toBe(0);
  });

  // ── condition 2 ──────────────────────────────────────────────────────────────────────────────────────────────
  it('A LOOKUP COMPLETES UNDER A 1.5 s STATEMENT TIMEOUT while a turn holds the conversation\'s lock and its rows FOR UPDATE', async () => {
    const turn = new pg.Client({ connectionString: DATABASE_URL });
    await turn.connect();
    try {
      await turn.query('begin');
      await turn.query("select set_config('app.business_id', $1, true)", [A]);
      await turn.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [C.held.conv]);
      await turn.query('select 1 from conversations where id = $1 for update', [C.held.conv]);
      await turn.query('select 1 from clients where id = $1 for update', [C.held.client]);
      // The control: what a foreign key's check takes would wait here, and the timeout ends it.
      const { withTenantTx } = await import('../../src/db/client.js');
      const { parseBusinessId } = await import('../../src/core/types/ids.js');
      const bid = parseBusinessId(A); if (!bid.ok) throw new Error('fixture');
      await expect(withTenantTx(lowDb, bid.value, (tx) => sql`select 1 from conversations where id = ${C.held.conv}::uuid for key share`.execute(tx)))
        .rejects.toMatchObject({ code: '57014' });
      const started = Date.now();
      const r = await (await lookupFor(A, { db: lowDb })).look({ conversationId: C.held.conv, orderName: ORDER, email: ORDER_EMAIL });
      expect(r.kind).toBe('verified');
      expect(Date.now() - started).toBeLessThan(1500);
      expect(await lookups(C.held.conv)).toEqual([{ outcome: 'verified', order_name: ORDER }]);
    } finally {
      await turn.query('rollback').catch(() => {});
      await turn.end();
    }
  });

  it('TWO TURNS OF ONE CONVERSATION: each takes the conversation lock and its row, then looks up; neither waits on the other forever', async () => {
    const { withTenantTx, lockConversation } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(A); if (!bid.ok) throw new Error('fixture');
    const look = await lookupFor(A, { db: lowDb });
    const aTurn = () => withTenantTx(db, bid.value, async (tx) => {
      await lockConversation(tx, C.pair.conv);
      await sql`select 1 from conversations where id = ${C.pair.conv}::uuid for update`.execute(tx);
      return look.look({ conversationId: C.pair.conv, orderName: ORDER, email: ORDER_EMAIL });
    });
    const both = await Promise.race([
      Promise.all([aTurn(), aTurn()]),
      new Promise<'stuck'>((resolve) => setTimeout(() => resolve('stuck'), 20_000)),
    ]);
    expect(both).not.toBe('stuck');
    expect((both as { kind: string }[]).map((x) => x.kind)).toEqual(['verified', 'verified']);
  });

  // ── Practice, isolation, erasure ─────────────────────────────────────────────────────────────────────────────
  it('PRACTICE: a copy can hold no Shopify connection, and a lookup there asks nothing', async () => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(A); if (!bid.ok) throw new Error('fixture');
    const copy = await withTenantTx(db, bid.value, async (tx) => (await sql<{ id: string }>`select practice_refresh(${A}::uuid)::text as id`.execute(tx)).rows[0]!.id);
    await expect(admin.query(`insert into shopify_connections (business_id, shop, way, credential_ciphertext, scopes, connected_by) values ($1, $2, 'token', $3, '{read_orders}', 'test')`,
      [copy, SHOP, encryptSecret('{}', KEY)])).rejects.toThrow();
    const practice = await customer(copy, 'practice', 'whatsapp', 7);
    seen.length = 0;
    expect(await (await lookupFor(copy)).look({ conversationId: practice.conv, orderName: ORDER, email: ORDER_EMAIL })).toEqual({ kind: 'off' });
    expect(seen).toHaveLength(0);
  });

  it('A CUSTOMER ERASED: their lookups go with them, counted on the plan and the result; another customer\'s stay', async () => {
    const look = await lookupFor(A);
    await look.look({ conversationId: C.erased.conv, orderName: ORDER, email: ORDER_EMAIL });
    await look.look({ conversationId: C.erased.conv, orderName: '#NOMI-9999', email: ORDER_EMAIL });
    expect((await admin.query('select customer_erasure_problems() as p')).rows[0].p).toEqual([]);
    const req = (await admin.query(`insert into deletion_requests (business_id, scope, client_id, asked_by) values ($1, 'buyer', $2, 'owner') returning id::text as id`,
      [A, C.erased.client])).rows[0].id as string;
    const plan = await planErasure(admin, { businessId: A, clientId: C.erased.client, requestId: req });
    expect(plan.refusals ?? []).toEqual([]);
    expect(plan.erased.get('shopify_order_lookups')).toBe(2);
    const done = (await admin.query("select carry_out_customer_request($1::uuid, $2::uuid, 'test', 'operator') as r", [A, req])).rows[0].r;
    expect(sameCounts(plan.erased, done.erased)).toEqual([]);
    expect(await n('select count(*) as n from shopify_order_lookups where conversation_id = $1', [C.erased.conv])).toBe(0);
    expect(await n('select count(*) as n from shopify_order_lookups where conversation_id = $1', [C.pair.conv])).toBeGreaterThan(0);
    expect((await connections(A))[0]).toMatchObject({ archived_at: null });   // the store is the business's, not the customer's
  });

  it('THE TOOL ERASES THEM: tools/erase-buyer.mjs plans the lookups under "erased", carries the request out, and the database agrees', async () => {
    const look = await lookupFor(A);
    await look.look({ conversationId: C.tool.conv, orderName: ORDER, email: ORDER_EMAIL });
    await look.look({ conversationId: C.tool.conv, orderName: '#NOMI-9998', email: ORDER_EMAIL });
    await look.look({ conversationId: C.tool.conv, orderName: '#NOMI-9997', email: ORDER_EMAIL });
    expect(await n('select count(*) as n from shopify_order_lookups where conversation_id = $1', [C.tool.conv])).toBe(3);
    const req = (await admin.query(`insert into deletion_requests (business_id, scope, client_id, asked_by) values ($1, 'buyer', $2, 'owner') returning id::text as id`,
      [A, C.tool.client])).rows[0].id as string;
    const tool = (...extra: string[]) => spawnSync(process.execPath, ['tools/erase-buyer.mjs', '--request', req, ...extra],
      { cwd: ROOT, env: { ...process.env, MIGRATE_DATABASE_URL: MIGRATE_URL }, encoding: 'utf8', timeout: 120_000 });
    const dry = tool();
    expect(dry.stderr).toBe('');
    expect(dry.status).toBe(0);
    expect(dry.stdout).toMatch(/shopify_order_lookups/);
    const done = tool('--yes', '--confirm', req.slice(0, 8), '--by', 'Operator Test');
    expect(done.stderr).toBe('');
    expect(done.status).toBe(0);
    expect(await n('select count(*) as n from shopify_order_lookups where conversation_id = $1', [C.tool.conv])).toBe(0);
    const ledger = (await admin.query('select counts from erasure_ledger where request_id = $1', [req])).rows[0].counts;
    expect(ledger.erased.shopify_order_lookups).toBe(3);
    expect(ledger.changed?.shopify_order_lookups).toBeUndefined();
    expect((await admin.query('select state from deletion_requests where id = $1', [req])).rows[0].state).toBe('done');
    expect(await n('select count(*) as n from shopify_order_lookups where conversation_id = $1', [C.pair.conv])).toBeGreaterThan(0);
  });

  it('STAFF DISCONNECTING: refused; the owner disconnects — the credential is gone and the switch is off', async () => {
    expect(flashSaid(await post(staff, `${SHOPIFY_ORDERS_PAGE}/disconnect`), SECRET)).toContain(OWNER_NOTICE);
    expect((await connections(A))[0]).toMatchObject({ archived_at: null, answer_orders: true });
    expect(flashSaid(await post(owner, `${SHOPIFY_ORDERS_PAGE}/disconnect`), SECRET)).toBe(t('en', 'shopifyOrders.flash.disconnected'));
    expect((await connections(A))[0]).toMatchObject({ credential_ciphertext: null, answer_orders: false });
    expect((await connections(A))[0]!['archived_at']).not.toBeNull();
    seen.length = 0;
    expect(await (await lookupFor(A)).look({ conversationId: C.pair.conv, orderName: ORDER, email: ORDER_EMAIL })).toEqual({ kind: 'off' });
    expect(seen).toHaveLength(0);
  });

  it('A WORKSPACE CLOSED: no Shopify row of it is left, and A\'s are untouched', async () => {
    await admin.query(`insert into shopify_connections (business_id, shop, way, credential_ciphertext, scopes, connected_by) values ($1, $2, 'token', $3, '{read_orders}', 'test')`,
      [B, `https://other-${RUN}.myshopify.com`, encryptSecret('{}', KEY)]);
    await admin.query(`insert into shopify_order_lookups (business_id, conversation_id, outcome) values ($1, $2, 'not_found')`, [B, C.theirs.conv]);
    const before = await n('select count(*) as n from shopify_order_lookups where business_id = $1', [A]);
    await asApp(B, (q) => q('select close_workspace($1, $2)', [B_NAME, B_OWNER]));
    expect(await n('select count(*) as n from shopify_connections where business_id = $1', [B])).toBe(0);
    expect(await n('select count(*) as n from shopify_order_lookups where business_id = $1', [B])).toBe(0);
    expect(await n('select count(*) as n from shopify_order_lookups where business_id = $1', [A])).toBe(before);
  });
});
