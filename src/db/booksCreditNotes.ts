import { sql } from 'kysely';
import type { Tx } from './client.js';
import {
  addDecimal, compareDecimal, divDecimal, mulDecimal, parseDecimal, roundDecimal, signOf, subDecimal, type Decimal,
} from '../core/types/decimal.js';
import { draftEntry, postEntry, refusalOf, type DraftLine } from './booksEntries.js';
import { booksAccountsOf } from './booksOrders.js';
import { creditNoteKey, invoiceKey, receivableMove, type BilledTo, type InvoiceRefusal } from './booksInvoices.js';

/**
 * D1b (Phase 5; 0188) — CREDIT NOTES. Drafted against one issued invoice, for some or all of each line's quantity;
 * the database checks each line against what is left of the invoice's line (the last of it takes exactly its
 * remaining net and tax), numbers the note at issue from its own counter, A-<year>-<n>, and copies the invoice's
 * customer. Issuing posts the invoice's mirror in the sales journal: each line's net debited to its sales account,
 * its tax to its tax account, the receivable credited with the customer on it — at the credit note's own day's rate
 * for a foreign invoice (A3: a rate is never recomputed), the receivable relieved by the one rule every payment uses
 * (`receivableMove`), the difference a marked exchange line. Any refusal: no number was taken.
 */
const d = (v: string): Decimal => parseDecimal(v)!;

export type CreditableLine = {
  readonly lineNo: number; readonly label: string; readonly quantity: Decimal; readonly unitPrice: Decimal;
  readonly left: Decimal; readonly leftNet: Decimal; readonly leftTax: Decimal; readonly rate: Decimal;
};

/** Each line of an issued invoice, and what is left of it to credit (after the credit notes ISSUED against it). */
export async function creditable(tx: Tx, businessId: string, invoiceId: string): Promise<CreditableLine[]> {
  return (await sql<{ line_no: number; label: string; quantity: string; unit_price: string; left: string; left_net: string; left_tax: string; rate: string }>`
    select l.line_no, l.label, l.quantity::text as quantity, l.unit_price::text as unit_price,
           (l.quantity - coalesce(c.q, 0))::text as left, (l.net - coalesce(c.net, 0))::text as left_net, (l.tax - coalesce(c.tax, 0))::text as left_tax,
           coalesce(t.rate, 0)::text as rate
      from invoice_lines l
      left join tax_codes t on t.id = l.tax_code_id
      left join lateral (select sum(cl.quantity) as q, sum(cl.net) as net, sum(cl.tax) as tax from credit_note_lines cl join credit_notes n on n.id = cl.credit_note_id
                          where n.invoice_id = l.invoice_id and n.state = 'issued' and cl.invoice_line_no = l.line_no) c on true
     where l.business_id = ${businessId}::uuid and l.invoice_id = ${invoiceId}::uuid order by l.line_no`.execute(tx)).rows.map((r) => ({
    lineNo: r.line_no, label: r.label, quantity: d(r.quantity), unitPrice: d(r.unit_price), left: d(r.left), leftNet: d(r.left_net), leftTax: d(r.left_tax), rate: d(r.rate) }));
}

type CreditRefusal = InvoiceRefusal | {
  readonly kind: 'refused'; readonly reason: 'credit_more_than_left' | 'credit_before_invoice' | 'credit_refused' | 'nothing_to_credit'; readonly detail: string | null;
};

/** The database's refusal, as a reason the page can say in its own words (the line, or the invoice's day). */
function creditRefusalOf(e: unknown): CreditRefusal {
  if (String((e as { code?: unknown } | null)?.code ?? '') === 'NB022') {
    const message = String((e as { message?: unknown }).message ?? '');
    const left = /more than is left of the invoice's line (\d+)/.exec(message);
    if (left) return { kind: 'refused', reason: 'credit_more_than_left', detail: left[1]! };
    const before = /dated on or after its invoice \((\d{4}-\d{2}-\d{2})\)/.exec(message);
    if (before) return { kind: 'refused', reason: 'credit_before_invoice', detail: before[1]! };
    return { kind: 'refused', reason: 'credit_refused', detail: null };
  }
  return refusalOf(e);
}

