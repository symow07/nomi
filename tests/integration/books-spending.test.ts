import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { asTenant, purgeBusinesses, type Q } from './books-db.js';

/**
 * Block 2 PR 3 (0227) — SPENDING, on a Moroccan workspace whose pack came through the country page: bills typed with and
 * without tax, one paid on the spot and one paid later from the bank; two recurring costs proposed by the job's own
 * function and decided by the owner (one posted, one skipped); a category on an account of the chart. Then THE TRIAL
 * BALANCE TIES, and each account carries exactly the fixture's sums. Staff write nothing; the accountant reads and sees
 * no form.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `b2270000-0000-4000-8000-${RUN}0001`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

d('0227 · spending: bills, categories, recurring costs; the trial balance ties (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 180_000 }, () => {
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let tenant: pg.Client;
  let app: import('fastify').FastifyInstance;
  let owner = ''; let staff = ''; let accountant = '';
  let today = '';
  let expense = '';          // an expense account of the chart, by code
  let expenseId = '';
  const as = <T>(fn: (q: Q) => Promise<T>) => asTenant(tenant, BIZ, fn);
  const cookieOf = (r: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=')) ?? '';
  const get = (url: string, who = owner) => app.inject({ method: 'GET', url, headers: { cookie: who } });
  const post = (url: string, body: Record<string, string>, who = owner) => app.inject({ method: 'POST', url, payload: new URLSearchParams(body).toString(), headers: { cookie: who, ...FORM } });
  const notice = async (r: { headers: Record<string, unknown> }) => {
    const set = ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).join('; ');
    return (await app.inject({ method: 'GET', url: String(r.headers['location']).split('#')[0]!, headers: { cookie: `${owner}; ${set}` } })).body;
  };
  const idOf = async (table: 'accounts' | 'tax_codes' | 'journals', code: string) => (await as((q) => q(`select id::text as id from ${table} where code = $1`, [code]))).rows[0].id as string;
  const closing = async (code: string) => {
    const { trialBalanceOf } = await import('../../src/db/booksReports.js');
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    const tb = await withTenantTx(db, b.value, (tx) => trialBalanceOf(tx, b.value, { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` }));
    const row = tb.rows.find((r) => r.code === code);
    return { balanced: tb.balanced, debit: Number(row?.closing.debit ?? 0), credit: Number(row?.closing.credit ?? 0) };
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    tenant = new pg.Client({ connectionString: DATABASE_URL }); await tenant.connect();
    await admin.query(`insert into businesses (id, name, engine, country, currency, books_area, timezone) values ($1, $2, 'service', 'MA', 'MAD', true, 'Africa/Casablanca')`, [BIZ, `Spending ${RUN}`]);
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { addPerson } = await import('../../src/api/web/people.js');
    const { dayKey } = await import('../../src/core/owner/i18n/format.js');
    today = dayKey(new Date(), 'Africa/Casablanca');
    db = createDb(DATABASE_URL!);
    app = Fastify({ logger: { level: 'error' } });   // a 500 says why in the run's log
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: `spend-${RUN}`, sessionSecret: SECRET, factsTtlMs: 0,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const login = (code: string) => app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`, headers: FORM });
    owner = cookieOf(await login(`spend-${RUN}`));
    const acct = await addPerson(db, BIZ, SECRET, `Accountant ${RUN}`, 'accountant'); if (acct.code !== 'added') throw new Error('fixture');
    accountant = cookieOf(await login(acct.accessCode));
    const team = await addPerson(db, BIZ, SECRET, `Staff ${RUN}`, 'team'); if (team.code !== 'added') throw new Error('fixture');
    staff = cookieOf(await login(team.accessCode));
    // The pack, as the owner loads it: the CGNC, the TVA codes, the journals, the year, the books started.
    expect((await post('/app/books/country', { country: 'MA', period: 'month', year_start: `${today.slice(0, 4)}-01-01` })).statusCode).toBe(302);
    const e = (await as((q) => q(`select id::text as id, code from accounts where kind = 'expense' and is_active and code ~ '^61' and not exists (select 1 from accounts c where c.parent_id = accounts.id) order by code limit 1`))).rows[0];
    expense = e.code; expenseId = e.id;
  });
  afterAll(async () => { await app?.close(); await db?.destroy(); await tenant?.end(); await purgeBusinesses(admin, [BIZ], 'books-spending-test'); await admin?.end(); });

  it('the page: the owner\'s forms; the accountant reads and sees none; staff are turned away from every write', async () => {
    const page = await get('/app/books/spending');
    expect(page.statusCode).toBe(200);
    for (const a of ['/app/books/spending/bills', '/app/books/spending/recurring', '/app/books/spending/categories']) expect(page.body).toContain(`action="${a}"`);
    const read = await get('/app/books/spending', accountant);
    expect(read.statusCode).toBe(200);
    expect(read.body).toContain('Costs that come back');
    expect(read.body).not.toContain('action="/app/books/spending/bills"');
    const tried = await post('/app/books/spending/bills', { date: today, label: 'Nope', ref: 'X-1', gross: '10', account: expenseId }, staff);
    expect(tried.statusCode).toBe(302);
    expect((await as((q) => q(`select count(*)::int as n from spending_bills`))).rows[0].n).toBe(0);
  });

  it('a category on an account of the chart; a word twice or an account that is not an expense is refused', async () => {
    expect(await notice(await post('/app/books/spending/categories', { name: 'Rent and premises', account: expenseId }))).toContain('Category added.');
    expect(await notice(await post('/app/books/spending/categories', { name: 'rent AND premises', account: expenseId }))).toContain('not added');
    expect(await notice(await post('/app/books/spending/categories', { name: 'Bank', account: await idOf('accounts', '5141') }))).toContain('not added');
    expect((await as((q) => q(`select count(*)::int as n from spending_categories where archived_at is null`))).rows[0].n).toBe(1);
  });

  it('a bill with tax, not yet paid, from a new supplier: the net on the account, the tax on the code\'s, the gross owed to the supplier', async () => {
    const r = await post('/app/books/spending/bills', { date: today, label: 'Cotton, March', ref: 'RC-2026-031', gross: '1200', newSupplier: 'Rif Coton', tax: await idOf('tax_codes', 'TVA20_D'), account: expenseId });
    expect(await notice(r)).toMatch(/Posted as /);
    const lines = (await as((q) => q(`select a.code, l.debit::text as debit, l.credit::text as credit, p.name as party from journal_lines l join accounts a on a.id = l.account_id
      left join parties p on p.id = l.party_id join journal_entries e on e.id = l.entry_id where e.label = 'Cotton, March' order by l.line_no`))).rows;
    expect(lines.map((l) => [l.code, l.debit, l.credit, l.party])).toEqual([[expense, '1000.00', '0.00', null], ['34552', '200.00', '0.00', null], ['4411', '0.00', '1200.00', 'Rif Coton']]);
    expect((await as((q) => q(`select kind from parties where name = 'Rif Coton'`))).rows[0].kind).toBe('supplier');
    expect((await get('/app/books/spending')).body).toContain('Cotton, March');     // under "Not paid yet"
  });

  it('a bill with no tax, paid on the spot from the bank: nothing owed, the bank credited', async () => {
    const category = (await as((q) => q(`select id::text as id from spending_categories where archived_at is null`))).rows[0].id as string;
    const r = await post('/app/books/spending/bills', { date: today, label: 'Window cleaning', ref: 'T-118', gross: '300', category, payFrom: await idOf('accounts', '5141') });
    expect(await notice(r)).toMatch(/Posted as /);
    const lines = (await as((q) => q(`select a.code, l.debit::text as debit, l.credit::text as credit from journal_lines l join accounts a on a.id = l.account_id
      join journal_entries e on e.id = l.entry_id where e.label = 'Window cleaning' order by l.line_no`))).rows;
    expect(lines.map((l) => [l.code, l.debit, l.credit])).toEqual([[expense, '300.00', '0.00'], ['5141', '0.00', '300.00']]);
    expect((await as((q) => q(`select count(*)::int as n from spending_bills where paid_entry_id is null`))).rows[0].n).toBe(1);   // only the cotton
  });

  it('a bill refused by the books is refused in words: a fixed asset cannot pay; a bill needs a supplier or a payer', async () => {
    const fixed = (await as((q) => q(`select id::text as id from accounts where code ~ '^2' and kind = 'asset' and is_active limit 1`))).rows[0].id as string;
    expect(await notice(await post('/app/books/spending/bills', { date: today, label: 'Nope', ref: 'X-1', gross: '10', account: expenseId, payFrom: fixed }))).toContain('only a bank or cash account can pay');
    expect(await notice(await post('/app/books/spending/bills', { date: today, label: 'Nope', ref: 'X-1', gross: '10', account: expenseId }))).toContain('needs a supplier');
    expect(await notice(await post('/app/books/spending/bills', { date: today, label: 'Nope', ref: 'X-1', gross: 'ten', account: expenseId }))).toContain('not recorded');
    expect(await notice(await post('/app/books/spending/bills', { date: today, label: 'No number', gross: '10', account: expenseId, payFrom: await idOf('accounts', '5141') }))).toContain("document's reference and date");
    expect((await as((q) => q(`select count(*)::int as n from journal_entries where label = 'Nope'`))).rows[0].n).toBe(0);
  });

  it('paid later: the supplier\'s account settled from the bank, and the bill leaves "Not paid yet"', async () => {
    const bill = (await as((q) => q(`select id::text as id from spending_bills where paid_entry_id is null`))).rows[0].id as string;
    expect(await notice(await post(`/app/books/spending/bills/${bill}/pay`, { date: today, account: await idOf('accounts', '5141') }))).toMatch(/Marked as paid: /);
    expect((await as((q) => q(`select count(*)::int as n from spending_bills where paid_entry_id is null`))).rows[0].n).toBe(0);
    expect((await get('/app/books/spending')).body).toContain('Every bill recorded here has been paid.');
  });

  it('recurring costs: proposed on their day by the job\'s function, once; posted or skipped only by the owner; the schedule moves on', async () => {
    const { proposeDue } = await import('../../src/db/booksSpending.js');
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    const category = (await as((q) => q(`select id::text as id from spending_categories where archived_at is null`))).rows[0].id as string;
    expect(await notice(await post('/app/books/spending/recurring', { label: 'Rent', amount: '2400', every: 'month', firstOn: today, category, newSupplier: 'Immo Souss' }))).toContain('Schedule saved');
    expect(await notice(await post('/app/books/spending/recurring', { label: 'Ads', amount: '600', every: 'quarter', firstOn: today, account: expenseId, payFrom: await idOf('accounts', '5141') }))).toContain('Schedule saved');
    expect(await notice(await post('/app/books/spending/recurring', { label: 'Nope', amount: '0', every: 'month', firstOn: today, account: expenseId }))).toContain('not saved');
    // the job's half: proposals, once per due day — and nothing posted
    expect(await withTenantTx(db, b.value, (tx) => proposeDue(tx, b.value, today))).toBe(2);
    expect(await withTenantTx(db, b.value, (tx) => proposeDue(tx, b.value, today))).toBe(0);
    expect((await as((q) => q(`select count(*)::int as n from journal_entries where label in ('Rent', 'Ads')`))).rows[0].n).toBe(0);
    expect((await as((q) => q(`select spending_due_workspaces($1::date)::text as id`, [today]))).rows.map((r) => r.id)).toContain(BIZ);
    const page = (await get('/app/books/spending')).body;
    expect(page).toContain('Waiting for your tick');
    expect(page).toContain('Immo Souss');
    // the owner decides: rent posted (owed to the landlord), ads skipped
    const waiting = (await as((q) => q(`select p.id::text as id, r.label from spending_proposals p join recurring_costs r on r.id = p.recurring_id where p.state = 'waiting' order by r.label`))).rows;
    expect(waiting.map((w) => w.label)).toEqual(['Ads', 'Rent']);
    expect(await notice(await post(`/app/books/spending/proposals/${waiting[1].id}/post`, {}))).toMatch(/Posted as /);
    expect(await notice(await post(`/app/books/spending/proposals/${waiting[0].id}/skip`, {}))).toContain('Skipped');
    expect(await notice(await post(`/app/books/spending/proposals/${waiting[0].id}/skip`, {}))).toContain('already decided');
    const after = (await as((q) => q(`select r.label, r.next_on::text as next_on, p.state from recurring_costs r join spending_proposals p on p.recurring_id = r.id order by r.label`))).rows;
    expect(after.map((r) => r.state)).toEqual(['skipped', 'posted']);
    for (const r of after) expect(r.next_on > today).toBe(true);
    expect((await as((q) => q(`select count(*)::int as n from spending_bills where paid_entry_id is null`))).rows[0].n).toBe(1);   // the rent, owed
    // a stopped schedule is proposed no more
    const ads = (await as((q) => q(`select id::text as id from recurring_costs where label = 'Ads'`))).rows[0].id as string;
    expect(await notice(await post(`/app/books/spending/recurring/${ads}/archive`, {}))).toContain('no longer proposed');
    expect(await withTenantTx(db, b.value, (tx) => proposeDue(tx, b.value, '2099-01-01'))).toBe(1);   // the rent's next month only
  });

  it('THE TRIAL BALANCE TIES, and each account carries exactly the fixture\'s sums', async () => {
    const exp = await closing(expense);
    expect(exp.balanced).toBe(true);
    expect(exp.debit - exp.credit).toBeCloseTo(1000 + 300 + 2400, 2);          // cotton net, cleaning, rent
    const vat = await closing('34552'); expect(vat.debit - vat.credit).toBeCloseTo(200, 2);
    const bank = await closing('5141'); expect(bank.credit - bank.debit).toBeCloseTo(300 + 1200, 2);   // cleaning on the spot, cotton paid later
    const owed = await closing('4411'); expect(owed.credit - owed.debit).toBeCloseTo(2400, 2);          // the rent, still owed
  });

  it('a bill with no number: ticked, the books give it NOREF-<day>-<n>, unique for the day, shown as Nomi\'s on the row, the entry and in the pack', async () => {
    const day = today.replace(/-/g, '');
    const bank = await idOf('accounts', '5141');
    // Typed AND ticked is refused; a typed reference in the reserved shape is refused; neither is NB008's own refusal (above).
    expect(await notice(await post('/app/books/spending/bills', { date: today, label: 'Both', ref: 'R-1', noref: '1', gross: '10', account: expenseId, payFrom: bank }))).toContain('not both');
    expect(await notice(await post('/app/books/spending/bills', { date: today, label: 'Reserved', ref: `NOREF-${day}-7`, gross: '10', account: expenseId, payFrom: bank }))).toContain('the books&#39; own');
    expect((await as((q) => q(`select count(*)::int as n from journal_entries where label in ('Both', 'Reserved')`))).rows[0].n).toBe(0);
    // Ticked: the day's first reference; the next counts up, whether paid on the spot or owed.
    expect(await notice(await post('/app/books/spending/bills', { date: today, label: 'Market vegetables', noref: '1', gross: '85', account: expenseId, payFrom: bank })))
      .toContain(`The bill has no number; in the books its reference is NOREF-${day}-1.`);
    expect(await notice(await post('/app/books/spending/bills', { date: today, label: 'Taxi', noref: '1', gross: '40', account: expenseId, newSupplier: 'Cash purchases' }))).toContain(`NOREF-${day}-2`);
    const refs = (await as((q) => q(`select label, document_ref, document_date::text as doc from journal_entries where label in ('Market vegetables', 'Taxi') order by label`))).rows;
    expect(refs.map((r) => [r.document_ref, r.doc])).toEqual([[`NOREF-${day}-1`, today], [`NOREF-${day}-2`, today]]);
    // Shown as Nomi's: the owed taxi's row on the spending book, and the entry's own page.
    expect((await get('/app/books/spending')).body).toContain(`no number on the bill; Nomi&#39;s reference NOREF-${day}-2`);
    const entry = (await as((q) => q(`select id::text as id from journal_entries where label = 'Taxi'`))).rows[0].id as string;
    expect((await get(`/app/books/advanced/entries/${entry}`)).body).toContain(`<bdi>NOREF-${day}-2</bdi>`);
    expect((await get(`/app/books/advanced/entries/${entry}`)).body).toContain('this reference is Nomi&#39;s own');
    // The accountant pack's journal carries it as the entry's document, verbatim: the prefix is the marker there.
    const { packData } = await import('../../src/db/booksReports.js');
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    const pack = await withTenantTx(db, b.value, (tx) => packData(tx, b.value, { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` }));
    expect(pack.lines.filter((l) => l.label === 'Taxi').map((l) => l.documentRef)).toEqual([`NOREF-${day}-2`, `NOREF-${day}-2`]);
    // The books still tie, with the two bills in their accounts.
    const exp = await closing(expense);
    expect(exp.balanced).toBe(true);
    expect(exp.debit - exp.credit).toBeCloseTo(1000 + 300 + 2400 + 85 + 40, 2);
    const bankNow = await closing('5141'); expect(bankNow.credit - bankNow.debit).toBeCloseTo(300 + 1200 + 85, 2);
    const owed = await closing('4411'); expect(owed.credit - owed.debit).toBeCloseTo(2400 + 40, 2);
  });

  it('the app role deletes nothing of it', async () => {
    for (const t of ['spending_categories', 'spending_bills', 'recurring_costs', 'spending_proposals']) {
      const r = await as((q) => q(`select has_table_privilege('nomi_app', $1, 'DELETE') as can`, [t]));
      expect(r.rows[0].can, t).toBe(false);
    }
  });
});
