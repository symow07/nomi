import { sql } from 'kysely';
import type { Tx } from './client.js';
import {
  addDecimal, compareDecimal, divDecimal, mulDecimal, parseDecimal, roundDecimal, signOf, subDecimal, type Decimal,
} from '../core/types/decimal.js';
import { draftEntry, postEntry, refusalOf, type DraftLine, type EntryRefusal } from './booksEntries.js';
import { booksAccountsOf } from './booksOrders.js';

/**
 * C2 (Phase 5, item 5; 0184) — INVOICES AND PAYMENTS. The rules are the database's: the number is taken at issue
 * from the invoice's own counter, with no gap; an issued invoice never changes; a line's net and tax are checked to
 * the cent; a payment is in its invoice's currency and never more than is owed. This file builds the two entries
 * the rules call for and turns a refusal into its reason.
 *
 *   ISSUE    one transaction: the number, then the entry — the receivable debited with the total (the party on it),
 *            each line's net credited to its sales account, each tax code's tax to its tax account. A foreign invoice's
 *            lines are each turned at the owner's rate on the day (A3) and each rounded; what that leaves in the
 *            books' currency is its own marked line on the exchange accounts (0182). Any refusal: no number was taken.
 *   PAYMENT  the bank debited, the receivable credited — relieved at the receivable's OWN value in the books'
 *            currency (its share of what issuing booked; the last payment takes exactly what is left), never at the
 *            payment day's rate. The difference between that and what the bank received is the realised exchange
 *            gain or loss, its own marked line.
 *   REFUND   (D1b, 0188) money out to a customer owed it back after a credit note: the receivable debited, the bank
 *            credited; the refund that settles the invoice brings its receivable to exactly nothing, the difference
 *            again a marked line. A payment, a refund and a credit note all move the receivable by ONE rule
 *            (`receivableMove`), and each stores what it moved in the books' currency.
 */
const d = (v: string): Decimal => parseDecimal(v)!;
export const invoiceKey = (year: number, number: number): string => `F-${year}-${String(number).padStart(4, '0')}`;
export const creditNoteKey = (year: number, number: number): string => `A-${year}-${String(number).padStart(4, '0')}`;

export type InvoiceStatus = 'draft' | 'open' | 'partly_paid' | 'paid' | 'overdue' | 'credited' | 'refund_due' | 'discarded';
export type InvoiceRow = {
  readonly id: string; readonly key: string | null; readonly party: string; readonly issueDate: string; readonly dueDate: string | null;
  readonly currency: string; readonly total: Decimal; readonly credited: Decimal; readonly paid: Decimal; readonly status: InvoiceStatus; readonly label: string | null;
};
/** Who the invoice is to: once issued, as the database copied it then (0187) — never read again from the party. */
export type BilledTo = {
  readonly code: string; readonly name: string; readonly address: string | null; readonly country: string | null;
  readonly ice: string | null; readonly taxNumber: string | null; readonly asIssued: boolean;
  /** R3 (0210) — the company registry number, the SIRET (France) and the Registro Mercantil entry (Spain). */
  readonly registry: string | null; readonly siret: string | null; readonly registro: string | null;
};
export type InvoiceView = InvoiceRow & {
  readonly entryId: string | null;
  readonly billedTo: BilledTo;
  readonly lines: readonly { lineNo: number; label: string; quantity: string; unitPrice: string; account: string; taxCode: string | null; net: Decimal; tax: Decimal }[];
  readonly payments: readonly { paidOn: string; amount: Decimal; account: string; entryId: string; refund: boolean }[];
  readonly creditNotes: readonly { id: string; key: string | null; state: string; issueDate: string; total: Decimal }[];
};

/** What is owed on an issued invoice: its total, less what credit notes credited, less what was paid (net of refunds). */
export const owedOn = (total: Decimal, credited: Decimal, paid: Decimal): Decimal => subDecimal(subDecimal(total, credited), paid);

