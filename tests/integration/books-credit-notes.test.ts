import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { asTenant, purgeBusinesses, type Q } from './books-db.js';

/**
 * D1b (Phase 5; 0188) — the done-criterion (PHASE-5.md §4): credit notes numbered without a gap from their own
 * counter; issuing posts the invoice's mirror; what is owed falls by it, and a paid invoice credited is owed back
 * (a refund, never more); more than an invoice's line has left is refused by the app and the database; a foreign
 * invoice's receivable clears to nothing in both currencies; a wholly credited invoice reads as credited, not paid.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `d1b00000-0000-4000-8000-${RUN}0001`;
const CODE = `credit-owner-${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const TODAY = '2026-12-01';

d('D1b · credit notes and refunds (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let admin: pg.Client;
  let tenant: pg.Client;
  let db: import('../../src/db/client.js').Db;
  let app: import('fastify').FastifyInstance;
  let inv: typeof import('../../src/db/booksInvoices.js');
  let cn: typeof import('../../src/db/booksCreditNotes.js');
  let owner = '';
  let accountant = '';
  let accountantId = '';
  let k: Record<'receivable' | 'sales' | 'tva' | 'bank' | 'loss' | 'gain' | 've' | 'bq' | 'party' | 'tax', string>;
  const as = <T>(fn: (q: Q) => Promise<T>) => asTenant(tenant, BIZ, fn);
  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };
  const dec = (s: string) => s as import('../../src/core/types/decimal.js').Decimal;
  /** An issued invoice: [quantity, price, taxed] per line. */
  const invoice = async (currency: string, lines: [string, string, boolean][], date = '2026-04-02') => {
    const dr = await tx((t) => inv.draftInvoice(t, BIZ, 'owner', { partyId: k.party, issueDate: date, dueDate: null, currency, label: null,
      lines: lines.map(([quantity, unitPrice, taxed]) => ({ label: `Sacs ${quantity}×${unitPrice}`, quantity: dec(quantity), unitPrice: dec(unitPrice), accountId: k.sales, taxCodeId: taxed ? k.tax : null })) }));
    if (dr.kind !== 'drafted') throw new Error(dr.reason);
    const is = await tx((t) => inv.issueInvoice(t, BIZ, dr.id, 'owner'));
    if (is.kind !== 'issued') throw new Error(is.reason);
    return dr.id;
  };
  const credit = (invoiceId: string, lines: [number, string][], date = '2026-04-20') =>
    tx((t) => cn.draftCreditNote(t, BIZ, 'owner', { invoiceId, issueDate: date, reason: 'Retour', lines: lines.map(([invoiceLineNo, q]) => ({ invoiceLineNo, quantity: dec(q) })) }));
  const issue = (id: string, by = 'owner') => tx((t) => cn.issueCreditNote(t, BIZ, id, by));
  const creditAndIssue = async (invoiceId: string, lines: [number, string][], date?: string) => {
    const c = await credit(invoiceId, lines, date); if (c.kind !== 'drafted') throw new Error(`${c.reason} ${c.detail}`);
    const i = await issue(c.id); if (i.kind !== 'issued') throw new Error(`${i.reason} ${i.detail}`);
    return { id: c.id, ...i };
  };
  const pay = (id: string, amount: string, on: string, refund = false) =>
    tx((t) => inv.recordPayment(t, BIZ, id, 'owner', { paidOn: on, amount: dec(amount), journalId: k.bq, accountId: k.bank, refund }));
  const view = (id: string) => tx((t) => inv.loadInvoice(t, BIZ, id, TODAY));
  /** An account's balance over ONE invoice's entries — its issue, its payments and refunds, its credit notes. */
  const balance = (account: string, invoiceId: string, currency = 'MAD') => as(async (q) => (await q(`select coalesce(sum(l.book_debit - l.book_credit), 0)::text as book,
      coalesce(sum(case when l.currency = $3 then l.debit - l.credit else 0 end), 0)::text as own
      from journal_lines l join journal_entries e on e.id = l.entry_id
     where l.account_id = $1 and e.state = 'posted'
       and e.id in (select entry_id from invoices where id = $2 union select entry_id from invoice_payments where invoice_id = $2
                    union select entry_id from credit_notes where invoice_id = $2 and entry_id is not null)`, [account, invoiceId, currency])).rows[0]);
  /** A write made in its own transaction and HELD open — so another can be started while it is not committed yet. */
  const held = async (text: string, values: unknown[]) => {
    const c = new pg.Client({ connectionString: DATABASE_URL }); await c.connect();
    await c.query('begin'); await c.query(`select set_config('app.business_id', $1, true)`, [BIZ]);
    await c.query(text, values);
    return { commit: async () => { await c.query('commit'); await c.end(); } };
  };
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const session = (r: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=')) ?? '';
  const notice = async (r: { headers: Record<string, unknown> }) => {
    const set = ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).join('; ');
    return (await app.inject({ method: 'GET', url: String(r.headers['location']).split('#')[0]!, headers: { cookie: `${owner}; ${set}` } })).body;
  };
  const post = (url: string, body: Record<string, string> = {}, who = owner) => app.inject({ method: 'POST', url, payload: new URLSearchParams(body).toString(),
    headers: { cookie: who, 'content-type': 'application/x-www-form-urlencoded' } });

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    tenant = new pg.Client({ connectionString: DATABASE_URL }); await tenant.connect();
    await admin.query(`insert into businesses (id, name, engine, country, currency, books_area) values ($1, $2, 'service', 'MA', 'MAD', true)`, [BIZ, `Credit ${RUN}`]);
    k = await as(async (q) => {
      const one = async (s: string, v: unknown[] = []) => (await q(s, v)).rows[0].id as string;
      const acc = (code: string, kind: string) => one(`insert into accounts (business_id, code, name, kind) values (current_business_id(), $1, $1, $2) returning id::text as id`, [code, kind]);
      const out = {
        receivable: await acc('3421', 'asset'), sales: await acc('7111', 'income'), tva: await acc('4455', 'liability'), bank: await acc('5141', 'asset'),
        loss: await acc('6331', 'expense'), gain: await acc('7331', 'income'),
        ve: await one(`insert into journals (business_id, code, name, kind) values (current_business_id(), 'VE', 'Ventes', 'sales') returning id::text as id`),
        bq: await one(`insert into journals (business_id, code, name, kind) values (current_business_id(), 'BQ', 'Banque', 'bank') returning id::text as id`),
        party: await one(`insert into parties (business_id, code, name, kind, country, address) values (current_business_id(), 'C001', 'Atlas Textiles SARL', 'customer', 'MA', '12 rue Ibn Battouta') returning id::text as id`),
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
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { addPerson } = await import('../../src/api/web/people.js');
    db = createDb(DATABASE_URL!);
    inv = await import('../../src/db/booksInvoices.js');
    cn = await import('../../src/db/booksCreditNotes.js');
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
    accountantId = (await admin.query(`select id::text as id from people where business_id = $1 and kind = 'accountant'`, [BIZ])).rows[0].id as string;
  });
  afterAll(async () => { await app?.close(); await db?.destroy(); await tenant?.end(); await purgeBusinesses(admin, [BIZ], 'books-credit-notes-test'); await admin?.end(); });

  it('A WHOLE CREDIT: A-2026-0001, the invoice\'s mirror posted — sales and tax debited, the receivable credited with the customer — and the invoice reads as credited', async () => {
    const id = await invoice('MAD', [['10', '100', true], ['1', '50', false]]);    // 1000 + 200 tax + 50
    const c = await creditAndIssue(id, [[1, '10'], [2, '1']]);
    expect(c.key).toBe('A-2026-0001');
    const lines = await as((q) => q(`select a.code, p.code as party, l.debit::text, l.credit::text from journal_lines l join accounts a on a.id = l.account_id
      left join parties p on p.id = l.party_id where l.entry_id = $1 order by l.line_no`, [c.entryId]));
    expect(lines.rows).toEqual([
      { code: '7111', party: null, debit: '1000.00', credit: '0.00' }, { code: '7111', party: null, debit: '50.00', credit: '0.00' },
      { code: '4455', party: null, debit: '200.00', credit: '0.00' }, { code: '3421', party: 'C001', debit: '0.00', credit: '1250.00' }]);
    const v = (await view(id))!;
    expect([v.status, v.credited, inv.owedOn(v.total, v.credited, v.paid)]).toEqual(['credited', '1250', '0']);
    expect(await balance(k.receivable, id)).toMatchObject({ book: '0.00' });
    // nothing left to credit: a further note is refused, by the app's figures and by the database
    expect(await credit(id, [[1, '1']])).toMatchObject({ kind: 'refused', reason: 'credit_more_than_left', detail: '1' });
  });

  it('A LINE CREDITED IN THIRDS comes to the cent: the last takes exactly what is left of its net and its tax', async () => {
    const id = await invoice('MAD', [['3', '33.33', true]]);                    // net 99.99, tax 20.00 (19.998)
    const parts = [await creditAndIssue(id, [[1, '1']]), await creditAndIssue(id, [[1, '1']]), await creditAndIssue(id, [[1, '1']])];
    const got = await as((q) => q(`select l.net::text as net, l.tax::text as tax from credit_note_lines l where l.credit_note_id = any($1) order by l.credit_note_id = $2, l.net`,
      [parts.map((p) => p.id), parts[2]!.id]));
    expect(got.rows).toEqual([{ net: '33.33', tax: '6.67' }, { net: '33.33', tax: '6.67' }, { net: '33.33', tax: '6.66' }]);   // 20.00 in all, never 20.01
    expect((await view(id))!.status).toBe('credited');
    expect(await balance(k.receivable, id)).toMatchObject({ book: '0.00' });
  });

  it('NEVER MORE THAN IS LEFT — refused by the database too, past the app; two notes at once cannot both take the same remainder', async () => {
    const id = await invoice('MAD', [['2', '100', false]]);
    const draftId = (await as((q) => q(`insert into credit_notes (business_id, invoice_id, issue_date, currency, reason, created_by)
      values (current_business_id(), $1, '2026-04-20', 'MAD', 'x', 'owner') returning id::text as id`, [id]))).rows[0].id as string;
    await expect(as((q) => q(`insert into credit_note_lines (business_id, credit_note_id, line_no, invoice_line_no, quantity, net, tax)
      values (current_business_id(), $1, 1, 1, 3, 300, 0)`, [draftId]))).rejects.toThrow(/more than is left of the invoice's line 1/);
    await expect(as((q) => q(`insert into credit_note_lines (business_id, credit_note_id, line_no, invoice_line_no, quantity, net, tax)
      values (current_business_id(), $1, 1, 1, 1, 99, 0)`, [draftId]))).rejects.toThrow(/quantity at the invoice line's price/);
    // two drafts for all of it: A is being issued (not committed yet) when B is issued — B waits for A, then is
    // refused, because the invoice is locked while a note is checked; without that, both would credit all of it
    const a = await credit(id, [[1, '2']]); const b = await credit(id, [[1, '2']]);
    if (a.kind !== 'drafted' || b.kind !== 'drafted') throw new Error('fixture');
    const first = await held(`update credit_notes set state = 'issued', issued_by = 'owner' where id = $1`, [a.id]);
    const second = issue(b.id);
    await pause(400);
    await first.commit();
    expect(await second).toMatchObject({ kind: 'refused', reason: 'credit_more_than_left' });
    expect((await view(id))!.credited).toBe('200');
  });

  it('NO GAP, ITS OWN COUNTER: a refused issue takes no number; ten at once are consecutive; the invoices\' numbers go on untouched', async () => {
    const before = (await as((q) => q(`select max(number)::int as n from credit_notes where state = 'issued'`))).rows[0].n as number;
    const usd = await invoice('USD', [['1', '10', false]]);
    const early = await credit(usd, [[1, '1']], '2026-03-01');   // before the invoice: refused at issue
    if (early.kind !== 'drafted') throw new Error('fixture');
    expect(await issue(early.id)).toMatchObject({ kind: 'refused', reason: 'credit_before_invoice', detail: '2026-04-02' });
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const c = await credit(await invoice('MAD', [['1', '1', false]]), [[1, '1']]); if (c.kind !== 'drafted') throw new Error('fixture'); ids.push(c.id);
    }
    const outs = await Promise.all(ids.map((id) => issue(id)));
    expect(outs.every((o) => o.kind === 'issued')).toBe(true);
    const nums = (await as((q) => q(`select number from credit_notes where id = any($1) order by number`, [ids]))).rows.map((r) => r.number as number);
    expect(nums).toEqual(Array.from({ length: 10 }, (_, i) => before + 1 + i));
    const invoiceNumbers = (await as((q) => q(`select number from invoices where state = 'issued' order by number`))).rows.map((r) => r.number as number);
    expect(invoiceNumbers).toEqual(Array.from({ length: invoiceNumbers.length }, (_, i) => i + 1));
  });

  it('PAID, THEN CREDITED: the customer is owed back — a refund, never more; refunded, the invoice reads as paid for what stood', async () => {
    const id = await invoice('MAD', [['10', '100', false]]);
    expect(await pay(id, '1000', '2026-04-10')).toMatchObject({ kind: 'recorded' });
    expect((await view(id))!.status).toBe('paid');
    await creditAndIssue(id, [[1, '4']]);
    expect((await view(id))!.status).toBe('refund_due');
    expect(await pay(id, '1', '2026-04-21')).toMatchObject({ kind: 'refused', reason: 'too_much' });
    expect(await pay(id, '400.01', '2026-04-21', true)).toMatchObject({ kind: 'refused', reason: 'too_much_refund', detail: '400 MAD' });
    // past the app: the database refuses a refund beyond what is owed back
    const entry = (await as((q) => q(`select entry_id::text as e from invoice_payments where invoice_id = $1 limit 1`, [id]))).rows[0].e;
    await expect(as((q) => q(`insert into invoice_payments (business_id, invoice_id, paid_on, currency, amount, receivable_book, account_id, entry_id, created_by, kind)
      values (current_business_id(), $1, '2026-04-21', 'MAD', 500, -500, $2, $3, 'owner', 'refund')`, [id, k.bank, entry]))).rejects.toThrow(/more than the customer is owed back/);
    expect(await pay(id, '400', '2026-04-21', true)).toMatchObject({ kind: 'recorded' });
    const v = (await view(id))!;
    expect([v.status, v.paid, v.credited]).toEqual(['paid', '600', '400']);
    expect(await balance(k.receivable, id)).toMatchObject({ book: '0.00' });
    expect(await balance(k.bank, id)).toMatchObject({ book: '600.00' });
  });

  it('TWO PAYMENTS AT ONCE cannot pay an invoice twice: the invoice is locked while each is checked (C2 did not lock)', async () => {
    const id = await invoice('MAD', [['1', '300', false]]);
    const entry = (await as((q) => q(`select entry_id::text as e from invoices where id = $1`, [id]))).rows[0].e as string;
    // A pays all of it and is not committed yet when B pays all of it too: B waits for A, then is refused
    const first = await held(`insert into invoice_payments (business_id, invoice_id, paid_on, currency, amount, receivable_book, account_id, entry_id, created_by)
      values (current_business_id(), $1, '2026-04-11', 'MAD', 300, 300, $2, $3, 'owner')`, [id, k.bank, entry]);
    const second = pay(id, '300', '2026-04-11');
    await pause(400);
    await first.commit();
    expect(await second).toMatchObject({ kind: 'refused' });
    expect((await view(id))!.paid).toBe('300');
  });

  it('A FOREIGN INVOICE credited at a later rate: the receivable clears to nothing in MAD and in USD, the difference a marked exchange line', async () => {
    const id = await invoice('USD', [['1', '100', false]]);                     // 997.65 MAD at 9.9765
    await as((q) => q(`insert into owner_rates (business_id, from_currency, to_currency, rate, stated_at) values (current_business_id(), 'USD', 'MAD', 10.10, '2026-04-15T09:00:00Z')`));
    const part = await creditAndIssue(id, [[1, '0.4']]);                         // 40 USD, 404.00 at the day's rate, 399.06 of the receivable
    const fx = await as((q) => q(`select a.code, l.debit::text, l.credit::text, l.is_fx from journal_lines l join accounts a on a.id = l.account_id
      where l.entry_id = $1 and l.currency = 'MAD' order by l.line_no`, [part.entryId]));
    expect(fx.rows).toEqual([{ code: '3421', debit: '4.94', credit: '0.00', is_fx: false }, { code: '7331', debit: '0.00', credit: '4.94', is_fx: true }]);
    expect(await pay(id, '60', '2026-04-25')).toMatchObject({ kind: 'recorded', fx: '7.41' });   // 606.00 for the 598.59 left
    expect((await view(id))!.status).toBe('paid');
    expect(await balance(k.receivable, id, 'USD')).toEqual({ book: '0.00', own: '0.00' });
  });

  it('AN ISSUED CREDIT NOTE NEVER CHANGES; its customer is the INVOICE\'s copy, whatever the party became', async () => {
    const id = await invoice('MAD', [['1', '80', false]]);
    await as((q) => q(`update parties set name = 'Atlas (renamed)' where id = $1`, [k.party]));
    try {
      const c = await creditAndIssue(id, [[1, '1']]);
      expect((await as((q) => q(`select party_name, party_address from credit_notes where id = $1`, [c.id]))).rows[0]).toEqual({ party_name: 'Atlas Textiles SARL', party_address: '12 rue Ibn Battouta' });
      await expect(as((q) => q(`update credit_notes set reason = 'other' where id = $1`, [c.id]))).rejects.toThrow(/an issued credit note never changes/);
      await expect(as((q) => q(`update credit_note_lines set quantity = 0.5, net = 40 where credit_note_id = $1`, [c.id]))).rejects.toThrow(/an issued credit note never changes/);
      await expect(as((q) => q(`update credit_note_counters set last_number = 1`))).rejects.toThrow(/permission denied/);
    } finally {
      await as((q) => q(`update parties set name = 'Atlas Textiles SARL' where id = $1`, [k.party]));
    }
  });

  it('THE ACCOUNTANT makes, issues and refunds nothing: refused by the database, and by the routes', async () => {
    const id = await invoice('MAD', [['1', '70', false]]);
    const { asViewer } = await import('../../src/db/viewer.js');
    const theirs = await asViewer(accountantId, () => credit(id, [[1, '1']]));
    expect(theirs.kind).toBe('refused');
    const tried = await post(`/app/books/invoices/${id}/credit-notes`, { issueDate: '2026-04-20', reason: 'x', qty1: '1' }, accountant);
    expect([tried.statusCode, tried.headers['location']]).toEqual([302, '/app/books']);
    expect((await as((q) => q(`select count(*)::int as n from credit_notes where invoice_id = $1`, [id]))).rows[0].n).toBe(0);
  });

  it('ON THE PAGES: from the invoice, a credit note drafted, issued, listed on its invoice', async () => {
    const id = await invoice('MAD', [['5', '20', false]]);
    const form = await app.inject({ method: 'GET', url: `/app/books/invoices/${id}/credit-notes/new`, headers: { cookie: owner } });
    expect(form.statusCode).toBe(200);
    expect(form.body).toContain('name="qty1"');
    expect((await post(`/app/books/invoices/${id}/credit-notes`, { issueDate: '2026-04-20', reason: '', qty1: '1' })).body).toContain('Give the reason for the credit note.');
    const r = await post(`/app/books/invoices/${id}/credit-notes`, { issueDate: '2026-04-20', reason: 'Two bags torn', qty1: '2' });
    expect(await notice(r)).toContain('Saved as a draft.');
    const noteId = String(r.headers['location']).split('/').pop()!;
    const issued = await notice(await post(`/app/books/credit-notes/${noteId}/issue`));
    expect(issued).toMatch(/Issued as A-2026-\d{4}, and its entry posted\./);
    const page = (await app.inject({ method: 'GET', url: `/app/books/invoices/${id}`, headers: { cookie: owner } })).body;
    expect(page).toContain('Credit notes');
    expect(page).toContain(`/app/books/credit-notes/${noteId}`);
    expect(page).toContain('Credited');
    expect((await app.inject({ method: 'GET', url: `/app/books/credit-notes/${noteId}`, headers: { cookie: accountant } })).statusCode).toBe(200);
  });
});
