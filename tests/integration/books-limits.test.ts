import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { asTenant, purgeBusinesses, type Q } from './books-db.js';

/**
 * 0216 — THE BOOKS' DISCLOSED LIMITS, LIFTED (PHASE-5.md §10; the owner, 2026-10-26: "list 3 — all in 100%"), on the
 * real database:
 *   (c) a payment in another currency than its invoice — the difference between what arrived and what it settled, at
 *       the owner's rates, an exchange gain or loss to the cent, both ways, for a payment in and a refund out;
 *   (b) a credit note that lowers a price with nothing given back;
 *   (f) the opening journal, which takes the opening entry and nothing else.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `b0216000-0000-4000-8000-${RUN}0001`;

d('0216 · the books\' limits lifted (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let admin: pg.Client;
  let tenant: pg.Client;
  let db: import('../../src/db/client.js').Db;
  let inv: typeof import('../../src/db/booksInvoices.js');
  let cn: typeof import('../../src/db/booksCreditNotes.js');
  let k: Record<'receivable' | 'sales' | 'bank' | 'loss' | 'gain' | 've' | 'bq' | 'od' | 'an' | 'party', string>;
  const as = <T>(fn: (q: Q) => Promise<T>) => asTenant(tenant, BIZ, fn);
  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };
  const dec = (s: string) => s as import('../../src/core/types/decimal.js').Decimal;
  /** An issued invoice of one untaxed line: `quantity` × `price`, in `currency`. */
  const issued = async (currency: string, quantity = '1', price = '100') => {
    const dr = await tx((t) => inv.draftInvoice(t, BIZ, 'owner', { partyId: k.party, issueDate: '2026-04-02', dueDate: null, currency, label: null,
      lines: [{ label: 'Sacs en toile', quantity: dec(quantity), unitPrice: dec(price), accountId: k.sales, taxCodeId: null }] }));
    if (dr.kind !== 'drafted') throw new Error(dr.reason);
    const out = await tx((t) => inv.issueInvoice(t, BIZ, dr.id, 'owner'));
    if (out.kind !== 'issued') throw new Error(out.reason);
    return dr.id;
  };
  const money = (id: string, amount: string, o: { refund?: boolean; paid?: { currency: string; amount: string | null } } = {}) =>
    tx((t) => inv.recordPayment(t, BIZ, id, 'owner', { paidOn: '2026-04-05', amount: dec(amount), journalId: k.bq, accountId: k.bank,
      refund: o.refund ?? false, paid: o.paid ? { currency: o.paid.currency, amount: o.paid.amount === null ? null : dec(o.paid.amount) } : null }));
  /** An account's balance over ONE invoice's entries (issue, payments, credit notes): in the books' currency, and in `currency`. */
  const balance = (account: string, invoiceId: string, currency: string) => as(async (q) => (await q(`select coalesce(sum(l.book_debit - l.book_credit), 0)::text as book,
      coalesce(sum(case when l.currency = $3 then l.debit - l.credit else 0 end), 0)::text as own
      from journal_lines l join journal_entries e on e.id = l.entry_id
     where l.account_id = $1 and e.state = 'posted'
       and e.id in (select entry_id from invoices where id = $2 union select entry_id from invoice_payments where invoice_id = $2
                    union select entry_id from credit_notes where invoice_id = $2)`, [account, invoiceId, currency])).rows[0]);
  const fxOf = (entryId: string) => as(async (q) => (await q(`select a.code, l.debit::text as debit, l.credit::text as credit from journal_lines l
      join accounts a on a.id = l.account_id where l.entry_id = $1 and l.is_fx order by l.line_no`, [entryId])).rows);
  /** A credit note lowering line 1's price by `by`, issued on 2026-04-06. */
  const lowered = async (invoiceId: string, by: string) => {
    const dr = await tx((t) => cn.draftCreditNote(t, BIZ, 'owner', { invoiceId, issueDate: '2026-04-06', reason: 'Dommage',
      lines: [{ invoiceLineNo: 1, quantity: dec('0'), reduction: dec(by) }] }));
    if (dr.kind !== 'drafted') return dr;
    return tx((t) => cn.issueCreditNote(t, BIZ, dr.id, 'owner'));
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    tenant = new pg.Client({ connectionString: DATABASE_URL }); await tenant.connect();
    await admin.query(`insert into businesses (id, name, engine, country, currency, books_area) values ($1, $2, 'service', 'MA', 'MAD', true)`, [BIZ, `Limits ${RUN}`]);
    k = await as(async (q) => {
      const one = async (s: string, v: unknown[] = []) => (await q(s, v)).rows[0].id as string;
      const acc = (code: string, kind: string) => one(`insert into accounts (business_id, code, name, kind) values (current_business_id(), $1, $1, $2) returning id::text as id`, [code, kind]);
      const journal = (code: string, kind: string) => one(`insert into journals (business_id, code, name, kind) values (current_business_id(), $1, $1, $2) returning id::text as id`, [code, kind]);
      const out = {
        receivable: await acc('3421', 'asset'), sales: await acc('7111', 'income'), bank: await acc('5141', 'asset'),
        loss: await acc('6331', 'expense'), gain: await acc('7331', 'income'),
        ve: await journal('VE', 'sales'), bq: await journal('BQ', 'bank'), od: await journal('OD', 'general'), an: await journal('AN', 'opening'),
        party: await one(`insert into parties (business_id, code, name, kind, country) values (current_business_id(), 'C001', 'Atlas Textiles SARL', 'customer', 'MA') returning id::text as id`),
      };
      await q(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2026-01-01', '2026-12-31')`);
      await q(`insert into books_settings (business_id, sales_journal_id, receivable_account_id, sales_account_id, fx_loss_account_id, fx_gain_account_id)
        values (current_business_id(), $1, $2, $3, $4, $5)`, [out.ve, out.receivable, out.sales, out.loss, out.gain]);
      await q(`insert into owner_rates (business_id, from_currency, to_currency, rate, stated_at) values (current_business_id(), 'USD', 'MAD', 9.9765, '2026-04-01T09:00:00Z')`);
      await q(`insert into owner_rates (business_id, from_currency, to_currency, rate, stated_at) values (current_business_id(), 'CNY', 'MAD', 1.384567, '2026-04-01T09:00:00Z')`);
      return out;
    });
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    inv = await import('../../src/db/booksInvoices.js');
    cn = await import('../../src/db/booksCreditNotes.js');
  });
  afterAll(async () => { await db?.destroy(); await tenant?.end(); await purgeBusinesses(admin, [BIZ], 'books-limits-test'); await admin?.end(); });

  // ── (c) ──────────────────────────────────────────────────────────────────────────────────────────────────────
  it('(c) PAID IN YUAN, A LOSS TO THE CENT: 100 USD settled by 720.33 CNY — 997.35 arrived for 997.65 owed, 0.30 on the loss account', async () => {
    const id = await issued('USD');
    const out = await money(id, '100', { paid: { currency: 'CNY', amount: '720.33' } });
    if (out.kind !== 'recorded') throw new Error(out.reason);
    expect(Number(out.fx)).toBe(-0.3);
    expect(await fxOf(out.entryId)).toEqual([{ code: '6331', debit: '0.30', credit: '0.00' }]);
    // the bank holds what arrived, in its own currency; the receivable is gone in both
    expect(await balance(k.bank, id, 'CNY')).toEqual({ book: '997.35', own: '720.33' });
    expect(await balance(k.receivable, id, 'USD')).toEqual({ book: '0.00', own: '0.00' });
    const e = await as(async (q) => (await q(`select across_currencies as a, state from journal_entries where id = $1`, [out.entryId])).rows[0]);
    expect(e).toEqual({ a: true, state: 'posted' });
    const p = await as(async (q) => (await q(`select currency, amount::text, paid_currency, paid_amount::text from invoice_payments where invoice_id = $1`, [id])).rows[0]);
    expect(p).toEqual({ currency: 'USD', amount: '100.00', paid_currency: 'CNY', paid_amount: '720.33' });
    expect((await tx((t) => inv.loadInvoice(t, BIZ, id, '2026-04-10')))!.status).toBe('paid');
  });

  it('(c) PAID IN THE BOOKS\' OWN MONEY, A GAIN: 100 USD settled by 1,003.10 MAD — 5.45 on the gain account', async () => {
    const id = await issued('USD');
    const out = await money(id, '100', { paid: { currency: 'MAD', amount: '1003.10' } });
    if (out.kind !== 'recorded') throw new Error(out.reason);
    expect(Number(out.fx)).toBe(5.45);
    expect(await fxOf(out.entryId)).toEqual([{ code: '7331', debit: '0.00', credit: '5.45' }]);
    expect(await balance(k.bank, id, 'MAD')).toEqual({ book: '1003.10', own: '1003.10' });
    expect(await balance(k.receivable, id, 'USD')).toEqual({ book: '0.00', own: '0.00' });
  });

  it('(c) A REFUND OUT IN YUAN, BOTH WAYS: more yuan out than the 20 USD was worth is a loss, less is a gain — the receivable clears', async () => {
    // each invoice paid in full, then lowered by 20 USD (b): the customer is owed 20 USD back (199.53 at the day's rate)
    for (const [cny, fx, line] of [['150', '-8.16', { code: '6331', debit: '8.16', credit: '0.00' }], ['140', '5.69', { code: '7331', debit: '0.00', credit: '5.69' }]] as const) {
      const id = await issued('USD');
      expect(Number(((await money(id, '100')) as { fx: string }).fx)).toBe(0);
      expect(await lowered(id, '20')).toMatchObject({ kind: 'issued' });
      const out = await money(id, '20', { refund: true, paid: { currency: 'CNY', amount: cny } });
      if (out.kind !== 'recorded') throw new Error(out.reason);
      expect(Number(out.fx)).toBe(Number(fx));
      expect(await fxOf(out.entryId)).toEqual([line]);
      expect(await balance(k.receivable, id, 'USD')).toEqual({ book: '0.00', own: '0.00' });
    }
  });

  it('(c) REFUSED, NOTHING WRITTEN: another currency with no amount, a currency with no rate of hers; the same currency is an ordinary payment', async () => {
    const id = await issued('USD');
    expect(await money(id, '100', { paid: { currency: 'CNY', amount: null } })).toEqual({ kind: 'refused', reason: 'arrived_missing', detail: 'CNY' });
    expect(await money(id, '100', { paid: { currency: 'EUR', amount: '92' } })).toMatchObject({ kind: 'refused', reason: 'no_rate' });
    expect(await as(async (q) => (await q(`select count(*)::int as n from invoice_payments where invoice_id = $1`, [id])).rows[0].n)).toBe(0);
    const plain = await money(id, '100', { paid: { currency: 'USD', amount: '100' } });
    if (plain.kind !== 'recorded') throw new Error(plain.reason);
    expect(await as(async (q) => (await q(`select across_currencies as a from journal_entries where id = $1`, [plain.entryId])).rows[0].a)).toBe(false);
    expect(await as(async (q) => (await q(`select paid_currency from invoice_payments where invoice_id = $1`, [id])).rows[0].paid_currency)).toBeNull();
  });

  it('(c) THE DATABASE: only a bank or cash entry takes the mark; an entry without it still balances in each foreign currency', async () => {
    const tried = (journal: string, across: boolean) => as(async (q) => {
      await q('savepoint s');
      try {
        const e = (await q(`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, document_ref, document_date, created_by, across_currencies)
          values (current_business_id(), $1, (select id from fiscal_years where business_id = current_business_id()), '2026-04-07', 'x', 'R-1', '2026-04-07', 'owner', $2) returning id`, [journal, across])).rows[0].id;
        await q(`insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, credit) values (current_business_id(), $1, 1, $2, 'CNY', 100, 0)`, [e, k.bank]);
        await q(`insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, credit) values (current_business_id(), $1, 2, $2, 'MAD', 0, 138.46)`, [e, k.sales]);
        await q(`update journal_entries set state = 'posted', posted_by = 'owner' where id = $1`, [e]);
        await q('release savepoint s');
        return 'posted';
      } catch (err) { await q('rollback to savepoint s'); return (err as { code?: string }).code; }
    });
    expect(await tried(k.od, true)).toBe('NB028');
    expect(await tried(k.bq, false)).toBe('NB009');
    expect(await tried(k.bq, true)).toBe('posted');
  });

  // ── (b) ──────────────────────────────────────────────────────────────────────────────────────────────────────
  it('(b) A PRICE LOWERED, NOTHING RETURNED: quantity 0, its amount; never more than is left; a return then takes what is left', async () => {
    const id = await issued('MAD', '10', '10');
    expect(await lowered(id, '30')).toMatchObject({ kind: 'issued' });
    const lines = await as(async (q) => (await q(`select l.quantity::text as quantity, l.net::text as net from credit_note_lines l
      join credit_notes c on c.id = l.credit_note_id where c.invoice_id = $1`, [id])).rows);
    expect(lines.map((l) => [Number(l.quantity), l.net])).toEqual([[0, '30.00']]);
    expect(await lowered(id, '70.01')).toMatchObject({ kind: 'refused' });
    // all ten given back now takes the 70.00 that is left, not the 100.00 they were billed at
    const back = await tx((t) => cn.draftCreditNote(t, BIZ, 'owner', { invoiceId: id, issueDate: '2026-04-06', reason: 'Retour', lines: [{ invoiceLineNo: 1, quantity: dec('10') }] }));
    if (back.kind !== 'drafted') throw new Error(back.reason);
    expect(await as(async (q) => (await q(`select net::text from credit_note_lines where credit_note_id = $1`, [back.id])).rows[0].net)).toBe('70.00');
    expect(await tx((t) => cn.issueCreditNote(t, BIZ, back.id, 'owner'))).toMatchObject({ kind: 'issued' });
    expect(await balance(k.receivable, id, 'MAD')).toEqual({ book: '0.00', own: '0.00' });
  });

  // ── (a) ──────────────────────────────────────────────────────────────────────────────────────────────────────
  it('(a) A DRAFT ENTRY EDITED: its header and lines as given, the old lines gone; posted, it is refused and unchanged', async () => {
    const en = await import('../../src/db/booksEntries.js');
    const line = (accountId: string, debit: string | null, credit: string | null) =>
      ({ accountId, partyId: null, taxCodeId: null, currency: 'MAD', debit: debit === null ? null : dec(debit), credit: credit === null ? null : dec(credit), label: null, isFx: false });
    const base = { journalId: k.od, date: '2026-04-08', label: 'Frais', documentRef: 'P-1', documentDate: '2026-04-08' };
    const made = await tx((t) => en.draftEntry(t, BIZ, 'owner', { ...base, lines: [line(k.sales, '10', null), line(k.bank, null, '10')] }));
    if (made.kind !== 'drafted') throw new Error(made.reason);
    const form = await tx((t) => en.draftEntryForm(t, BIZ, made.id));
    expect(form).toMatchObject({ journal: k.od, date: '2026-04-08', label: 'Frais', documentRef: 'P-1', account0: k.sales, debit0: '10', credit1: '10' });
    const again = await tx((t) => en.redraftEntry(t, BIZ, made.id, { ...base, label: 'Frais de port', lines: [line(k.sales, '12.50', null), line(k.bank, null, '7.50'), line(k.loss, null, '5')] }));
    expect(again).toEqual({ kind: 'drafted', id: made.id });
    const rows = await as(async (q) => (await q(`select line_no, debit::text, credit::text from journal_lines where entry_id = $1 order by line_no`, [made.id])).rows);
    expect(rows).toEqual([{ line_no: 1, debit: '12.50', credit: '0.00' }, { line_no: 2, debit: '0.00', credit: '7.50' }, { line_no: 3, debit: '0.00', credit: '5.00' }]);
    expect(await as(async (q) => (await q(`select label from journal_entries where id = $1`, [made.id])).rows[0].label)).toBe('Frais de port');
    expect(await tx((t) => en.postEntry(t, BIZ, made.id, 'owner'))).toMatchObject({ kind: 'posted' });
    expect(await tx((t) => en.redraftEntry(t, BIZ, made.id, { ...base, lines: [line(k.sales, '1', null), line(k.bank, null, '1')] }))).toMatchObject({ kind: 'refused', reason: 'not_a_draft' });
    expect(await as(async (q) => (await q(`select count(*)::int as n from journal_lines where entry_id = $1`, [made.id])).rows[0].n)).toBe(3);
    expect(await tx((t) => en.draftEntryForm(t, BIZ, made.id))).toBeNull();
  });

  it('(a) A DRAFT INVOICE EDITED, then issued as edited; an issued one is never edited', async () => {
    const dr = await tx((t) => inv.draftInvoice(t, BIZ, 'owner', { partyId: k.party, issueDate: '2026-04-02', dueDate: null, currency: 'MAD', label: null,
      lines: [{ label: 'Sacs', quantity: dec('2'), unitPrice: dec('10'), accountId: k.sales, taxCodeId: null }] }));
    if (dr.kind !== 'drafted') throw new Error(dr.reason);
    expect(await tx((t) => inv.draftInvoiceForm(t, BIZ, dr.id))).toMatchObject({ party: k.party, quantity0: '2', price0: '10', label0: 'Sacs' });
    const input = { partyId: k.party, issueDate: '2026-04-03', dueDate: '2026-05-03', currency: 'MAD', label: 'Commande 7',
      lines: [{ label: 'Sacs', quantity: dec('3'), unitPrice: dec('10'), accountId: k.sales, taxCodeId: null }, { label: 'Port', quantity: dec('1'), unitPrice: dec('4.5'), accountId: k.sales, taxCodeId: null }] };
    expect(await tx((t) => inv.redraftInvoice(t, BIZ, dr.id, input))).toEqual({ kind: 'drafted', id: dr.id });
    expect(await tx((t) => inv.issueInvoice(t, BIZ, dr.id, 'owner'))).toMatchObject({ kind: 'issued' });
    const v = (await tx((t) => inv.loadInvoice(t, BIZ, dr.id, '2026-04-10')))!;
    expect([v.total, v.label, v.issueDate, v.lines.length]).toEqual(['34.5', 'Commande 7', '2026-04-03', 2]);
    expect(await tx((t) => inv.redraftInvoice(t, BIZ, dr.id, input))).toMatchObject({ kind: 'refused', reason: 'not_a_draft' });
  });

  it('(a) A DRAFT CREDIT NOTE EDITED: a return becomes a price lowered; issued, it is never edited', async () => {
    const id = await issued('MAD', '10', '10');
    const dr = await tx((t) => cn.draftCreditNote(t, BIZ, 'owner', { invoiceId: id, issueDate: '2026-04-06', reason: 'Retour', lines: [{ invoiceLineNo: 1, quantity: dec('2') }] }));
    if (dr.kind !== 'drafted') throw new Error(dr.reason);
    expect((await tx((t) => cn.draftCreditForm(t, BIZ, dr.id)))!.values).toMatchObject({ qty1: '2', red1: '', reason: 'Retour' });
    expect(await tx((t) => cn.redraftCreditNote(t, BIZ, dr.id, { issueDate: '2026-04-07', reason: 'Dommage', lines: [{ invoiceLineNo: 1, quantity: dec('0'), reduction: dec('15') }] })))
      .toEqual({ kind: 'drafted', id: dr.id });
    expect((await tx((t) => cn.draftCreditForm(t, BIZ, dr.id)))!.values).toMatchObject({ qty1: '0', red1: '15', reason: 'Dommage', issueDate: '2026-04-07' });
    expect(await tx((t) => cn.issueCreditNote(t, BIZ, dr.id, 'owner'))).toMatchObject({ kind: 'issued' });
    expect(await tx((t) => cn.redraftCreditNote(t, BIZ, dr.id, { issueDate: '2026-04-07', reason: 'x', lines: [{ invoiceLineNo: 1, quantity: dec('1') }] })))
      .toMatchObject({ kind: 'refused', reason: 'not_a_draft' });
  });

  it('(a) THE ONE DOOR clears only a draft of the viewer\'s own workspace, and never for an accountant', async () => {
    const other = `b0216000-0000-4000-8000-${RUN}0002`;
    await admin.query(`insert into businesses (id, name, engine, country, currency) values ($1, $2, 'service', 'MA', 'MAD')`, [other, `Other ${RUN}`]);
    try {
      const theirs = (await admin.query(`insert into journals (business_id, code, name, kind) values ($1, 'OD', 'OD', 'general') returning id`, [other])).rows[0].id;
      await admin.query(`insert into fiscal_years (business_id, starts_on, ends_on) values ($1, '2026-01-01', '2026-12-31')`, [other]);
      const e = (await admin.query(`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by)
        values ($1, $2, (select id from fiscal_years where business_id = $1), '2026-04-08', 'x', 'owner') returning id`, [other, theirs])).rows[0].id;
      expect(await as(async (q) => (await q(`select books_clear_draft('entry', $1) as ok`, [e])).rows[0].ok)).toBe(false);
      const acc = (await admin.query(`insert into people (business_id, name, kind) values ($1, 'Comptable', 'accountant') returning id::text as id`, [BIZ])).rows[0].id;
      const refused = await as(async (q) => {
        await q('savepoint s');
        try { await q(`select set_config('app.viewer_id', $1, true)`, [acc]); await q(`select books_clear_draft('entry', $1)`, [e]); await q('release savepoint s'); return 'cleared'; }
        catch (err) { await q('rollback to savepoint s'); return (err as { code?: string }).code; }
      });
      expect(refused).toBe('NB021');
    } finally { await purgeBusinesses(admin, [other], 'books-limits-test'); }
  });

  // ── (f) ──────────────────────────────────────────────────────────────────────────────────────────────────────
  it('(f) THE OPENING JOURNAL takes the opening entry, on its year\'s first day, and nothing else', async () => {
    const entry = (day: string) => as(async (q) => {
      await q('savepoint s');
      try {
        await q(`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by)
          values (current_business_id(), $1, (select id from fiscal_years where business_id = current_business_id()), $2, 'À-nouveaux', 'owner')`, [k.an, day]);
        await q('release savepoint s');
        return 'drafted';
      } catch (err) { await q('rollback to savepoint s'); return (err as { code?: string }).code; }
    });
    expect(await entry('2026-01-01')).toBe('drafted');
    expect(await entry('2026-03-01')).toBe('NB027');
  });
});