export function statusOf(state: string, total: Decimal, credited: Decimal, paid: Decimal, due: string | null, today: string): InvoiceStatus {
  if (state === 'draft' || state === 'discarded') return state;
  const owed = owedOn(total, credited, paid);
  if (signOf(owed) < 0) return 'refund_due';
  // nothing owed: paid (some of it was paid), or credited (none of it was — wholly credited, or credited and refunded)
  if (signOf(owed) === 0) return signOf(paid) > 0 ? 'paid' : 'credited';
  if (due !== null && due < today) return 'overdue';
  return signOf(paid) > 0 ? 'partly_paid' : 'open';
}

export async function listInvoices(tx: Tx, businessId: string, today: string): Promise<InvoiceRow[]> {
  const rows = (await sql<{ id: string; year: number | null; number: number | null; party: string; issue_date: string; due_date: string | null;
    currency: string; total: string; credited: string; paid: string; state: string; label: string | null }>`
    select i.id::text as id, i.year, i.number, coalesce(i.party_name, p.name) as party, i.issue_date::text as issue_date, i.due_date::text as due_date, i.currency,
           invoice_total(i.id)::text as total, invoice_credited(i.id)::text as credited, invoice_paid(i.id)::text as paid, i.state, i.label
      from invoices i join parties p on p.id = i.party_id
     where i.business_id = ${businessId}::uuid and i.state <> 'discarded'
     order by i.issue_date desc, i.number desc nulls first, i.created_at desc limit 100`.execute(tx)).rows;
  return rows.map((r) => ({ id: r.id, key: r.number === null ? null : invoiceKey(r.year!, r.number), party: r.party, issueDate: r.issue_date,
    dueDate: r.due_date, currency: r.currency, total: d(r.total), paid: d(r.paid), label: r.label,
    credited: d(r.credited), status: statusOf(r.state, d(r.total), d(r.credited), d(r.paid), r.due_date, today) }));
}

