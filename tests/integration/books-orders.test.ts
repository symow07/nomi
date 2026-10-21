import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { asTenant, purgeBusinesses, type Q } from './books-db.js';

/**
 * C1 (Phase 5, item 3; 0183) — entries from Nomi's orders (PHASE-5.md §4: "entries from orders … balance"): a
 * confirmed order is drafted once, a debit on the receivable account and a credit on sales, on the day it was
 * confirmed; never one waiting or cancelled; never twice, not even at once. The owner's: the orders name buyers.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `c10a0000-0000-4000-8000-${RUN}0001`;
const CODE = `orders-owner-${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';

d('C1 · entries from Nomi\'s orders (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let tenant: pg.Client;
  let owner = '';
  let accountant = '';
  let k: Record<'receivable' | 'sales' | 'loss' | 'gain' | 've', string>;
  const orders: Record<'mad' | 'usd' | 'waiting' | 'cancelled' | 'later', string> = { mad: '', usd: '', waiting: '', cancelled: '', later: '' };
  const as = <T>(fn: (q: Q) => Promise<T>) => asTenant(tenant, BIZ, fn);
  const session = (r: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=')) ?? '';
  const notice = async (r: { headers: Record<string, unknown> }) => {
    const set = ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).join('; ');
    return (await app.inject({ method: 'GET', url: String(r.headers['location']).split('#')[0]!, headers: { cookie: `${owner}; ${set}` } })).body;
  };
  const post = (url: string, body: Record<string, string> = {}, who = owner) => app.inject({ method: 'POST', url, payload: new URLSearchParams(body).toString(),
    headers: { cookie: who, 'content-type': 'application/x-www-form-urlencoded' } });
  const page = async (who = owner) => (await app.inject({ method: 'GET', url: '/app/books/orders', headers: { cookie: who } }));

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    tenant = new pg.Client({ connectionString: DATABASE_URL }); await tenant.connect();
    await admin.query(`insert into businesses (id, name, engine, country, currency, books_area) values ($1, $2, 'service', 'MA', 'MAD', true)`, [BIZ, `Orders ${RUN}`]);
    const client = (await admin.query(`insert into clients (business_id, display_name) values ($1, 'Atlas Textiles SARL') returning id::text as id`, [BIZ])).rows[0].id;
    // one open order per conversation (the schema's own rule): each order its own
    const conversation = async () => (await admin.query(`insert into conversations (business_id, client_id, channel) values ($1, $2, 'whatsapp') returning id::text as id`, [BIZ, client])).rows[0].id as string;
    const product = (await admin.query(`insert into products (business_id, sku, name) values ($1, $2, 'Tote') returning id::text as id`, [BIZ, `OR-${RUN}`])).rows[0].id;
    const order = async (ref: string, total: string, currency: string, status: string) => (await admin.query(
      `insert into orders (order_reference, business_id, client_id, conversation_id, product_id, quantity, unit, total_value_usd, currency, status, confirmed_at)
       values ($1, $2, $3, $4, $5, 100, 'pcs', $6, $7, $8, case when $8 in ('confirmed', 'shipped') then '2026-04-02T10:00:00Z'::timestamptz end) returning id::text as id`,
      [`${ref}-${RUN}`, BIZ, client, await conversation(), product, total, currency, status])).rows[0].id as string;
    orders.mad = await order('ORD-1', '1200.50', 'MAD', 'confirmed');
    orders.usd = await order('ORD-2', '480.00', 'USD', 'shipped');
    orders.waiting = await order('ORD-3', '99', 'MAD', 'pending_confirmation');
    orders.cancelled = await order('ORD-4', '77', 'MAD', 'cancelled');
    orders.later = await order('ORD-5', '55', 'MAD', 'confirmed');
    k = await as(async (q) => {
      const one = async (s: string, v: unknown[] = []) => (await q(s, v)).rows[0].id as string;
      const acc = (code: string, kind: string) => one(`insert into accounts (business_id, code, name, kind) values (current_business_id(), $1, $1, $2) returning id::text as id`, [code, kind]);
      const out = { receivable: await acc('3421', 'asset'), sales: await acc('7111', 'income'), loss: await acc('6331', 'expense'), gain: await acc('7331', 'income'),
        ve: await one(`insert into journals (business_id, code, name, kind) values (current_business_id(), 'VE', 'Ventes', 'sales') returning id::text as id`) };
      await q(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2026-01-01', '2026-12-31')`);
      await q(`insert into owner_rates (business_id, from_currency, to_currency, rate, stated_at) values (current_business_id(), 'USD', 'MAD', 9.9765, '2026-04-01T09:00:00Z')`);
      return out;
    });
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { addPerson } = await import('../../src/api/web/people.js');
    db = createDb(DATABASE_URL!);
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET, factsTtlMs: 0,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const login = (code: string) => app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    owner = session(await login(CODE));
    const acct = await addPerson(db, BIZ, SECRET, `Accountant ${RUN}`, 'accountant');
    if (acct.code !== 'added') throw new Error('fixture');
    accountant = session(await login(acct.accessCode));
  });
  afterAll(async () => {
    await app?.close(); await db?.destroy(); await tenant?.end();
    await admin.query('delete from orders where business_id = $1', [BIZ]);   // orders do not cascade from their business
    await purgeBusinesses(admin, [BIZ], 'books-orders-test'); await admin?.end();
  });

  it('the accounts come first: until they are chosen, nothing is drafted', async () => {
    const body = (await page()).body;
    expect(body).toContain('Choose the accounts first');
    expect(body).not.toContain('/draft"');
    expect(await notice(await post(`/app/books/orders/${orders.mad}/draft`))).toContain('Choose the accounts first');
  });

  it('chosen on the books\' home, the confirmed and shipped orders are listed — never one waiting or cancelled', async () => {
    expect((await app.inject({ method: 'GET', url: '/app/books', headers: { cookie: owner } })).body).toContain('action="/app/books/settings/accounts"');
    expect(await notice(await post('/app/books/settings/accounts', { salesJournal: k.ve, receivable: k.receivable, sales: k.sales, fxLoss: k.loss, fxGain: k.gain })))
      .toContain('The accounts are saved.');
    const body = (await page()).body;
    expect(body).toContain(`ORD-1-${RUN}`);
    expect(body).toContain(`ORD-2-${RUN}`);
    expect(body).not.toContain(`ORD-3-${RUN}`);
    expect(body).not.toContain(`ORD-4-${RUN}`);
  });

  it('DRAFTED ONCE: receivable debit, sales credit, its day and its reference; it posts; asked again, already in', async () => {
    const r = await post(`/app/books/orders/${orders.mad}/draft`);
    expect(await notice(r)).toContain('Drafted from the order.');
    const lines = await as((q) => q(`select e.entry_date::text as day, e.document_ref, a.code, l.currency, l.debit::text, l.credit::text
      from journal_entries e join journal_lines l on l.entry_id = e.id join accounts a on a.id = l.account_id where e.source_order_id = $1 order by l.line_no`, [orders.mad]));
    expect(lines.rows).toEqual([
      { day: '2026-04-02', document_ref: `ORD-1-${RUN}`, code: '3421', currency: 'MAD', debit: '1200.50', credit: '0.00' },
      { day: '2026-04-02', document_ref: `ORD-1-${RUN}`, code: '7111', currency: 'MAD', debit: '0.00', credit: '1200.50' }]);
    expect((await page()).body).not.toContain(`ORD-1-${RUN}`);
    expect(await notice(await post(`/app/books/orders/${orders.mad}/draft`))).toContain('That order is in the books already.');
    const id = String(r.headers['location']).split('/').pop()!;
    expect(await notice(await post(`/app/books/entries/${id}/post`))).toContain('Posted as VE-2026-1.');
  });

  it('two drafts of one order at once: one entry, never two', async () => {
    const both = await Promise.all([post(`/app/books/orders/${orders.usd}/draft`), post(`/app/books/orders/${orders.usd}/draft`)]);
    expect(both.map((r) => r.statusCode)).toEqual([302, 302]);
    const n = (await as((q) => q(`select count(*)::int as n from journal_entries where source_order_id = $1 and state <> 'discarded'`, [orders.usd]))).rows[0].n;
    expect(n).toBe(1);
  });

  it('a foreign order posts at the owner\'s rate; discarded, the order comes back to the list', async () => {
    const id = (await as((q) => q(`select id::text as id from journal_entries where source_order_id = $1 and state = 'draft'`, [orders.usd]))).rows[0].id as string;
    expect(await notice(await post(`/app/books/entries/${id}/post`))).toContain('Posted as VE-2026-2.');
    const books = await as((q) => q(`select book_debit::text as d, book_credit::text as c from journal_lines where entry_id = $1 order by line_no`, [id]));
    expect(books.rows).toEqual([{ d: '4788.72', c: '0.00' }, { d: '0.00', c: '4788.72' }]);
    // a draft from an order, discarded: the order is not in the books, and is offered again
    const drafted = await post(`/app/books/orders/${orders.later}/draft`);
    expect((await page()).body).not.toContain(`ORD-5-${RUN}`);
    await post(`/app/books/entries/${String(drafted.headers['location']).split('/').pop()}/discard`);
    expect((await page()).body).toContain(`ORD-5-${RUN}`);
  });

  it('the accountant does not reach the orders (they name buyers): sent to the books', async () => {
    const r = await page(accountant);
    expect([r.statusCode, r.headers['location']]).toEqual([302, '/app/books']);
  });
});
