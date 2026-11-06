/**
 * BLOCK 2 PR 5 — REPORTS IN THE OWNER'S WORDS: each report's figure equals the trial balance's on the same fixture.
 *   · What you made      = the trial balance's income less expense movement in the period.
 *   · Money in and out   = in − out + the balance brought forward = the trial balance's movement on the money accounts.
 *   · Tax you owe        = the trial balance's movement on the tax accounts (every tax line carries its code here).
 *   · Top customers      = the invoices issued in the period, net of credit notes; the sum of the rows is the total.
 *   · Unpaid by age      = the overview's "customers owe you"; the buckets add up to it.
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
import { draftCreditNote, issueCreditNote } from '../../src/db/booksCreditNotes.js';
import { trialBalanceOf } from '../../src/db/booksReports.js';
import { readBooksOverview } from '../../src/db/booksOverview.js';
import { periodFor, madeReport, moneyReport, taxReport, customersReport, unpaidReport } from '../../src/db/booksOwnerReports.js';

const d = process.env['DATABASE_URL'] && process.env['MIGRATE_DATABASE_URL'] ? describe : describe.skip;
const TODAY = '2026-11-06';
type Fixture = { biz: string; ids: Record<string, string> };
const num = (x: string | null | undefined) => Number(x ?? 'NaN');

d('Block 2 PR 5 · the owner\'s reports agree with the trial balance (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: Db, admin: pg.Client;
  const tx = <T>(f: Fixture, fn: (t: Tx) => Promise<T>) => { const b = parseBusinessId(f.biz); if (!b.ok) throw Error('fixture'); return withTenantTx(db, b.value, fn); };
  beforeAll(async () => { db = createDb(process.env['DATABASE_URL']!); admin = new pg.Client({ connectionString: process.env['MIGRATE_DATABASE_URL'] }); await admin.connect(); });
  afterAll(async () => { await db?.destroy(); await admin?.end(); });

  const setup = async (): Promise<Fixture> => {
    const f = { biz: randomUUID(), ids: {} as Record<string, string> };
    await admin.query("insert into businesses(id,name,country,currency,books_area) values($1,'Reports fixture','MA','MAD',true)", [f.biz]);
    await tx(f, async (t) => {
      for (const [code, name, kind, money] of [['5141', 'Banque', 'asset', true], ['5161', 'Caisse', 'asset', true], ['3421', 'Clients', 'asset', false], ['4411', 'Fournisseurs', 'liability', false],
        ['4455', 'TVA facturée', 'liability', false], ['34552', 'TVA récupérable', 'asset', false], ['7111', 'Ventes', 'income', false], ['6111', 'Achats', 'expense', false], ['6132', 'Loyer', 'expense', false], ['1111', 'Capital', 'equity', false]] as const)
        f.ids[code] = (await sql<{ id: string }>`insert into accounts(business_id,code,name,kind,holds_money) values(${f.biz}::uuid,${code},${name},${kind},${money}) returning id::text`.execute(t)).rows[0]!.id;
      for (const [code, kind] of [['BQ', 'bank'], ['VT', 'sales'], ['AN', 'opening'], ['AC', 'purchases']]) f.ids[kind!] = (await sql<{ id: string }>`insert into journals(business_id,code,name,kind) values(${f.biz}::uuid,${code!},${code!},${kind!}) returning id::text`.execute(t)).rows[0]!.id;
      for (const [code, name, kind] of [['C1', 'Atlas Mode', 'customer'], ['C2', 'Dar Beauté', 'customer'], ['C3', 'Souk Online', 'customer'], ['S1', 'Rif Coton', 'supplier']]) f.ids[code!] = (await sql<{ id: string }>`insert into parties(business_id,code,name,kind) values(${f.biz}::uuid,${code!},${name!},${kind!}) returning id::text`.execute(t)).rows[0]!.id;
      await sql`insert into fiscal_years(business_id,starts_on,ends_on) values(${f.biz}::uuid,'2026-01-01','2026-12-31')`.execute(t);
      await sql`insert into books_settings(business_id,sales_journal_id,receivable_account_id,sales_account_id) values(${f.biz}::uuid,${f.ids['sales']}::uuid,${f.ids['3421']}::uuid,${f.ids['7111']}::uuid)`.execute(t);
      f.ids['TVA20'] = (await sql<{ id: string }>`insert into tax_codes(business_id,code,label,rate,kind,account_id,valid_from) values(${f.biz}::uuid,'TVA20','TVA 20 %',20,'collected',${f.ids['4455']}::uuid,'2020-01-01') returning id::text`.execute(t)).rows[0]!.id;
      f.ids['TVA20_D'] = (await sql<{ id: string }>`insert into tax_codes(business_id,code,label,rate,kind,account_id,valid_from) values(${f.biz}::uuid,'TVA20_D','TVA 20 % déductible',20,'deductible',${f.ids['34552']}::uuid,'2020-01-01') returning id::text`.execute(t)).rows[0]!.id;
    });
    return f;
  };
  const line = (f: Fixture, account: string, debit: string, credit: string, extra: Partial<DraftLine> = {}): DraftLine => ({ accountId: f.ids[account]!, partyId: null, taxCodeId: null, currency: 'MAD', debit: debit === '0' ? null : decimal(debit), credit: credit === '0' ? null : decimal(credit), label: null, isFx: false, ...extra });
  const entry = (f: Fixture, lines: DraftLine[], date: string, journal = 'bank') => tx(f, async (t) => {
    const r = await draftEntry(t, f.biz, 'owner', { journalId: f.ids[journal]!, date, label: `Record ${date}`, documentRef: randomUUID(), documentDate: date, lines });
    if (r.kind !== 'drafted') throw Error(JSON.stringify(r));
    const p = await postEntry(t, f.biz, r.id, 'owner'); if (p.kind !== 'posted') throw Error(JSON.stringify(p)); return r.id;
  });
  const invoice = (f: Fixture, party: string, amount: string, issue: string, due: string, tax = true) => tx(f, async (t) => {
    const r = await draftInvoice(t, f.biz, 'owner', { partyId: f.ids[party]!, issueDate: issue, dueDate: due, currency: 'MAD', label: null, lines: [{ label: 'Sale', quantity: decimal('1'), unitPrice: decimal(amount), accountId: f.ids['7111']!, taxCodeId: tax ? f.ids['TVA20']! : null }] });
    if (r.kind !== 'drafted') throw Error(JSON.stringify(r));
    const i = await issueInvoice(t, f.biz, r.id, 'owner'); if (i.kind !== 'issued') throw Error(JSON.stringify(i)); return r.id;
  });
  const pay = (f: Fixture, id: string, amount: string, date: string, account = '5141') => tx(f, async (t) => { const r = await recordPayment(t, f.biz, id, 'owner', { amount: decimal(amount), paidOn: date, accountId: f.ids[account]!, journalId: f.ids['bank']!, refund: false }); if (r.kind !== 'recorded') throw Error(JSON.stringify(r)); });
  const credit = (f: Fixture, id: string, date: string, reduction: string) => tx(f, async (t) => { const r = await draftCreditNote(t, f.biz, 'owner', { invoiceId: id, issueDate: date, reason: 'Returned', lines: [{ invoiceLineNo: 1, quantity: decimal('0'), reduction: decimal(reduction) }] }); if (r.kind !== 'drafted') throw Error(JSON.stringify(r)); const c = await issueCreditNote(t, f.biz, r.id, 'owner'); if (c.kind !== 'issued') throw Error(JSON.stringify(c)); });

  /** A year of a Moroccan shop's books, with the period's own figures and some from before it. */
  const year = async (f: Fixture) => {
    await entry(f, [line(f, '5141', '20000', '0'), line(f, '1111', '0', '20000')], '2026-01-01', 'opening');
    // Before this month: a paid sale, rent.
    const old = await invoice(f, 'C1', '1000', '2026-09-10', '2026-09-20'); await pay(f, old, '1200', '2026-09-25');
    await entry(f, [line(f, '6132', '2000', '0'), line(f, '5141', '0', '2000')], '2026-10-01');
    // This month: three customers invoiced (tax on each), one credit note, one payment into the till, one still unpaid and late.
    const a = await invoice(f, 'C1', '3000', '2026-11-02', '2026-11-30');
    const b = await invoice(f, 'C2', '1500', '2026-11-03', '2026-11-04'); await pay(f, b, '600', '2026-11-05', '5161');
    await invoice(f, 'C3', '500', '2026-11-04', '2026-11-05');
    await credit(f, a, '2026-11-05', '200');
    // A supplier bill with deductible tax, owed; rent paid from the bank; a transfer bank → till.
    await entry(f, [line(f, '6111', '800', '0', { taxCodeId: f.ids['TVA20_D']! }), line(f, '34552', '160', '0'), line(f, '4411', '0', '960', { partyId: f.ids['S1']! })], '2026-11-03', 'purchases');
    await entry(f, [line(f, '6132', '2000', '0'), line(f, '5141', '0', '2000')], '2026-11-01');
    await entry(f, [line(f, '5161', '300', '0'), line(f, '5141', '0', '300')], '2026-11-04');
  };
  const movement = (tb: Awaited<ReturnType<typeof trialBalanceOf>>, codes: string[]) => tb.rows.filter((r) => r.code && codes.includes(r.code)).reduce((s, r) => s + num(r.period.debit) - num(r.period.credit), 0);

  it('the period: this month, this calendar quarter, the fiscal year — each up to today', async () => {
    const f = await setup();
    expect(await tx(f, (t) => periodFor(t, f.biz, TODAY, 'month'))).toEqual({ from: '2026-11-01', to: TODAY });
    expect(await tx(f, (t) => periodFor(t, f.biz, TODAY, 'quarter'))).toEqual({ from: '2026-10-01', to: TODAY });
    expect(await tx(f, (t) => periodFor(t, f.biz, TODAY, 'year'))).toEqual({ from: '2026-01-01', to: TODAY });
    expect(await tx(f, (t) => periodFor(t, f.biz, '2026-02-14', 'quarter'))).toEqual({ from: '2026-01-01', to: '2026-02-14' });
  });

  it('what you made, money in and out, and the tax you owe equal the trial balance for every span', async () => {
    const f = await setup(); await year(f);
    for (const span of ['month', 'quarter', 'year'] as const) {
      const period = await tx(f, (t) => periodFor(t, f.biz, TODAY, span));
      const tb = await tx(f, (t) => trialBalanceOf(t, f.biz, period));
      expect(tb.balanced).toBe(true);
      const made = await tx(f, (t) => madeReport(t, f.biz, period));
      expect(num(made.result)).toBeCloseTo(-movement(tb, ['7111', '6111', '6132']), 6);         // income is credit-side: result = −(debits − credits)
      expect(num(made.income) - num(made.spending)).toBe(num(made.result));
      expect(made.rows.reduce((s, r) => s + (r.kind === 'income' ? 1 : -1) * num(r.amount), 0)).toBeCloseTo(num(made.result), 6);
      const money = await tx(f, (t) => moneyReport(t, f.biz, period));
      expect(money.state).toBe('available');
      expect(num(money.in) - num(money.out) + num(money.opening)).toBeCloseTo(movement(tb, ['5141', '5161']), 6);
      expect(money.rows.reduce((s, r) => s + num(r.in) - num(r.out), 0)).toBeCloseTo(num(money.in) - num(money.out), 6);
      const tax = await tx(f, (t) => taxReport(t, f.biz, period));
      expect(num(tax.owed)).toBeCloseTo(-movement(tb, ['4455', '34552']), 6);                    // tax owed is credit-side on 4455 less the debit on 34552
      expect(tax.rows.reduce((s, r) => s + (r.kind === 'deductible' ? -1 : 1) * num(r.tax), 0)).toBeCloseTo(num(tax.owed), 6);
    }
    // The month's own figures, in words the owner can check against the entries above.
    const period = await tx(f, (t) => periodFor(t, f.biz, TODAY, 'month'));
    const made = await tx(f, (t) => madeReport(t, f.biz, period));
    expect(num(made.income)).toBe(3000 + 1500 + 500 - 200); expect(num(made.spending)).toBe(800 + 2000);
    const money = await tx(f, (t) => moneyReport(t, f.biz, period));
    expect(num(money.in)).toBe(600); expect(num(money.out)).toBe(2000); expect(num(money.opening)).toBe(0);   // the transfer of 300 is on neither side
    expect(money.rows.length).toBe(2);
    const tax = await tx(f, (t) => taxReport(t, f.biz, period));
    expect(num(tax.collected)).toBe((3000 + 1500 + 500 - 200) * 0.2); expect(num(tax.deductible)).toBe(160); expect(num(tax.owed)).toBe(960 - 160);
    const yr = await tx(f, async (t) => moneyReport(t, f.biz, await periodFor(t, f.biz, TODAY, 'year')));
    expect(num(yr.opening)).toBe(20000); expect(num(yr.in)).toBe(1200 + 600); expect(num(yr.out)).toBe(2000 + 2000);
  });

  it('top customers are the period\'s invoices net of credit notes; the unpaid buckets add up to what customers owe', async () => {
    const f = await setup(); await year(f);
    const period = await tx(f, (t) => periodFor(t, f.biz, TODAY, 'month'));
    const top = await tx(f, (t) => customersReport(t, f.biz, period, 2));
    expect(top.rows.map((r) => [r.name, num(r.billed)])).toEqual([['Atlas Mode', 3600 - 240], ['Dar Beauté', 1800]]);
    expect(top.others).toEqual({ customers: 1, billed: '600' });
    expect(num(top.total)).toBe(3360 + 1800 + 600);
    const all = await tx(f, (t) => customersReport(t, f.biz, period));
    expect(all.others).toBeNull(); expect(all.rows.reduce((s, r) => s + num(r.billed), 0)).toBe(num(all.total));
    const unpaid = await tx(f, (t) => unpaidReport(t, f.biz, TODAY));
    const owed = await tx(f, (t) => readBooksOverview(t, f.biz, { today: TODAY }));
    expect(num(unpaid.total)).toBe(num(owed.customerOwed.byCurrency[0]!.owed));
    expect(Object.values(unpaid.byBucket).reduce((s, v) => s + num(v), 0)).toBe(num(unpaid.total));
    expect(unpaid.rows.map((r) => [r.name, r.bucket, num(r.owed)])).toEqual([['Dar Beauté', 'd1_30', 1800 - 600], ['Souk Online', 'd1_30', 600], ['Atlas Mode', 'not_due', 3360]]);
    expect(unpaid.rows[0]!.daysPastDue).toBe(2); expect(unpaid.rows[2]!.daysPastDue).toBeLessThan(0);
  });
});
