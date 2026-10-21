import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { asTenant, purgeBusinesses, type Q } from './books-db.js';
import { googleFake } from '../books-connectors/google-fake.js';
import { odooFake } from '../books-connectors/odoo-fake.js';
import { SAMPLE_BOOKS } from '../books-connectors/sample.js';

/**
 * C4 (Phase 5; item 13, part 2) — the done-criterion (PHASE-5.md §4): writing back to Sheets and Odoo, conflicts
 * shown and never overwritten silently. Through the real routes, against the recorded fakes; live on deploy day.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `c4c40000-0000-4000-8000-${RUN}0001`;
const HOST = `write-${RUN}.odoo.com`;
const CODE = `write-owner-${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const KEY = randomBytes(32);

d('C4 · writing back, never over anything (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let tenant: pg.Client;
  let owner = '';
  let accountant = '';
  let sheet = '';
  const google = googleFake();
  const odoo = odooFake(HOST);
  const as = <T>(fn: (q: Q) => Promise<T>) => asTenant(tenant, BIZ, fn);
  const cookiesOf = (r: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!);
  const session = (r: { headers: Record<string, unknown> }) => cookiesOf(r).find((c) => c.startsWith('yf_session=')) ?? '';
  const notice = async (r: { headers: Record<string, unknown> }) => {
    const to = String(r.headers['location']).split('#')[0]!;
    return (await app.inject({ method: 'GET', url: to, headers: { cookie: `${owner}; ${cookiesOf(r).join('; ')}` } })).body;
  };
  const press = (url: string, who = owner) => app.inject({ method: 'POST', url, headers: { cookie: who } });
  const entryKeys = () => google.rows(sheet, 'Journal').slice(1).map((r) => String(r[0]));
  /** An entry of Nomi's own, posted by the owner; its number back. */
  const postEntry = (journal: string, label: string, lines: [string, string | null, string, string][]) => as(async (q) => {
    const one = async (s: string, v: unknown[] = []) => (await q(s, v)).rows[0];
    const j = (await one(`select id::text as id from journals where code = $1`, [journal])).id;
    const fy = (await one(`select id::text as id from fiscal_years limit 1`)).id;
    const e = (await one(`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by)
      values (current_business_id(), $1, $2, '2026-04-20', $3, 'owner') returning id::text as id`, [j, fy, label])).id;
    let n = 0;
    for (const [account, party, dr, cr] of lines) {
      await q(`insert into journal_lines (business_id, entry_id, line_no, account_id, party_id, currency, debit, credit)
        values (current_business_id(), $1, $2, (select id from accounts where code = $3), (select id from parties where code = $4), 'MAD', $5, $6)`, [e, ++n, account, party, dr, cr]);
    }
    await q(`update journal_entries set state = 'posted', posted_by = 'owner', document_ref = $2, document_date = entry_date where id = $1`, [e, label]);
    return (await one(`select j.code || '-' || extract(year from f.starts_on)::int || '-' || e.number as key
      from journal_entries e join journals j on j.id = e.journal_id join fiscal_years f on f.id = e.fiscal_year_id where e.id = $1`, [e])).key as string;
  });
  const entryCount = () => as(async (q) => (await q(`select count(*)::int as n from journal_entries where state <> 'discarded'`)).rows[0].n as number);

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    tenant = new pg.Client({ connectionString: DATABASE_URL }); await tenant.connect();
    await admin.query(`insert into businesses (id, name, engine, country, currency, books_area) values ($1, $2, 'service', 'MA', 'MAD', true)`, [BIZ, `Write ${RUN}`]);
    await as((q) => q(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2026-01-01', '2026-12-31')`));
    // The shop's Odoo holds the sample books; read in once, they give Nomi its chart, journals and partners.
    await admin.query(`insert into tax_start_dates (business_id, system, code, valid_from, confirmed_by) values ($1, 'odoo', 'ODOO-1', '2026-01-01', 'owner')`, [BIZ]);
    odoo.publish(SAMPLE_BOOKS);
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { saveConnection } = await import('../../src/db/booksConnections.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { addPerson } = await import('../../src/api/web/people.js');
    db = createDb(DATABASE_URL!);
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    await withTenantTx(db, bid.value, (tx) => saveConnection(tx, KEY, { businessId: BIZ, system: 'odoo', secret: 'good-key', by: 'owner',
      settings: { url: `https://${HOST}`, database: 'shop-db' }, keyExpiresOn: new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10) }));
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET, factsTtlMs: 0,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
      publicBaseUrl: 'https://app.example', credentialKey: KEY, oauthFetch: google.fetch, odooPost: odoo.post,
      sheetsClient: { clientId: 'nomi-test.apps.googleusercontent.com', clientSecret: 'test-secret' },
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const login = (code: string) => app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    owner = session(await login(CODE));
    const acct = await addPerson(db, BIZ, SECRET, `Accountant ${RUN}`, 'accountant');
    if (acct.code !== 'added') throw new Error('fixture');
    accountant = session(await login(acct.accessCode));
    expect(await notice(await press('/app/books/odoo/read'))).toContain('Read in');
    // Google Sheets, connected: a new spreadsheet holding the books.
    const start = await app.inject({ method: 'GET', url: '/app/books/sheets/start', headers: { cookie: owner } });
    const nonce = new URL(String(start.headers['location'])).searchParams.get('state')!;
    const state = cookiesOf(start).find((c) => c.startsWith('yf_sheets_oauth='))!;
    await app.inject({ method: 'GET', url: `/app/books/sheets/callback?code=good-code&state=${encodeURIComponent(nonce)}`, headers: { cookie: `${owner}; ${state}` } });
    sheet = (await as((q) => q(`select settings from books_connections where system = 'sheets'`))).rows[0].settings.spreadsheetId as string;
  });
  afterAll(async () => { await app?.close(); await db?.destroy(); await tenant?.end(); await purgeBusinesses(admin, [BIZ], 'books-write-back-test'); await admin?.end(); });

  it('SHEETS: with nothing unread there, the books are written — the posted entry arrives, and the next read sees nothing new', async () => {
    const key = await postEntry('VE', `Vente comptoir ${RUN}`, [['3421', 'C001', '120', '0'], ['7111', null, '0', '120']]);
    expect(entryKeys()).not.toContain(key);
    expect(await notice(await press('/app/books/sheets/write'))).toMatch(/Written: \d+\./);
    expect(entryKeys()).toContain(key);
    expect(await notice(await press('/app/books/sheets/read'))).toContain('0 new');
    // a draft the spreadsheet holds is posted here (its row now goes by its number): written again, still no conflict —
    // what Nomi wrote is remembered, and the draft's old row is Nomi's own, not a row the owner deleted
    const draft = await as(async (q) => (await q(`select id::text as id from journal_entries where state = 'draft' and label = 'Bon de livraison 311'`)).rows[0].id as string);
    expect(entryKeys()).toContain(`draft-${draft}`);
    await as((q) => q(`update journal_entries set state = 'posted', posted_by = 'owner', document_date = entry_date where id = $1`, [draft]));
    expect(await notice(await press('/app/books/sheets/write'))).toMatch(/Written: \d+\./);
    expect(entryKeys()).not.toContain(`draft-${draft}`);
    expect(await notice(await press('/app/books/sheets/write'))).toMatch(/Written: \d+\./);   // and again: the old row is not "removed"
  });

  it('SHEETS: an edit the owner made there is a CONFLICT — shown, and nothing is written over it', async () => {
    const rows = google.rows(sheet, 'Parties').length;
    google.type(sheet, 'Parties', rows + 1, 1, 'C009'); google.type(sheet, 'Parties', rows + 1, 2, 'Souk Sacs'); google.type(sheet, 'Parties', rows + 1, 3, 'customer');
    const clears = google.calls.filter((c) => c.endsWith('values:batchClear')).length;
    await postEntry('VE', `Vente du soir ${RUN}`, [['3421', 'C001', '60', '0'], ['7111', null, '0', '60']]);
    const r = await press('/app/books/sheets/write');
    expect(r.statusCode).toBe(409);
    expect(r.body).toContain('Nothing was written over');
    expect(r.body).toContain('Party C009: changed in the spreadsheet');
    expect(google.calls.filter((c) => c.endsWith('values:batchClear')).length).toBe(clears);
    expect(google.rows(sheet, 'Parties').map((x) => x[0])).toContain('C009');
  });

  it('SHEETS: a row the owner deleted there is a conflict too — writing would have put it back', async () => {
    expect(await notice(await press('/app/books/sheets/read'))).toContain('Read in');   // C009 read in: that edit is settled
    const at = google.rows(sheet, 'Accounts').findIndex((x) => x[0] === '6111');
    google.deleteRow(sheet, 'Accounts', at + 1);
    const r = await press('/app/books/sheets/write');
    expect(r.statusCode).toBe(409);
    expect(r.body).toContain('Account 6111: removed from the spreadsheet');
    expect(r.body).not.toContain('C009');
  });

  it('ODOO: each posted entry of Nomi\'s own is created and posted there once — never one that came from Odoo, never twice', async () => {
    const before = odoo.created.length;
    const r = await press('/app/books/odoo/write');
    expect(await notice(r)).toContain('Written: 2.');           // the two sales posted above; the three read from Odoo stay put
    const mine = odoo.created.slice(before);
    expect(mine.map((m) => m.vals['ref'])).toEqual([expect.stringMatching(/^VE-2026-\d+$/), expect.stringMatching(/^VE-2026-\d+$/)]);
    expect(mine[0]!.vals['line_ids']).toEqual([
      [0, 0, { account_id: 1, partner_id: 1, name: `Vente comptoir ${RUN}`, debit: 120, credit: 0 }],
      [0, 0, { account_id: 7, partner_id: false, name: `Vente comptoir ${RUN}`, debit: 0, credit: 120 }],
    ]);
    expect(await notice(await press('/app/books/odoo/write'))).toContain('Written: 0.');
    expect(odoo.created.length).toBe(before + 2);
  });

  it('ODOO: the next read does not bring Nomi\'s own moves back as new entries', async () => {
    const n = await entryCount();
    expect(await notice(await press('/app/books/odoo/read'))).toContain('Read in');
    expect(await entryCount()).toBe(n);
  });

  it('ODOO: what Odoo already holds, or an account it lacks, is a CONFLICT — named, and nothing is created for it', async () => {
    await as((q) => q(`insert into accounts (business_id, code, name, kind) values (current_business_id(), '4457', 'TVA due', 'liability')`));
    const lacking = await postEntry('VE', `Régularisation ${RUN}`, [['3421', null, '10', '0'], ['4457', null, '0', '10']]);
    const held = await postEntry('BQ', `Remise ${RUN}`, [['5141', null, '75', '0'], ['3421', null, '0', '75']]);
    // the owner had already keyed this one in Odoo, under Nomi's number
    odoo.publish({ ...SAMPLE_BOOKS, entries: [...SAMPLE_BOOKS.entries, { ...SAMPLE_BOOKS.entries[1]!, key: 'AC-2026-77', label: held, state: 'posted' }] });
    const before = odoo.created.length;
    const r = await press('/app/books/odoo/write');
    expect(r.statusCode).toBe(409);
    expect(r.body).toContain(`${lacking}: account 4457 is not in Odoo.`);
    expect(r.body).toContain(`${held}: Odoo already holds an entry with this reference.`);
    expect(r.body).toContain('Sent to Odoo: 0.');
    expect(odoo.created.length).toBe(before);
  });

  it('the accountant writes nothing, anywhere', async () => {
    for (const url of ['/app/books/sheets/write', '/app/books/odoo/write']) {
      const tried = await press(url, accountant);
      expect([tried.statusCode, tried.headers['location']]).toEqual([302, '/app/books']);
    }
    expect((await app.inject({ method: 'GET', url: '/app/books', headers: { cookie: accountant } })).body).not.toContain('/write"');
  });
});
