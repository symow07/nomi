import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { asTenant, purgeBusinesses, type Q } from './books-db.js';

/**
 * D1 (Phase 5, item 1) — the done-criterion (PHASE-5.md §4): debits equal credits for any period, and the figures
 * match a fixture computed by hand, to the cent. Two fiscal years; a foreign purchase at the owner's rate; a sale
 * and its reversal; a draft and an entry after the period, neither counted.
 *
 *   by hand, period 2026-02-01 – 2026-04-30 (MAD):
 *   account   opening        period dr / cr        closing
 *   1111      cr 10000.00    —                     cr 10000.00
 *   3421      dr  2000.50    300.00 / 1500.00      dr   800.50
 *   4411      cr   450.25    —                     cr   450.25
 *   5141      dr 10000.00    1200.00 / 997.65      dr 10202.35
 *   6111      —              997.65 / —            dr   997.65
 *   7111      cr   800.50    300.00 / 300.00       cr   800.50
 *   earlier   cr   749.75    —                     cr   749.75     (2025: sales 1200.00 less purchases 450.25)
 *   totals    12000.50 each  2797.65 each          12000.50 each
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `d1d10000-0000-4000-8000-${RUN}0001`;
const CODE = `trial-owner-${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';

d('D1 · the trial balance (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let tenant: pg.Client;
  let owner = '';
  let accountant = '';
  const as = <T>(fn: (q: Q) => Promise<T>) => asTenant(tenant, BIZ, fn);
  const session = (r: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=')) ?? '';
  const page = (qs: string, who = owner) => app.inject({ method: 'GET', url: `/app/books/trial-balance${qs}`, headers: { cookie: who } });

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    tenant = new pg.Client({ connectionString: DATABASE_URL }); await tenant.connect();
    await admin.query(`insert into businesses (id, name, engine, country, currency, books_area) values ($1, $2, 'service', 'MA', 'MAD', true)`, [BIZ, `Trial ${RUN}`]);
    await as(async (q) => {
      const one = async (s: string, v: unknown[] = []) => (await q(s, v)).rows[0].id as string;
      const acc: Record<string, string> = {};
      for (const [code, kind] of [['1111', 'equity'], ['3421', 'asset'], ['4411', 'liability'], ['5141', 'asset'], ['6111', 'expense'], ['7111', 'income']] as const) {
        acc[code] = await one(`insert into accounts (business_id, code, name, kind) values (current_business_id(), $1, $1, $2) returning id::text as id`, [code, kind]);
      }
      const j = await one(`insert into journals (business_id, code, name, kind) values (current_business_id(), 'OD', 'Opérations diverses', 'general') returning id::text as id`);
      const fy: Record<string, string> = {};
      for (const y of ['2025', '2026']) fy[y] = await one(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), $1, $2) returning id::text as id`, [`${y}-01-01`, `${y}-12-31`]);
      await q(`insert into owner_rates (business_id, from_currency, to_currency, rate, stated_at) values (current_business_id(), 'USD', 'MAD', 9.9765, '2026-03-01T09:00:00Z')`);
      const entry = async (day: string, lines: [string, string, string, string][], posted = true) => {
        const e = await one(`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by) values (current_business_id(), $1, $2, $3, $4, 'owner') returning id::text as id`,
          [j, fy[day.slice(0, 4)], day, `E ${day}`]);
        let n = 0;
        for (const [a, cur, dr, cr] of lines) await q(`insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, credit) values (current_business_id(), $1, $2, $3, $4, $5, $6)`, [e, ++n, acc[a], cur, dr, cr]);
        if (posted) await q(`update journal_entries set state = 'posted', posted_by = 'owner', document_ref = $2, document_date = entry_date where id = $1`, [e, `P-${day}`]);
      };
      await entry('2025-03-01', [['5141', 'MAD', '10000', '0'], ['1111', 'MAD', '0', '10000']]);
      await entry('2025-06-10', [['3421', 'MAD', '1200', '0'], ['7111', 'MAD', '0', '1200']]);
      await entry('2025-09-05', [['6111', 'MAD', '450.25', '0'], ['4411', 'MAD', '0', '450.25']]);
      await entry('2026-01-15', [['3421', 'MAD', '800.50', '0'], ['7111', 'MAD', '0', '800.50']]);
      await entry('2026-02-01', [['5141', 'MAD', '1200', '0'], ['3421', 'MAD', '0', '1200']]);
      await entry('2026-03-10', [['6111', 'USD', '100', '0'], ['5141', 'USD', '0', '100']]);          // 997.65 at 9.9765
      await entry('2026-04-20', [['3421', 'MAD', '300', '0'], ['7111', 'MAD', '0', '300']]);
      await entry('2026-04-25', [['7111', 'MAD', '300', '0'], ['3421', 'MAD', '0', '300']]);          // its reversal
      await entry('2026-03-01', [['5141', 'MAD', '99999', '0'], ['7111', 'MAD', '0', '99999']], false); // a draft: not the books
      await entry('2026-05-01', [['5141', 'MAD', '7', '0'], ['7111', 'MAD', '0', '7']]);              // after the period
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
  afterAll(async () => { await app?.close(); await db?.destroy(); await tenant?.end(); await purgeBusinesses(admin, [BIZ], 'books-trial-balance-test'); await admin?.end(); });

  it('MATCHES THE FIXTURE WORKED BY HAND, to the cent', async () => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { trialBalanceOf } = await import('../../src/db/booksReports.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    const tb = await withTenantTx(db, b.value, (tx) => trialBalanceOf(tx, b.value, { from: '2026-02-01', to: '2026-04-30' }));
    const fig = (x: string) => Number(x).toFixed(2);
    expect(tb.rows.map((r) => [r.code ?? 'earlier', fig(r.opening.debit), fig(r.opening.credit), fig(r.period.debit), fig(r.period.credit), fig(r.closing.debit), fig(r.closing.credit)])).toEqual([
      ['1111', '0.00', '10000.00', '0.00', '0.00', '0.00', '10000.00'],
      ['3421', '2000.50', '0.00', '300.00', '1500.00', '800.50', '0.00'],
      ['4411', '0.00', '450.25', '0.00', '0.00', '0.00', '450.25'],
      ['5141', '10000.00', '0.00', '1200.00', '997.65', '10202.35', '0.00'],
      ['6111', '0.00', '0.00', '997.65', '0.00', '997.65', '0.00'],
      ['7111', '0.00', '800.50', '300.00', '300.00', '0.00', '800.50'],
      ['earlier', '0.00', '749.75', '0.00', '0.00', '0.00', '749.75'],
    ]);
    expect([fig(tb.totals.opening.debit), fig(tb.totals.opening.credit), fig(tb.totals.period.debit), fig(tb.totals.period.credit),
      fig(tb.totals.closing.debit), fig(tb.totals.closing.credit), tb.balanced]).toEqual(['12000.50', '12000.50', '2797.65', '2797.65', '12000.50', '12000.50', true]);
  });

  it('DEBITS EQUAL CREDITS FOR ANY PERIOD: every month of both years, and both years whole', async () => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { trialBalanceOf } = await import('../../src/db/booksReports.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    const periods = [{ from: '2025-01-01', to: '2026-12-31' }];
    for (const y of [2025, 2026]) for (let m = 1; m <= 12; m++) {
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      periods.push({ from: `${y}-${String(m).padStart(2, '0')}-01`, to: `${y}-${String(m).padStart(2, '0')}-${last}` });
    }
    const unbalanced = await withTenantTx(db, b.value, async (tx) => {
      const out: string[] = [];
      for (const p of periods) if (!(await trialBalanceOf(tx, b.value, p)).balanced) out.push(`${p.from}…${p.to}`);
      return out;
    });
    expect(unbalanced).toEqual([]);
  });

  it('on the page: the period, each row, the totals and the verdict; the accountant sees it too', async () => {
    const r = await page('?from=2026-02-01&to=2026-04-30');
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('Debits equal credits in every column.');
    expect(r.body).toContain('Result of earlier years, not closed yet');
    expect(r.body).toMatch(/10,202\.35/);
    expect(r.body).toMatch(/12,000\.50/);
    expect(r.body).not.toMatch(/99,999/);
    expect((await page('?from=2026-02-01&to=2026-04-30', accountant)).statusCode).toBe(200);
  });

  it('D3 · THE ACCOUNTANT PACK for the period: the same figures in a workbook — the trial balance, the journal, the ledger — for the owner and the accountant', async () => {
    const { xlsxSheets } = await import('../../src/net/xlsx.js');
    const r = await app.inject({ method: 'GET', url: '/app/books/pack.xlsx?from=2026-02-01&to=2026-04-30', headers: { cookie: owner } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('spreadsheetml');
    expect(String(r.headers['content-disposition'])).toContain('accountant-pack-2026-02-01-2026-04-30.xlsx');
    const book = xlsxSheets(r.rawPayload)!;
    expect(book.sheets.map((x) => x.name)).toEqual(['About', 'Trial balance', 'Journal', 'General ledger', 'Tax by code']);
    const rows = (name: string) => [...book.sheets.find((x) => x.name === name)!.rows.values()].map((row) => row.map((c) => c.text));
    expect(rows('About')[0]).toEqual(['Business', `Trial ${RUN}`]);
    expect(rows('About')[3]![1]).toMatch(/^Nomi · .* · schema \d+$/);
    expect(rows('Trial balance').find((x) => x[0] === '5141')).toEqual(['5141', '5141', '10000', '0', '1200', '997.65', '10202.35', '0']);
    expect(rows('Trial balance').at(-1)).toEqual(['Total', '', '12000.5', '12000.5', '2797.65', '2797.65', '12000.5', '12000.5']);
    // the journal: the period's posted lines only — not the draft, not the entry after the period
    const journal = rows('Journal');
    expect(journal.filter((x) => x[3] && /^2026-0[2-4]/.test(x[3]!)).length).toBe(8);
    expect(journal.some((x) => x.includes('99999'))).toBe(false);
    expect(journal.find((x) => x[0] === 'Total OD')!.slice(11, 13)).toEqual(['2797.65', '2797.65']);
    // the ledger: 5141 opens at 10000, ends at 10202.35 — its trial-balance closing
    const ledger = rows('General ledger');
    expect(ledger.find((x) => x[0] === '5141' && x[5] === 'Closing balance')![9]).toBe('10202.35');
    expect((await app.inject({ method: 'GET', url: '/app/books/pack.xlsx?from=2026-02-01&to=2026-04-30', headers: { cookie: accountant } })).statusCode).toBe(200);
  });

  it('a period that is not two days in order is said, and this fiscal year so far is shown instead', async () => {
    const r = await page('?from=2026-04-30&to=2026-02-01');
    expect(r.body).toContain('The period is two days, the first on or before the last.');
    expect(r.statusCode).toBe(200);
    expect((await page('?from=2026-02-31&to=2026-03-01')).body).toContain('The period is two days');
  });
});
