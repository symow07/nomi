import { t } from '../../src/core/owner/i18n/messages.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { asTenant, purgeBusinesses, type Q } from './books-db.js';

/**
 * The Books audit's first finding (2026-11-05), on the real Moroccan chart and through the routes: the payment form
 * offered all 294 asset accounts with the first selected, so pressing Record as drawn put the money in "21 ·
 * IMMOBILISATION EN NON-VALEURS" and marked the invoice Paid. A posted entry can only be reversed. Now only bank and
 * cash accounts are offered, none is selected, and the route refuses anything else whatever the browser sent.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `c2f30000-0000-4000-8000-${RUN}0001`;
const CODE = `payment-owner-${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';

d('BPAY · where a payment lands (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let tenant: pg.Client;
  let owner = '';
  let invoice = '';
  const as = <T>(fn: (q: Q) => Promise<T>) => asTenant(tenant, BIZ, fn);
  const post = (url: string, body: Record<string, string> = {}) => app.inject({ method: 'POST', url, payload: new URLSearchParams(body).toString(),
    headers: { cookie: owner, 'content-type': 'application/x-www-form-urlencoded' } });
  const get = (url: string) => app.inject({ method: 'GET', url, headers: { cookie: owner } });
  const notice = async (r: { headers: Record<string, unknown> }) => {
    const set = ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).join('; ');
    return (await app.inject({ method: 'GET', url: String(r.headers['location']).split('#')[0]!, headers: { cookie: `${owner}; ${set}` } })).body;
  };
  const idOf = async (table: 'accounts' | 'journals', code: string) =>
    (await as((q) => q(`select id::text as id from ${table} where code = $1`, [code]))).rows[0].id as string;
  const payments = async () => (await as((q) => q(`select a.code from invoice_payments p join accounts a on a.id = p.account_id where p.invoice_id = $1`, [invoice]))).rows.map((r) => r.code as string);
  const offered = (html: string) => [...(/<select name="account" required>(.*?)<\/select>/s.exec(html)?.[1] ?? '').matchAll(/<option value="([^"]*)"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2]]);

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    tenant = new pg.Client({ connectionString: DATABASE_URL }); await tenant.connect();
    await admin.query(`insert into businesses (id, name, engine, country, currency, books_area) values ($1, $2, 'service', 'MA', 'MAD', true)`, [BIZ, `Payment accounts ${RUN}`]);
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET, factsTtlMs: 0,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const login = await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(CODE)}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    owner = ([] as string[]).concat((login.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=')) ?? '';

    // As an owner does it: the chart from its button, a year, a customer, an invoice, issued.
    expect((await post('/app/books/chart/cgnc')).statusCode).toBe(302);
    await as((q) => q(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2026-01-01', '2026-12-31')`));
    await post('/app/books/parties', { code: 'C001', name: 'Atlas Cosmetics', country: 'ma' });
    const party = (await as((q) => q(`select id::text as id from parties where code = 'C001'`))).rows[0].id as string;
    const made = await post('/app/books/invoices', { party, issueDate: '2026-10-10', dueDate: '', currency: 'MAD', label: 'Order',
      label0: 'Serum', quantity0: '1', price0: '50', tax0: '', account0: await idOf('accounts', '7111') });
    expect(made.statusCode).toBe(303);
    invoice = String(made.headers['location']).split('/').pop()!;
    expect(await notice(await post(`/app/books/invoices/${invoice}/issue`))).toContain('Issued as');
  });
  afterAll(async () => { await app?.close(); await db?.destroy(); await tenant?.end(); await purgeBusinesses(admin, [BIZ], 'books-payment-accounts-test'); await admin?.end(); });

  it('the form offers the chart\'s bank and cash accounts only, none selected', async () => {
    const html = (await get(`/app/books/invoices/${invoice}`)).body;
    const rows = offered(html);
    expect(rows[0]![0]).toBe('');
    expect(rows.slice(1).map((r) => r[1]!.split(' ')[0])).toEqual(['5141', '5143', '5146', '5148', '51611', '51613', '51614', '5165']);
    const select = /<select name="account" required>(.*?)<\/select>/s.exec(html)![1]!;
    expect((select.match(/ selected/g) ?? []).length).toBe(1);
    expect(select).toMatch(/<option value="" selected>/);
  });

  it('an account named as a bank counts in a chart of any numbering; a house account does not', async () => {
    await as((q) => q(`insert into accounts (business_id, code, name, kind) values (current_business_id(), '1000', 'Barclays Bank', 'asset'), (current_business_id(), '1010', 'Stock', 'asset')`));
    const names = offered((await get(`/app/books/invoices/${invoice}`)).body).map((r) => r[1]);
    expect(names).toContain('1000 · Barclays Bank');
    expect(names).not.toContain('1010 · Stock');
  });

  it('pressing Record with nothing chosen records nothing, and says what to do', async () => {
    const r = await post(`/app/books/invoices/${invoice}/payments`, { paidOn: '2026-10-15', amount: '50', paidIn: 'MAD', arrived: '', journal: await idOf('journals', 'BQ'), account: '' });
    expect(await notice(r)).toContain('Choose a bank or cash account.');
    expect(await payments()).toEqual([]);
  });

  it('a fixed asset sent by hand is refused by the route; nothing is posted and the invoice stays open', async () => {
    const r = await post(`/app/books/invoices/${invoice}/payments`, { paidOn: '2026-10-15', amount: '50', paidIn: 'MAD', arrived: '', journal: await idOf('journals', 'BQ'), account: await idOf('accounts', '21') });
    expect(await notice(r)).toContain('Choose a bank or cash account.');
    expect(await payments()).toEqual([]);
    expect((await get(`/app/books/invoices/${invoice}`)).body).toContain('id="pay"');
  });

  it('Block 1 #2 · the Bank page offers the same accounts, opens on none, and reads a statement only against one chosen', async () => {
    const bank = await get('/app/books/bank');
    expect(bank.statusCode).toBe(200);
    const options = [...(/<select name="account" required>(.*?)<\/select>/s.exec(bank.body)?.[1] ?? '').matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)</g)].map((m) => [m[1], m[3]!.split(' ')[0], /selected/.test(m[2]!)]);
    expect(options[0]).toEqual(['', t('en', 'books.invoice.bankChoose'), true]);
    expect(options.slice(1).map((o) => o[1])).toEqual(['5141', '5143', '5146', '5148', '51611', '51613', '51614', '5165']);
    expect(options.slice(1).some((o) => o[2])).toBe(false);
    expect(bank.body).not.toContain('id="bank-open"');            // nothing is read until an account is chosen
    expect(bank.body).not.toContain('2340');                      // never a fixed asset among the choices
    const chosen = await get(`/app/books/bank?account=${await idOf('accounts', '5141')}`);
    expect(chosen.statusCode).toBe(200);
    expect(chosen.body).toContain('id="bank-open"');
    const fixed = await get(`/app/books/bank?account=${await idOf('accounts', '2340')}`);
    expect(fixed.statusCode).toBe(404);                           // a fixed asset is not an address here
  });

  it('a bank account takes the payment, and the money is on that account', async () => {
    const r = await post(`/app/books/invoices/${invoice}/payments`, { paidOn: '2026-10-15', amount: '50', paidIn: 'MAD', arrived: '', journal: await idOf('journals', 'BQ'), account: await idOf('accounts', '5141') });
    expect(await notice(r)).toContain('The payment is recorded');
    expect(await payments()).toEqual(['5141']);
    expect((await get(`/app/books/invoices/${invoice}`)).body).not.toContain('id="pay"');
  });
});