export async function loadInvoice(tx: Tx, businessId: string, id: string, today: string): Promise<InvoiceView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = (await sql<{ year: number | null; number: number | null; party: string; issue_date: string; due_date: string | null; currency: string;
    total: string; credited: string; paid: string; state: string; label: string | null; entry_id: string | null; as_issued: boolean;
    b_code: string; b_address: string | null; b_country: string | null; b_ice: string | null; b_tax: string | null;
    b_registry: string | null; b_siret: string | null; b_registro: string | null }>`
    select i.year, i.number, i.issue_date::text as issue_date, i.due_date::text as due_date, i.currency,
           invoice_total(i.id)::text as total, invoice_credited(i.id)::text as credited, invoice_paid(i.id)::text as paid, i.state, i.label,
           i.entry_id::text as entry_id, i.party_name is not null as as_issued,
           -- issued: the copy, whole (0187); a draft: the party as it stands now, to be copied at issue
           case when i.party_name is not null then i.party_name else p.name end as party,
           case when i.party_name is not null then i.party_code else p.code end as b_code,
           case when i.party_name is not null then i.party_address else p.address end as b_address,
           case when i.party_name is not null then i.party_country else p.country end as b_country,
           case when i.party_name is not null then i.party_ice else p.ice end as b_ice,
           case when i.party_name is not null then i.party_tax_number else p.tax_number end as b_tax,
           case when i.party_name is not null then i.party_registry_number else p.registry_number end as b_registry,
           case when i.party_name is not null then i.party_siret else p.siret end as b_siret,
           case when i.party_name is not null then i.party_registro_mercantil else p.registro_mercantil end as b_registro
      from invoices i join parties p on p.id = i.party_id where i.business_id = ${businessId}::uuid and i.id = ${id}::uuid`.execute(tx)).rows[0];
  if (!r) return null;
  const lines = (await sql<{ line_no: number; label: string; quantity: string; unit_price: string; account: string; tax_code: string | null; net: string; tax: string }>`
    select l.line_no, l.label, l.quantity::text as quantity, l.unit_price::text as unit_price, a.code as account, t.code as tax_code, l.net::text as net, l.tax::text as tax
      from invoice_lines l join accounts a on a.id = l.account_id left join tax_codes t on t.id = l.tax_code_id
     where l.invoice_id = ${id}::uuid order by l.line_no`.execute(tx)).rows;
  const payments = (await sql<{ paid_on: string; amount: string; account: string; entry_id: string; kind: string }>`
    select pm.paid_on::text as paid_on, pm.amount::text as amount, a.code as account, pm.entry_id::text as entry_id, pm.kind
      from invoice_payments pm join accounts a on a.id = pm.account_id where pm.invoice_id = ${id}::uuid order by pm.paid_on, pm.created_at`.execute(tx)).rows;
  return {
    id, key: r.number === null ? null : invoiceKey(r.year!, r.number), party: r.party, issueDate: r.issue_date, dueDate: r.due_date,
    currency: r.currency, total: d(r.total), paid: d(r.paid), label: r.label, entryId: r.entry_id,
    billedTo: { code: r.b_code, name: r.party, address: r.b_address, country: r.b_country, ice: r.b_ice, taxNumber: r.b_tax, asIssued: r.as_issued,
      registry: r.b_registry, siret: r.b_siret, registro: r.b_registro },
    credited: d(r.credited), status: statusOf(r.state, d(r.total), d(r.credited), d(r.paid), r.due_date, today),
    lines: lines.map((l) => ({ lineNo: l.line_no, label: l.label, quantity: d(l.quantity), unitPrice: d(l.unit_price), account: l.account, taxCode: l.tax_code, net: d(l.net), tax: d(l.tax) })),
    payments: payments.map((p) => ({ paidOn: p.paid_on, amount: d(p.amount), account: p.account, entryId: p.entry_id, refund: p.kind === 'refund' })),
    creditNotes: (await sql<{ id: string; year: number | null; number: number | null; state: string; issue_date: string; total: string }>`
      select id::text as id, year, number, state, issue_date::text as issue_date, credit_note_total(id)::text as total from credit_notes
       where invoice_id = ${id}::uuid and state <> 'discarded' order by created_at`.execute(tx)).rows.map((c) => ({
      id: c.id, key: c.number === null ? null : creditNoteKey(c.year!, c.number), state: c.state, issueDate: c.issue_date, total: d(c.total) })),
  };
}

export type InvoiceLineInput = { readonly label: string; readonly quantity: Decimal; readonly unitPrice: Decimal; readonly accountId: string; readonly taxCodeId: string | null };
export type InvoiceInput = {
  readonly sourceOrderId?: string;
  readonly partyId: string; readonly issueDate: string; readonly dueDate: string | null; readonly currency: string;
  readonly label: string | null; readonly lines: readonly InvoiceLineInput[];
};

/** A draft: each line's net (quantity × price) and tax (net × its code's rate), to the cent — the database checks both. */
export async function draftInvoice(tx: Tx, businessId: string, by: string, input: InvoiceInput): Promise<{ readonly kind: 'drafted'; readonly id: string } | EntryRefusal> {
  try {
    await sql`savepoint draft_invoice`.execute(tx);
    const id = (await sql<{ id: string }>`insert into invoices (business_id, party_id, issue_date, due_date, currency, label, created_by, source_order_id)
      values (${businessId}::uuid, ${input.partyId}::uuid, ${input.issueDate}::date, ${input.dueDate}::date, ${input.currency}, ${input.label}, ${by},
              ${input.sourceOrderId ?? null}::uuid)
      returning id::text as id`.execute(tx)).rows[0]!.id;
    let n = 0;
    for (const l of input.lines) {
      const rate = l.taxCodeId === null ? '0' : ((await sql<{ r: string }>`select rate::text as r from tax_codes where id = ${l.taxCodeId}::uuid and business_id = ${businessId}::uuid`
        .execute(tx)).rows[0]?.r ?? '0');
      const net = roundDecimal(mulDecimal(l.quantity, l.unitPrice), 2);
      const tax = roundDecimal(divDecimal(mulDecimal(net, d(rate)), d('100'), 6), 2);
      await sql`insert into invoice_lines (business_id, invoice_id, line_no, label, quantity, unit_price, account_id, tax_code_id, net, tax)
        values (${businessId}::uuid, ${id}::uuid, ${++n}, ${l.label}, ${l.quantity}::numeric, ${l.unitPrice}::numeric, ${l.accountId}::uuid,
                ${l.taxCodeId}::uuid, ${net}::numeric, ${tax}::numeric)`.execute(tx);
    }
    await sql`release savepoint draft_invoice`.execute(tx);
    return { kind: 'drafted', id };
  } catch (e) {
    await sql`rollback to savepoint draft_invoice`.execute(tx);
    return refusalOf(e);
  }
}

