import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { asTenant, refusal, purgeBusinesses, type Q } from './books-db.js';

/**
 * D2 (Phase 5, item 6; 0189) — the done-criterion (PHASE-5.md §4): the checklist must be clear before a lock; a
 * locked period refuses postings, with the reason; a third open period is refused; closing entries go to their own
 * journal; reopening is the owner's, and recorded. Each rule held by the database, past the routes.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `d2d20000-0000-4000-8000-${RUN}0001`;
const CODE = `close-owner-${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';

d('D2 · closing the books (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let tenant: pg.Client;
  let owner = '';
  let accountant = '';
  let accountantId = '';
  let staffId = '';
  let k: Record<'bank' | 'sales' | 'purchases' | 'result' | 've' | 'cl' | 'fy2025' | 'fy2026', string>;
  const as = <T>(fn: (q: Q) => Promise<T>) => asTenant(tenant, BIZ, fn);
  const refused = (fn: (q: Q) => Promise<unknown>) => refusal(tenant, BIZ, fn);
  const session = (r: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=')) ?? '';
  const notice = async (r: { headers: Record<string, unknown> }) => {
    const set = ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).join('; ');
    return (await app.inject({ method: 'GET', url: String(r.headers['location']).split('#')[0]!, headers: { cookie: `${owner}; ${set}` } })).body;
  };
  const post = (url: string, body: Record<string, string> = {}, who = owner) => app.inject({ method: 'POST', url, payload: new URLSearchParams(body).toString(),
    headers: { cookie: who, 'content-type': 'application/x-www-form-urlencoded' } });
  const page = async (qs = '', who = owner) => (await app.inject({ method: 'GET', url: `/app/books/closing${qs}`, headers: { cookie: who } })).body;
  /** An entry in the sales journal; posted unless asked not to. */
  const entry = (day: string, lines: [string, string, string][], posted = true) => as(async (q) => {
    const e = (await q(`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by) values (current_business_id(), $1, $2, $3, $4, 'owner') returning id::text as id`,
      [k.ve, day.startsWith('2025') ? k.fy2025 : k.fy2026, day, `E ${day}`])).rows[0].id as string;
    let n = 0;
    for (const [a, dr, cr] of lines) await q(`insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, credit) values (current_business_id(), $1, $2, $3, 'MAD', $4, $5)`, [e, ++n, a, dr, cr]);
    if (posted) await q(`update journal_entries set state = 'posted', posted_by = 'owner', document_ref = $2, document_date = entry_date where id = $1`, [e, `P-${day}`]);
    return e;
  });
  const asWho = async <T>(person: string, fn: (t: import('../../src/db/client.js').Tx) => Promise<T>) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { asViewer } = await import('../../src/db/viewer.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return asViewer(person, () => withTenantTx(db, b.value, fn));
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    tenant = new pg.Client({ connectionString: DATABASE_URL }); await tenant.connect();
    await admin.query(`insert into businesses (id, name, engine, country, currency, books_area) values ($1, $2, 'service', 'MA', 'MAD', true)`, [BIZ, `Close ${RUN}`]);
    k = await as(async (q) => {
      const one = async (s: string, v: unknown[] = []) => (await q(s, v)).rows[0].id as string;
      const acc = (code: string, kind: string) => one(`insert into accounts (business_id, code, name, kind) values (current_business_id(), $1, $1, $2) returning id::text as id`, [code, kind]);
      return {
        bank: await acc('5141', 'asset'), sales: await acc('7111', 'income'), purchases: await acc('6111', 'expense'), result: await acc('1191', 'equity'),
        ve: await one(`insert into journals (business_id, code, name, kind) values (current_business_id(), 'VE', 'Ventes', 'sales') returning id::text as id`),
        cl: await one(`insert into journals (business_id, code, name, kind) values (current_business_id(), 'CL', 'Clôture', 'closing') returning id::text as id`),
        fy2025: await one(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2025-01-01', '2025-12-31') returning id::text as id`),
        fy2026: await one(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2026-01-01', '2026-12-31') returning id::text as id`),
      };
    });
    await entry('2025-03-10', [[k.bank, '1000', '0'], [k.sales, '0', '1000']]);
    await entry('2025-06-02', [[k.purchases, '300', '0'], [k.bank, '0', '300']]);
    await entry('2026-02-14', [[k.bank, '50', '0'], [k.sales, '0', '50']]);
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
    const staff = await addPerson(db, BIZ, SECRET, `Staff ${RUN}`);
    if (staff.code !== 'added') throw new Error('fixture');
    const ids = (await admin.query(`select id::text as id, kind from people where business_id = $1 and not is_owner and archived_at is null`, [BIZ])).rows;
    accountantId = ids.find((r) => r.kind === 'accountant')!.id; staffId = ids.find((r) => r.kind === 'team')!.id;
  });
  afterAll(async () => { await app?.close(); await db?.destroy(); await tenant?.end(); await purgeBusinesses(admin, [BIZ], 'books-close-test'); await admin?.end(); });

  it('THE CHECKLIST MUST BE CLEAR before a lock — a draft waiting is counted, named and refused, by the page and the database', async () => {
    const draft = await entry('2026-03-05', [[k.bank, '9', '0'], [k.sales, '0', '9']], false);
    const body = await page('?month=2026-03');
    expect(body).toContain('Draft entries');
    expect(body).toContain('1 waiting');
    expect(body).toContain('Clear the list first');
    expect(await notice(await post('/app/books/closing/lock', { day: '2026-03-31' }))).toContain('Not clear yet — Draft entries: 1.');
    expect(await refused((q) => q(`select books_lock_to('2026-03-31', 'owner')`))).toMatch(/checklist is not clear for 2026-03-31 — draft_entries: 1/);
    await as((q) => q(`update journal_entries set state = 'discarded' where id = $1`, [draft]));
    expect(await notice(await post('/app/books/closing/lock', { day: '2026-03-31' }))).toContain('The books are locked up to');
    // D10 (0211): the lock is the year's own, said year by year
    expect(await page()).toMatch(/2026 – [^<]*2026: locked up to [^<]*2026</);
    expect((await admin.query(`select starts_on::text as s, lock_date::text as l from fiscal_years where business_id = $1 order by starts_on`, [BIZ])).rows)
      .toEqual([{ s: '2025-01-01', l: null }, { s: '2026-01-01', l: '2026-03-31' }]);
  });

  it('A LOCKED PERIOD REFUSES POSTINGS, WITH THE REASON; the lock moves only forward, never by a plain write', async () => {
    expect(await refused((q) => q(`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by)
      values (current_business_id(), $1, $2, '2026-03-20', 'Late', 'owner')`, [k.ve, k.fy2026]))).toMatch(/2026-03-20 is on or before the lock date 2026-03-31/);
    expect(await refused((q) => q(`update fiscal_years set lock_date = '2026-01-31' where id = $1`, [k.fy2026]))).toMatch(/a lock date moves only by locking/);
    expect(await refused(async (q) => { await q(`select set_config('nomi.closing', 'on', true)`); await q(`update fiscal_years set lock_date = null where id = $1`, [k.fy2026]); }))
      .toMatch(/a lock date moves only by locking/);
    expect(await notice(await post('/app/books/closing/lock', { day: '2026-02-28' }))).toContain('a lock moves only forward');
    expect(await notice(await post('/app/books/closing/lock', { day: '2099-01-31' }))).toContain('today at the latest');
  });

  it('REOPENING IS THE OWNER\'S, WITH A REASON, AND RECORDED — staff and the accountant are refused by the database', async () => {
    expect(await notice(await post('/app/books/closing/reopen', { year: k.fy2026, day: '2026-02-28', reason: '' }))).toContain('A reopening says why.');
    for (const who of [staffId, accountantId]) {
      await expect(asWho(who, async (t) => { const { sql } = await import('kysely'); await sql`select books_reopen_year(${k.fy2026}::uuid, '2026-02-28', 'x', 'because')`.execute(t); }))
        .rejects.toThrow(/reopening the books is the owner's/);
      await expect(asWho(who, async (t) => { const { sql } = await import('kysely'); await sql`select books_lock_to('2026-04-30', 'x')`.execute(t); }))
        .rejects.toThrow(/locking the books is the owner's/);
    }
    expect(await notice(await post('/app/books/closing/reopen', { year: k.fy2026, day: '2026-02-28', reason: 'A supplier bill for March arrived late' }))).toContain('Reopened, and recorded with its reason.');
    const history = (await as((q) => q(`select action, from_date::text as f, to_date::text as t, reason from period_locks order by at`))).rows;
    expect(history).toEqual([
      { action: 'lock', f: null, t: '2026-03-31', reason: null },
      { action: 'reopen', f: '2026-03-31', t: '2026-02-28', reason: 'A supplier bill for March arrived late' }]);
    const body = await page();
    expect(body).toContain('Reopened: locked up to');
    expect(body).toContain('A supplier bill for March arrived late');
    // the period is writable again after the reopened day
    await entry('2026-03-20', [[k.bank, '5', '0'], [k.sales, '0', '5']]);
  });

  it('A THIRD OPEN YEAR IS REFUSED (Avis 24): two are open, a third is not opened', async () => {
    expect(await notice(await post('/app/books/closing/open-year', { startsOn: '2027-01-01', endsOn: '2027-12-31' }))).toContain('Two fiscal years are open already');
    expect((await as((q) => q(`select count(*)::int as n from fiscal_years`))).rows[0].n).toBe(2);
  });

  it('CLOSING ENTRIES GO TO THEIR OWN JOURNAL: the year\'s result carried to the result account, the year closed for good', async () => {
    // nothing else may be written in the closing journal
    expect(await refused((q) => q(`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by)
      values (current_business_id(), $1, $2, '2025-12-31', 'By hand', 'owner')`, [k.cl, k.fy2025]))).toMatch(/closing journal takes only the closing entry/);
    // a year not ended yet is not closed
    expect(await notice(await post('/app/books/closing/year', { year: k.fy2026, result: k.result, journal: k.cl }))).toContain('A year is closed once it has ended');
    const closed = await post('/app/books/closing/year', { year: k.fy2025, result: k.result, journal: k.cl });
    expect(await notice(closed)).toContain('The year is closed, its closing entry posted.');
    const closing = (await as((q) => q(`select a.code, l.debit::text, l.credit::text from journal_entries e join journal_lines l on l.entry_id = e.id
      join accounts a on a.id = l.account_id where e.journal_id = $1 and e.state = 'posted' order by l.line_no`, [k.cl]))).rows;
    expect(closing).toEqual([{ code: '6111', debit: '0.00', credit: '300.00' }, { code: '7111', debit: '1000.00', credit: '0.00' }, { code: '1191', debit: '0.00', credit: '700.00' }]);
    expect((await as((q) => q(`select state from fiscal_years where id = $1`, [k.fy2025]))).rows[0].state).toBe('closed');
    expect(await refused((q) => q(`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by)
      values (current_business_id(), $1, $2, '2025-11-01', 'Too late', 'owner')`, [k.ve, k.fy2025]))).toMatch(/fiscal year 2025-01-01 to 2025-12-31 is closed/);
    // the trial balance: no result of earlier years left unclosed; it is in the result account
    const { trialBalanceOf } = await import('../../src/db/booksReports.js');
    const tb = await asWho('', (t) => trialBalanceOf(t, BIZ, { from: '2026-01-01', to: '2026-06-30' }));
    expect(tb.rows.find((r) => r.kind === 'earlier_result')).toBeUndefined();
    expect(tb.rows.find((r) => r.code === '1191')?.opening).toEqual({ debit: '0', credit: '700' });
    expect(tb.balanced).toBe(true);
    // the period history says it; and the closed year's OWN lock went to its last day first (0211: 2026's lock
    // never reached into 2025)
    expect((await as((q) => q(`select action from period_locks order by at`))).rows.map((r) => r.action)).toEqual(['lock', 'reopen', 'lock', 'close']);
    expect((await admin.query(`select lock_date::text as l from fiscal_years where id = $1`, [k.fy2025])).rows[0].l).toBe('2025-12-31');
  });

  it('THE ACCOUNTANT sees the page and its checklist, and locks, reopens and closes nothing', async () => {
    const theirs = await page('', accountant);
    expect(theirs).toContain('Before locking');
    expect(theirs).not.toContain('action="/app/books/closing/lock"');
    expect(theirs).not.toContain('action="/app/books/closing/year"');
    const tried = await post('/app/books/closing/lock', { day: '2026-04-30' }, accountant);
    expect([tried.statusCode, tried.headers['location']]).toEqual([302, '/app/books']);
    await expect(asWho(accountantId, async (t) => { const { sql } = await import('kysely');
      await sql`insert into fiscal_years (business_id, starts_on, ends_on) values (${BIZ}::uuid, '2030-01-01', '2030-12-31')`.execute(t); }))
      .rejects.toThrow(/an accountant sees and exports the books/);
  });
});
