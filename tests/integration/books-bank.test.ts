import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { asTenant, purgeBusinesses, type Q } from './books-db.js';

/**
 * C3 (Phase 5, item 4; 0185) — the done-criterion (PHASE-5.md §4): CSV, OFX and CAMT.053 import, with duplicate
 * lines refused. A match is never applied without a person, and an un-match restores exactly.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `c3c30000-0000-4000-8000-${RUN}0001`;
const CODE = `bank-owner-${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const OFX = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>MAD<BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260420<TRNAMT>1440.60<FITID>BQ-${RUN}-1<NAME>VIR ATLAS TEXTILES</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260422<TRNAMT>-380.00<FITID>BQ-${RUN}-2<NAME>RIF COTON</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

d('C3 · reconciliation from statement files (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let tenant: pg.Client;
  let owner = '';
  let accountant = '';
  let k: Record<'bank' | 'receivable' | 'supplier' | 'bq', string>;
  const as = <T>(fn: (q: Q) => Promise<T>) => asTenant(tenant, BIZ, fn);
  const session = (r: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=')) ?? '';
  const notice = async (r: { headers: Record<string, unknown> }) => {
    const set = ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).join('; ');
    return (await app.inject({ method: 'GET', url: String(r.headers['location']), headers: { cookie: `${owner}; ${set}` } })).body;
  };
  const upload = (text: string, name = 'statement.ofx') => {
    const boundary = `----nomi${RUN}`;
    return app.inject({ method: 'POST', url: `/app/books/bank/import?account=${k.bank}`, headers: { cookie: owner, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: `--${boundary}\r\nContent-Disposition: form-data; name="statement"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n${text}\r\n--${boundary}--\r\n` });
  };
  const post = (url: string, body: Record<string, string>, who = owner) => app.inject({ method: 'POST', url, payload: new URLSearchParams(body).toString(),
    headers: { cookie: who, 'content-type': 'application/x-www-form-urlencoded' } });
  const page = async (who = owner) => (await app.inject({ method: 'GET', url: `/app/books/bank?account=${k.bank}`, headers: { cookie: who } })).body;
  const lineOf = (amount: string) => as(async (q) => (await q(`select id::text as id from statement_lines where amount = $1`, [amount])).rows[0].id as string);
  const journalLine = (amount: string, side: 'debit' | 'credit') => as(async (q) => (await q(`select id::text as id from journal_lines where account_id = $1 and ${side} = $2`, [k.bank, amount])).rows[0].id as string);

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    tenant = new pg.Client({ connectionString: DATABASE_URL }); await tenant.connect();
    await admin.query(`insert into businesses (id, name, engine, country, currency, books_area) values ($1, $2, 'service', 'MA', 'MAD', true)`, [BIZ, `Bank ${RUN}`]);
    k = await as(async (q) => {
      const one = async (s: string, v: unknown[] = []) => (await q(s, v)).rows[0].id as string;
      const acc = (code: string, kind: string) => one(`insert into accounts (business_id, code, name, kind) values (current_business_id(), $1, $1, $2) returning id::text as id`, [code, kind]);
      const out = { bank: await acc('5141', 'asset'), receivable: await acc('3421', 'asset'), supplier: await acc('4411', 'liability'),
        bq: await one(`insert into journals (business_id, code, name, kind) values (current_business_id(), 'BQ', 'Banque', 'bank') returning id::text as id`) };
      const fy = await one(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2026-01-01', '2026-12-31') returning id::text as id`);
      const entry = async (day: string, label: string, lines: [string, string, string][]) => {
        const e = await one(`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by) values (current_business_id(), $1, $2, $3, $4, 'owner') returning id::text as id`, [out.bq, fy, day, label]);
        let n = 0;
        for (const [a, dr, cr] of lines) await q(`insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, credit) values (current_business_id(), $1, $2, $3, 'MAD', $4, $5)`, [e, ++n, a, dr, cr]);
        await q(`update journal_entries set state = 'posted', posted_by = 'owner', document_ref = $2, document_date = entry_date where id = $1`, [e, label]);
      };
      await entry('2026-04-19', 'Encaissement F-2026-0001', [[out.bank, '1440.60', '0'], [out.receivable, '0', '1440.60']]);
      await entry('2026-04-21', 'Règlement Rif Coton', [[out.supplier, '380', '0'], [out.bank, '0', '380']]);
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
  afterAll(async () => { await app?.close(); await db?.destroy(); await tenant?.end(); await purgeBusinesses(admin, [BIZ], 'books-bank-test'); await admin?.end(); });

  it('READ IN, then again: two new lines, then none — the duplicates refused', async () => {
    expect(await notice(await upload(OFX))).toContain('Read in: 2 new lines; 0 were already there.');
    expect(await notice(await upload(OFX))).toContain('Read in: 0 new lines; 2 were already there.');
    expect((await as((q) => q(`select count(*)::int as n from statement_lines`))).rows[0].n).toBe(2);
  });

  it('a CSV with a figure that reads two ways is not read in at all, and says where', async () => {
    expect(await notice(await upload('Date,Amount,Description\n2026-04-25,1.250,Something\n', 'x.csv')))
      .toContain('Nothing was read in: 1 lines need fixing. The first, line 2: a figure that can be read two ways.');
    expect((await as((q) => q(`select count(*)::int as n from statement_lines`))).rows[0].n).toBe(2);
  });

  it('THE RULE ONLY SUGGESTS: each line with its entry, and nothing matched until a person presses it', async () => {
    const body = await page();
    expect(body).toContain('Match with BQ-2026-1');
    expect(body).toContain('Match with BQ-2026-2');
    expect((await as((q) => q(`select count(*)::int as n from statement_matches`))).rows[0].n).toBe(0);
  });

  it('A PERSON MATCHES; a wrong pair, or a line matched already, is refused by the database', async () => {
    const receipt = await lineOf('1440.60'); const out = await lineOf('-380.00');
    const inLine = await journalLine('1440.60', 'debit'); const outLine = await journalLine('380.00', 'credit');
    expect(await notice(await post('/app/books/bank/match', { account: k.bank, line: receipt, journalLine: inLine }))).toContain('Matched.');
    expect(await notice(await post('/app/books/bank/match', { account: k.bank, line: out, journalLine: inLine }))).toContain('That match could not be made');
    expect(await notice(await post('/app/books/bank/match', { account: k.bank, line: receipt, journalLine: outLine }))).toContain('That match could not be made');
    const body = await page();
    expect(body).toContain('Undo the match');
    expect(body).not.toContain('Match with BQ-2026-1');
  });

  it('UN-MATCH RESTORES EXACTLY: the line is open again with the very same suggestion; the match is kept, set aside', async () => {
    const openBefore = (await page()).split('<h2>')[1];
    const match = (await as((q) => q(`select id::text as id from statement_matches where unmatched_at is null`))).rows[0].id as string;
    expect(await notice(await post('/app/books/bank/unmatch', { account: k.bank, match }))).toContain('The match is undone.');
    const after = await page();
    expect(after).toContain('Match with BQ-2026-1');
    expect(after).toContain('Nothing matched yet.');
    expect(openBefore).not.toContain('BQ-2026-1');   // before the undo, line 1 was not among the open ones; now it is
    expect((await as((q) => q(`select count(*)::int as n from statement_matches where unmatched_at is not null`))).rows[0].n).toBe(1);
    // and it can be matched again
    expect(await notice(await post('/app/books/bank/match', { account: k.bank, line: await lineOf('1440.60'), journalLine: await journalLine('1440.60', 'debit') }))).toContain('Matched.');
  });

  it('the accountant sees the page and matches nothing', async () => {
    const theirs = await page(accountant);
    expect(theirs).toContain('Suggested: BQ-2026-2');
    expect(theirs).not.toContain('/app/books/bank/match');
    const tried = await post('/app/books/bank/match', { account: k.bank, line: await lineOf('-380.00'), journalLine: await journalLine('380.00', 'credit') }, accountant);
    expect([tried.statusCode, tried.headers['location']]).toEqual([302, '/app/books']);
    expect((await as((q) => q(`select count(*)::int as n from statement_matches where unmatched_at is null`))).rows[0].n).toBe(1);
  });
});
