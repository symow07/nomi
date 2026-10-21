import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { asTenant, purgeBusinesses, type Q } from './books-db.js';

/**
 * C2 (Phase 5, item 5; 0184) — the done-criterion (PHASE-5.md §4): invoices are open, partly paid or paid by their
 * payments, in any currency (gains and losses on exchange posted); invoice numbers have no gaps. And an issued
 * invoice never changes, a payment is never more than what is owed, and a foreign receivable clears to nothing in
 * the books' currency as well as its own.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `c2c20000-0000-4000-8000-${RUN}0001`;
const TODAY = '2026-04-10';   // the day the page is read: before any due date below

d('C2 · invoices and payments (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let admin: pg.Client;
  let tenant: pg.Client;
  let db: import('../../src/db/client.js').Db;
  let inv: typeof import('../../src/db/booksInvoices.js');
  let k: Record<'receivable' | 'sales' | 'tva' | 'bank' | 'loss' | 'gain' | 've' | 'bq' | 'party' | 'tax', string>;
  const as = <T>(fn: (q: Q) => Promise<T>) => asTenant(tenant, BIZ, fn);
  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };
  const dec = (s: string) => s as import('../../src/core/types/decimal.js').Decimal;
  const draft = (currency: string, lines: [string, string, boolean][], date = '2026-04-02', due: string | null = null) =>
    tx((t) => inv.draftInvoice(t, BIZ, 'owner', { partyId: k.party, issueDate: date, dueDate: due, currency, label: null,
      lines: lines.map(([quantity, unitPrice, taxed]) => ({ label: 'Sacs en toile', quantity: dec(quantity), unitPrice: dec(unitPrice), accountId: k.sales, taxCodeId: taxed ? k.tax : null })) }));
  const issue = (id: string, by = 'owner') => tx((t) => inv.issueInvoice(t, BIZ, id, by));
  const pay = (id: string, amount: string, on: string) => tx((t) => inv.recordPayment(t, BIZ, id, 'owner', { paidOn: on, amount: dec(amount), journalId: k.bq, accountId: k.bank }));
  const view = (id: string) => tx((t) => inv.loadInvoice(t, BIZ, id, TODAY));
  /** An account's balance over ONE invoice's entries (its issue and its payments): in the books' currency, and in its own. */
  const balance = (account: string, invoiceId: string, currency = 'MAD') => as(async (q) => (await q(`select coalesce(sum(l.book_debit - l.book_credit), 0)::text as book,
      coalesce(sum(case when l.currency = $3 then l.debit - l.credit else 0 end), 0)::text as own
      from journal_lines l join journal_entries e on e.id = l.entry_id
     where l.account_id = $1 and e.state = 'posted'
       and e.id in (select entry_id from invoices where id = $2 union select entry_id from invoice_payments where invoice_id = $2)`, [account, invoiceId, currency])).rows[0]);

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    tenant = new pg.Client({ connectionString: DATABASE_URL }); await tenant.connect();
    await admin.query(`insert into businesses (id, name, engine, country, currency, books_area) values ($1, $2, 'service', 'MA', 'MAD', true)`, [BIZ, `Invoices ${RUN}`]);
    k = await as(async (q) => {
      const one = async (s: string, v: unknown[] = []) => (await q(s, v)).rows[0].id as string;
      const acc = (code: string, kind: string) => one(`insert into accounts (business_id, code, name, kind) values (current_business_id(), $1, $1, $2) returning id::text as id`, [code, kind]);
      const out = {
        receivable: await acc('3421', 'asset'), sales: await acc('7111', 'income'), tva: await acc('4455', 'liability'), bank: await acc('5141', 'asset'),
        loss: await acc('6331', 'expense'), gain: await acc('7331', 'income'),
        ve: await one(`insert into journals (business_id, code, name, kind) values (current_business_id(), 'VE', 'Ventes', 'sales') returning id::text as id`),
        bq: await one(`insert into journals (business_id, code, name, kind) values (current_business_id(), 'BQ', 'Banque', 'bank') returning id::text as id`),
        party: await one(`insert into parties (business_id, code, name, kind, country) values (current_business_id(), 'C001', 'Atlas Textiles SARL', 'customer', 'MA') returning id::text as id`),
        tax: '',
      };
      out.tax = await one(`insert into tax_codes (business_id, code, label, rate, kind, account_id, valid_from) values (current_business_id(), 'TVA20', 'TVA 20 %', 20, 'collected', $1, '2026-01-01') returning id::text as id`, [out.tva]);
      await q(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2026-01-01', '2026-12-31')`);
      await q(`insert into books_settings (business_id, sales_journal_id, receivable_account_id, sales_account_id, fx_loss_account_id, fx_gain_account_id)
        values (current_business_id(), $1, $2, $3, $4, $5)`, [out.ve, out.receivable, out.sales, out.loss, out.gain]);
      await q(`insert into owner_rates (business_id, from_currency, to_currency, rate, stated_at) values (current_business_id(), 'USD', 'MAD', 9.9765, '2026-04-01T09:00:00Z')`);
      return out;
    });
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    inv = await import('../../src/db/booksInvoices.js');
  });
  afterAll(async () => { await db?.destroy(); await tenant?.end(); await purgeBusinesses(admin, [BIZ], 'books-invoices-test'); await admin?.end(); });

  it('ISSUED: F-2026-0001, its entry posted — the receivable the total, sales the net, the tax its account', async () => {
    const dr = await draft('MAD', [['1', '1200.50', true]]);
    if (dr.kind !== 'drafted') throw new Error(dr.reason);
    expect((await view(dr.id))!.status).toBe('draft');
    const out = await issue(dr.id);
    expect(out).toMatchObject({ kind: 'issued', key: 'F-2026-0001' });
    const lines = await as((q) => q(`select a.code, l.debit::text, l.credit::text from journal_lines l join accounts a on a.id = l.account_id
      where l.entry_id = $1 order by l.line_no`, [(out as { entryId: string }).entryId]));
    expect(lines.rows).toEqual([{ code: '3421', debit: '1440.60', credit: '0.00' }, { code: '7111', debit: '0.00', credit: '1200.50' }, { code: '4455', debit: '0.00', credit: '240.10' }]);
    expect((await view(dr.id))!.status).toBe('open');
  });

  it('NO GAP: a refused issue takes no number — the next is F-2026-0002', async () => {
    await as((q) => q(`update books_settings set lock_date = '2026-04-30'`));
    const locked = await draft('MAD', [['2', '10', false]], '2026-04-15');
    if (locked.kind !== 'drafted') throw new Error(locked.reason);
    expect(await issue(locked.id)).toMatchObject({ kind: 'refused' });
    await as((q) => q(`update books_settings set lock_date = null`));
    const next = await draft('MAD', [['2', '10', false]], '2026-05-15');
    if (next.kind !== 'drafted') throw new Error(next.reason);
    expect(await issue(next.id)).toMatchObject({ kind: 'issued', key: 'F-2026-0002' });
    expect(await issue(locked.id)).toMatchObject({ kind: 'issued', key: 'F-2026-0003' });   // its day open again, it takes the next
  });

  it('AN ISSUED INVOICE NEVER CHANGES: not its label, not a line; the counter only rises', async () => {
    const id = (await as((q) => q(`select id::text as id from invoices where number = 1`))).rows[0].id as string;
    await expect(as((q) => q(`update invoices set label = 'changed' where id = $1`, [id]))).rejects.toThrow(/an issued invoice never changes/);
    await expect(as((q) => q(`update invoice_lines set unit_price = 1, net = 1 where invoice_id = $1`, [id]))).rejects.toThrow(/an issued invoice never changes/);
    await expect(as((q) => q(`update invoice_counters set last_number = 1`))).rejects.toThrow(/permission denied/);
    // and on a draft, a line whose net is not its quantity times its price is refused
    const fresh = await draft('MAD', [['1', '5', false]], '2026-06-01');
    if (fresh.kind !== 'drafted') throw new Error(fresh.reason);
    await expect(as((q) => q(`insert into invoice_lines (business_id, invoice_id, line_no, label, quantity, unit_price, account_id, net) values (current_business_id(), $1, 9, 'x', 1, 5, $2, 4)`,
      [fresh.id, k.sales]))).rejects.toThrow(/net is its quantity times its price/);
  });

  it('THE CUSTOMER AS AT ISSUE (0187): copied onto the invoice when issued, never read again — the party renamed, the invoice still says what it said', async () => {
    const id = (await as((q) => q(`select id::text as id from invoices where number = 1`))).rows[0].id as string;
    expect((await as((q) => q(`select party_code, party_name, party_country, party_address from invoices where id = $1`, [id]))).rows[0])
      .toEqual({ party_code: 'C001', party_name: 'Atlas Textiles SARL', party_country: 'MA', party_address: null });
    await as((q) => q(`update parties set name = 'Atlas Textiles (renamed)', address = 'Zone franche, Tanger' where id = $1`, [k.party]));
    try {
      const v = await view(id);
      expect([v!.party, v!.billedTo.name, v!.billedTo.address, v!.billedTo.asIssued]).toEqual(['Atlas Textiles SARL', 'Atlas Textiles SARL', null, true]);
      // the copy is the database's: an issued invoice's copy never changes, and a draft holds none, whatever it is given
      await expect(as((q) => q(`update invoices set party_name = 'Someone else' where id = $1`, [id]))).rejects.toThrow(/an issued invoice never changes/);
      const forged = await as(async (q) => (await q(`insert into invoices (business_id, party_id, issue_date, currency, created_by, party_name)
        values (current_business_id(), $1, '2026-06-02', 'MAD', 'owner', 'Forged') returning party_name, id::text as id`, [k.party])).rows[0]);
      expect(forged.party_name).toBeNull();
      const pending = await view(forged.id as string);
      expect([pending!.billedTo.name, pending!.billedTo.address, pending!.billedTo.asIssued]).toEqual(['Atlas Textiles (renamed)', 'Zone franche, Tanger', false]);
      await as((q) => q(`update invoices set state = 'discarded' where id = $1`, [forged.id]));
    } finally {
      await as((q) => q(`update parties set name = 'Atlas Textiles SARL', address = null where id = $1`, [k.party]));
    }
  });

  it('PAYMENTS: partly paid, then paid; never more than is owed — the app and the database both refuse', async () => {
    const id = (await as((q) => q(`select id::text as id from invoices where number = 1`))).rows[0].id as string;
    expect(await pay(id, '440.60', '2026-04-20')).toMatchObject({ kind: 'recorded' });
    expect((await view(id))!.status).toBe('partly_paid');
    expect(await pay(id, '1000.01', '2026-04-25')).toMatchObject({ kind: 'refused', reason: 'too_much', detail: '1000 MAD' });
    expect(await pay(id, '1000', '2026-04-25')).toMatchObject({ kind: 'recorded', fx: '0' });
    expect((await view(id))!.status).toBe('paid');
    expect(await balance(k.receivable, id)).toMatchObject({ book: '0.00' });
    // straight to the database, past the app's check: refused there too
    const entry = (await as((q) => q(`select entry_id::text as e from invoice_payments where invoice_id = $1 limit 1`, [id]))).rows[0].e;
    await expect(as((q) => q(`insert into invoice_payments (business_id, invoice_id, paid_on, currency, amount, receivable_book, account_id, entry_id, created_by)
      values (current_business_id(), $1, '2026-04-26', 'MAD', 1, 1, $2, $3, 'owner')`, [id, k.bank, entry]))).rejects.toThrow(/more than is still owed/);
  });

  it('A FOREIGN INVOICE: issued at the day\'s rate with its rounding as an exchange line; each payment\'s realised gain posted; the receivable clears to 0 in both currencies', async () => {
    // three lines of 33.33 + 33.33 + 33.34 USD: each turned and rounded, they make 997.66 against the total's 997.65
    const dr = await draft('USD', [['1', '33.33', false], ['1', '33.33', false], ['1', '33.34', false]], '2026-04-09', null);
    if (dr.kind !== 'drafted') throw new Error(dr.reason);
    const issued = await issue(dr.id);
    expect(issued).toMatchObject({ kind: 'issued' });
    const fxAtIssue = await as((q) => q(`select a.code, l.debit::text, l.credit::text from journal_lines l join accounts a on a.id = l.account_id where l.entry_id = $1 and l.is_fx`,
      [(issued as { entryId: string }).entryId]));
    expect(fxAtIssue.rows).toEqual([{ code: '6331', debit: '0.01', credit: '0.00' }]);
    // paid 40 USD when the dollar is 10.10, then 60 when it is 10.00
    await as((q) => q(`insert into owner_rates (business_id, from_currency, to_currency, rate, stated_at) values (current_business_id(), 'USD', 'MAD', 10.10, '2026-05-01T09:00:00Z')`));
    const first = await pay(dr.id, '40', '2026-05-02');
    expect(first).toMatchObject({ kind: 'recorded', fx: '4.94' });          // received 404.00 for 399.06 of receivable
    await as((q) => q(`insert into owner_rates (business_id, from_currency, to_currency, rate, stated_at) values (current_business_id(), 'USD', 'MAD', 10.00, '2026-06-01T09:00:00Z')`));
    const second = await pay(dr.id, '60', '2026-06-02');
    expect(second).toMatchObject({ kind: 'recorded', fx: '1.41' });         // received 600.00 for the 598.59 left
    expect((await view(dr.id))!.status).toBe('paid');
    expect(await balance(k.receivable, dr.id, 'USD')).toEqual({ book: '0.00', own: '0.00' });
    expect(await balance(k.gain, dr.id)).toMatchObject({ book: '-6.35' });         // 4.94 + 1.41, a credit
  });

  it('TEN ISSUED AT ONCE: consecutive numbers, no gap, no repeat', async () => {
    const drafts: string[] = [];
    for (let i = 0; i < 10; i++) { const r = await draft('MAD', [['1', '1', false]], '2026-06-10'); if (r.kind !== 'drafted') throw new Error(r.reason); drafts.push(r.id); }
    const outs = await Promise.all(drafts.map((id) => issue(id)));
    expect(outs.every((o) => o.kind === 'issued')).toBe(true);
    const numbers = (await as((q) => q(`select number from invoices where year = 2026 and number is not null order by number`))).rows.map((r) => r.number as number);
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => i + 1));
  });

  it('the accountant cannot issue: the posting is refused, and no number is taken', async () => {
    const before = (await as((q) => q(`select max(number)::int as n from invoices`))).rows[0].n as number;
    await as((q) => q(`insert into people (business_id, name, kind) values (current_business_id(), 'Amal', 'accountant')`));
    const acct = (await as((q) => q(`select id::text as id from people where kind = 'accountant' limit 1`))).rows[0].id as string;
    const r = await draft('MAD', [['1', '5', false]], '2026-06-12');
    if (r.kind !== 'drafted') throw new Error(r.reason);
    expect(await issue(r.id, acct)).toMatchObject({ kind: 'refused', reason: 'accountant' });
    expect((await as((q) => q(`select max(number)::int as n from invoices`))).rows[0].n).toBe(before);
  });
});