export async function draftCreditNote(tx: Tx, businessId: string, by: string, input: {
  readonly invoiceId: string; readonly issueDate: string; readonly reason: string;
  readonly lines: readonly { readonly invoiceLineNo: number; readonly quantity: Decimal }[];
}): Promise<{ readonly kind: 'drafted'; readonly id: string } | CreditRefusal> {
  const wanted = input.lines.filter((l) => signOf(l.quantity) > 0);
  if (wanted.length === 0) return { kind: 'refused', reason: 'nothing_to_credit', detail: null };
  const inv = (await sql<{ currency: string }>`select currency from invoices where business_id = ${businessId}::uuid and id = ${input.invoiceId}::uuid
    and state = 'issued'`.execute(tx)).rows[0];
  if (!inv) return { kind: 'refused', reason: 'not_issued', detail: null };
  const left = new Map((await creditable(tx, businessId, input.invoiceId)).map((l) => [l.lineNo, l]));
  try {
    await sql`savepoint draft_credit`.execute(tx);
    const id = (await sql<{ id: string }>`insert into credit_notes (business_id, invoice_id, issue_date, currency, reason, created_by)
      values (${businessId}::uuid, ${input.invoiceId}::uuid, ${input.issueDate}::date, ${inv.currency}, ${input.reason}, ${by}) returning id::text as id`.execute(tx)).rows[0]!.id;
    let n = 0;
    for (const w of wanted) {
      const l = left.get(w.invoiceLineNo);
      // the last of a line takes exactly what is left of it; a part is its quantity at the line's price and tax
      const all = l !== undefined && compareDecimal(w.quantity, l.left) === 0;
      const net = !l ? d('0') : all ? l.leftNet : roundDecimal(mulDecimal(w.quantity, l.unitPrice), 2);
      const tax = !l ? d('0') : all ? l.leftTax : roundDecimal(divDecimal(mulDecimal(net, l.rate), d('100'), 6), 2);
      await sql`insert into credit_note_lines (business_id, credit_note_id, line_no, invoice_line_no, quantity, net, tax)
        values (${businessId}::uuid, ${id}::uuid, ${++n}, ${w.invoiceLineNo}, ${w.quantity}::numeric, ${net}::numeric, ${tax}::numeric)`.execute(tx);
    }
    await sql`release savepoint draft_credit`.execute(tx);
    return { kind: 'drafted', id };
  } catch (e) {
    await sql`rollback to savepoint draft_credit`.execute(tx);
    return creditRefusalOf(e);
  }
}

export async function discardCreditNote(tx: Tx, businessId: string, id: string): Promise<boolean> {
  const r = await sql`update credit_notes set state = 'discarded' where business_id = ${businessId}::uuid and id = ${id}::uuid and state = 'draft'`.execute(tx);
  return Number(r.numAffectedRows ?? 0) > 0;
}

const fxResidueLine = (residue: Decimal, a: { fxLossAccountId: string | null; fxGainAccountId: string | null }, book: string): DraftLine | null =>
  signOf(residue) === 0 ? null : signOf(residue) > 0
    ? { accountId: a.fxLossAccountId!, partyId: null, taxCodeId: null, currency: book, debit: residue, credit: null, label: null, isFx: true }
    : { accountId: a.fxGainAccountId!, partyId: null, taxCodeId: null, currency: book, debit: null, credit: subDecimal(d('0'), residue), label: null, isFx: true };

