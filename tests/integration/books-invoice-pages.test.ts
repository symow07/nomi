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
    expect(await notice(await post(`/app/books/invoices/${invoice}/issue`))).toContain('Issued as F-2026-0001 and saved to the books.');
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

  it('R3 (0210) · a French customer\'s SIREN, SIRET and VAT, checked; the issued invoice keeps its copy whatever the party becomes', async () => {
    // a doubtful SIREN (its check sum fails, which INSEE does not publish) is asked again, never refused
    const doubt = await notice(await post('/app/books/parties', { code: 'C101', name: 'Société Douteuse', country: 'FR', registry: '123456789' }));
    expect(doubt).toContain('That customer was not added yet: this SIREN looks like a typo');
    expect((await as((q) => q(`select count(*)::int as n from parties where code = 'C101'`))).rows[0].n).toBe(0);
    expect(await notice(await post('/app/books/parties', { code: 'C101', name: 'Société Douteuse', country: 'FR', registry: '123456789', registryConfirmed: '1' })))
      .toContain('The customer is added.');
    // a shape that is wrong, and a VAT number that is not the SIREN's, are refused
    expect(await notice(await post('/app/books/parties', { code: 'C102', name: 'X', country: 'FR', registry: '12345' }))).toContain("not in its country's form");
    expect(await notice(await post('/app/books/parties', { code: 'C102', name: 'X', country: 'FR', registry: '732829320', taxNumber: 'FR44552100554' })))
      .toContain('a French VAT number ends with the company');
    // the real one: SIREN, SIRET and VAT together
    expect(await notice(await post('/app/books/parties', { code: 'C100', name: 'Toiles de Lyon SAS', country: 'FR', registry: '732 829 320',
      siret: '73282932000074', taxNumber: 'FR44732829320' }))).toContain('The customer is added.');
    const party = (await as((q) => q(`select id::text as id, registry_number, siret from parties where code = 'C100'`))).rows[0];
    expect(party).toMatchObject({ registry_number: '732829320', siret: '73282932000074' });
    const made = await post('/app/books/invoices', { party: party.id, issueDate: '2026-05-04', dueDate: '', currency: 'MAD', label: 'Commande Lyon',
      label0: 'Sacs en toile', quantity0: '2', price0: '50', tax0: k.tax, account0: k.sales });
    const inv = String(made.headers['location']).split('/').pop()!;
    expect(await notice(await post(`/app/books/invoices/${inv}/issue`))).toContain('Issued as F-2026-0002');
    const issued = (await get(`/app/books/invoices/${inv}`)).body;
    expect(issued).toContain('<dt>SIREN</dt><dd><bdi>732829320</bdi></dd>');
    expect(issued).toContain('<bdi>73282932000074</bdi>');
    // the party changes later: the issued invoice does not
    await admin.query(`update parties set registry_number = '552100554', siret = null, tax_number = null where id = $1`, [party.id]);
    const after = (await get(`/app/books/invoices/${inv}`)).body;
    expect(after).toContain('<dd><bdi>732829320</bdi></dd>');
    expect(after).not.toContain('552100554');
    // and the database holds the rules itself
    await expect(admin.query(`update parties set registry_number = 'ABC' where id = $1`, [party.id])).rejects.toThrow(/parties_registry_shape/);
    await expect(admin.query(`update parties set siret = '55210055400099', tax_number = 'FR11999999999' where id = $1`, [party.id])).rejects.toThrow(/parties_siret_shape|parties_vat_matches_registry/);
  });

  /**
   * F18 (the UI correction, 2026-11-13) — THE TOTAL WHILE THE FORM IS FILLED. The preview route answers what Save would
   * store, from the books' own per-line figures (`invoiceLineFigures`, the one function `writeInvoiceLines` uses), and
   * writes nothing. Held here: the preview of a form EQUALS what the database holds after that same form is saved
   * (tax, several lines, figures that round), and the form is the owner's: the accountant and a stranger get nothing.
   */
  it('F18 · the total preview equals what Save stores for the same lines, writes nothing, and is the owner\'s alone', async () => {
    const { renderInvoiceTotal } = await import('../../src/api/web/booksInvoices.js');
    const party = (await as((q) => q(`select id::text as id from parties where code = 'C001'`))).rows[0].id as string;
    const counts = async () => (await as((q) => q(`select (select count(*) from invoices)::int as i, (select count(*) from invoice_lines)::int as l,
      (select count(*) from journal_entries)::int as e`))).rows[0];
    const cases: Record<string, string>[] = [
      // one line, taxed
      { label0: 'Sacs en toile', quantity0: '100', price0: '45', account0: k.sales, tax0: k.tax },
      // several lines: a taxed one whose tax rounds (3 × 33.33 at 20 %), an untaxed one, a fractional quantity with a typed thousands mark
      { label0: 'Trousse', quantity0: '3', price0: '33.33', account0: k.sales, tax0: k.tax,
        label1: 'Livraison', quantity1: '7', price1: '0.19', account1: k.sales, tax1: '',
        label2: 'Sur mesure', quantity2: '1.5', price2: '1,250.55', account2: k.sales, tax2: k.tax },
      // a line left empty between two filled ones is left out by both
      { label0: 'A', quantity0: '2', price0: '9.99', account0: k.sales, tax0: k.tax, label2: 'C', quantity2: '1', price2: '0.01', account2: k.sales, tax2: k.tax },
    ];
    for (const lines of cases) {
      const form = { party, issueDate: '2026-06-02', dueDate: '', currency: 'MAD', label: '', ...lines };
      const before = await counts();
      const shown = await post('/app/books/invoices/preview', form);
      expect(shown.statusCode).toBe(200);
      expect(shown.headers['cache-control']).toBe('no-store');
      expect(await counts(), 'the preview writes nothing').toEqual(before);
      // …then the same form, saved: the figures the database holds for it
      const saved = await post('/app/books/invoices', form);
      expect(saved.statusCode).toBe(303);
      const id = String(saved.headers['location']).split('/').pop()!.split(/[?#]/)[0]!;
      const stored = (await as((q) => q(`select coalesce(sum(net), 0)::text as net, coalesce(sum(tax), 0)::text as tax, invoice_total($1)::text as total, count(*)::int as n
        from invoice_lines where invoice_id = $1`, [id]))).rows[0];
      expect(stored.n).toBe(Object.keys(lines).filter((x) => x.startsWith('label')).length);
      const dec = (x: string) => x as import('../../src/core/types/decimal.js').Decimal;
      expect(shown.body).toBe(`<div data-total-body>${renderInvoiceTotal('en', { net: dec(stored.net), tax: dec(stored.tax), total: dec(stored.total), currency: 'MAD' })}</div>`);
      expect(shown.body).toContain('MAD');
      // and the saved draft's edit form shows those same figures beside Save
      expect((await get(`/app/books/invoices/${id}/edit`)).body).toContain(renderInvoiceTotal('en', { net: dec(stored.net), tax: dec(stored.tax), total: dec(stored.total), currency: 'MAD' }, 'booksDocs.totalSaved'));
    }
    // the rounding case, in figures: 99.99 + 1.33 + 1,875.83 before tax; 20.00 + 375.17 of tax
    const again = await post('/app/books/invoices/preview', { party, issueDate: '2026-06-02', currency: 'MAD', ...cases[1]! });
    expect(again.body).toMatch(/1,977\.15[\s\S]*395\.17[\s\S]*2,372\.32/);

    // NOT YET, said plainly, never a figure: nothing typed; a quantity that is not one; a line with no label
    for (const partial of [{}, { label0: 'Sacs', quantity0: 'abc', price0: '45', account0: k.sales }, { quantity0: '2', price0: '45', account0: k.sales }]) {
      const r = await post('/app/books/invoices/preview', { party, issueDate: '2026-06-02', currency: 'MAD', ...partial });
      expect(r.statusCode).toBe(200);
      expect(r.body).toContain('cannot be worked out yet');
      expect(r.body).not.toMatch(/\d/);
    }
    // the customer and the date are Save's to check: they do not hold the total back
    expect((await post('/app/books/invoices/preview', { party: '', issueDate: '', currency: 'MAD', ...cases[0]! })).body).toContain('5,400.00');

    // the form names the route, and stands without the script: the sentence, in the place the total is drawn
    const page = (await get('/app/books/invoices/new')).body;
    expect(page).toContain('data-total="/app/books/invoices/preview"');
    expect(page).toMatch(/data-total-out aria-live="polite"><p class="caption muted">The total, with tax, is worked out when you save the draft/);

    // the owner's alone, like the form: the accountant is refused as on Save, a stranger gets nothing, and neither wrote anything
    const before = await counts();
    const refused = await post('/app/books/invoices/preview', { party, issueDate: '2026-06-02', currency: 'MAD', ...cases[0]! }, accountant);
    const refusedSave = await post('/app/books/invoices', { party, issueDate: '2026-06-02', currency: 'MAD', ...cases[0]! }, accountant);
    expect(refused.statusCode).toBe(refusedSave.statusCode);
    expect(refused.statusCode).not.toBe(200);
    expect(refused.body).not.toContain('5,400.00');
    const stranger = await app.inject({ method: 'POST', url: '/app/books/invoices/preview', payload: new URLSearchParams({ ...cases[0]! }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(stranger.statusCode).not.toBe(200);
    expect(stranger.body).not.toContain('5,400.00');
    expect(await counts()).toEqual(before);
  });

  /**
   * F-5 (the UI correction's fix round, 2026-11-13) — A FIGURE BELOW ZERO. The table holds `quantity > 0` and
   * `unit_price >= 0` (0184); the form's reader let "-10" through, so the preview showed a total (a negative one) for a
   * form Save could not store, and Save came back as an error page with the typed form gone. Now the reader refuses it
   * by the table's own rule, no stricter and no looser: Save answers 422 with the field named and every typed value
   * kept, nothing is written, and the preview says the line cannot be worked out — never a figure. A price of zero is
   * still a price (the table takes it); a quantity of zero is still refused, in the words it always was.
   */
  it('F-5 · a price or a quantity below zero: 422 with the field named and the values kept, no row, and no figure in the preview', async () => {
    const party = (await as((q) => q(`select id::text as id from parties where code = 'C001'`))).rows[0].id as string;
    const counts = async () => (await as((q) => q(`select (select count(*) from invoices)::int as i, (select count(*) from invoice_lines)::int as l,
      (select count(*) from journal_entries)::int as e`))).rows[0];
    const base = { party, issueDate: '2026-06-02', dueDate: '', currency: 'MAD', label: '' };
    const before = await counts();
    for (const [line, said] of [
      [{ label0: 'Remise sur sacs', quantity0: '1', price0: '-10', account0: k.sales, tax0: k.tax }, 'Line 1: the price cannot be below zero.'],
      [{ label0: 'Remise sur sacs', quantity0: '-3', price0: '12.50', account0: k.sales, tax0: k.tax }, 'Line 1: the quantity must be above zero.'],
      // on the second line, so the line is named by its number; the first line is a good one
      [{ label0: 'Sacs', quantity0: '2', price0: '45', account0: k.sales, tax0: k.tax, label1: 'Livraison', quantity1: '1', price1: '-0.01', account1: k.sales, tax1: '' }, 'Line 2: the price cannot be below zero.'],
    ] as const) {
      const saved = await post('/app/books/invoices', { ...base, ...line });
      expect(saved.statusCode, said).toBe(422);
      expect(saved.body).toContain(said);
      // every typed value is back in its box
      for (const [name, value] of Object.entries(line)) if (/^(label|quantity|price)\d$/.test(name)) expect(saved.body, name).toMatch(new RegExp(`name="${name}"[^>]*value="${value.replace(/[.]/g, '\\.')}"`));
      expect(await counts(), 'nothing is written').toEqual(before);
      const shown = await post('/app/books/invoices/preview', { ...base, ...line });
      expect(shown.statusCode).toBe(200);
      expect(shown.body).toContain('cannot be worked out yet');
      expect(shown.body, 'never a figure').not.toMatch(/\d/);
      expect(await counts()).toEqual(before);
    }
    // the same on a draft saved over
    const good = await post('/app/books/invoices', { ...base, label0: 'Sacs', quantity0: '2', price0: '45', account0: k.sales, tax0: k.tax });
    expect(good.statusCode).toBe(303);
    const id = String(good.headers['location']).split('/').pop()!.split(/[?#]/)[0]!;
    const afterGood = await counts();
    const over = await post(`/app/books/invoices/${id}/edit`, { ...base, label0: 'Sacs', quantity0: '2', price0: '-45', account0: k.sales, tax0: k.tax });
    expect(over.statusCode).toBe(422);
    expect(over.body).toContain('Line 1: the price cannot be below zero.');
    expect((await as((q) => q(`select unit_price::text as p from invoice_lines where invoice_id = $1`, [id]))).rows[0].p).toBe('45.0000');
    expect(await counts()).toEqual(afterGood);

    // THE TABLE'S OWN LINE, no stricter: a price of zero is saved and totalled; no looser: a quantity of zero is refused as it was
    const free = { ...base, label0: 'Echantillon offert', quantity0: '1', price0: '0', account0: k.sales, tax0: k.tax };
    expect((await post('/app/books/invoices/preview', free)).body).toMatch(/0\.00/);
    expect((await post('/app/books/invoices', free)).statusCode).toBe(303);
    const none = await post('/app/books/invoices', { ...base, label0: 'Sacs', quantity0: '0', price0: '45', account0: k.sales, tax0: k.tax });
    expect(none.statusCode).toBe(422);
    expect(none.body).toContain('Line 1: not an amount above zero.');
    // and the words exist in every language the owner reads
    const { t } = await import('../../src/core/owner/i18n/messages.js');
    for (const l of ['en', 'zh', 'ar', 'es', 'fr'] as const) for (const key of ['books.invoice.problem.quantity', 'books.invoice.problem.price'] as const) expect(t(l, key, { n: 1 }), `${l} ${key}`).not.toBe(key);
  });
});
