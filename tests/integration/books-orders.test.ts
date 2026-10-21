import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { asTenant, purgeBusinesses, type Q } from './books-db.js';

/**
 * D0 (0187; was C1's party-less entry) — a confirmed order goes into the books THROUGH AN INVOICE: drafted once for
 * the customer the owner chooses, on the day it was confirmed; issued, it debits the receivable WITH THAT CUSTOMER,
 * so what is owed is traced to who owes it. Never one waiting or cancelled; never twice, not even at once. The buyer's
 * name is never written into the books. The owner's: the orders name buyers.
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
  let k: Record<'receivable' | 'sales' | 'loss' | 'gain' | 've' | 'tva' | 'tax', string>;
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
        ve: await one(`insert into journals (business_id, code, name, kind) values (current_business_id(), 'VE', 'Ventes', 'sales') returning id::text as id`),
        tva: await acc('4455', 'liability'), tax: '' };
      out.tax = await one(`insert into tax_codes (business_id, code, label, rate, kind, account_id, valid_from) values (current_business_id(), 'TVA20', 'TVA 20 %', 20, 'collected', $1, '2026-01-01') returning id::text as id`, [out.tva]);
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

  it('with no customer in the books, nothing is offered: the customer comes first', async () => {
    const body = (await page()).body;
    expect(body).toContain('Add your customers to the books first.');
    expect(body).not.toContain('/draft"');
    expect(await notice(await post(`/app/books/orders/${orders.mad}/draft`))).toContain('Choose the customer.');
    expect(await notice(await post('/app/books/parties', { code: 'C001', name: 'ATX Maroc', country: 'MA', ice: '001234567000089', address: '12 rue Ibn Battouta, Casablanca' })))
      .toContain('The customer is added.');
    expect((await page()).body).toContain(`action="/app/books/orders/${orders.mad}/draft"`);
  });

  let customer = '';
  it('DRAFTED ONCE, AS AN INVOICE for the chosen customer, with the chosen tax; issued, the receivable names who owes it', async () => {
    customer = (await as((q) => q(`select id::text as id from parties where code = 'C001'`))).rows[0].id as string;
    const r = await post(`/app/books/orders/${orders.mad}/draft`, { party: customer, taxCode: k.tax });
    expect(await notice(r)).toContain('Drafted as an invoice. Check it, then issue it.');
    const id = String(r.headers['location']).split('/').pop()!;
    const inv = (await as((q) => q(`select i.issue_date::text as day, i.currency, i.source_order_id::text as o, l.label, l.net::text as net, l.tax::text as tax
      from invoices i join invoice_lines l on l.invoice_id = i.id where i.id = $1`, [id]))).rows;
    expect(inv).toEqual([{ day: '2026-04-02', currency: 'MAD', o: orders.mad, label: `ORD-1-${RUN}`, net: '1200.50', tax: '240.10' }]);
    expect((await page()).body).not.toContain(`ORD-1-${RUN}`);
    expect(await notice(await post(`/app/books/orders/${orders.mad}/draft`, { party: customer }))).toContain('That order is in the books already.');
    expect(await notice(await post(`/app/books/invoices/${id}/issue`))).toContain('Issued as F-2026-0001');
    const lines = await as((q) => q(`select a.code, p.code as party, l.debit::text, l.credit::text
      from invoices i join journal_lines l on l.entry_id = i.entry_id join accounts a on a.id = l.account_id left join parties p on p.id = l.party_id
     where i.id = $1 order by l.line_no`, [id]));
    expect(lines.rows).toEqual([
      { code: '3421', party: 'C001', debit: '1440.60', credit: '0.00' },
      { code: '7111', party: null, debit: '0.00', credit: '1200.50' },
      { code: '4455', party: null, debit: '0.00', credit: '240.10' }]);
    // the buyer's name is shown to the owner on the page, and written nowhere in the books
    const written = await as((q) => q(`select (select count(*) from journal_entries where label like '%Atlas Textiles%')::int
      + (select count(*) from invoices where label like '%Atlas Textiles%' or party_name like '%Atlas Textiles%')::int
      + (select count(*) from invoice_lines where label like '%Atlas Textiles%')::int as n`));
    expect(written.rows[0].n).toBe(0);
  });

  it('two drafts of one order at once: one invoice, never two', async () => {
    const both = await Promise.all([post(`/app/books/orders/${orders.usd}/draft`, { party: customer }), post(`/app/books/orders/${orders.usd}/draft`, { party: customer })]);
    expect(both.map((r) => r.statusCode)).toEqual([302, 302]);
    const n = (await as((q) => q(`select count(*)::int as n from invoices where source_order_id = $1 and state <> 'discarded'`, [orders.usd]))).rows[0].n;
    expect(n).toBe(1);
  });

  it('a foreign order is invoiced in its currency and posts at the owner\'s rate; discarded, the order comes back to the list', async () => {
    const id = (await as((q) => q(`select id::text as id from invoices where source_order_id = $1 and state = 'draft'`, [orders.usd]))).rows[0].id as string;
    expect(await notice(await post(`/app/books/invoices/${id}/issue`))).toContain('Issued as F-2026-0002');
    const books = await as((q) => q(`select l.book_debit::text as d, l.book_credit::text as c from invoices i join journal_lines l on l.entry_id = i.entry_id where i.id = $1 order by l.line_no`, [id]));
    expect(books.rows).toEqual([{ d: '4788.72', c: '0.00' }, { d: '0.00', c: '4788.72' }]);
    const drafted = await post(`/app/books/orders/${orders.later}/draft`, { party: customer });
    expect((await page()).body).not.toContain(`ORD-5-${RUN}`);
    await post(`/app/books/invoices/${String(drafted.headers['location']).split('/').pop()}/discard`);
    expect((await page()).body).toContain(`ORD-5-${RUN}`);
  });

  it('the accountant does not reach the orders (they name buyers): sent to the books', async () => {
    const r = await page(accountant);
    expect([r.statusCode, r.headers['location']]).toEqual([302, '/app/books']);
  });
});