export async function issueCreditNote(tx: Tx, businessId: string, id: string, by: string):
  Promise<{ readonly kind: 'issued'; readonly key: string; readonly entryId: string } | CreditRefusal> {
  const a = await booksAccountsOf(tx, businessId);
  if (!a.salesJournalId || !a.receivableAccountId) return { kind: 'refused', reason: 'accounts_not_set', detail: null };
  // What is owed and what the receivable holds are read while this note is still a draft (it counts in neither), so
  // the move is measured against the invoice as it stands without it.
  const pending = (await sql<{ invoice_id: string; issue_date: string; total: string; invoice_date: string }>`select c.invoice_id::text as invoice_id,
    c.issue_date::text as issue_date, credit_note_total(c.id)::text as total, i.issue_date::text as invoice_date
      from credit_notes c join invoices i on i.id = c.invoice_id where c.business_id = ${businessId}::uuid and c.id = ${id}::uuid and c.state = 'draft'`.execute(tx)).rows[0];
  if (!pending) return { kind: 'refused', reason: 'not_a_draft', detail: null };
  // said first, before any rate is looked for (the database says it again at issue)
  if (pending.issue_date < pending.invoice_date) return { kind: 'refused', reason: 'credit_before_invoice', detail: pending.invoice_date };
  try {
    await sql`savepoint issue_credit`.execute(tx);
    const move = await receivableMove(tx, businessId, pending.invoice_id, d(pending.total), true, pending.issue_date);
    if ('kind' in move) { await sql`rollback to savepoint issue_credit`.execute(tx); return move; }
    const note = (await sql<{ year: number; number: number; invoice_id: string; issue_date: string; currency: string; reason: string }>`
      update credit_notes set state = 'issued', issued_by = ${by} where business_id = ${businessId}::uuid and id = ${id}::uuid and state = 'draft'
      returning year, number, invoice_id::text as invoice_id, issue_date::text as issue_date, currency, reason`.execute(tx)).rows[0];
    if (!note) { await sql`rollback to savepoint issue_credit`.execute(tx); return { kind: 'refused', reason: 'not_a_draft', detail: null }; }
    const key = creditNoteKey(note.year, note.number);
    const inv = (await sql<{ party_id: string; year: number; number: number }>`select party_id::text as party_id, year, number from invoices where id = ${note.invoice_id}::uuid`
      .execute(tx)).rows[0]!;
    const lines = (await sql<{ account_id: string; tax_code_id: string | null; tax_account: string | null; net: string; tax: string }>`
      select il.account_id::text as account_id, il.tax_code_id::text as tax_code_id, t.account_id::text as tax_account, cl.net::text as net, cl.tax::text as tax
        from credit_note_lines cl join invoice_lines il on il.invoice_id = ${note.invoice_id}::uuid and il.line_no = cl.invoice_line_no
        left join tax_codes t on t.id = il.tax_code_id where cl.credit_note_id = ${id}::uuid order by cl.line_no`.execute(tx)).rows;
    const total = lines.reduce((s, l) => addDecimal(s, addDecimal(d(l.net), d(l.tax))), d('0'));
    // the mirror of the invoice's entry: sales and tax debited, the receivable credited with the customer on it
    const draft: DraftLine[] = [];
    for (const l of lines) if (signOf(d(l.net)) > 0) draft.push({ accountId: l.account_id, partyId: null, taxCodeId: l.tax_code_id, currency: note.currency, debit: d(l.net), credit: null, label: null, isFx: false });
    const taxBy = new Map<string, Decimal>();
    for (const l of lines) if (l.tax_account && signOf(d(l.tax)) > 0) taxBy.set(l.tax_account, addDecimal(taxBy.get(l.tax_account) ?? d('0'), d(l.tax)));
    for (const [account, tax] of taxBy) draft.push({ accountId: account, partyId: null, taxCodeId: null, currency: note.currency, debit: tax, credit: null, label: null, isFx: false });
    draft.push({ accountId: a.receivableAccountId, partyId: inv.party_id, taxCodeId: null, currency: note.currency, debit: null, credit: total, label: null, isFx: false });
    const book = (await sql<{ c: string }>`select books_currency(${businessId}::uuid) as c`.execute(tx)).rows[0]!.c;
    if (note.currency !== book) {
      const r = (await sql<{ r: string }>`select rate::text as r from owner_rates where business_id = ${businessId}::uuid and from_currency = ${note.currency}
        and to_currency = ${book} and stated_at < (${note.issue_date}::date + 1)::timestamptz order by stated_at desc, created_at desc limit 1`.execute(tx)).rows[0];
      if (!r) { await sql`rollback to savepoint issue_credit`.execute(tx); return { kind: 'refused', reason: 'no_rate', detail: `${note.currency} to ${book} on or before ${note.issue_date}` }; }
      const turned = (x: Decimal | null) => (x === null ? d('0') : roundDecimal(mulDecimal(x, d(r.r)), 2));
      const residue = draft.reduce((s, l) => addDecimal(s, subDecimal(turned(l.credit), turned(l.debit))), d('0'));
      const fx = fxResidueLine(residue, a, book);
      if (fx && (!a.fxLossAccountId || !a.fxGainAccountId)) { await sql`rollback to savepoint issue_credit`.execute(tx); return { kind: 'refused', reason: 'fx_accounts', detail: null }; }
      if (fx) draft.push(fx);
    }
    draft.push(...move.lines);
    const made = await draftEntry(tx, businessId, by, { journalId: a.salesJournalId, date: note.issue_date,
      label: `${key} · ${invoiceKey(inv.year, inv.number)} · ${note.reason}`.slice(0, 200), documentRef: key, documentDate: note.issue_date, lines: draft });
    if (made.kind === 'refused') { await sql`rollback to savepoint issue_credit`.execute(tx); return made; }
    const posted = await postEntry(tx, businessId, made.id, by);
    if (posted.kind === 'refused') { await sql`rollback to savepoint issue_credit`.execute(tx); return posted; }
    await sql`update credit_notes set entry_id = ${made.id}::uuid, receivable_book = ${move.relief}::numeric where id = ${id}::uuid`.execute(tx);
    await sql`release savepoint issue_credit`.execute(tx);
    return { kind: 'issued', key, entryId: made.id };
  } catch (e) {
    await sql`rollback to savepoint issue_credit`.execute(tx);
    return creditRefusalOf(e);
  }
}

