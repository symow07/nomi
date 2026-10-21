import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { sql } from 'kysely';
import { asTenant, purgeBusinesses, type Q } from './books-db.js';
import { odooFake } from '../books-connectors/odoo-fake.js';
import { SAMPLE_WITH_FIELDS } from '../books-connectors/sample.js';
import type { BooksData } from '../../src/core/books/interchange.js';

/**
 * D7 (Phase 5, item 9) — the done-criterion (PHASE-5.md §4): custom fields "survive export, import and every
 * connector's round trip". The owner defines them on their page (an accountant sees them, and the database refuses
 * them a change); the entry and party forms take their values, checked as the database checks them; and the books
 * with fields and values go out through the workbook, Google Sheets' sheets and Odoo, and come back the same — into a
 * workspace of their own, and into the same one, where nothing is new.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `d7d70000-0000-4000-8000-${RUN}0001`;
const BY_EXCEL = `d7d70000-0000-4000-8000-${RUN}0002`;
const BY_SHEETS = `d7d70000-0000-4000-8000-${RUN}0003`;
const BY_ODOO = `d7d70000-0000-4000-8000-${RUN}0004`;
const AFTER_RETIRING = `d7d70000-0000-4000-8000-${RUN}0005`;
const ALL = [BIZ, BY_EXCEL, BY_SHEETS, BY_ODOO, AFTER_RETIRING];
const CODE = `fields-owner-${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';

/** What a round trip must keep: the fields, and every value where it is — by party code, by entry label. */
const custom = (b: BooksData) => ({
  fields: b.fields ?? [],
  parties: b.parties.map((p) => [p.code, p.custom ?? null]),
  entries: [...b.entries].sort((x, y) => x.label.localeCompare(y.label)).map((e) => [e.label, e.custom ?? null, e.lines.map((l) => l.custom ?? null)]),
});

