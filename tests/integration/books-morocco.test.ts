import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { asTenant, purgeBusinesses, type Q } from './books-db.js';

/**
 * D4 (Phase 5, item 10) — the done-criterion (PHASE-5.md §4): the CGNC chart for a shop, from the CNC's own text,
 * added without touching what the owner has; the Moroccan FEC of a fiscal year with Avis 24's eighteen fields, its
 * numbering checked, an account off the CGNC's numbering named. Through the routes.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `d4d40000-0000-4000-8000-${RUN}0001`;
const CODE = `morocco-owner-${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';

d('D4 · Morocco: the CGNC chart and the FEC (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let tenant: pg.Client;
  let owner = '';
  let accountant = '';
  let staff = '';
  let year = '';
  const as = <T>(fn: (q: Q) => Promise<T>) => asTenant(tenant, BIZ, fn);
  const session = (r: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=')) ?? '';
  const notice = async (r: { headers: Record<string, unknown> }) => {
    const set = ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).join('; ');
    return (await app.inject({ method: 'GET', url: String(r.headers['location']).split('#')[0]!, headers: { cookie: `${owner}; ${set}` } })).body;
  };
  const post = (url: string, who = owner) => app.inject({ method: 'POST', url, payload: '', headers: { cookie: who, 'content-type': 'application/x-www-form-urlencoded' } });

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    tenant = new pg.Client({ connectionString: DATABASE_URL }); await tenant.connect();
    await admin.query(`insert into businesses (id, name, engine, country, currency, books_area) values ($1, $2, 'service', 'MA', 'MAD', true)`, [BIZ, `Morocco ${RUN}`]);
    year = await as(async (q) => {
      // the owner's own account under a CGNC code, named their way: the chart must leave it as it is
      await q(`insert into accounts (business_id, code, name, kind) values (current_business_id(), '5141', 'Banque Populaire', 'asset')`);
      return (await q(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2026-01-01', '2026-12-31') returning id::text as id`)).rows[0].id as string;
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
    const team = await addPerson(db, BIZ, SECRET, `Staff ${RUN}`, 'team');
    if (team.code !== 'added') throw new Error('fixture');
    staff = session(await login(team.accessCode));
  });
  afterAll(async () => { await app?.close(); await db?.destroy(); await tenant?.end(); await purgeBusinesses(admin, [BIZ], 'books-morocco-test'); await admin?.end(); });

  it('THE CGNC CHART: 870 accounts added (the owner\'s 5141 kept as named), seven journals (0216: AN, for the opening entry), the accounts Nomi drafts with chosen; again, nothing', async () => {
    expect(await notice(await post('/app/books/chart/cgnc'))).toContain('Added: 870 accounts and 7 journals.');
    expect((await as((q) => q(`select name, kind from journals where code = 'AN'`))).rows[0]).toEqual({ name: 'À-nouveaux', kind: 'opening' });
    const n = (await as((q) => q(`select count(*)::int as n from accounts`))).rows[0].n;
    expect(n).toBe(871);
    expect((await as((q) => q(`select name from accounts where code = '5141'`))).rows[0].name).toBe('Banque Populaire');
    expect((await as((q) => q(`select p.code from accounts a join accounts p on p.id = a.parent_id where a.code = '3421'`))).rows[0].code).toBe('342');
    const chosen = (await as((q) => q(`select j.code as journal, r.code as receivable, s.code as sales, l.code as loss, g.code as gain from books_settings b
      join journals j on j.id = b.sales_journal_id join accounts r on r.id = b.receivable_account_id join accounts s on s.id = b.sales_account_id
      join accounts l on l.id = b.fx_loss_account_id join accounts g on g.id = b.fx_gain_account_id`))).rows[0];
    expect(chosen).toEqual({ journal: 'VE', receivable: '3421', sales: '7111', loss: '6331', gain: '7331' });
    expect(await notice(await post('/app/books/chart/cgnc'))).toContain('Added: 0 accounts and 0 journals.');
    // the accountant does not start a chart
    const tried = await post('/app/books/chart/cgnc', accountant);
    expect([tried.statusCode, tried.headers['location']]).toEqual([302, '/app/books']);
  });

  it('THE FEC: the year\'s posted entries with Avis 24\'s eighteen fields; the numbering checked; an account off the CGNC\'s numbering named', async () => {
    await as(async (q) => {
      const id = async (t: string, code: string) => (await q(`select id::text as id from ${t} where code = $1`, [code])).rows[0].id as string;
      await q(`insert into accounts (business_id, code, name, kind) values (current_business_id(), 'X100', 'Compte maison', 'asset')`);
      await q(`insert into owner_rates (business_id, from_currency, to_currency, rate, stated_at) values (current_business_id(), 'EUR', 'MAD', 10.8, '2026-03-01T09:00:00Z')`);
      const entry = async (journal: string, day: string, ref: string, lines: [string, string, string, string][]) => {
        const e = (await q(`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by) values (current_business_id(), $1, $2, $3, $4, 'owner') returning id::text as id`,
          [await id('journals', journal), year, day, `Pièce ${ref}`])).rows[0].id as string;
        let n = 0;
        for (const [a, cur, dr, cr] of lines) await q(`insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, credit) values (current_business_id(), $1, $2, $3, $4, $5, $6)`,
          [e, ++n, await id('accounts', a), cur, dr, cr]);
        await q(`update journal_entries set state = 'posted', posted_by = 'owner', document_ref = $2, document_date = entry_date where id = $1`, [e, ref]);
      };
      await entry('VE', '2026-03-02', 'F-2026-0001', [['3421', 'MAD', '1200', '0'], ['7111', 'MAD', '0', '1000'], ['4455', 'MAD', '0', '200']]);
      await entry('VE', '2026-03-09', 'F-2026-0002', [['3421', 'EUR', '100', '0'], ['7113', 'EUR', '0', '100']]);
      await entry('BQ', '2026-03-20', 'REL-03', [['5141', 'MAD', '1200', '0'], ['3421', 'MAD', '0', '1200']]);
      await entry('OD', '2026-03-31', 'OD-1', [['X100', 'MAD', '5', '0'], ['5141', 'MAD', '0', '5']]);
    });
    const page = (await app.inject({ method: 'GET', url: '/app/books/fec', headers: { cookie: owner } })).body;
    expect(page).toContain('Numbering checked: in each journal, no gap and no repeat.');
    expect(page).toContain('Compte maison');
    expect(page).toContain('The year is still open');
    expect(page).toContain('The FEC of this year (9 lines)');
    const r = await app.inject({ method: 'GET', url: `/app/books/fec/${year}.txt`, headers: { cookie: owner } });
    expect(r.statusCode).toBe(200);
    expect(String(r.headers['content-disposition'])).toContain('FEC20261231.txt');
    const lines = r.body.split('\r\n').filter(Boolean).map((l) => l.split('|'));
    expect(lines[0]).toEqual(['Code_Journal', 'Libelle_Journal', 'Num_Ecriture', 'Date_Ecriture', 'Num_Compte', 'Libelle_Compte', 'Num_Compte_Aux',
      'Libelle_Compte_Aux', 'Ref_Piece', 'Date_Piece', 'Libelle_Ecriture', 'Montant_Debit', 'Montant_Credit', 'Lettrage_Ecriture', 'Date_Lettrage',
      'Date_Validation', 'Montant_Devise', 'Id_devise', 'ICE', 'Identifiant_Fiscal', 'Num_RC', 'Tribunal_RC']);
    expect(lines.length).toBe(10);
    expect(lines.every((l) => l.length === 22)).toBe(true);
    // E2 — none given yet: the four are empty, and the page says what the file goes without
    expect(lines.slice(1).every((l) => l.slice(18).join('') === '')).toBe(true);
    expect(page).toContain('The file goes without: ICE (Identifiant Commun de l’Entreprise) · IF (identifiant fiscal) · RC number (registre du commerce)');
    expect(lines[1]!.slice(0, 13)).toEqual(['VE', 'Ventes', '1', '20260302', '3421', 'Clients', '', '', 'F-2026-0001', '20260302', 'Pièce F-2026-0001', '1200.00', '0.00']);
    // the foreign line: in the books' currency, and its own amount and currency
    const eur = lines.find((l) => l[4] === '7113')!;
    expect([eur[11], eur[12], eur[16], eur[17]]).toEqual(['0.00', '1080.00', '-100.00', 'EUR']);
    // the accountant takes the same file
    expect((await app.inject({ method: 'GET', url: `/app/books/fec/${year}.txt`, headers: { cookie: accountant } })).body).toBe(r.body);
  });

  it('E2 · THE ICE, IF AND RC: given by the owner on the profile, checked only where a source sets a rule, carried on every line of the FEC', async () => {
    const form = (fields: Record<string, string>, who = owner) => app.inject({ method: 'POST', url: '/app/settings/identifiers',
      payload: new URLSearchParams(fields).toString(), headers: { cookie: who, 'content-type': 'application/x-www-form-urlencoded' } });
    const stored = async () => (await admin.query(`select legal_ice, legal_if, legal_rc, legal_rc_court from businesses where id = $1`, [BIZ])).rows[0];
    // shown on the profile, a Moroccan business's, empty
    const profile = (await app.inject({ method: 'GET', url: '/app/settings/profile', headers: { cookie: owner } })).body;
    expect(profile).toContain('id="identifiers"');
    expect(profile).toContain('action="/app/settings/identifiers"');
    // staff see them and change nothing; nor does the accountant
    const seen = (await app.inject({ method: 'GET', url: '/app/settings/profile', headers: { cookie: staff } })).body;
    expect(seen).toContain('id="identifiers"');
    expect(seen).not.toContain('action="/app/settings/identifiers"');
    for (const who of [staff, accountant]) {
      const tried = await form({ ice: '001234567000089', tax_id: '1', rc: '1', rc_court: 'Rabat' }, who);
      expect(tried.statusCode).toBe(302);
    }
    expect(await notice(await form({ ice: '001234567000089', tax_id: '1', rc: '1', rc_court: 'Rabat' }, staff))).toContain('Only the owner');
    expect(await stored()).toEqual({ legal_ice: null, legal_if: null, legal_rc: null, legal_rc_court: null });
    // fourteen positions refused, said under the field, everything typed still there, nothing stored
    const bad = await form({ ice: '00123456700008', tax_id: '40123456', rc: '123456', rc_court: '' });
    expect(bad.statusCode).toBe(422);
    expect(bad.body).toContain('An ICE has 15 positions.');
    expect(bad.body).toContain('Give the court too: an RC number goes with its court.');
    expect(bad.body).toContain('value="00123456700008"');
    expect(bad.body).toContain('value="40123456"');
    expect(await stored()).toEqual({ legal_ice: null, legal_if: null, legal_rc: null, legal_rc_court: null });
    // the database holds the ICE's rule itself
    await expect(admin.query(`update businesses set legal_ice = '0012345670000' where id = $1`, [BIZ])).rejects.toThrow(/businesses_legal_ice_shape/);
    await expect(admin.query(`update businesses set legal_rc = '1' where id = $1`, [BIZ])).rejects.toThrow(/businesses_legal_rc_bound/);
    // saved: spaces out of the ICE, the IF and the RC as typed
    expect(await notice(await form({ ice: '001234567 0000 89', tax_id: ' 40 123 456 ', rc: '123456', rc_court: 'Tribunal de commerce de Casablanca' }))).toContain('Identifiers saved.');
    expect(await stored()).toEqual({ legal_ice: '001234567000089', legal_if: '40 123 456', legal_rc: '123456', legal_rc_court: 'Tribunal de commerce de Casablanca' });
    expect((await app.inject({ method: 'GET', url: '/app/settings/profile', headers: { cookie: staff } })).body).toContain('001234567000089');
    // the FEC carries them on every line, the eighteen untouched; the page no longer says anything is missing
    const r = await app.inject({ method: 'GET', url: `/app/books/fec/${year}.txt`, headers: { cookie: owner } });
    const lines = r.body.split('\r\n').filter(Boolean).map((l) => l.split('|'));
    expect(lines.slice(1).every((l) => l.slice(18).join('|') === '001234567000089|40 123 456|123456|Tribunal de commerce de Casablanca')).toBe(true);
    expect(lines[1]!.slice(0, 13)).toEqual(['VE', 'Ventes', '1', '20260302', '3421', 'Clients', '', '', 'F-2026-0001', '20260302', 'Pièce F-2026-0001', '1200.00', '0.00']);
    expect((await app.inject({ method: 'GET', url: '/app/books/fec', headers: { cookie: owner } })).body).not.toContain('The file goes without');
    // what changed is audited by name, never by value
    const audit = (await admin.query(`select detail from channel_audit where business_id = $1 and action = 'update_profile' order by id desc limit 1`, [BIZ])).rows[0].detail;
    expect(audit).toEqual({ fields: ['legal_ice', 'legal_if', 'legal_rc', 'legal_rc_court'] });
  });

  it('R2 · THE FEC\'S FILE NAME: Nomi\'s default from the ICE and the year\'s end, changed by the owner only, never called required', async () => {
    const name = async () => String((await app.inject({ method: 'GET', url: `/app/books/fec/${year}.txt`, headers: { cookie: owner } })).headers['content-disposition']);
    const set = (pattern: string, who = owner) => app.inject({ method: 'POST', url: '/app/books/fec/filename',
      payload: new URLSearchParams({ pattern }).toString(), headers: { cookie: who, 'content-type': 'application/x-www-form-urlencoded' } });
    const pattern = async () => (await admin.query(`select fec_filename from books_settings where business_id = $1`, [BIZ])).rows[0]?.fec_filename ?? null;
    // the ICE given in E2's test above, and the year's last day
    expect(await name()).toBe('attachment; filename="001234567000089FEC20261231.txt"');
    const fec = (await app.inject({ method: 'GET', url: '/app/books/fec', headers: { cookie: owner } })).body;
    expect(fec).toContain("Nomi's default filename convention. Your accountant may ask for a different one — you can change it here.");
    expect(fec).toContain('001234567000089FEC20261231.txt');
    expect(fec).toContain('action="/app/books/fec/filename"');
    // the block's own words, tags aside (the input's `required` attribute is HTML, not a claim)
    const block = (/<div class="block" id="file-name">[\s\S]*?<\/div>/.exec(fec)?.[0] ?? '').replace(/<[^>]*>/g, ' ');
    expect(block).toContain('default filename convention');
    expect(block).not.toMatch(/required|official|DGI-compliant/i);
    // staff and the accountant read it, change nothing
    const seen = (await app.inject({ method: 'GET', url: '/app/books/fec', headers: { cookie: accountant } })).body;
    expect(seen).not.toContain('action="/app/books/fec/filename"');
    for (const who of [staff, accountant]) await set('{ICE}.txt', who);
    expect(await name()).toBe('attachment; filename="001234567000089FEC20261231.txt"');
    // the owner's own, and a bad one refused with nothing changed
    expect(await notice(await set('FEC_{ICE}_{YYYYMMDD}.txt'))).toContain('File name saved: FEC_{ICE}_{YYYYMMDD}.txt.');
    expect(await name()).toBe('attachment; filename="FEC_001234567000089_20261231.txt"');
    expect(await notice(await set('../{SIREN}.txt'))).toContain('That file name was not saved.');
    expect(await pattern()).toBe('FEC_{ICE}_{YYYYMMDD}.txt');
    await expect(admin.query(`update books_settings set fec_filename = '../x.txt' where business_id = $1`, [BIZ])).rejects.toThrow(/books_settings_fec_filename_shape/);
  });

  it('0208 · ONE RULE FOR THE ICE: a party\'s is fifteen positions, checked as the business\'s, only for a party in Morocco, by the form and the database alike', async () => {
    const party = (fields: Record<string, string>) => app.inject({ method: 'POST', url: '/app/books/parties',
      payload: new URLSearchParams(fields).toString(), headers: { cookie: owner, 'content-type': 'application/x-www-form-urlencoded' } });
    const iceOf = async (code: string) => (await admin.query(`select ice from parties where business_id = $1 and code = $2`, [BIZ, code])).rows[0]?.ice ?? null;
    // the database says the two rules in the same words
    const rule = async (table: string, name: string) => (await admin.query(`select pg_get_constraintdef(oid) as d from pg_constraint
      where conrelid = $1::regclass and conname = $2`, [table, name])).rows[0]?.d as string;
    expect(await rule('parties', 'parties_ice_shape')).toBe((await rule('businesses', 'businesses_legal_ice_shape')).replaceAll('legal_ice', 'ice'));
    // a position that is not a digit is no longer refused (no official text says digits); spaces as typed come out
    expect(await notice(await party({ code: 'C0208', name: 'Atlas Négoce', country: 'MA', ice: '123456789 00A 057' }))).toContain('The customer is added.');
    expect(await iceOf('C0208')).toBe('12345678900A057');
    // fourteen positions refused, and the refusal says positions, not digits
    const short = await notice(await party({ code: 'C0209', name: 'Short', country: 'MA', ice: '12345678900005' }));
    expect(short).toContain('an ICE of 15 positions');
    expect(await iceOf('C0209')).toBeNull();
    await expect(admin.query(`insert into parties (business_id, kind, code, name, country, ice) values ($1, 'customer', 'C0210', 'Spaced', 'MA', '12345678900005 ')`, [BIZ]))
      .rejects.toThrow(/parties_ice_shape/);
    await expect(admin.query(`insert into parties (business_id, kind, code, name, country, ice) values ($1, 'customer', 'C0211', 'Long', 'MA', '1234567890000571')`, [BIZ]))
      .rejects.toThrow(/parties_ice_shape/);
    // only a party in Morocco has an ICE: a Spanish company's fifteen characters are refused by the form and the database
    const spanish = await notice(await party({ code: 'C0212', name: 'Textiles Ibéricos SL', country: 'ES', ice: 'B12345678901234' }));
    expect(spanish).toContain('only for a customer in Morocco (MA)');
    expect(await iceOf('C0212')).toBeNull();
    expect(await notice(await party({ code: 'C0213', name: 'Textiles Ibéricos SL', country: 'ES' }))).toContain('The customer is added.');
    await expect(admin.query(`insert into parties (business_id, kind, code, name, country, ice) values ($1, 'customer', 'C0214', 'Spain', 'ES', '123456789000057')`, [BIZ]))
      .rejects.toThrow(/parties_ice_morocco/);
    await expect(admin.query(`insert into parties (business_id, kind, code, name, ice) values ($1, 'customer', 'C0215', 'Nowhere', '123456789000057')`, [BIZ]))
      .rejects.toThrow(/parties_ice_morocco/);
  });
});