export async function discardInvoice(tx: Tx, businessId: string, id: string): Promise<boolean> {
  const r = await sql`update invoices set state = 'discarded' where business_id = ${businessId}::uuid and id = ${id}::uuid and state = 'draft'`.execute(tx);
  return Number(r.numAffectedRows ?? 0) > 0;
}

/** The owner's rate for a pair on a day, as the posting will take it (A3): the latest stated on or before it. */
async function rateOn(tx: Tx, businessId: string, from: string, to: string, day: string): Promise<Decimal | null> {
  const r = (await sql<{ r: string }>`select rate::text as r from owner_rates where business_id = ${businessId}::uuid and from_currency = ${from}
    and to_currency = ${to} and stated_at < (${day}::date + 1)::timestamptz order by stated_at desc, created_at desc limit 1`.execute(tx)).rows[0];
  return r ? d(r.r) : null;
}

export type InvoiceRefusal = EntryRefusal | { readonly kind: 'refused'; readonly reason: 'accounts_not_set' | 'too_much' | 'too_much_refund' | 'not_issued'; readonly detail: string | null };

/** The one marked line that closes a foreign entry in the books' currency: a loss as a debit, a gain as a credit. */
function fxLine(residue: Decimal, a: { fxLossAccountId: string | null; fxGainAccountId: string | null }, book: string, partyId: string | null): DraftLine | null {
  if (signOf(residue) === 0) return null;
  // residue > 0: the credits came to more in the books' currency than the debits — a debit closes it (a loss)
  return signOf(residue) > 0
    ? { accountId: a.fxLossAccountId!, partyId, taxCodeId: null, currency: book, debit: residue, credit: null, label: null, isFx: true }
    : { accountId: a.fxGainAccountId!, partyId, taxCodeId: null, currency: book, debit: null, credit: subDecimal(d('0'), residue), label: null, isFx: true };
}