d('D7 · custom fields, defined, filled in, and through every road (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let tenant: pg.Client;
  let owner = '';
  let accountant = '';
  let accountantId = '';
  const as = <T>(fn: (q: Q) => Promise<T>, biz = BIZ) => asTenant(tenant, biz, fn);
  const cookiesOf = (r: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!);
  const session = (r: { headers: Record<string, unknown> }) => cookiesOf(r).find((c) => c.startsWith('yf_session=')) ?? '';
  const notice = async (r: { headers: Record<string, unknown> }, who = owner) =>
    (await app.inject({ method: 'GET', url: String(r.headers['location']).split('#')[0]!, headers: { cookie: `${who}; ${cookiesOf(r).join('; ')}` } })).body;
  const form = (url: string, fields: Record<string, string>, who = owner) => app.inject({ method: 'POST', url,
    payload: new URLSearchParams(fields).toString(), headers: { cookie: who, 'content-type': 'application/x-www-form-urlencoded' } });
  const books = async (biz: string) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { readBooks } = await import('../../src/db/booksInterchange.js');
    return withTenantTx(db, biz as never, (tx) => readBooks(tx, biz));
  };
  const readIn = async (biz: string, system: 'excel' | 'sheets' | 'odoo', r: { data: BooksData; where: import('../../src/core/books/connector.js').Located }) => {
    const { readInBooks } = await import('../../src/db/booksInterchange.js');
    return readInBooks(db, biz as never, 'owner', system, r.data, r.where);
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    tenant = new pg.Client({ connectionString: DATABASE_URL }); await tenant.connect();
    for (const [i, biz] of ALL.entries()) {
      await admin.query(`insert into businesses (id, name, engine, country, currency, books_area) values ($1, $2, 'service', 'MA', 'MAD', true)`, [biz, `Fields ${RUN} ${i}`]);
      await as((q) => q(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2026-01-01', '2026-12-31')`), biz);
    }
    // Odoo gives its taxes no start date: the owner confirmed the day for this one (C0).
    await admin.query(`insert into tax_start_dates (business_id, system, code, valid_from, confirmed_by) values ($1, 'odoo', 'ODOO-1', '2026-01-01', 'owner')`, [BY_ODOO]);
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { addPerson } = await import('../../src/api/web/people.js');
    db = createDb(DATABASE_URL!);
    // The books, with their fields and values, read into the first workspace (its entries as drafts, as any read-in).
    const read = await readIn(BIZ, 'excel', { data: SAMPLE_WITH_FIELDS, where: () => ({ sheet: '', row: 0 }) });
    expect(read).toMatchObject({ kind: 'applied' });
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET, factsTtlMs: 0,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {}, publicBaseUrl: 'https://app.example',
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const login = (code: string) => app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    owner = session(await login(CODE));
    const acct = await addPerson(db, BIZ, SECRET, `Accountant ${RUN}`, 'accountant');
    if (acct.code !== 'added') throw new Error('fixture');
    accountant = session(await login(acct.accessCode));
    accountantId = (await admin.query(`select id::text as id from people where business_id = $1 and kind = 'accountant'`, [BIZ])).rows[0].id;
  });
  afterAll(async () => { await app?.close(); await db?.destroy(); await tenant?.end(); await purgeBusinesses(admin, ALL, 'books-custom-fields-test'); await admin?.end(); });

  it('THE PAGE: the owner adds, retires and uses again; only a party field is required; the accountant sees and changes nothing', async () => {
    const page = await app.inject({ method: 'GET', url: '/app/books/fields', headers: { cookie: owner } });
    expect(page.statusCode).toBe(200);
    for (const label of ['Project', 'Weight (kg)', 'Segment', 'Customer since']) expect(page.body).toContain(label);
    expect(await notice(await form('/app/books/fields', { appliesTo: 'entry', key: 'site', label: 'Site', kind: 'choice', choices: 'Casablanca\nTanger' })))
      .toContain('Field added.');
    // a required field on a line: refused, with the reason — Nomi's own entries could never fill it in
    expect(await notice(await form('/app/books/fields', { appliesTo: 'line', key: 'batch', label: 'Batch', kind: 'text', required: '1' })))
      .toContain("Only a party's field can be required");
    expect(await notice(await form('/app/books/fields', { appliesTo: 'entry', key: 'site', label: 'Site again', kind: 'text' }))).toContain('already there');
    const site = await as(async (q) => (await q(`select id::text as id from custom_field_defs where key = 'site'`)).rows[0].id as string);
    expect(await notice(await form(`/app/books/fields/${site}/retire`, {}))).toContain('Field retired.');
    expect((await app.inject({ method: 'GET', url: '/app/books/fields', headers: { cookie: owner } })).body).toContain('Retired');
    expect(await notice(await form(`/app/books/fields/${site}/use`, {}))).toContain('Field in use again.');
    // the accountant: the list, and no form; a post is refused at the route, and at the database
    const seen = await app.inject({ method: 'GET', url: '/app/books/fields', headers: { cookie: accountant } });
    expect(seen.statusCode).toBe(200);
    expect(seen.body).toContain('Segment');
    expect(seen.body).not.toContain('action="/app/books/fields"');
    const before = (await admin.query(`select count(*)::int as n from custom_field_defs where business_id = $1`, [BIZ])).rows[0].n;
    expect((await form('/app/books/fields', { appliesTo: 'entry', key: 'theirs', label: 'Theirs', kind: 'text' }, accountant)).statusCode).toBe(302);
    expect((await form(`/app/books/fields/${site}/retire`, {}, accountant)).statusCode).toBe(302);
    const { withTenantTx } = await import('../../src/db/client.js');
    const { asViewer } = await import('../../src/db/viewer.js');
    await expect(asViewer(accountantId, () => withTenantTx(db, BIZ as never, (tx) =>
      sql`insert into custom_field_defs (business_id, applies_to, key, label, kind) values (${BIZ}::uuid, 'entry', 'theirs', 'Theirs', 'text')`.execute(tx))))
      .rejects.toThrow(/an accountant sees and exports the books; this is the owner's/);
    expect((await admin.query(`select count(*)::int as n from custom_field_defs where business_id = $1`, [BIZ])).rows[0].n).toBe(before);
    expect((await admin.query(`select is_active from custom_field_defs where id = $1`, [site])).rows[0].is_active).toBe(true);
  });

  it('THE FORMS: an entry and its lines, and a party, take their values — checked, named by the field, shown where they are', async () => {
    const blank = await app.inject({ method: 'GET', url: '/app/books/entries/new', headers: { cookie: owner } });
    for (const name of ['cf_entry_project', 'cf_entry_site', 'cf_line0_weight_kg', 'cf_line7_weight_kg']) expect(blank.body).toContain(`name="${name}"`);
    const id = (table: string, code: string) => as(async (q) => (await q(`select id::text as id from ${table} where code = $1`, [code])).rows[0].id as string);
    const entry = { journal: await id('journals', 'VE'), date: '2026-05-04', label: `Salon ${RUN}`,
      account0: await id('accounts', '3421'), debit0: '500', account1: await id('accounts', '7111'), credit1: '500',
      cf_entry_project: 'Salon de Rabat', cf_entry_site: 'Tanger', cf_line1_weight_kg: '3,5' };
    const wrong = await form('/app/books/entries', entry);
    expect(wrong.statusCode).toBe(422);
    expect(wrong.body).toContain('Weight (kg) 2: this is not what the field takes.');
    expect((await form('/app/books/entries', { ...entry, cf_entry_site: 'Fès', cf_line1_weight_kg: '3.5' })).body).toContain('Site: this is not what the field takes.');
    const made = await form('/app/books/entries', { ...entry, cf_line1_weight_kg: '3.5' });
    expect(made.statusCode).toBe(303);
    const row = await as(async (q) => (await q(`select e.custom as entry, (select json_agg(l.custom order by l.line_no) from journal_lines l where l.entry_id = e.id) as lines
      from journal_entries e where e.label = $1`, [`Salon ${RUN}`])).rows[0]);
    expect(row).toEqual({ entry: { project: 'Salon de Rabat', site: 'Tanger' }, lines: [{}, { weight_kg: '3.5' }] });
    const shown = (await app.inject({ method: 'GET', url: String(made.headers['location']), headers: { cookie: owner } })).body;
    expect(shown).toContain('<bdi>Project</bdi>: <bdi>Salon de Rabat</bdi>');
    expect(shown).toContain('<bdi>Weight (kg)</bdi>: <bdi>3.5</bdi>');
    // a party: the required segment, and a date
    const invoice = await app.inject({ method: 'GET', url: '/app/books/invoices/new', headers: { cookie: owner } });
    expect(invoice.body).toContain('name="cf_party_segment"');
    expect(invoice.body).toMatch(/<select name="cf_party_segment" aria-label="Segment" required>/);
    const party = { code: `C9${RUN.slice(0, 3)}`, name: 'Souk Sacs', cf_party_since: '2025-11-30' };
    expect(await notice(await form('/app/books/parties', party))).toContain('That customer could not be added: Segment needs a value.');
    expect(await notice(await form('/app/books/parties', { ...party, cf_party_segment: 'retail' }))).toContain('added');
    expect((await as((q) => q(`select custom from parties where code = $1`, [party.code]))).rows[0].custom).toEqual({ segment: 'retail', since: '2025-11-30' });
  });

  it('THE OWNER\'S COPY: each line carries its entry\'s and its own values, as one exact column', async () => {
    const { makeBooksFile } = await import('../../src/db/booksExport.js');
    await as((q) => q(`update journal_entries set state = 'posted', posted_by = 'owner', document_ref = coalesce(document_ref, 'S-1'), document_date = entry_date
      where label = $1`, [`Salon ${RUN}`]));
    const { RFC4180 } = await import('../../src/core/owner/csv.js');
    const file = await makeBooksFile(db, BIZ, 'owner', RFC4180);
    const line = file!.csv.split(/\r?\n/).find((l) => l.includes('3.5'))!;
    expect(line).toContain('"{""entry.project"":""Salon de Rabat"",""entry.site"":""Tanger"",""line.weight_kg"":""3.5""}"');
  });

  it('EXPORT AND IMPORT: the workbook, and Sheets\' sheets, out of one workspace and into another — the same fields, the same values', async () => {
    const { excelConnector } = await import('../../src/books/connectors/excel.js');
    const { sheetsConnector } = await import('../../src/books/connectors/sheets.js');
    const mine = await books(BIZ);
    expect(mine.fields?.map((f) => `${f.appliesTo}.${f.key}`)).toEqual(['entry.project', 'entry.site', 'line.weight_kg', 'party.segment', 'party.since']);
    // the workbook, by its own route
    const file = await app.inject({ method: 'GET', url: '/app/books/workbook.xlsx', headers: { cookie: owner } });
    expect(file.statusCode).toBe(200);
    const excel = excelConnector('MAD');
    const fromFile = excel.toBooks(file.rawPayload);
    expect(fromFile.problems).toEqual([]);
    expect(await readIn(BY_EXCEL, 'excel', fromFile)).toMatchObject({ kind: 'applied' });
    expect(custom(await books(BY_EXCEL))).toEqual(custom(mine));
    // Google Sheets' sheets (the same reading as the file's, arrived by another road)
    const sheets = sheetsConnector({} as never, 'MAD');
    const fromSheets = sheets.toBooks(sheets.fromBooks(mine));
    expect(fromSheets.problems).toEqual([]);
    expect(await readIn(BY_SHEETS, 'sheets', fromSheets)).toMatchObject({ kind: 'applied' });
    expect(custom(await books(BY_SHEETS))).toEqual(custom(mine));
    // and back into the same workspace: nothing is new, nothing differs
    expect(await readIn(BIZ, 'excel', excel.toBooks(file.rawPayload))).toMatchObject({ kind: 'applied', added: 0, replaced: 0 });
    expect(custom(await books(BIZ))).toEqual(custom(mine));
    // a field the owner retired is not brought back from outside: theirs to use again, here
    await as((q) => q(`update custom_field_defs set is_active = false where key = 'site'`));
    // the same workbook again says nothing new (B5): nothing changes; another source with the field in use is refused
    expect(await readIn(BIZ, 'excel', excel.toBooks(file.rawPayload))).toMatchObject({ kind: 'applied', added: 0, replaced: 0 });
    const back = await readIn(BIZ, 'sheets', sheets.toBooks(sheets.fromBooks(mine)));
    expect(back.kind === 'refused' && back.problems.map((p) => `${p.reason} ${p.column}`)).toEqual(['differs_from_nomi Code']);
    expect((await admin.query(`select is_active from custom_field_defs where business_id = $1 and key = 'site'`, [BIZ])).rows[0].is_active).toBe(false);
    // the books as they are now — the retired field with them, and the value written under it — read back as they are
    const now = await app.inject({ method: 'GET', url: '/app/books/workbook.xlsx', headers: { cookie: owner } });
    expect(await readIn(BIZ, 'excel', excel.toBooks(now.rawPayload))).toMatchObject({ kind: 'applied', added: 0, replaced: 0 });
    const retired = await books(BIZ);
    expect(await readIn(AFTER_RETIRING, 'excel', excel.toBooks(now.rawPayload))).toMatchObject({ kind: 'applied' });
    expect(custom(await books(AFTER_RETIRING))).toEqual(custom(retired));
    expect((await books(AFTER_RETIRING)).fields?.find((f) => f.key === 'site')).toMatchObject({ retired: true });
    // and a NEW row with a value under it is refused, by that field
    const fresh = excel.toBooks(now.rawPayload).data;
    const salon = fresh.entries.find((e) => e.label === `Salon ${RUN}`)!;
    const again = await readIn(BIZ, 'excel', { data: { ...fresh, entries: [...fresh.entries, { ...salon, key: `row-${RUN}`, state: 'draft' }] }, where: () => ({ sheet: '', row: 0 }) });
    expect(again.kind === 'refused' && again.problems.map((p) => `${p.reason} ${p.column}`)).toEqual(['retired_field entry.site']);
    await as((q) => q(`update custom_field_defs set is_active = true where key = 'site'`));
  });

  it('ODOO: the values travel in Nomi\'s mark through Odoo\'s HTML notes and labels; the fields stay Nomi\'s, and must be there', async () => {
    const { odooConnector } = await import('../../src/books/connectors/odoo.js');
    const { addField } = await import('../../src/db/booksFields.js');
    const { withTenantTx } = await import('../../src/db/client.js');
    const mine = await books(BIZ);
    const odoo = odooFake();
    odoo.publish(mine);
    const c = odooConnector(odoo.post, 'MAD', () => '2026-10-22');
    const connected = await c.connect({ url: 'https://shop.odoo.com', database: 'shop-db', key: 'good-key', expires: '2027-01-15' });
    if (connected.kind !== 'connected') throw new Error('fixture');
    const read = await c.changedSince(connected.source, null);
    if (read.kind !== 'read') throw new Error('fixture');
    expect(read.data.fields).toBeUndefined();
    // a workspace without the fields: the values are refused, by their field — nothing is read in
    const refused = await readIn(BY_ODOO, 'odoo', read);
    expect(refused.kind).toBe('refused');
    expect(refused.kind === 'refused' && refused.problems.some((p) => p.reason === 'unknown_field' && p.column === 'party.segment')).toBe(true);
    expect((await admin.query(`select count(*)::int as n from parties where business_id = $1`, [BY_ODOO])).rows[0].n).toBe(0);
    // with Nomi's fields defined there, the same read brings every value
    await withTenantTx(db, BY_ODOO as never, async (tx) => { for (const f of mine.fields ?? []) await addField(tx, BY_ODOO, f); });
    const applied = await readIn(BY_ODOO, 'odoo', read);
    expect(applied.kind, JSON.stringify(applied)).toBe('applied');
    const theirs = custom(await books(BY_ODOO));
    expect(theirs.parties).toEqual(custom(mine).parties);
    // an entry's label in Odoo is its own reference when Nomi had none: compare the values, entry by entry
    expect(theirs.entries.map(([, e, l]) => [e, l]).sort()).toEqual(custom(mine).entries.map(([, e, l]) => [e, l]).sort());
  });
});
