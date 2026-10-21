import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { asTenant, purgeBusinesses, type Q } from './books-db.js';

/**
 * B2 (Phase 5, §5 option A) — the done-criterion (PHASE-5.md §4): the workbook imports and exports; a broken template
 * is refused, naming the sheet, row and column, and nothing half-imports; export then re-import changes nothing.
 * Through the real routes, as the owner and as the accountant, on a ledger the database keeps.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `b2b20000-0000-4000-8000-${RUN}0001`;
const CODE = `workbook-owner-${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';

d('B2 · the Nomi workbook, in and out (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let tenant: pg.Client;
  let owner = '';
  let accountant = '';
  let excel: ReturnType<typeof import('../../src/books/connectors/excel.js').excelConnector>;
  let readBack: (b: Buffer) => import('../../src/core/books/interchange.js').BooksData;
  const as = <T>(fn: (q: Q) => Promise<T>) => asTenant(tenant, BIZ, fn);
  const cookieOf = (r: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=')) ?? '';
  /** Every row the books hold, as text: what "changed nothing" is measured against. */
  const snapshot = () => as(async (q) => {
    const out: Record<string, unknown[]> = {};
    for (const t of ['accounts', 'journals', 'parties', 'tax_codes', 'journal_entries', 'journal_lines']) {
      out[t] = (await q(`select * from ${t} order by id`)).rows;
    }
    return JSON.stringify(out);
  });
  const upload = async (bytes: Buffer, who = owner) => {
    const boundary = `----nomi${RUN}`;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="workbook"; filename="books.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`),
      bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    return app.inject({ method: 'POST', url: '/app/books/workbook', payload: body,
      headers: { cookie: who, 'content-type': `multipart/form-data; boundary=${boundary}` } });
  };
  const flashOf = async (r: { headers: Record<string, unknown> }) => {
    const set = ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).join('; ');
    const page = await app.inject({ method: 'GET', url: String(r.headers['location']).split('#')[0]!, headers: { cookie: `${owner}; ${set}` } });
    return page.body;
  };
  const download = async (who = owner) => {
    const r = await app.inject({ method: 'GET', url: '/app/books/workbook.xlsx', headers: { cookie: who } });
    expect(r.statusCode, r.body.slice(0, 200)).toBe(200);
    return r.rawPayload;
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    tenant = new pg.Client({ connectionString: DATABASE_URL });
    await tenant.connect();
    await admin.query(`insert into businesses (id, name, engine, country, currency, books_area) values ($1, $2, 'service', 'MA', 'MAD', true)`, [BIZ, `Workbook ${RUN}`]);
    // A ledger: a chart, journals, a party, a tax code, an open year, a posted MAD sale, a posted USD receipt with its
    // exchange difference, and a draft.
    await as(async (q) => {
      const acc = async (code: string, name: string, kind: string) => (await q(`insert into accounts (business_id, code, name, kind) values (current_business_id(), $1, $2, $3) returning id`, [code, name, kind])).rows[0].id as string;
      const a = { clients: await acc('3421', 'Clients', 'asset'), bank: await acc('5141', 'Banque', 'asset'), tva: await acc('4455', 'TVA facturée', 'liability'),
        sales: await acc('7111', 'Ventes', 'income'), fx: await acc('6331', 'Pertes de change', 'expense') };
      const jr = async (code: string, kind: string) => (await q(`insert into journals (business_id, code, name, kind) values (current_business_id(), $1, $1, $2) returning id`, [code, kind])).rows[0].id as string;
      const ve = await jr('VE', 'sales'); const bq = await jr('BQ', 'bank');
      await q(`insert into parties (business_id, code, name, kind, country, ice) values (current_business_id(), 'C001', 'Atlas Textiles SARL', 'customer', 'MA', '001234567000089')`);
      await q(`insert into tax_codes (business_id, code, label, rate, kind, account_id, valid_from) values (current_business_id(), 'TVA20', 'TVA 20 %', 20, 'collected', $1, '2026-01-01')`, [a.tva]);
      await q(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2025-01-01', '2025-12-31')`);
      const fy = (await q(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2026-01-01', '2026-12-31') returning id`)).rows[0].id as string;
      await q(`insert into owner_rates (business_id, from_currency, to_currency, rate, stated_at) values (current_business_id(), 'USD', 'MAD', 9.9765, '2026-04-01T09:00:00Z')`);
      const entry = async (j: string, day: string, label: string, lines: [string, string, string | null, string | null][], post: boolean) => {
        const e = (await q(`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by) values (current_business_id(), $1, $2, $3, $4, 'owner') returning id`, [j, fy, day, label])).rows[0].id as string;
        let n = 0;
        for (const [account, currency, debit, credit] of lines) {
          await q(`insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, credit) values (current_business_id(), $1, $2, $3, $4, $5, $6)`, [e, ++n, account, currency, debit ?? 0, credit ?? 0]);
        }
        if (post) await q(`update journal_entries set state = 'posted', posted_by = 'owner', document_ref = $2, document_date = entry_date where id = $1`, [e, `DOC-${label.length}`]);
      };
      await entry(ve, '2026-04-02', 'Facture F-2026-0042', [[a.clients, 'MAD', '1440.60', null], [a.sales, 'MAD', null, '1200.50'], [a.tva, 'MAD', null, '240.10']], true);
      await entry(bq, '2026-04-09', 'Virement USD', [[a.bank, 'USD', '33.33', null], [a.bank, 'USD', '33.33', null], [a.bank, 'USD', '33.34', null],
        [a.sales, 'USD', null, '100.00'], [a.fx, 'MAD', null, '0.01']], true);
      await entry(ve, '2026-04-20', 'Avoir à préparer', [[a.sales, 'MAD', '50', null], [a.clients, 'MAD', null, '50']], false);
    });
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { addPerson } = await import('../../src/api/web/people.js');
    const { excelConnector } = await import('../../src/books/connectors/excel.js');
    excel = excelConnector('MAD');
    readBack = (b) => excel.toBooks(b).data;
    db = createDb(DATABASE_URL!);
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET, factsTtlMs: 0,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const login = (code: string) => app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    owner = cookieOf(await login(CODE));
    const acct = await addPerson(db, BIZ, SECRET, `Accountant ${RUN}`, 'accountant');
    if (acct.code !== 'added') throw new Error('fixture');
    accountant = cookieOf(await login(acct.accessCode));
  });
  afterAll(async () => {
    await app?.close(); await db?.destroy(); await tenant?.end();
    await purgeBusinesses(admin, [BIZ], 'books-workbook-test');
    await admin?.end();
  });

  it('OUT: the workbook holds the chart, the journals, the party, the tax code and every entry not discarded', async () => {
    const books = readBack(await download());
    expect(books.accounts.map((a) => a.code)).toEqual(['3421', '4455', '5141', '6331', '7111']);
    expect(books.journals.map((j) => j.code)).toEqual(['BQ', 'VE']);
    expect(books.parties).toEqual([{ code: 'C001', name: 'Atlas Textiles SARL', kind: 'customer', country: 'MA', ice: '001234567000089', taxNumber: null }]);
    expect(books.taxCodes.map((t) => [t.code, t.rate, t.account])).toEqual([['TVA20', '20', '4455']]);
    expect(books.entries.map((e) => [e.key.replace(/^draft-.*/, 'draft'), e.state, e.lines.length])).toEqual([
      ['VE-2026-1', 'posted', 3], ['BQ-2026-1', 'posted', 5], ['draft', 'draft', 2]]);
    // exact amounts, in the line's own currency
    expect(books.entries[1]!.lines.map((l) => [l.currency, l.debit, l.credit])).toEqual([
      ['USD', '33.33', null], ['USD', '33.33', null], ['USD', '33.34', null], ['USD', null, '100'], ['MAD', null, '0.01']]);
  });

  it('EXPORT THEN RE-IMPORT CHANGES NOTHING — and says so', async () => {
    const before = await snapshot();
    const r = await upload(await download());
    expect(r.statusCode).toBe(302);
    expect(await flashOf(r)).toContain('Read in: 0 new, 0 replaced, 12 already here.');
    expect(await snapshot()).toBe(before);
  });

  it('IN: new records are added, a new entry arrives as a DRAFT; the same workbook again adds nothing', async () => {
    const books = readBack(await download());
    const more = { ...books,
      accounts: [...books.accounts, { code: '3425', name: 'Clients douteux', kind: 'asset' as const, parent: '3421' }],
      entries: [...books.entries, { key: 'mine-1', journal: 'VE', date: '2026-05-03', label: 'Facture F-2026-0051', documentRef: 'F-2026-0051', documentDate: '2026-05-03',
        state: 'posted' as const, lines: [
          { account: '3425', party: 'C001', taxCode: null, currency: 'MAD', debit: '600' as never, credit: null, label: null },
          { account: '7111', party: null, taxCode: 'TVA20', currency: 'MAD', debit: null, credit: '500' as never, label: null },
          { account: '4455', party: null, taxCode: null, currency: 'MAD', debit: null, credit: '100' as never, label: null }] }] };
    const r = await upload(excel.fromBooks(more));
    expect(await flashOf(r)).toContain('Read in: 2 new, 0 replaced, 12 already here.');
    const made = await as((q) => q(`select e.state, e.number, e.label, a.code as account, p.code as party
      from journal_entries e join journal_lines l on l.entry_id = e.id join accounts a on a.id = l.account_id left join parties p on p.id = l.party_id
      where e.label = 'Facture F-2026-0051' and l.line_no = 1`));
    // whatever the workbook called it, it is a draft: posting is the owner's, in Nomi
    expect(made.rows).toEqual([{ state: 'draft', number: null, label: 'Facture F-2026-0051', account: '3425', party: 'C001' }]);
    const parent = await as((q) => q(`select p.code from accounts a join accounts p on p.id = a.parent_id where a.code = '3425'`));
    expect(parent.rows).toEqual([{ code: '3421' }]);
    const before = await snapshot();
    const again = await upload(excel.fromBooks(more));
    expect(await flashOf(again)).toContain('Read in: 0 new, 0 replaced, 14 already here.');
    expect(await snapshot()).toBe(before);
  });

  it('A BROKEN TEMPLATE IS REFUSED, naming the sheet, the row and the column — and nothing half-imports', async () => {
    const { xlsxWrite } = await import('../../src/net/xlsx.js');
    const before = await snapshot();
    const broken = xlsxWrite([
      { name: 'Nomi', rows: [['Nomi workbook', '1']] },
      { name: 'Accounts', rows: [['Code', 'Name', 'Kind', 'Parent'], ['3426', 'Clients litigieux', 'asset', null]] },
      { name: 'Journals', rows: [['Code', 'Name', 'Kind']] },
      { name: 'Parties', rows: [['Code', 'Name', 'Kind', 'Country', 'ICE']] },              // no "Tax number"
      { name: 'Tax codes', rows: [['Code', 'Label', 'Rate', 'Kind', 'Account', 'Valid from', 'Valid to']] },
      { name: 'Journal', rows: [
        ['Entry', 'Journal', 'Date', 'Label', 'Document', 'Document date', 'State', 'Account', 'Party', 'Tax code', 'Currency', 'Debit', 'Credit', 'Line label'],
        ['x1', 'VE', '01/05/2026', 'Ambiguous', null, null, null, '3421', null, null, 'MAD', '1.250', null, null],
        ['x1', null, null, null, null, null, null, '7111', null, null, 'MAD', null, '1250', null]] },
    ]);
    const r = await upload(broken);
    expect(r.statusCode).toBe(422);
    expect(r.body).toContain('Nothing was read in');
    const rows = [...r.body.matchAll(/<tr><td><bdi>([^<]*)<\/bdi><\/td><td>([^<]*)<\/td>\s*<td><bdi>([^<]*)<\/bdi><\/td><td>([^<]*)<\/td><\/tr>/g)]
      .map((m) => [m[1], (m[2] ?? '').replace(/[^\d]/g, ''), m[3], m[4]]);
    expect(rows).toEqual(expect.arrayContaining([
      ['Parties', '1', 'Tax number', 'This column is missing from the header row.'],
      ['Journal', '2', 'Date', 'Not a date. Write it as YYYY-MM-DD, or use an Excel date.'],
      ['Journal', '2', 'Debit', expect.stringContaining('can be read two ways')],
    ]));
    // and the account the same workbook would have added is not there either
    expect(await snapshot()).toBe(before);
  });

  it('A POSTED ENTRY CHANGED IN THE WORKBOOK stops the whole read-in; the new account beside it is not added', async () => {
    const before = await snapshot();
    const books = readBack(await download());
    const tampered = { ...books,
      accounts: [...books.accounts, { code: '3427', name: 'Autre', kind: 'asset' as const, parent: null }],
      entries: books.entries.map((e) => (e.key === 'VE-2026-1' ? { ...e, label: 'Facture F-2026-0042 (modifiée)' } : e)) };
    const r = await upload(excel.fromBooks(tampered));
    expect(r.statusCode).toBe(422);
    expect(r.body).toContain('This entry is posted, and a posted entry never changes. Reverse it in Nomi instead.');
    expect(await snapshot()).toBe(before);
  });

  it('A PROBLEM FOUND WHILE WRITING rolls back what was already written (a tax code not yet in force on the day)', async () => {
    const before = await snapshot();
    const books = readBack(await download());
    const early = { ...books,
      accounts: [...books.accounts, { code: '3428', name: 'Écrite puis annulée', kind: 'asset' as const, parent: null }],
      entries: [...books.entries, { key: 'early-1', journal: 'VE', date: '2025-06-01', label: 'Avant la TVA20', documentRef: null, documentDate: null,
        state: 'draft' as const, lines: [
          { account: '3421', party: null, taxCode: null, currency: 'MAD', debit: '120' as never, credit: null, label: null },
          { account: '7111', party: null, taxCode: 'TVA20', currency: 'MAD', debit: null, credit: '120' as never, label: null }] }] };
    const r = await upload(excel.fromBooks(early));
    expect(r.statusCode).toBe(422);
    expect(r.body).toContain('No tax code of that name is in force on this day.');
    expect(await snapshot()).toBe(before);   // the account 3428, written first, is gone with the rest
  });

  it('a draft the workbook changes is replaced (the old one discarded, never deleted)', async () => {
    const books = readBack(await download());
    const draft = books.entries.find((e) => e.label === 'Avoir à préparer')!;
    const changed = { ...books, entries: books.entries.map((e) => (e.key === draft.key ? { ...e, label: 'Avoir AV-2026-0003' } : e)) };
    const r = await upload(excel.fromBooks(changed));
    expect(await flashOf(r)).toContain('Read in: 0 new, 1 replaced,');
    const rows = await as((q) => q(`select label, state from journal_entries where label in ('Avoir à préparer', 'Avoir AV-2026-0003') order by label`));
    expect(rows.rows).toEqual([{ label: 'Avoir AV-2026-0003', state: 'draft' }, { label: 'Avoir à préparer', state: 'discarded' }]);
  });

  it('a file that is not the Nomi workbook is refused as such; the accountant downloads but cannot read in', async () => {
    const r = await upload(Buffer.from('Code,Name\n3421,Clients\n'));
    expect(r.statusCode).toBe(302);
    expect(await flashOf(r)).toContain('That file is not the Nomi workbook.');
    expect((await download(accountant)).length).toBeGreaterThan(500);
    const before = await snapshot();
    const theirs = await upload(await download(accountant), accountant);
    expect([theirs.statusCode, theirs.headers['location']]).toEqual([302, '/app/books']);
    expect(await snapshot()).toBe(before);
    // the books' home offers them the copy, and no way in
    const home = await app.inject({ method: 'GET', url: '/app/books', headers: { cookie: accountant } });
    expect(home.body).toContain('href="/app/books/workbook.xlsx"');
    expect(home.body).not.toContain('action="/app/books/workbook"');
    const mine = await app.inject({ method: 'GET', url: '/app/books', headers: { cookie: owner } });
    expect(mine.body).toContain('action="/app/books/workbook"');
  });
});
