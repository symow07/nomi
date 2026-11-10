import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runDigits } from './tenant.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';
import type { ShopifyAnswer, ShopifyRequest } from '../../src/net/shopifyAdmin.js';
import { SHOPIFY_API_VERSION } from '../../src/core/onboard/shopifyGraphql.js';
import { SHOPIFY_ORDER_QUERY, SHOPIFY_SCOPES_QUERY, dayIn } from '../../src/core/commerce/shopifyOrders.js';
import { SHOPIFY_ORDERS_PAGE } from '../../src/api/web/shopifyOrders.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';

/**
 * 5.5 — WHERE AN ORDER REPLY'S FIGURES CAME FROM, through the REAL composition (t1r's ruling A, 2026-11-10): a signed
 * Instagram message, the worker, the Shopify lookup (Shopify faked), the turn, the draft, then the record the worker
 * writes after the turn commits, and the owner's card.
 *
 *   · the record holds the draft's id, the order's name and the figures the reply writes that the order holds — not
 *     the expected day the reply does not state, the e-mail, the tracking number or any id;
 *   · the card says "from the order in Shopify (#…)" for them, and no figure is left without a source;
 *   · the record cannot be written: the turn stands (the draft waits as `order_facts`) and the card says "No source";
 *   · the erase tool on that customer takes the record with them;
 *   · Practice: no record is ever written on a copy, and Shopify is not asked.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd5b0000-0000-4000-8000-${RUN}0001`;
const APP_SECRET = `meta-app-secret-${RUN}`;
const IG_ACCOUNT = `1785${runDigits(RUN, 10)}`;
const PAGE_ID = `1021${runDigits(RUN, 10)}`;
const SHOP = `https://sourced-${RUN}.myshopify.com`;
const GRAPHQL = `${SHOP}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
const TOKEN = `shpat-test-${RUN}-7701`;
const ORDER = '#NOMI-7701';
const ORDER_EMAIL = `order7701.${RUN}@example.test`;
const TRACKING = `AP7701-CANARY-${RUN}`;
const GID = `gid://shopify/Order/77010${runDigits(RUN, 6)}`;
const DAY = 86_400_000;
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** The order's own days, near enough to now for read_orders alone; the expected day is never the day it was placed. */
const PLACED = new Date(Date.now() - DAY);
const EXPECTED = new Date(Date.now() + 5 * DAY);
const [placedYear, placedMonth, placedDay] = dayIn(PLACED, 'UTC').split('-').map(Number) as [number, number, number];
const expectedDay = Number(dayIn(EXPECTED, 'UTC').split('-')[2]);
const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(PLACED);
/** The reply states the order's number and the day it was placed — not the day it is expected. */
const REPLY = `Your order ${ORDER} was placed on ${placedDay} ${MONTH} ${placedYear} and is on its way.`;
const ASK = `Where is my order ${ORDER}? My email is ${ORDER_EMAIL}`;

const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 30_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

const orderRequests: string[] = [];
const transport = async (req: ShopifyRequest): Promise<ShopifyAnswer> => {
  const answer = (status: number, body: unknown): ShopifyAnswer => ({ status, location: null, version: SHOPIFY_API_VERSION, body: JSON.stringify(body) });
  if (req.url !== GRAPHQL || req.method !== 'POST' || req.headers['x-shopify-access-token'] !== TOKEN) return answer(404, {});
  const { query, variables } = JSON.parse(req.body ?? '{}') as { query: string; variables: Record<string, unknown> };
  if (query === SHOPIFY_SCOPES_QUERY) return answer(200, { data: { currentAppInstallation: { accessScopes: [{ handle: 'read_orders' }] } } });
  if (query !== SHOPIFY_ORDER_QUERY) return answer(400, {});
  orderRequests.push(String(variables['q']));
  const nodes = variables['q'] === `name:"${ORDER}"` ? [{
    id: GID, name: ORDER, createdAt: PLACED.toISOString(), cancelledAt: null,
    displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'FULFILLED', email: ORDER_EMAIL,
    fulfillments: [{ status: 'SUCCESS', displayStatus: 'IN_TRANSIT', deliveredAt: null, estimatedDeliveryAt: EXPECTED.toISOString(),
      trackingInfo: [{ company: 'Atlas Post', number: TRACKING, url: `https://track.example.test/${TRACKING}` }] }],
  }] : [];
  return answer(200, { data: { orders: { pageInfo: { hasNextPage: false }, nodes } },
    extensions: { cost: { requestedQueryCost: 20, actualQueryCost: 8, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 990, restoreRate: 50 } } } });
};

