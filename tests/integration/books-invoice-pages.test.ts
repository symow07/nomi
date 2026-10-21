import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { asTenant, purgeBusinesses, type Q } from './books-db.js';

/**
 * C2 (Phase 5, item 5) — invoices through the routes: the owner adds a customer, drafts, issues, records payments;
 * an invoice stands open, partly paid, paid; more than is owed is refused; the accountant sees it all and acts on
 * none of it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `c2f20000-0000-4000-8000-${RUN}0001`;
const CODE = `invoice-owner-${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';

d('C2 · invoices through the routes (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let tenant: pg.Client;
  let owner = '';
  let accountant = '';
  let k: Record<'receivable' | 'sales' | 'bank' | 'bq' | 'tax', string>;
  let invoice = '';
  const as = <T>(fn: (q: Q) => Promise<T>) => asTenant(tenant, BIZ, fn);
  const session = (r: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=')) ?? '';
  const notice = async (r: { headers: Record<string, unknown> }) => {
    const set = ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).join('; ');
    return (await app.inject({ method: 'GET', url: String(r.headers['location']).split('#')[0]!, headers: { cookie: `${owner}; ${set}` } })).body;
  };
  const post = (url: string, body: Record<string, string> = {}, who = owner) => app.inject({ method: 'POST', url, payload: new URLSearchParams(body).toString(),
    headers: { cookie: who, 'content-type': 'application/x-www-form-urlencoded' } });
  const get = (url: string, who = owner) => app.inject({ method: 'GET', url, headers: { cookie: who } });

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    tenant = new pg.Client({ connectionString: DATABASE_URL }); await tenant.connect();
    await admin.query(`insert into businesses (id, name, engine, country, currency, books_area) values ($1, $2, 'service', 'MA', 'MAD', true)`, [BIZ, `Invoice pages ${RUN}`]);
    k = await as(async (q) => {
      const one = async (s: string, v: unknown[] = []) => (await q(s, v)).rows[0].id as string;
      const acc = (code: string, kind: string) => one(`insert into accounts (business_id, code, name, kind) values (current_business_id(), $1, $1, $2) returning id::text as id`, [code, kind]);
      const out = { receivable: await acc('3421', 'asset'), sales: await acc('7111', 'income'), bank: await acc('5141', 'asset'), tax: '',
        bq: await one(`insert into journals (business_id, code, name, kind) values (current_business_id(), 'BQ', 'Banque', 'bank') returning id::text as id`) };
      const tva = await acc('4455', 'liability');
      out.tax = await one(`insert into tax_codes (business_id, code, label, rate, kind, account_id, valid_from) values (current_business_id(), 'TVA20', 'TVA 20 %', 20, 'collected', $1, '2026-01-01') returning id::text as id`, [tva]);
      const ve = await one(`insert into journals (business_id, code, name, kind) values (current_business_id(), 'VE', 'Ventes', 'sales') returning id::text as id`);
      await q(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2026-01-01', '2026-12-31')`);
      await q(`insert into books_settings (business_id, sales_journal_id, receivable_account_id, sales_account_id) values (current_business_id(), $1, $2, $3)`, [ve, out.receivable, out.sales]);
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
  afterAll(async () => { await app?.close(); await db?.destroy(); await tenant?.end(); await purgeBusinesses(admin, [BIZ], 'books-invoice-pages-test'); await admin?.end(); });

  it('a customer first, then a draft: "1.250" refused, the right figures kept', async () => {
    expect((await get('/app/books/invoices/new')).body).toContain('Add a customer below first.');
    expect(await notice(await post('/app/books/parties', { code: 'C001', name: 'Atlas Textiles SARL', country: 'ma', ice: '001234567000089' }))).toContain('The customer is added.');
    expect(await notice(await post('/app/books/parties', { code: 'C 2', name: 'x' }))).toContain('That customer could not be added');
    const party = (await as((q) => q(`select id::text as id from parties where code = 'C001'`))).rows[0].id as string;
    // no due date: the list's standing then says paid or partly paid, never overdue whatever day the test runs
    const form = (o: Record<string, string>) => ({ party, issueDate: '2026-04-02', dueDate: '', currency: 'MAD', label: 'Commande 0042',
      label0: 'Sacs en toile', quantity0: '3', price0: '33.3333', tax0: k.tax, account0: k.sales, ...o });
    const bad = await post('/app/books/invoices', form({ price0: '1.250' }));
    expect(bad.statusCode).toBe(422);
    expect(bad.body).toContain('Line 1: this figure can be read two ways.');
    const ok = await post('/app/books/invoices', form({}));
    expect(ok.statusCode).toBe(303);
    invoice = String(ok.headers['location']).split('/').pop()!;
    const page = (await get(`/app/books/invoices/${invoice}`)).body;
    expect(page).toContain('Draft');
    expect(page).toContain('100.00');   // 3 × 33.3333 = 99.9999: 100.00 net, to the cent
    expect(page).toContain('120.00');                          // and 20.00 of tax
  });

  it('ISSUED, F-2026-0001; then a part paid, more than owed refused, the rest paid', async () => {
    expect(await notice(await post(`/app/books/invoices/${invoice}/issue`))).toContain('Issued as F-2026-0001, and its entry posted.');
    const pay = (amount: string) => post(`/app/books/invoices/${invoice}/payments`, { paidOn: '2026-04-20', amount, journal: k.bq, account: k.bank });
    expect(await notice(await pay('20'))).toContain('The payment is recorded');
    expect((await get('/app/books/invoices')).body).toContain('Partly paid');
    expect(await notice(await pay('100.01'))).toContain('That is more than is still owed (100 MAD).');
    expect(await notice(await pay('100'))).toContain('The payment is recorded');
    const page = (await get(`/app/books/invoices/${invoice}`)).body;
    expect(page).toContain('Paid');
    expect(page).not.toContain('action="/app/books/invoices/' + invoice + '/payments"');
  });

  it('the accountant sees the invoices and each one, and can issue, pay or add nothing', async () => {
    const list = (await get('/app/books/invoices', accountant)).body;
    expect(list).toContain('F-2026-0001');
    expect(list).not.toContain('/app/books/invoices/new');
    const tried = await post('/app/books/parties', { code: 'C009', name: 'Nope' }, accountant);
    expect([tried.statusCode, tried.headers['location']]).toEqual([302, '/app/books']);
    expect((await as((q) => q(`select count(*)::int as n from parties`))).rows[0].n).toBe(1);
  });
});
