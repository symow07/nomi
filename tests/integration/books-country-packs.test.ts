import { settingsHref } from '../../src/api/web/settingsNavigation.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { asTenant, purgeBusinesses, type Q } from './books-db.js';

/**
 * Block 2 PR 1 (0225) — THE COUNTRY PACKS, through the page's routes, one fixture workspace per country:
 *
 *   · Morocco — the CGNC chart (as `applyCgncChart` adds it), the TVA codes on 4455 and 34552, the identifiers on the
 *     profile, ten years; and the FEC still passes its checks (books-morocco.test.ts's expectations). A country change
 *     after an entry is posted is refused in one sentence.
 *   · the United Kingdom — a workspace that signed up in France: the page says not yet; saving GB loads the plain
 *     chart and the VAT codes (VAT0 collected at 0, EXEMPT exempt), keeps the company number by R3's rule, says six
 *     years and keeps six; `holds_money` on the bank and cash accounts, and "Barclays Current" offered to a payment
 *     when marked, not when the owner unticks it.
 *   · the United States — the EIN, no VAT, a rate per state as a tax code on Sales tax payable, seven years.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = { MA: `b2250000-0000-4000-8000-${RUN}0001`, GB: `b2250000-0000-4000-8000-${RUN}0002`, US: `b2250000-0000-4000-8000-${RUN}0003` } as const;
type Fixture = keyof typeof BIZ;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

d('0225 · the books\' country packs: MA, GB, US (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 180_000 }, () => {
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let tenant: pg.Client;
  const apps: Partial<Record<Fixture, import('fastify').FastifyInstance>> = {};
  const owners: Partial<Record<Fixture, string>> = {};
  let staff = '';
  let accountant = '';
  let today = '';
  const year = () => today.slice(0, 4);
  const as = <T>(f: Fixture, fn: (q: Q) => Promise<T>) => asTenant(tenant, BIZ[f], fn);
  const cookieOf = (r: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=')) ?? '';
  const get = (f: Fixture, url: string, who = owners[f]!) => apps[f]!.inject({ method: 'GET', url: settingsHref(url), headers: { cookie: who } });
  const post = (f: Fixture, url: string, body: Record<string, string>, who = owners[f]!) =>
    apps[f]!.inject({ method: 'POST', url, payload: new URLSearchParams(body).toString(), headers: { cookie: who, ...FORM } });
  /** The notice a redirect lands with, read on the page it lands on. */
  const notice = async (f: Fixture, r: { headers: Record<string, unknown> }) => {
    const set = ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).join('; ');
    return (await apps[f]!.inject({ method: 'GET', url: settingsHref(String(r.headers['location']).split('#')[0]!), headers: { cookie: `${owners[f]}; ${set}` } })).body;
  };
  const business = async (f: Fixture) => (await admin.query(`select country, company_number, ein from businesses where id = $1`, [BIZ[f]])).rows[0];
  const taxCodes = (f: Fixture) => as(f, async (q) => (await q(`select t.code, t.rate::text as rate, t.kind, a.code as account, t.valid_from::text as valid_from
    from tax_codes t left join accounts a on a.id = t.account_id order by t.code`)).rows);
  const moneyMarks = (f: Fixture, codes: string[]) => as(f, async (q) => Object.fromEntries((await q(`select code, holds_money from accounts where code = any($1) order by code`, [codes])).rows.map((r) => [r.code, r.holds_money])));
  /** An entry posted by hand, as the owner's own rows: the FEC and the retention read posted entries. */
  const postEntry = (f: Fixture, journal: string, day: string, ref: string, lines: [string, string, string, string][], fiscalYear: string) => as(f, async (q) => {
    const id = async (t: string, code: string) => (await q(`select id::text as id from ${t} where code = $1`, [code])).rows[0].id as string;
    const e = (await q(`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by) values (current_business_id(), $1, $2, $3, $4, 'owner') returning id::text as id`,
      [await id('journals', journal), fiscalYear, day, `Pièce ${ref}`])).rows[0].id as string;
    let n = 0;
    for (const [a, cur, dr, cr] of lines) await q(`insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, credit) values (current_business_id(), $1, $2, $3, $4, $5, $6)`,
      [e, ++n, await id('accounts', a), cur, dr, cr]);
    await q(`update journal_entries set state = 'posted', posted_by = 'owner', document_ref = $2, document_date = entry_date where id = $1`, [e, ref]);
  });

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    tenant = new pg.Client({ connectionString: DATABASE_URL }); await tenant.connect();
    // Morocco from sign-up; a French sign-up that will keep its books in the UK; a sign-up with no country yet
    await admin.query(`insert into businesses (id, name, engine, country, currency, books_area, timezone) values ($1, $2, 'service', 'MA', 'MAD', true, 'Africa/Casablanca')`, [BIZ.MA, `Country MA ${RUN}`]);
    await admin.query(`insert into businesses (id, name, engine, country, currency, books_area, timezone) values ($1, $2, 'service', 'FR', 'GBP', true, 'Europe/London')`, [BIZ.GB, `Country GB ${RUN}`]);
    await admin.query(`insert into businesses (id, name, engine, country, currency, books_area, timezone) values ($1, $2, 'service', null, 'USD', true, 'America/New_York')`, [BIZ.US, `Country US ${RUN}`]);
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { addPerson } = await import('../../src/api/web/people.js');
    const { dayKey } = await import('../../src/core/owner/i18n/format.js');
    today = dayKey(new Date(), 'UTC');
    db = createDb(DATABASE_URL!);
    for (const f of ['MA', 'GB', 'US'] as const) {
      const app = Fastify({ logger: false });
      registerWebApp(app, {
        db, businessId: BIZ[f], accessCode: `country-${f}-${RUN}`, sessionSecret: SECRET, factsTtlMs: 0,
        employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
        kickOutbound: async () => {}, kickDrive: async () => {},
      } as unknown as Parameters<typeof registerWebApp>[1]);
      await app.ready();
      apps[f] = app;
      owners[f] = cookieOf(await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(`country-${f}-${RUN}`)}`, headers: FORM }));
    }
    const login = (code: string) => apps.MA!.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`, headers: FORM });
    const acct = await addPerson(db, BIZ.MA, SECRET, `Accountant ${RUN}`, 'accountant');
    if (acct.code !== 'added') throw new Error('fixture');
    accountant = cookieOf(await login(acct.accessCode));
    const team = await addPerson(db, BIZ.MA, SECRET, `Staff ${RUN}`, 'team');
    if (team.code !== 'added') throw new Error('fixture');
    staff = cookieOf(await login(team.accessCode));
  });
  afterAll(async () => {
    for (const app of Object.values(apps)) await app?.close();
    await db?.destroy(); await tenant?.end();
    await purgeBusinesses(admin, Object.values(BIZ), 'books-country-packs-test');
    await admin?.end();
  });

  it('THE PAGE: the owner\'s; staff and the accountant are sent away; a country the packs do not cover is named with the three', async () => {
    const page = await get('MA', '/app/settings/books/country');
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<option value="MA" selected>');
    expect(page.body).toContain('Chosen once');
    for (const who of [staff, accountant]) expect((await get('MA', '/app/settings/books/country', who)).statusCode).toBe(302);
    const tried = await post('MA', '/app/books/country', { country: 'MA', period: 'month', year_start: `${year()}-01-01` }, staff);
    expect(tried.statusCode).toBe(302);
    expect((await as('MA', (q) => q(`select count(*)::int as n from accounts`))).rows[0].n).toBe(0);
    // the settings index and the Books group link to it
    expect((await get('MA', '/app/settings/books')).body).toContain('href="/app/settings/books/country"');
    const fr = (await get('GB', '/app/settings/books/country')).body;
    expect(fr).toContain('Books for France are not ready yet.');
    expect(fr).toContain('Morocco, the United Kingdom and the United States');
    // and saving it as it is loads nothing
    expect(await notice('GB', await post('GB', '/app/books/country', { country: 'FR', period: 'month', year_start: `${year()}-01-01` }))).toContain('Nothing was changed.');
    expect((await as('GB', (q) => q(`select count(*)::int as n from accounts`))).rows[0].n).toBe(0);
  });

  it('MOROCCO: Save loads the CGNC chart, the TVA codes and the first year; the books start on it, monthly; the identifiers are the profile\'s; ten years', async () => {
    const saved = await post('MA', '/app/books/country', { country: 'MA', period: 'month', year_start: `${year()}-01-01` });
    expect(saved.statusCode).toBe(302);
    expect(await notice('MA', saved)).toContain('Saved: Morocco. Added 871 accounts, 7 journals and 9 tax codes.');
    expect((await as('MA', (q) => q(`select count(*)::int as n from accounts`))).rows[0].n).toBe(871);
    expect((await as('MA', (q) => q(`select books_start::text as day, period_length from books_settings`))).rows[0]).toEqual({ day: `${year()}-01-01`, period_length: 'month' });
    expect((await as('MA', (q) => q(`select starts_on::text as s, ends_on::text as e from fiscal_years`))).rows).toEqual([{ s: `${year()}-01-01`, e: `${year()}-12-31` }]);
    const codes = await taxCodes('MA');
    expect(codes.map((c) => [c.code, c.rate, c.kind, c.account])).toEqual([
      ['EXO', '0.0000', 'exempt', null],
      ['TVA10', '10.0000', 'collected', '4455'], ['TVA10_D', '10.0000', 'deductible', '34552'],
      ['TVA14', '14.0000', 'collected', '4455'], ['TVA14_D', '14.0000', 'deductible', '34552'],
      ['TVA20', '20.0000', 'collected', '4455'], ['TVA20_D', '20.0000', 'deductible', '34552'],
      ['TVA7', '7.0000', 'collected', '4455'], ['TVA7_D', '7.0000', 'deductible', '34552']]);
    expect(codes.every((c) => c.valid_from === `${year()}-01-01`)).toBe(true);
    // the template marked the CGNC's 514 and 516 families
    expect(await moneyMarks('MA', ['5141', '5161', '51611', '3421', '5115'])).toEqual({ '5141': true, '5161': true, '51611': true, '3421': false, '5115': false });
    const page = (await get('MA', '/app/settings/books/country')).body;
    expect(page).toContain('href="/app/settings/business/profile#identifiers"');
    expect(page).toContain('Not given yet');
    expect(page).toContain('10 years after the end');
    expect(page).toContain('Months, since');
    expect(page).toContain('871 accounts');
    expect(page).not.toContain('name="period"');
    // again: nothing more added, nothing changed
    expect(await notice('MA', await post('MA', '/app/books/country', { country: 'MA' }))).toContain('Added 0 accounts, 0 journals and 0 tax codes.');
    expect((await as('MA', (q) => q(`select count(*)::int as n from tax_codes`))).rows[0].n).toBe(9);
  });

  it('MOROCCO: the FEC still passes its checks on the pack\'s chart; then a country change is refused, because entries are posted', async () => {
    const fy = (await as('MA', (q) => q(`select id::text as id from fiscal_years`))).rows[0].id as string;
    await postEntry('MA', 'VE', today, 'F-0001', [['3421', 'MAD', '1200', '0'], ['7111', 'MAD', '0', '1000'], ['4455', 'MAD', '0', '200']], fy);
    await postEntry('MA', 'BQ', today, 'REL-01', [['5141', 'MAD', '1200', '0'], ['3421', 'MAD', '0', '1200']], fy);
    const report = (await get('MA', '/app/books/reports/fec')).body;
    expect(report).toContain('Numbering checked: in each journal, no gap and no repeat.');
    expect(report).toContain('The FEC of this year (5 lines)');
    const r = await get('MA', `/app/books/fec/${fy}.txt`);
    expect(r.statusCode).toBe(200);
    expect(String(r.headers['content-disposition'])).toContain(`FEC${year()}1231.txt`);
    const lines = r.body.split('\r\n').filter(Boolean).map((l) => l.split('|'));
    expect(lines[0]).toEqual(['Code_Journal', 'Libelle_Journal', 'Num_Ecriture', 'Date_Ecriture', 'Num_Compte', 'Libelle_Compte', 'Num_Compte_Aux',
      'Libelle_Compte_Aux', 'Ref_Piece', 'Date_Piece', 'Libelle_Ecriture', 'Montant_Debit', 'Montant_Credit', 'Lettrage_Ecriture', 'Date_Lettrage',
      'Date_Validation', 'Montant_Devise', 'Id_devise', 'ICE', 'Identifiant_Fiscal', 'Num_RC', 'Tribunal_RC']);
    expect(lines.length).toBe(6);
    expect(lines.every((l) => l.length === 22)).toBe(true);
    // the file is ordered by journal (BQ before VE on one day): the sale's line, found by its journal
    expect(lines.find((l) => l[0] === 'VE' && l[4] === '3421')!.slice(0, 6)).toEqual(['VE', 'Ventes', '1', today.replace(/-/g, ''), '3421', 'Clients']);
    // the country stays: said in one sentence, nothing written
    expect(await notice('MA', await post('MA', '/app/books/country', { country: 'GB', company_number: '12345678' }))).toContain('The country stays Morocco: entries are already posted under it.');
    expect(await business('MA')).toEqual({ country: 'MA', company_number: null, ein: null });
    expect((await as('MA', (q) => q(`select count(*)::int as n from accounts`))).rows[0].n).toBe(871);
  });

  it('THE UNITED KINGDOM: from France to GB with nothing posted; the plain chart, the VAT codes, the company number padded by R3\'s rule, quarters, six years', async () => {
    const bad = await post('GB', '/app/books/country', { country: 'GB', period: 'quarter', year_start: '2026-04-06', company_number: 'ABC' });
    expect(bad.statusCode).toBe(422);
    expect(bad.body).toContain('A company number is eight digits, or two letters and six digits.');
    expect(bad.body).toContain('value="ABC"');
    expect(await business('GB')).toEqual({ country: 'FR', company_number: null, ein: null });
    expect((await as('GB', (q) => q(`select count(*)::int as n from accounts`))).rows[0].n).toBe(0);
    const saved = await post('GB', '/app/books/country', { country: 'GB', period: 'quarter', year_start: '2026-04-06', company_number: '1234567' });
    expect(await notice('GB', saved)).toContain('Saved: United Kingdom. Added 45 accounts, 7 journals and 4 tax codes.');
    expect(await business('GB')).toEqual({ country: 'GB', company_number: '01234567', ein: null });
    expect((await as('GB', (q) => q(`select books_start::text as day, period_length from books_settings`))).rows[0]).toEqual({ day: '2026-04-06', period_length: 'quarter' });
    expect((await as('GB', (q) => q(`select starts_on::text as s, ends_on::text as e, lock_date::text as l from fiscal_years`))).rows).toEqual([{ s: '2026-04-06', e: '2027-04-05', l: null }]);   // a start on the year's first day moves no lock (0211)
    expect((await taxCodes('GB')).map((c) => [c.code, c.rate, c.kind, c.account, c.valid_from])).toEqual([
      ['EXEMPT', '0.0000', 'exempt', null, '2026-04-06'], ['VAT0', '0.0000', 'collected', '2100', '2026-04-06'],
      ['VAT20', '20.0000', 'collected', '2100', '2026-04-06'], ['VAT5', '5.0000', 'collected', '2100', '2026-04-06']]);
    expect((await as('GB', (q) => q(`select j.code as journal, r.code as receivable, s.code as sales, l.code as loss, g.code as gain from books_settings b
      join journals j on j.id = b.sales_journal_id join accounts r on r.id = b.receivable_account_id join accounts s on s.id = b.sales_account_id
      join accounts l on l.id = b.fx_loss_account_id join accounts g on g.id = b.fx_gain_account_id`))).rows[0]).toEqual({ journal: 'SJ', receivable: '1100', sales: '4000', loss: '7900', gain: '4900' });
    expect(await moneyMarks('GB', ['1000', '1010', '1020', '1030', '1040', '1100', '2100'])).toEqual({ '1000': true, '1010': true, '1020': true, '1030': false, '1040': false, '1100': false, '2100': false });
    const page = (await get('GB', '/app/settings/books/country')).body;
    expect(page).toContain('value="01234567"');
    expect(page).toContain('6 years after the end');
    expect(page).toContain('Quarters, since');
    expect(page).toContain('VAT at 20%, 5% and 0%');
    // six years, counted from the end of the year with the entry (0218): the pack's chart and journals carry it
    const fy = (await as('GB', (q) => q(`select id::text as id from fiscal_years`))).rows[0].id as string;
    await postEntry('GB', 'SJ', '2026-04-06', 'INV-1', [['1100', 'GBP', '120', '0'], ['4000', 'GBP', '0', '100'], ['2100', 'GBP', '0', '20']], fy);
    expect((await as('GB', (q) => q(`select books_keep_until(current_business_id())::text as d`))).rows[0].d).toBe('2033-04-05');
    // the Moroccan FEC is not theirs
    expect((await get('GB', '/app/books/reports/fec')).statusCode).toBe(404);
    // the company number cleared is cleared; the posted entry keeps the country
    expect(await notice('GB', await post('GB', '/app/books/country', { country: 'GB', company_number: '' }))).toContain('Saved: United Kingdom.');
    expect(await business('GB')).toEqual({ country: 'GB', company_number: null, ein: null });
    expect(await notice('GB', await post('GB', '/app/books/country', { country: 'US' }))).toContain('The country stays United Kingdom');
  });

  it('HOLDS MONEY: "Barclays Current" marked in the chart is offered to a payment; the owner unticks it on the accounts page, and it is not; ticks it, and it is', async () => {
    const { paymentAccounts } = await import('../../src/db/bankStatements.js');
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ.GB); if (!bid.ok) throw new Error('fixture');
    const offered = async () => (await withTenantTx(db, bid.value, (tx) => paymentAccounts(tx, BIZ.GB))).map((a) => a.code);
    await as('GB', (q) => q(`update accounts set name = 'Barclays Current' where code = '1000'`));
    expect(await offered()).toEqual(['1000', '1010', '1020']);
    const page = (await get('GB', '/app/settings/books/accounts')).body;
    expect(page).toContain('action="/app/books/accounts/money"');
    expect(page).toContain('Barclays Current');
    const ids = Object.fromEntries((await as('GB', (q) => q(`select code, id::text as id from accounts where code in ('1000', '1010', '1020', '1100')`))).rows.map((r) => [r.code, r.id]));
    // untick 1000 (1010 "Bank savings account" and 1020 "Cash" are the rule's, and stay whatever is sent)
    const r = await apps.GB!.inject({ method: 'POST', url: '/app/books/accounts/money', payload: `money_${ids['1010']}=1`, headers: { cookie: owners.GB!, ...FORM } });
    expect(await notice('GB', r)).toContain('Saved which accounts hold money.');
    expect(await moneyMarks('GB', ['1000', '1010', '1020'])).toEqual({ '1000': false, '1010': true, '1020': true });
    expect(await offered()).toEqual(['1010', '1020']);
    // tick 1000 and 1010 again, and a receivable ticked too is a receivable that holds money (the owner's say)
    await apps.GB!.inject({ method: 'POST', url: '/app/books/accounts/money', payload: `money_${ids['1000']}=1&money_${ids['1010']}=1&money_${ids['1100']}=1`, headers: { cookie: owners.GB!, ...FORM } });
    expect(await offered()).toEqual(['1000', '1010', '1020', '1100']);
    await apps.GB!.inject({ method: 'POST', url: '/app/books/accounts/money', payload: `money_${ids['1000']}=1&money_${ids['1010']}=1`, headers: { cookie: owners.GB!, ...FORM } });
    expect(await offered()).toEqual(['1000', '1010', '1020']);
    // staff and the accountant change nothing
    for (const who of [staff, accountant]) await apps.MA!.inject({ method: 'POST', url: '/app/books/accounts/money', payload: '', headers: { cookie: who, ...FORM } });
    expect(await moneyMarks('MA', ['5141'])).toEqual({ '5141': true });
  });

  it('THE UNITED STATES: the EIN kept as 00-0000000, no VAT, a rate per state on Sales tax payable from today, seven years; the privacy page says it', async () => {
    // before the country: a state's rate has no account to go to
    expect(await notice('US', await post('US', '/app/books/country/state-tax', { state: 'CA', rate: '8.25' }))).toContain('Save the country as the United States first');
    const bad = await post('US', '/app/books/country', { country: 'US', period: 'month', year_start: `${year()}-01-01`, ein: '12-34' });
    expect(bad.statusCode).toBe(422);
    expect(bad.body).toContain('An EIN is nine digits, written 00-0000000.');
    expect(await business('US')).toEqual({ country: null, company_number: null, ein: null });
    const saved = await post('US', '/app/books/country', { country: 'US', period: 'month', year_start: `${year()}-01-01`, ein: '12 3456789' });
    expect(await notice('US', saved)).toContain('Saved: USA. Added 45 accounts, 7 journals and 0 tax codes.');
    expect(await business('US')).toEqual({ country: 'US', company_number: null, ein: '12-3456789' });
    expect((await as('US', (q) => q(`select count(*)::int as n from tax_codes`))).rows[0].n).toBe(0);
    expect((await as('US', (q) => q(`select name from accounts where code = '2100'`))).rows[0].name).toBe('Sales tax payable');
    expect((await as('US', (q) => q(`select count(*)::int as n from accounts where name ilike '%VAT%'`))).rows[0].n).toBe(0);
    expect(await moneyMarks('US', ['1000', '1010', '1020', '1100'])).toEqual({ '1000': true, '1010': true, '1020': true, '1100': false });
    // the database holds the EIN's shape itself
    await expect(admin.query(`update businesses set ein = '123456789' where id = $1`, [BIZ.US])).rejects.toThrow(/businesses_ein_shape/);
    await expect(admin.query(`update businesses set company_number = 'ABC' where id = $1`, [BIZ.US])).rejects.toThrow(/businesses_company_number_shape/);
    // a state's rate: one code per state, collected, on 2100, from today; a repeat and a non-state refused
    expect(await notice('US', await post('US', '/app/books/country/state-tax', { state: 'ca', rate: '8.25' }))).toContain('Added CA at 8.25%.');
    expect((await taxCodes('US')).map((c) => [c.code, c.rate, c.kind, c.account])).toEqual([['ST_CA', '8.2500', 'collected', '2100']]);
    expect((await taxCodes('US'))[0]!.valid_from).toBe((await as('US', (q) => q(`select books_today(current_business_id())::text as d`))).rows[0].d);
    expect(await notice('US', await post('US', '/app/books/country/state-tax', { state: 'CA', rate: '7' }))).toContain('CA already has a tax code.');
    expect(await notice('US', await post('US', '/app/books/country/state-tax', { state: 'XX', rate: '7' }))).toContain('Nothing was added.');
    expect(await notice('US', await post('US', '/app/books/country/state-tax', { state: 'NY', rate: '101' }))).toContain('Nothing was added.');
    expect((await as('US', (q) => q(`select count(*)::int as n from tax_codes`))).rows[0].n).toBe(1);
    const page = (await get('US', '/app/settings/books/country')).body;
    expect(page).toContain('value="12-3456789"');
    expect(page).toContain('7 years after the end');
    expect(page).toContain('No VAT.');
    expect(page).toContain('8.25%');
    expect(page).not.toContain('<option value="CA">');
    // seven years, from the end of the year with the entry; the data page names it as Nomi's own choice
    const fy = (await as('US', (q) => q(`select id::text as id from fiscal_years`))).rows[0].id as string;
    await postEntry('US', 'SJ', today, 'INV-1', [['1100', 'USD', '108.25', '0'], ['4000', 'USD', '0', '100'], ['2100', 'USD', '0', '8.25']], fy);
    expect((await as('US', (q) => q(`select books_keep_until(current_business_id())::text as d`))).rows[0].d).toBe(`${Number(year()) + 7}-12-31`);
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const books = await import('../../src/db/booksExport.js');
    const bid = parseBusinessId(BIZ.US); if (!bid.ok) throw new Error('fixture');
    expect((await withTenantTx(db, bid.value, (tx) => books.booksHoldingTx(tx, BIZ.US))).law).toContain("Nomi's own choice: seven years");
    expect((await apps.US!.inject({ method: 'GET', url: '/privacy' })).body).toContain('United States: seven years');
    // the accountant and staff reach none of it
    for (const who of [staff, accountant]) {
      const tried = await apps.MA!.inject({ method: 'POST', url: '/app/books/country/state-tax', payload: 'state=NY&rate=4', headers: { cookie: who, ...FORM } });
      expect(tried.statusCode).toBe(302);
    }
    expect((await as('MA', (q) => q(`select count(*)::int as n from tax_codes where code like 'ST%'`))).rows[0].n).toBe(0);
  });
});