export type CreditNoteView = {
  readonly id: string; readonly key: string | null; readonly state: 'draft' | 'issued' | 'discarded'; readonly issueDate: string;
  readonly reason: string; readonly currency: string; readonly invoiceId: string; readonly invoiceKey: string; readonly entryId: string | null;
  readonly billedTo: BilledTo; readonly total: Decimal;
  readonly lines: readonly { readonly invoiceLineNo: number; readonly label: string; readonly quantity: Decimal; readonly net: Decimal; readonly tax: Decimal }[];
};

export async function loadCreditNote(tx: Tx, businessId: string, id: string): Promise<CreditNoteView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = (await sql<{ year: number | null; number: number | null; state: CreditNoteView['state']; issue_date: string; reason: string; currency: string;
    invoice_id: string; i_year: number; i_number: number; entry_id: string | null; total: string; as_issued: boolean;
    b_code: string; b_name: string; b_address: string | null; b_country: string | null; b_ice: string | null; b_tax: string | null;
    b_registry: string | null; b_siret: string | null; b_registro: string | null }>`
    select c.year, c.number, c.state, c.issue_date::text as issue_date, c.reason, c.currency, c.invoice_id::text as invoice_id,
           i.year as i_year, i.number as i_number, c.entry_id::text as entry_id, credit_note_total(c.id)::text as total, c.party_name is not null as as_issued,
           -- issued: its own copy; a draft: the invoice's copy, which it will take at issue
           coalesce(c.party_code, i.party_code) as b_code, coalesce(c.party_name, i.party_name) as b_name,
           case when c.party_name is not null then c.party_address else i.party_address end as b_address,
           case when c.party_name is not null then c.party_country else i.party_country end as b_country,
           case when c.party_name is not null then c.party_ice else i.party_ice end as b_ice,
           case when c.party_name is not null then c.party_tax_number else i.party_tax_number end as b_tax,
           case when c.party_name is not null then c.party_registry_number else i.party_registry_number end as b_registry,
           case when c.party_name is not null then c.party_siret else i.party_siret end as b_siret,
           case when c.party_name is not null then c.party_registro_mercantil else i.party_registro_mercantil end as b_registro
      from credit_notes c join invoices i on i.id = c.invoice_id
     where c.business_id = ${businessId}::uuid and c.id = ${id}::uuid`.execute(tx)).rows[0];
  if (!r) return null;
  const lines = (await sql<{ invoice_line_no: number; label: string; quantity: string; net: string; tax: string }>`
    select cl.invoice_line_no, il.label, cl.quantity::text as quantity, cl.net::text as net, cl.tax::text as tax
      from credit_note_lines cl join invoice_lines il on il.invoice_id = ${r.invoice_id}::uuid and il.line_no = cl.invoice_line_no
     where cl.credit_note_id = ${id}::uuid order by cl.line_no`.execute(tx)).rows;
  return {
    id, key: r.number === null ? null : creditNoteKey(r.year!, r.number), state: r.state, issueDate: r.issue_date, reason: r.reason, currency: r.currency,
    invoiceId: r.invoice_id, invoiceKey: invoiceKey(r.i_year, r.i_number), entryId: r.entry_id, total: d(r.total),
    billedTo: { code: r.b_code, name: r.b_name, address: r.b_address, country: r.b_country, ice: r.b_ice, taxNumber: r.b_tax, asIssued: r.as_issued,
      registry: r.b_registry, siret: r.b_siret, registro: r.b_registro },
    lines: lines.map((l) => ({ invoiceLineNo: l.invoice_line_no, label: l.label, quantity: d(l.quantity), net: d(l.net), tax: d(l.tax) })),
  };
}
