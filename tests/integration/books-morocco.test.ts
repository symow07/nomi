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
  });
  afterAll(async () => { await app?.close(); await db?.destroy(); await tenant?.end(); await purgeBusinesses(admin, [BIZ], 'books-morocco-test'); await admin?.end(); });

  it('THE CGNC CHART: 870 accounts added (the owner\'s 5141 kept as named), six journals, the accounts Nomi drafts with chosen; again, nothing', async () => {
    expect(await notice(await post('/app/books/chart/cgnc'))).toContain('Added: 870 accounts and 6 journals.');
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
    expect(String(r.headers['content-disposition'])).toContain('FEC-2026-01-01-2026-12-31.txt');
    const lines = r.body.split('\r\n').filter(Boolean).map((l) => l.split('|'));
    expect(lines[0]).toEqual(['Code_Journal', 'Libelle_Journal', 'Num_Ecriture', 'Date_Ecriture', 'Num_Compte', 'Libelle_Compte', 'Num_Compte_Aux',
      'Libelle_Compte_Aux', 'Ref_Piece', 'Date_Piece', 'Libelle_Ecriture', 'Montant_Debit', 'Montant_Credit', 'Lettrage_Ecriture', 'Date_Lettrage',
      'Date_Validation', 'Montant_Devise', 'Id_devise']);
    expect(lines.length).toBe(10);
    expect(lines.every((l) => l.length === 18)).toBe(true);
    expect(lines[1]!.slice(0, 13)).toEqual(['VE', 'Ventes', '1', '20260302', '3421', 'Clients', '', '', 'F-2026-0001', '20260302', 'Pièce F-2026-0001', '1200.00', '0.00']);
    // the foreign line: in the books' currency, and its own amount and currency
    const eur = lines.find((l) => l[4] === '7113')!;
    expect([eur[11], eur[12], eur[16], eur[17]]).toEqual(['0.00', '1080.00', '-100.00', 'EUR']);
    // the accountant takes the same file
    expect((await app.inject({ method: 'GET', url: `/app/books/fec/${year}.txt`, headers: { cookie: accountant } })).body).toBe(r.body);
  });
});
