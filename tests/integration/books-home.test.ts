/**
 * BLOCK 2 PR 4 — THE BOOKS HOME IS WIRED TO THE ROWS BEHIND IT (the finishing roadmap, 2026-11-06).
 *
 * Every figure on the home is a query over posted entries, never a kept sum, and every figure equals the sum of the
 * rows its door opens: cash today = the balances by account on the cash report = the posted lines on those accounts;
 * received / paid out = the cash report's rows; customers owe = the unpaid invoices' rows; you owe = the supplier
 * rows; profit = the profit report's rows. With nothing chosen, the money accounts are the chart's own (0225's
 * `holds_money` or rule 91's words), so the home shows its figures without a choice; a chart with none says so.
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { sql } from 'kysely';
import { createDb, withTenantTx, type Db, type Tx } from '../../src/db/client.js';
import { parseBusinessId } from '../../src/core/types/ids.js';
import { decimal } from '../../src/core/types/decimal.js';
import { draftEntry, postEntry, type DraftLine } from '../../src/db/booksEntries.js';
import { draftInvoice, issueInvoice, recordPayment } from '../../src/db/booksInvoices.js';
import * as overview from '../../src/db/booksOverview.js';
import { renderBooksOverview } from '../../src/api/web/booksOverview.js';
import { renderBooksCashReport } from '../../src/api/web/booksOverviewReports.js';

const d = process.env['DATABASE_URL'] && process.env['MIGRATE_DATABASE_URL'] ? describe : describe.skip;
const TODAY = '2026-11-06';
type Fixture = { biz: string; ids: Record<string, string> };
const num = (x: string | null) => Number(x ?? 'NaN');

d('Block 2 PR 4 · the Books home: each figure is the sum of its rows (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: Db, admin: pg.Client;
  const tx = <T>(f: Fixture, fn: (t: Tx) => Promise<T>) => { const b = parseBusinessId(f.biz); if (!b.ok) throw Error('fixture'); return withTenantTx(db, b.value, fn); };
  beforeAll(async () => { db = createDb(process.env['DATABASE_URL']!); admin = new pg.Client({ connectionString: process.env['MIGRATE_DATABASE_URL'] }); await admin.connect(); });
  afterAll(async () => { await db?.destroy(); await admin?.end(); });

  /** A chart whose money accounts are known by the marker (bank) and by the name (cash); creditors on 4411. */
  const setup = async (money = true): Promise<Fixture> => {
    const f = { biz: randomUUID(), ids: {} as Record<string, string> };
    await admin.query("insert into businesses(id,name,country,currency,books_area) values($1,'Home fixture','US','USD',true)", [f.biz]);
    await tx(f, async (t) => {
      const accounts: [string, string, string][] = money
        ? [['5141', 'Main account', 'asset'], ['5161', 'Cash', 'asset'], ['3421', 'Customers', 'asset'], ['4411', 'Suppliers', 'liability'], ['7111', 'Sales', 'income'], ['6111', 'Purchases', 'expense'], ['1111', 'Capital', 'equity']]
        : [['2000', 'Machines', 'asset'], ['2100', 'Vehicles', 'asset'], ['3421', 'Customers', 'asset'], ['4411', 'Suppliers', 'liability'], ['7111', 'Sales', 'income'], ['6111', 'Purchases', 'expense'], ['1111', 'Capital', 'equity']];
      for (const [code, name, kind] of accounts) f.ids[code] = (await sql<{ id: string }>`insert into accounts(business_id,code,name,kind,holds_money) values(${f.biz}::uuid,${code},${name},${kind},${money && code === '5141'}) returning id::text`.execute(t)).rows[0]!.id;
      for (const [code, kind] of [['BK', 'bank'], ['SJ', 'sales'], ['OP', 'opening'], ['PJ', 'purchases']]) f.ids[kind!] = (await sql<{ id: string }>`insert into journals(business_id,code,name,kind) values(${f.biz}::uuid,${code!},${code!},${kind!}) returning id::text`.execute(t)).rows[0]!.id;
      for (const [code, kind] of [['C1', 'customer'], ['S1', 'supplier']]) f.ids[kind!] = (await sql<{ id: string }>`insert into parties(business_id,code,name,kind) values(${f.biz}::uuid,${code!},${code!},${kind!}) returning id::text`.execute(t)).rows[0]!.id;
      await sql`insert into fiscal_years(business_id,starts_on,ends_on) values(${f.biz}::uuid,'2026-04-01','2027-03-31')`.execute(t);
      await sql`insert into books_settings(business_id,sales_journal_id,receivable_account_id,sales_account_id) values(${f.biz}::uuid,${f.ids['sales']}::uuid,${f.ids['3421']}::uuid,${f.ids['7111']}::uuid)`.execute(t);
    });
    return f;
  };
  const line = (f: Fixture, account: string, debit: string, credit: string, party?: string): DraftLine => ({ accountId: f.ids[account]!, partyId: party ? f.ids[party]! : null, taxCodeId: null, currency: 'USD', debit: debit === '0' ? null : decimal(debit), credit: credit === '0' ? null : decimal(credit), label: null, isFx: false });
  const entry = (f: Fixture, lines: DraftLine[], date: string, journal = 'bank', post = true) => tx(f, async (t) => {
    const r = await draftEntry(t, f.biz, 'owner', { journalId: f.ids[journal]!, date, label: 'Home record', documentRef: randomUUID(), documentDate: date, lines });
    if (r.kind !== 'drafted') throw Error(JSON.stringify(r));
    if (post) { const p = await postEntry(t, f.biz, r.id, 'owner'); if (p.kind !== 'posted') throw Error(JSON.stringify(p)); }
    return r.id;
  });
  const read = (f: Fixture, options: Partial<overview.BooksOverviewOptions> = {}) => tx(f, (t) => overview.readBooksOverview(t, f.biz, { today: TODAY, ...options }));
  const owner = { id: 'o', name: 'Mei', isOwner: true };

  /** A month of the shop's money: an opening balance, a sale half paid, an expense from the bank, a bill owed, a transfer, a draft, a future entry. */
  const month = async (f: Fixture) => {
    await entry(f, [line(f, '5141', '5000', '0'), line(f, '1111', '0', '5000')], '2026-04-01', 'opening');
    const inv = await tx(f, async (t) => {
      const r = await draftInvoice(t, f.biz, 'owner', { partyId: f.ids['customer']!, issueDate: '2026-11-01', dueDate: '2026-11-15', currency: 'USD', label: null, lines: [{ label: 'Sale', quantity: decimal('1'), unitPrice: decimal('300'), accountId: f.ids['7111']!, taxCodeId: null }] });
      if (r.kind !== 'drafted') throw Error(JSON.stringify(r));
      const i = await issueInvoice(t, f.biz, r.id, 'owner'); if (i.kind !== 'issued') throw Error(JSON.stringify(i)); return r.id;
    });
    await tx(f, async (t) => { const r = await recordPayment(t, f.biz, inv, 'owner', { amount: decimal('120'), paidOn: '2026-11-03', accountId: f.ids['5161']!, journalId: f.ids['bank']!, refund: false }); if (r.kind !== 'recorded') throw Error(JSON.stringify(r)); });
    await entry(f, [line(f, '6111', '80', '0'), line(f, '5141', '0', '80')], '2026-11-02');
    await entry(f, [line(f, '6111', '200', '0'), line(f, '4411', '0', '200', 'supplier')], '2026-11-04', 'purchases');
    await entry(f, [line(f, '5161', '150', '0'), line(f, '5141', '0', '150')], '2026-11-05');
    await entry(f, [line(f, '6111', '999', '0'), line(f, '5141', '0', '999')], '2026-11-05', 'bank', false);   // a draft: not in the books
    await entry(f, [line(f, '5141', '50', '0'), line(f, '7111', '0', '50')], '2026-11-20');                    // after today: not yet
  };

  it('nothing chosen: the money accounts are the chart\'s own, by marker and by name; a chart with none asks for a choice', async () => {
    const f = await setup();
    const o = await read(f);
    expect(o.cashToday.state).toBe('available'); expect(o.cashToday.defaulted).toBe(true);
    expect(o.cashToday.byAccount.map((a) => a.code)).toEqual(['5141', '5161']);           // the marker, then the name; never the receivable 3421
    expect(o.cash.state).toBe('available'); expect([...o.cash.selectedIds].sort()).toEqual([f.ids['5141']!, f.ids['5161']!].sort());
    expect(o.supplierOwed.state).toBe('available');                                           // 4411 is the pack's creditors account
    const bare = await setup(false);
    const b = await read(bare);
    expect(b.cashToday.state).toBe('needs_setup'); expect(b.cashToday.balance).toBeNull(); expect(b.cash.state).toBe('needs_setup');
    await admin.query('update accounts set holds_money = true where business_id = $1 and code = $2', [bare.biz, '2100']);
    expect((await read(bare)).cashToday.byAccount.map((a) => a.code)).toEqual(['2100']);        // the owner's tick on the accounts page is enough
    // A choice for one view still overrides the default.
    const one = await read(f, { cashAccountIds: [f.ids['5161']!] });
    expect(one.cashToday.defaulted).toBe(false); expect(one.cashToday.byAccount.map((a) => a.code)).toEqual(['5161']);
  });

  it('after a month: every figure on the home equals the sum of the rows behind it, from posted entries alone', async () => {
    const f = await setup(); await month(f);
    const o = await read(f);
    // Cash today: the balances by account, and each of them the posted lines on that account up to today.
    const byAccount = Object.fromEntries(o.cashToday.byAccount.map((a) => [a.code, num(a.balance)]));
    expect(byAccount).toEqual({ '5141': 5000 - 80 - 150, '5161': 120 + 150 });
    expect(num(o.cashToday.balance)).toBe(byAccount['5141']! + byAccount['5161']!);
    for (const a of o.cashToday.byAccount) {
      const direct = await tx(f, (t) => sql<{ s: string }>`select coalesce(sum(l.book_debit-l.book_credit),0)::text as s from journal_lines l join journal_entries e on e.id=l.entry_id
        where l.account_id=${a.id}::uuid and e.state='posted' and e.entry_date<=${TODAY}::date`.execute(t));
      expect(num(a.balance)).toBe(num(direct.rows[0]!.s));
    }
    // Received and paid out this month: the cash report's rows (the transfer between the two is excluded on both sides).
    const cashRows = await tx(f, (t) => overview.readOverviewCashEntries(t, f.biz, { today: TODAY }, { size: 100 }));
    expect(cashRows.total).toBe(cashRows.rows.length);
    expect(num(o.cash.received)).toBe(cashRows.rows.reduce((s, r) => s + num(r.received), 0));
    expect(num(o.cash.paidOut)).toBe(cashRows.rows.reduce((s, r) => s + num(r.paidOut), 0));
    expect(num(o.cash.received)).toBe(120); expect(num(o.cash.paidOut)).toBe(80);
    // Customers owe you: the unpaid invoices' rows.
    const unpaid = await tx(f, (t) => overview.readOverviewInvoices(t, f.biz, TODAY, { state: 'unpaid', size: 100 }));
    const owedRows = unpaid.rows.reduce((s, r) => s + num(r.total) - num(r.credited) - num(r.paid), 0);
    expect(num(o.customerOwed.byCurrency[0]!.owed)).toBe(owedRows); expect(owedRows).toBe(180);
    // You owe: the supplier rows.
    const suppliers = await tx(f, (t) => overview.readOverviewSuppliers(t, f.biz, { today: TODAY }, { size: 100 }));
    expect(num(o.supplierOwed.owed)).toBe(suppliers.rows.reduce((s, r) => s + num(r.owed), 0)); expect(num(o.supplierOwed.owed)).toBe(200);
    // Profit this year: the profit report's rows.
    const profit = await tx(f, (t) => overview.readOverviewProfitEntries(t, f.biz, TODAY, { size: 100 }));
    expect(num(o.profit.amount)).toBe(profit.rows.reduce((s, r) => s + num(r.amount), 0)); expect(num(o.profit.amount)).toBe(300 - 80 - 200);
  });

  it('the home shows Cash today with its door to the balances by account; the cash report lists them', async () => {
    const f = await setup(); await month(f);
    const o = await read(f);
    const scope = { today: TODAY };
    const home = renderBooksOverview('en', owner, o, scope, [], [], { year: true, accounts: true });
    expect(home).toContain('Cash today'); expect(home).toContain('$5,040.00'); expect(home).toContain('href="/app/books/reports/cash#today"');
    expect(home).toContain('as the chart marks them');                                        // the default is said
    expect(home).not.toContain('Choose accounts');
    const report = renderBooksCashReport('en', o, scope, [], await tx(f, (t) => overview.readOverviewCashEntries(t, f.biz, scope, {})));
    expect(report).toContain('id="today"'); expect(report).toContain('5141 · Main account'); expect(report).toContain('$4,770.00'); expect(report).toContain('5161 · Cash'); expect(report).toContain('$270.00');
    // A chart with no money account: the home asks for a choice and shows no figure.
    const bare = await setup(false);
    const b = renderBooksOverview('en', owner, await read(bare), scope, [], [], { year: true, accounts: true });
    expect(b).toContain('Choose accounts'); expect(b).not.toContain('as the chart marks them');
  });
});