export async function issueInvoice(tx: Tx, businessId: string, id: string, by: string):
  Promise<{ readonly kind: 'issued'; readonly key: string; readonly entryId: string } | InvoiceRefusal> {
  const a = await booksAccountsOf(tx, businessId);
  if (!a.salesJournalId || !a.receivableAccountId) return { kind: 'refused', reason: 'accounts_not_set', detail: null };
  try {
    await sql`savepoint issue_invoice`.execute(tx);
    const inv = (await sql<{ year: number; number: number; party_id: string; issue_date: string; currency: string; label: string | null }>`
      update invoices set state = 'issued', issued_by = ${by} where business_id = ${businessId}::uuid and id = ${id}::uuid and state = 'draft'
      returning year, number, party_id::text as party_id, issue_date::text as issue_date, currency, label`.execute(tx)).rows[0];
    if (!inv) { await sql`rollback to savepoint issue_invoice`.execute(tx); return { kind: 'refused', reason: 'not_a_draft', detail: null }; }
    const key = invoiceKey(inv.year, inv.number);
    const lines = (await sql<{ account_id: string; tax_code_id: string | null; net: string; tax: string; tax_account: string | null }>`
      select l.account_id::text as account_id, l.tax_code_id::text as tax_code_id, l.net::text as net, l.tax::text as tax, t.account_id::text as tax_account
        from invoice_lines l left join tax_codes t on t.id = l.tax_code_id where l.invoice_id = ${id}::uuid order by l.line_no`.execute(tx)).rows;
    const total = lines.reduce((s, l) => addDecimal(s, addDecimal(d(l.net), d(l.tax))), d('0'));
    const credits: DraftLine[] = [];
    for (const l of lines) credits.push({ accountId: l.account_id, partyId: null, taxCodeId: l.tax_code_id, currency: inv.currency, debit: null, credit: d(l.net), label: null, isFx: false });
    const taxBy = new Map<string, Decimal>();
    for (const l of lines) if (l.tax_account && signOf(d(l.tax)) > 0) taxBy.set(l.tax_account, addDecimal(taxBy.get(l.tax_account) ?? d('0'), d(l.tax)));
    for (const [account, tax] of taxBy) credits.push({ accountId: account, partyId: null, taxCodeId: null, currency: inv.currency, debit: null, credit: tax, label: null, isFx: false });
    const draft: DraftLine[] = [
      { accountId: a.receivableAccountId, partyId: inv.party_id, taxCodeId: null, currency: inv.currency, debit: total, credit: null, label: null, isFx: false },
      ...credits.filter((c) => signOf(c.credit!) > 0)];
    const book = (await sql<{ c: string }>`select books_currency(${businessId}::uuid) as c`.execute(tx)).rows[0]!.c;
    if (inv.currency !== book) {
      const r = await rateOn(tx, businessId, inv.currency, book, inv.issue_date);
      if (r === null) { await sql`rollback to savepoint issue_invoice`.execute(tx); return { kind: 'refused', reason: 'no_rate', detail: `${inv.currency} to ${book} on or before ${inv.issue_date}` }; }
      const turned = (x: Decimal | null) => (x === null ? d('0') : roundDecimal(mulDecimal(x, r), 2));
      const residue = draft.reduce((s, l) => addDecimal(s, subDecimal(turned(l.credit), turned(l.debit))), d('0'));
      const fx = fxLine(residue, a, book, null);
      if (fx && (!a.fxLossAccountId || !a.fxGainAccountId)) { await sql`rollback to savepoint issue_invoice`.execute(tx); return { kind: 'refused', reason: 'fx_accounts', detail: null }; }
      if (fx) draft.push(fx);
    }
    const made = await draftEntry(tx, businessId, by, { journalId: a.salesJournalId, date: inv.issue_date, label: `${key}${inv.label ? ` · ${inv.label}` : ''}`.slice(0, 200),
      documentRef: key, documentDate: inv.issue_date, lines: draft });
    if (made.kind === 'refused') { await sql`rollback to savepoint issue_invoice`.execute(tx); return made; }
    const posted = await postEntry(tx, businessId, made.id, by);
    if (posted.kind === 'refused') { await sql`rollback to savepoint issue_invoice`.execute(tx); return posted; }
    await sql`update invoices set entry_id = ${made.id}::uuid where id = ${id}::uuid`.execute(tx);
    await sql`release savepoint issue_invoice`.execute(tx);
    return { kind: 'issued', key, entryId: made.id };
  } catch (e) {
    await sql`rollback to savepoint issue_invoice`.execute(tx);
    return refusalOf(e);
  }
}

/**
 * ONE RULE FOR WHAT MOVES AN INVOICE'S RECEIVABLE (C2's payments, D1b's refunds and credit notes). `amount` in the
 * invoice's currency; `lowers` true for a payment in or a credit note, false for a refund out. Each movement is
 * posted at its own day's rate (A3) and relieves the receivable by `relief`, in the books' currency:
 *   · lowering what is still owed: its share of what issuing booked — and the one that settles the invoice takes
 *     exactly what is left;
 *   · beyond what was owed (a credit note on a paid invoice): that part at its own rate — a credit the customer is owed;
 *   · a refund that settles the invoice: exactly what is left (a credit, in the books' currency), else its own rate.
 * The difference between `relief` and what the posting moved at the day's rate goes back on the receivable in the
 * books' currency and is the exchange gain or loss, its own marked line.
 */