const metaFetch: import('../../src/channels/meta/messaging.js').MetaFetch = async () =>
  ({ status: 400, text: async () => JSON.stringify({ error: { message: 'not a real token' } }) });

d('5.5 · an order reply\'s figures, sourced on the owner\'s card (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let prod: import('../../src/main.js').Production;
  let admin: pg.Client;
  let cookie = '';
  const analyzer = new FakeAnalyzer();
  analyzer.next = {
    language: { detected: 'en', replyIn: 'en' },
    intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
    recommendedPhase: 'clarification', wantsPerson: false,
  };
  const replyWriter = new FakeReplyWriter();
  replyWriter.replies = [REPLY];

  const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
  const post = (url: string, fields: Record<string, string>) =>
    prod.app.inject({ method: 'POST', url, headers: { cookie, ...FORM }, payload: new URLSearchParams(fields).toString() });
  const page = (conv: string) => prod.app.inject({ method: 'GET', url: `/app/inbox/${conv}`, headers: { cookie } }).then((r) => r.body);
  const n = async (q: string, p: unknown[]) => Number((await admin.query(q, p)).rows[0].n);

  /** One Instagram message, signed the way Meta signs it; the conversation it lands in. */
  const send = async (who: string, text: string): Promise<string> => {
    const mid = `mid.${randomUUID()}`;
    const body = JSON.stringify({ object: 'instagram', entry: [{ id: IG_ACCOUNT, time: Date.now(), messaging: [{
      sender: { id: `IGSID_${who}_${RUN}` }, recipient: { id: IG_ACCOUNT }, timestamp: Date.now(), message: { mid, text },
    }] }] });
    const r = await prod.app.inject({ method: 'POST', url: '/webhook/instagram', payload: body,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${createHmac('sha256', APP_SECRET).update(body, 'utf8').digest('hex')}` } });
    expect(r.statusCode).toBe(200);
    return until(async () => (await admin.query(`select conversation_id::text as c from messages where external_id = $1`, [mid])).rows[0]?.c as string | undefined, 'the message');
  };
  const pendingDraft = (conv: string) => until(async () => (await admin.query(
    `select d.id::text as id, (select e.payload->'withheld'->>'reason' from conversation_events e
        where e.conversation_id = d.conversation_id and e.type = 'draft_pending' and e.payload->>'draftId' = d.id::text) as reason
       from drafts d where d.conversation_id = $1 and d.status = 'pending'`, [conv])).rows[0] as { id: string; reason: string | null } | undefined, 'the draft');
  const records = (conv: string) => admin.query(`select payload from conversation_events where conversation_id = $1 and type = 'order_sourced'`, [conv])
    .then((r) => r.rows.map((x) => x.payload as Record<string, unknown>));

  beforeAll(async () => {
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    process.env['OWNER_ACCESS_CODE'] = `sourced-${RUN}`;
    process.env['META_PAGE_ACCESS_TOKEN'] = 'page-token-not-real';
    process.env['META_PAGE_ID'] = PAGE_ID;
    process.env['META_IG_ACCOUNT_ID'] = IG_ACCOUNT;
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    await admin.query(`insert into businesses (id, name, kind, timezone) values ($1, $2, 'online_shop', 'UTC') on conflict (id) do nothing`, [BIZ, `Sourced Shop ${RUN}`]);
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!,
      ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok',
      META_WHATSAPP_PHONE_NUMBER_ID: `SIM_PNID_os${RUN}`,
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765',
      META_APP_SECRET: APP_SECRET,
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'os-verify-token',
      CREDENTIAL_KEY: 'c'.repeat(64), PORT: 0, PUBLIC_BASE_URL: 'https://nomi.test',
    }, { models: { analyzer, replyWriter }, adapter: whatsappSimulator([], { tag: `os${RUN}` }).adapter, logger: false, metaFetch, shopifyTransport: transport });
    const login = await prod.app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(prod.ownerAccessCode)}`, headers: FORM });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect((await post('/app/channels/instagram/connect', {})).statusCode).toBe(302);
    expect((await post(`${SHOPIFY_ORDERS_PAGE}/connect`, { address: SHOP, token: TOKEN })).statusCode).toBe(302);
    expect((await post(`${SHOPIFY_ORDERS_PAGE}/switch`, { on: '1' })).statusCode).toBe(302);
    expect((await admin.query(`select answer_orders from shopify_connections where business_id = $1 and archived_at is null`, [BIZ])).rows[0].answer_orders).toBe(true);
  }, 90_000);
  afterAll(async () => {
    await admin?.query('drop trigger if exists order_sourced_probe on conversation_events').catch(() => {});
    await admin?.query('drop function if exists order_sourced_probe()').catch(() => {});
    await admin?.query('drop sequence if exists order_sourced_probe_tries').catch(() => {});
    delete process.env['META_PAGE_ACCESS_TOKEN'];
    delete process.env['META_PAGE_ID'];
    delete process.env['META_IG_ACCOUNT_ID'];
    await prod?.close(); await admin?.end();
  });

  let first = '';
  it('A VERIFIED ORDER: the draft waits as order_facts, and its record holds only the figures the reply writes', async () => {
    first = await send('ana', ASK);
    const draft = await pendingDraft(first);
    expect(draft.reason).toBe('order_facts');
    const [record] = await until(async () => { const r = await records(first); return r.length ? r : undefined; }, 'the record');
    expect(record).toEqual({ draftId: draft.id, order: ORDER, figures: [7701, placedDay, placedYear] });
    expect(await records(first)).toHaveLength(1);
    // Never the expected day, the month as a number, the e-mail, the tracking number, a link or an id.
    const text = JSON.stringify(record);
    expect(record!['figures']).not.toContain(expectedDay);
    if (placedMonth !== placedDay) expect(record!['figures']).not.toContain(placedMonth);
    for (const canary of [ORDER_EMAIL, ORDER_EMAIL.split('@')[0]!, TRACKING, GID, 'gid://', 'https://', dayIn(EXPECTED, 'UTC')]) expect(text).not.toContain(canary);
  });

  it('THE CARD names the order for those figures, and none is left without a source', async () => {
    const html = await page(first);
    expect(html).toContain(esc(t('en', 'card.source.order', { order: ORDER })));
    expect(html).not.toContain(esc(t('en', 'card.source.unsourced')));
  });

  it('THE CARD after the owner\'s KEPT EDIT (the real path: Stop, the edit refused and kept): the reading attributes nothing of it to the order, and the box shows the owner\'s words', async () => {
    // The edit names the expected day: a figure Shopify's order holds, but the owner wrote it, not the assistant.
    const edit = `Your order ${ORDER} should reach you on ${expectedDay} ${MONTH}.`;
    const draft = await pendingDraft(first);
    const before = await records(first);
    expect((await post('/app/business/stop-assistant', {})).statusCode).toBe(302);
    try {
      expect((await post(`/app/inbox/${first}/act`, { draftId: draft.id, command: '改', edit })).statusCode).toBe(302);
      // Refused while stopped, and kept: the draft's own words are untouched; nothing went out.
      const row = (await admin.query(`select status, draft_text, owner_edit, sent_text from drafts where id = $1`, [draft.id])).rows[0];
      expect(row).toEqual({ status: 'pending', draft_text: REPLY, owner_edit: edit, sent_text: null });
      expect(await n(`select count(*) as n from outbound_messages where conversation_id = $1`, [first])).toBe(0);
      const html = await page(first);
      // The box holds the owner's words.
      expect(html).toMatch(new RegExp(`<textarea id="reply"[^>]*>${esc(edit).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</textarea>`));
      // The reading explains the assistant's draft only: its figures from the order, none of the edit's.
      const reasons = html.slice(html.indexOf('<ul class="reasons">'), html.indexOf('</ul>', html.indexOf('<ul class="reasons">')));
      expect(reasons).toContain(esc(t('en', 'card.source.order', { order: ORDER })));
      expect(reasons).toContain(`<bdi>${placedDay}</bdi>`);
      expect(reasons).not.toContain(`<bdi>${expectedDay}</bdi>`);
      expect(html).not.toContain(esc(t('en', 'card.source.unsourced')));
      // The record is the one the worker wrote: the edit added nothing to it.
      expect(await records(first)).toEqual(before);
      expect(before[0]!['figures']).not.toContain(expectedDay);
    } finally {
      expect((await post('/app/business/start-assistant', {})).statusCode).toBe(302);
    }
  });

  it('THE RECORD CANNOT BE WRITTEN: the turn stands — its draft waits as order_facts — and the card says "No source"', async () => {
    // A refusal at the database, counted on a sequence (a sequence is not rolled back), so the test knows it was tried.
    await admin.query('create sequence order_sourced_probe_tries');
    await admin.query(`create function order_sourced_probe() returns trigger language plpgsql as $$
      begin perform nextval('order_sourced_probe_tries'); raise exception 'order_sourced refused for the test'; end $$`);
    await admin.query(`create trigger order_sourced_probe before insert on conversation_events for each row
      when (new.type = 'order_sourced') execute function order_sourced_probe()`);
    try {
      const conv = await send('bo', ASK);
      const draft = await pendingDraft(conv);
      expect(draft.reason).toBe('order_facts');
      await until(async () => ((await admin.query('select is_called from order_sourced_probe_tries')).rows[0].is_called ? true : undefined), 'the attempt');
      expect(await records(conv)).toEqual([]);
      expect(await n(`select count(*) as n from messages where conversation_id = $1 and direction = 'inbound'`, [conv])).toBe(1);
      const html = await page(conv);
      expect(html).not.toContain(esc(t('en', 'card.source.order', { order: ORDER })));
      expect(html).toContain(esc(t('en', 'card.source.unsourced')));
    } finally {
      await admin.query('drop trigger order_sourced_probe on conversation_events');
      await admin.query('drop function order_sourced_probe()');
      await admin.query('drop sequence order_sourced_probe_tries');
    }
  });

  it('PRACTICE: an order question on the copy asks Shopify nothing and leaves no record', async () => {
    const before = orderRequests.length;
    const said = await post('/app/sandbox/message', { text: ASK });
    expect(said.statusCode).toBeLessThan(400);
    const copy = await until(async () => (await admin.query(`select id::text as id from businesses where practice_of = $1`, [BIZ])).rows[0]?.id as string | undefined, 'the copy');
    await until(async () => ((await n(`select count(*) as n from turns where business_id = $1`, [copy])) > 0 ? true : undefined), 'the practice turn');
    expect(orderRequests.length).toBe(before);
    expect(await n(`select count(*) as n from conversation_events e join businesses b on b.id = e.business_id
      where e.type = 'order_sourced' and b.practice_of is not null`, [])).toBe(0);
  });

  it('THE ERASE TOOL takes the record with the customer: planned, carried out, and the database agrees', async () => {
    const client = (await admin.query('select client_id::text as c from conversations where id = $1', [first])).rows[0].c as string;
    expect(await records(first)).toHaveLength(1);
    const req = (await admin.query(`insert into deletion_requests (business_id, scope, client_id, asked_by) values ($1, 'buyer', $2, 'owner') returning id::text as id`,
      [BIZ, client])).rows[0].id as string;
    const tool = (...extra: string[]) => spawnSync(process.execPath, ['tools/erase-buyer.mjs', '--request', req, ...extra],
      { cwd: ROOT, env: { ...process.env, MIGRATE_DATABASE_URL: MIGRATE_URL }, encoding: 'utf8', timeout: 120_000 });
    const dry = tool();
    expect(dry.stderr).toBe('');
    expect(dry.status).toBe(0);
    expect(dry.stdout).toMatch(/conversation_events/);
    expect(await records(first)).toHaveLength(1);
    const done = tool('--yes', '--confirm', req.slice(0, 8), '--by', 'Operator Test');
    expect(done.stderr).toBe('');
    expect(done.status).toBe(0);
    expect(await n(`select count(*) as n from conversation_events where type = 'order_sourced' and payload->>'order' = $1 and business_id = $2`, [ORDER, BIZ])).toBe(0);
    expect(await n('select count(*) as n from conversations where id = $1', [first])).toBe(0);
    expect((await admin.query('select state from deletion_requests where id = $1', [req])).rows[0].state).toBe('done');
  });
});
