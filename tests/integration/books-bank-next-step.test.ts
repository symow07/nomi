import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { asTenant, purgeBusinesses, type Q } from './books-db.js';

/**
 * F23 fix (UI correction, Block 5; the owner's ruling, 2026-11-21) — A BANK LINE NOTHING MATCHES STILL HAS A NEXT STEP.
 * On a Moroccan workspace whose pack came through the country page: a statement read in with money out and money in
 * and no entry for either. Money out: "Record it as a cost" opens the bill form filled from the line (date, the bank's
 * words, the amount, paid from that account); recorded, the owner is back on the bank line and the bill's own entry is
 * the one offered to match — and matching it closes the line. Money in leads to the unpaid invoices. The accountant and
 * staff are offered no step and get no filled form.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `f2330000-0000-4000-8000-${RUN}0001`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

d('F23 fix · a bank line with no entry has a next step (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 180_000 }, () => {
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let tenant: pg.Client;
  let app: import('fastify').FastifyInstance;
  let owner = ''; let staff = ''; let accountant = '';
  let today = '';
  let bank = ''; let expenseId = '';
  const as = <T>(fn: (q: Q) => Promise<T>) => asTenant(tenant, BIZ, fn);
  const cookieOf = (r: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=')) ?? '';
  const get = (url: string, who = owner) => app.inject({ method: 'GET', url, headers: { cookie: who } });
  const post = (url: string, body: Record<string, string>, who = owner) => app.inject({ method: 'POST', url, payload: new URLSearchParams(body).toString(), headers: { cookie: who, ...FORM } });
  const lineOf = async (amount: string) => (await as((q) => q(`select id::text as id from statement_lines where amount = $1`, [amount]))).rows[0].id as string;
  const lineHtml = (page: string, id: string) => { const at = page.indexOf(`id="bank-line-${id}"`); expect(at, `line ${id} on the page`).toBeGreaterThan(-1); const end = page.indexOf('</li>', at); return page.slice(at, end); };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    tenant = new pg.Client({ connectionString: DATABASE_URL }); await tenant.connect();
    await admin.query(`insert into businesses (id, name, engine, country, currency, books_area, timezone) values ($1, $2, 'service', 'MA', 'MAD', true, 'Africa/Casablanca')`, [BIZ, `Bank next step ${RUN}`]);
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { addPerson } = await import('../../src/api/web/people.js');
    const { dayKey } = await import('../../src/core/owner/i18n/format.js');
    today = dayKey(new Date(), 'Africa/Casablanca');
    db = createDb(DATABASE_URL!);
    app = Fastify({ logger: { level: 'error' } });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: `next-${RUN}`, sessionSecret: SECRET, factsTtlMs: 0,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const login = (code: string) => app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`, headers: FORM });
    owner = cookieOf(await login(`next-${RUN}`));
    const acct = await addPerson(db, BIZ, SECRET, `Accountant ${RUN}`, 'accountant'); if (acct.code !== 'added') throw new Error('fixture');
    accountant = cookieOf(await login(acct.accessCode));
    const team = await addPerson(db, BIZ, SECRET, `Staff ${RUN}`, 'team'); if (team.code !== 'added') throw new Error('fixture');
    staff = cookieOf(await login(team.accessCode));
    expect((await post('/app/books/country', { country: 'MA', period: 'month', year_start: `${today.slice(0, 4)}-01-01` })).statusCode).toBe(302);
    bank = (await as((q) => q(`select id::text as id from accounts where code = '5141'`))).rows[0].id as string;
    expenseId = (await as((q) => q(`select id::text as id from accounts where kind = 'expense' and is_active and code ~ '^61' and not exists (select 1 from accounts c where c.parent_id = accounts.id) order by code limit 1`))).rows[0].id as string;
    // The statement: money out and money in today, and no entry in the books for either.
    const day = today.replace(/-/g, '');
    const ofx = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>MAD<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>${day}<TRNAMT>-380.00<FITID>NX-${RUN}-1<NAME>RIF COTON</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>${day}<TRNAMT>1440.60<FITID>NX-${RUN}-2<NAME>VIR ATLAS TEXTILES</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const boundary = `----nomi${RUN}`;
    const up = await app.inject({ method: 'POST', url: `/app/books/bank/import?account=${bank}`, headers: { cookie: owner, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: `--${boundary}\r\nContent-Disposition: form-data; name="statement"; filename="statement.ofx"\r\nContent-Type: application/octet-stream\r\n\r\n${ofx}\r\n--${boundary}--\r\n` });
    expect(up.statusCode).toBe(302);
  });
  afterAll(async () => { await app?.close(); await db?.destroy(); await tenant?.end(); await purgeBusinesses(admin, [BIZ], 'books-bank-next-step-test'); await admin?.end(); });

  it('the bank page offers each unmatched line its next step; the accountant reads the lines and is offered none', async () => {
    const out = await lineOf('-380.00'); const inn = await lineOf('1440.60');
    const page = (await get(`/app/books/bank?account=${bank}`)).body;
    const o = lineHtml(page, out);
    expect(o).toContain('No entry of the same amount within a week.');
    expect(o).toContain(`href="/app/books/spending?bankLine=${out}&amp;account=${bank}#bill">Record it as a cost</a>`);
    expect(o).toContain('href="/app/books/advanced/entries/new">Write an entry for this line</a>');
    const i = lineHtml(page, inn);
    expect(i).toContain('href="/app/books/invoices?state=unpaid">Find the invoice it pays</a>'); expect(i).not.toContain('Record it as a cost');
    const read = (await get(`/app/books/bank?account=${bank}`, accountant)).body;
    expect(lineHtml(read, out)).not.toContain('Record it as a cost'); expect(read).not.toContain('entries/new');
  });

  it('"Record it as a cost" fills the bill form from the line; money in, staff and the accountant get no filled form', async () => {
    const out = await lineOf('-380.00'); const inn = await lineOf('1440.60');
    const filled = (await get(`/app/books/spending?bankLine=${out}&account=${bank}`)).body;
    const form = filled.slice(filled.indexOf('id="bill"'), filled.indexOf('</form>', filled.indexOf('id="bill"')));
    expect(form).toContain('Recording a bank line as a cost');
    expect(form).toContain(`name="bankLine" value="${out}"`); expect(form).toContain(`name="bankAccount" value="${bank}"`);
    expect(form).toMatch(new RegExp(`name="date" value="${today}"`));
    expect(form).toContain('name="label" maxlength="200" required value="RIF COTON"');
    expect(form).toMatch(/name="gross" inputmode="decimal" required value="380(\.00?)?"/);
    expect(form).toMatch(new RegExp(`<select name="payFrom">.*<option value="${bank}" selected>`, 's'));
    expect(form).toContain('Filled from the bank line of');
    // the amount as money, never the bare stored figure ("MAD 380")
    expect(form).toMatch(/Filled from the bank line of [^<]* for [^<]*380\.00/);
    expect(form).not.toMatch(/for MAD 380(?!\.00)/);
    // money in is not a cost: the plain form
    const plain = (await get(`/app/books/spending?bankLine=${inn}&account=${bank}`)).body;
    expect(plain).not.toContain('name="bankLine"'); expect(plain).toContain('Add a bill');
    // the accountant reads the page with no bill form; staff the same
    for (const who of [accountant, staff]) expect((await get(`/app/books/spending?bankLine=${out}&account=${bank}`, who)).body).not.toContain('name="bankLine"');
  });

  it('recorded, the owner is back on the bank line, the bill\'s entry is the one offered, and matching it closes the line', async () => {
    const out = await lineOf('-380.00');
    const r = await post('/app/books/spending/bills', { bankLine: out, bankAccount: bank, date: today, label: 'RIF COTON', ref: `RC-${RUN}`, gross: '380.00', account: expenseId, payFrom: bank });
    expect(r.statusCode).toBe(302);
    expect(r.headers['location']).toBe(`/app/books/bank?account=${bank}#bank-line-${out}`);
    const page = (await get(`/app/books/bank?account=${bank}`)).body;
    const o = lineHtml(page, out);
    expect(o).toContain('Best match'); expect(o).not.toContain('Record it as a cost');
    const jl = /name="journalLine" value="([0-9a-f-]{36})"/.exec(o)?.[1];
    expect(jl, 'a candidate to match').toBeTruthy();
    // the candidate is the bill's own: its entry, or the entry that paid it from this account
    const bill = (await as((q) => q(`select b.entry_id::text as e, b.paid_entry_id::text as p from spending_bills b join journal_entries j on j.id = b.entry_id where j.document_ref = $1`, [`RC-${RUN}`]))).rows[0] as { e: string; p: string | null };
    expect([bill.e, bill.p]).toContain((await as((q) => q(`select entry_id::text as e from journal_lines where id = $1`, [jl!]))).rows[0].e);
    expect((await post('/app/books/bank/match', { account: bank, line: out, journalLine: jl! })).statusCode).toBe(302);
    expect((await get(`/app/books/bank?account=${bank}`)).body).not.toContain(`id="bank-line-${out}"`);
  });

  it('a refused bill from a bank line goes back to the same filled form', async () => {
    const inn = await lineOf('1440.60');
    const r = await post('/app/books/spending/bills', { bankLine: inn, bankAccount: bank, date: today, label: 'x', gross: 'nope', account: expenseId, payFrom: bank });
    expect(r.statusCode).toBe(302);
    expect(r.headers['location']).toBe(`/app/books/spending?bankLine=${inn}&account=${bank}#bill`);
    // the notice says what the bill lacks: a bill has no lines, so no "Line {n}"
    const flash = ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).filter((c) => !c.startsWith('yf_session='));
    const next = (await app.inject({ method: 'GET', url: String(r.headers['location']), headers: { cookie: [owner, ...flash].join('; ') } })).body;
    expect(next).toContain('The bill was not recorded: it needs its date and an amount above zero, tax included.');
    expect(next).not.toContain('{n}');
  });

  it('a bill naming a bank line this workspace does not hold is a plain bill: back to Spending, never a bank page that is not there', async () => {
    const inn = await lineOf('1440.60');
    const foreign = randomUUID();
    // another workspace's account (here: one no workspace has) with a real line; then this account with a line it does not hold
    for (const [i, form] of [{ bankLine: inn, bankAccount: foreign }, { bankLine: randomUUID(), bankAccount: bank }].entries()) {
      const r = await post('/app/books/spending/bills', { ...form, date: today, label: 'FORGED', ref: `FG-${RUN}-${i}`, gross: '12.00', account: expenseId, payFrom: bank });
      expect(r.statusCode).toBe(302);
      expect(r.headers['location'], `case ${i}`).toBe('/app/books/spending#unpaid');
    }
    // the refused one goes back to the plain form too, once inside (the early refusal's filled form draws plain: the GET checks the line)
    const refused = await post('/app/books/spending/bills', { bankLine: inn, bankAccount: foreign, date: today, label: 'FORGED', gross: '12.00', payFrom: bank });
    expect(refused.headers['location']).toBe('/app/books/spending#bill');
    expect((await get(`/app/books/spending?bankLine=${inn}&account=${foreign}`)).body).not.toContain('name="bankLine"');
  });

  it('a malformed id is no id (never a 500), and an upper-case id of this workspace\'s line goes back to that line', async () => {
    const inn = await lineOf('1440.60');
    for (const [i, bad] of ['-'.repeat(36), 'a'.repeat(36), `${inn.replace(/-/g, '')}abcd`].entries()) {
      const r = await post('/app/books/spending/bills', { bankLine: bad, bankAccount: bad, date: today, label: 'MALFORMED', ref: `MF-${RUN}-${i}`, gross: '7.00', account: expenseId, payFrom: bank });
      expect(r.statusCode, `case ${i}`).toBe(302);
      expect(r.headers['location'], `case ${i}`).toBe('/app/books/spending#unpaid');
    }
    const up = await post('/app/books/spending/bills', { bankLine: inn.toUpperCase(), bankAccount: bank.toUpperCase(), date: today, label: 'UPPER', ref: `UP-${RUN}`, gross: '7.00', account: expenseId, payFrom: bank });
    expect(up.statusCode).toBe(302);
    expect(up.headers['location']).toBe(`/app/books/bank?account=${bank}#bank-line-${inn}`);
    expect((await get(String(up.headers['location']).split('#')[0]!)).statusCode).toBe(200);
  });
});