export async function receivableMove(tx: Tx, businessId: string, invoiceId: string, amount: Decimal, lowers: boolean, day: string):
  Promise<{ readonly relief: Decimal; readonly lines: readonly DraftLine[]; readonly fx: Decimal } | InvoiceRefusal> {
  const a = await booksAccountsOf(tx, businessId);
  if (!a.receivableAccountId) return { kind: 'refused', reason: 'accounts_not_set', detail: null };
  const inv = (await sql<{ currency: string; party_id: string; entry_id: string; total: string; credited: string; paid: string }>`
    select currency, party_id::text as party_id, entry_id::text as entry_id, invoice_total(id)::text as total,
           invoice_credited(id)::text as credited, invoice_paid(id)::text as paid
      from invoices where business_id = ${businessId}::uuid and id = ${invoiceId}::uuid`.execute(tx)).rows[0]!;
  const total = d(inv.total);
  const owed = owedOn(total, d(inv.credited), d(inv.paid));
  const book = (await sql<{ c: string }>`select books_currency(${businessId}::uuid) as c`.execute(tx)).rows[0]!.c;
  if (inv.currency === book) return { relief: lowers ? amount : subDecimal(d('0'), amount), lines: [], fx: d('0') };
  const r = await rateOn(tx, businessId, inv.currency, book, day);
  if (r === null) return { kind: 'refused', reason: 'no_rate', detail: `${inv.currency} to ${book} on or before ${day}` };
  const turned = (x: Decimal) => roundDecimal(mulDecimal(x, r), 2);
  const booked = d((await sql<{ b: string }>`select coalesce(sum(book_debit), 0)::text as b from journal_lines
    where entry_id = ${inv.entry_id}::uuid and account_id = ${a.receivableAccountId}::uuid and debit > 0`.execute(tx)).rows[0]!.b);
  const relieved = d((await sql<{ r: string }>`select (coalesce((select sum(receivable_book) from invoice_payments where invoice_id = ${invoiceId}::uuid), 0)
    + coalesce((select sum(receivable_book) from credit_notes where invoice_id = ${invoiceId}::uuid and state = 'issued' and receivable_book is not null), 0))::text as r`
    .execute(tx)).rows[0]!.r);
  const left = subDecimal(booked, relieved);                   // the receivable's value in the books' currency, now
  let relief: Decimal;
  if (lowers) {
    if (signOf(owed) <= 0) relief = turned(amount);           // nothing owed: all of it a credit, at its own rate
    else if (compareDecimal(amount, owed) < 0) relief = roundDecimal(divDecimal(mulDecimal(booked, amount), total, 6), 2);
    else relief = addDecimal(left, turned(subDecimal(amount, owed)));   // it settles: what is left, and any excess at its rate
  } else {
    relief = compareDecimal(amount, subDecimal(d('0'), owed)) === 0 ? left : subDecimal(d('0'), turned(amount));
  }
  const moved = lowers ? turned(amount) : subDecimal(d('0'), turned(amount));
  const fx = subDecimal(moved, relief);
  const lines: DraftLine[] = [];
  if (signOf(fx) !== 0) {
    if (!a.fxLossAccountId || !a.fxGainAccountId) return { kind: 'refused', reason: 'fx_accounts', detail: null };
    lines.push(signOf(fx) > 0
      ? { accountId: a.receivableAccountId, partyId: inv.party_id, taxCodeId: null, currency: book, debit: fx, credit: null, label: null, isFx: false }
      : { accountId: a.receivableAccountId, partyId: inv.party_id, taxCodeId: null, currency: book, debit: null, credit: subDecimal(d('0'), fx), label: null, isFx: false });
    lines.push(fxLine(subDecimal(d('0'), fx), a, book, null)!);
  }
  return { relief, lines, fx };
}

/** A payment in, or (D1b) a refund out to a customer owed it back: through `receivableMove`, posted, recorded. */
export async function recordPayment(tx: Tx, businessId: string, invoiceId: string, by: string,
  p: { readonly paidOn: string; readonly amount: Decimal; readonly journalId: string; readonly accountId: string; readonly refund?: boolean }):
  Promise<{ readonly kind: 'recorded'; readonly entryId: string; readonly fx: Decimal } | InvoiceRefusal> {
  const a = await booksAccountsOf(tx, businessId);
  if (!a.receivableAccountId) return { kind: 'refused', reason: 'accounts_not_set', detail: null };
  const refund = p.refund === true;
  const inv = (await sql<{ state: string; currency: string; party_id: string; entry_id: string | null; total: string; credited: string; paid: string; year: number | null; number: number | null }>`
    select state, currency, party_id::text as party_id, entry_id::text as entry_id, invoice_total(id)::text as total,
           invoice_credited(id)::text as credited, invoice_paid(id)::text as paid, year, number
      from invoices where business_id = ${businessId}::uuid and id = ${invoiceId}::uuid`.execute(tx)).rows[0];
  if (!inv || inv.state !== 'issued' || !inv.entry_id) return { kind: 'refused', reason: 'not_issued', detail: null };
  const owed = owedOn(d(inv.total), d(inv.credited), d(inv.paid));
  const room = refund ? subDecimal(d('0'), owed) : owed;
  if (compareDecimal(p.amount, room) > 0) return { kind: 'refused', reason: refund ? 'too_much_refund' : 'too_much', detail: `${signOf(room) > 0 ? room : '0'} ${inv.currency}` };
  const move = await receivableMove(tx, businessId, invoiceId, p.amount, !refund, p.paidOn);
  if ('kind' in move) return move;
  const lines: DraftLine[] = refund ? [
    { accountId: a.receivableAccountId, partyId: inv.party_id, taxCodeId: null, currency: inv.currency, debit: p.amount, credit: null, label: null, isFx: false },
    { accountId: p.accountId, partyId: null, taxCodeId: null, currency: inv.currency, debit: null, credit: p.amount, label: null, isFx: false },
  ] : [
    { accountId: p.accountId, partyId: null, taxCodeId: null, currency: inv.currency, debit: p.amount, credit: null, label: null, isFx: false },
    { accountId: a.receivableAccountId, partyId: inv.party_id, taxCodeId: null, currency: inv.currency, debit: null, credit: p.amount, label: null, isFx: false },
  ];
  lines.push(...move.lines);
  const key = inv.number === null ? '' : invoiceKey(inv.year!, inv.number);
  try {
    await sql`savepoint record_payment`.execute(tx);
    const made = await draftEntry(tx, businessId, by, { journalId: p.journalId, date: p.paidOn, label: `${key} · ${refund ? '−' : ''}${p.amount} ${inv.currency}`,
      documentRef: key, documentDate: p.paidOn, lines });
    if (made.kind === 'refused') { await sql`rollback to savepoint record_payment`.execute(tx); return made; }
    const posted = await postEntry(tx, businessId, made.id, by);
    if (posted.kind === 'refused') { await sql`rollback to savepoint record_payment`.execute(tx); return posted; }
    await sql`insert into invoice_payments (business_id, invoice_id, paid_on, currency, amount, receivable_book, account_id, entry_id, created_by, kind)
      values (${businessId}::uuid, ${invoiceId}::uuid, ${p.paidOn}::date, ${inv.currency}, ${p.amount}::numeric, ${move.relief}::numeric,
              ${p.accountId}::uuid, ${made.id}::uuid, ${by}, ${refund ? 'refund' : 'in'})`.execute(tx);
    await sql`release savepoint record_payment`.execute(tx);
    return { kind: 'recorded', entryId: made.id, fx: move.fx };
  } catch (e) {
    await sql`rollback to savepoint record_payment`.execute(tx);
    return refusalOf(e);
  }
}
