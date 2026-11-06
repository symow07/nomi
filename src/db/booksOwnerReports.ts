import { sql } from 'kysely';
import type { Tx } from './client.js';
import { decimal, addDecimal, subDecimal, compareDecimal, signOf, type Decimal } from '../core/types/decimal.js';
import { defaultPeriod, type Period } from './booksReports.js';
import { moneyAccountIds } from './booksOverview.js';

/**
 * REPORTS IN THE OWNER'S WORDS (Block 2 PR 5 of the finishing roadmap; 2026-11-06; no migration). Five readers, each a
 * query over posted entries for a period, each the sum of the rows it shows, each with a download:
 *   · made      — "What you made": income less spending, by account.
 *   · money     — "Money in and out": what came into and left the bank and cash accounts (0225's `holds_money` or rule
 *                 91's words), a transfer between two of them counted on neither side; opening balances said apart.
 *   · tax       — "Tax you owe": collected less deductible, by code, from the lines that carry a code.
 *   · customers — "Top customers": what each was invoiced in the period, net of credit notes, top ten.
 *   · unpaid    — "Unpaid invoices by age": what customers still owe, by how long past due.
 * The accountant's trial balance and pack are untouched; `tests/integration/books-owner-reports.test.ts` holds each
 * figure to the trial balance's over the same rows.
 */
export type Span = 'month' | 'quarter' | 'year';
export const SPANS: readonly Span[] = ['month', 'quarter', 'year'];
export const isSpan = (v: unknown): v is Span => typeof v === 'string' && (SPANS as readonly string[]).includes(v);

/** This month, this calendar quarter, or the fiscal year holding today — each up to today. */
export async function periodFor(tx: Tx, businessId: string, today: string, span: Span): Promise<Period> {
  if (span === 'year') return defaultPeriod(tx, businessId, today);
  if (span === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
  const month = Number(today.slice(5, 7)), first = month - ((month - 1) % 3);
  return { from: `${today.slice(0, 4)}-${String(first).padStart(2, '0')}-01`, to: today };
}

const dec = (v: string | null): Decimal => decimal(v ?? '0');
const ZERO = decimal('0');
const sum = (xs: readonly Decimal[]): Decimal => xs.reduce((s, x) => addDecimal(s, x), ZERO);
const min = (a: Decimal, b: Decimal): Decimal => (compareDecimal(a, b) <= 0 ? a : b);

export type MadeRow = { readonly code: string; readonly name: string; readonly kind: 'income' | 'expense'; readonly amount: Decimal };
export type Made = { readonly period: Period; readonly income: Decimal; readonly spending: Decimal; readonly result: Decimal; readonly rows: readonly MadeRow[] };
/** Income as credits less debits, spending as debits less credits, per account, posted in the period; the closing journal is not a result. */
export async function madeReport(tx: Tx, businessId: string, period: Period): Promise<Made> {
  const rows = (await sql<{ code: string; name: string; kind: 'income' | 'expense'; amount: string }>`
    select a.code, a.name, a.kind, (case when a.kind = 'income' then sum(l.book_credit - l.book_debit) else sum(l.book_debit - l.book_credit) end)::text as amount
      from journal_lines l join journal_entries e on e.id = l.entry_id and e.business_id = l.business_id join journals j on j.id = e.journal_id
      join accounts a on a.id = l.account_id and a.business_id = l.business_id
     where l.business_id = ${businessId}::uuid and e.state = 'posted' and j.kind <> 'closing' and a.kind in ('income', 'expense')
       and e.entry_date between ${period.from}::date and ${period.to}::date
     group by a.code, a.name, a.kind having sum(l.book_credit - l.book_debit) <> 0 order by a.kind desc, a.code`.execute(tx)).rows;
  const shown = rows.map((r) => ({ ...r, amount: dec(r.amount) }));
  const income = sum(shown.filter((r) => r.kind === 'income').map((r) => r.amount)), spending = sum(shown.filter((r) => r.kind === 'expense').map((r) => r.amount));
  return { period, income, spending, result: subDecimal(income, spending), rows: shown };
}

export type MoneyRow = { readonly id: string; readonly date: string; readonly label: string; readonly in: Decimal; readonly out: Decimal };
export type Money = { readonly period: Period; readonly state: 'available' | 'needs_setup'; readonly in: Decimal; readonly out: Decimal; readonly opening: Decimal; readonly rows: readonly MoneyRow[] };
/**
 * Per posted entry in the period: what its money-account lines took in less what they paid out, with the part that
 * merely moved between two money accounts (the smaller side) counted on neither. Opening-journal lines are the balance
 * brought forward, said apart, never money that came in. So in − out + opening = the trial balance's period movement
 * on the money accounts.
 */
export async function moneyReport(tx: Tx, businessId: string, period: Period): Promise<Money> {
  const ids = await moneyAccountIds(tx, businessId);
  if (!ids.length) return { period, state: 'needs_setup', in: decimal('0'), out: decimal('0'), opening: decimal('0'), rows: [] };
  const rows = (await sql<{ id: string; date: string; label: string; dr: string; cr: string; opening: boolean }>`
    select e.id::text as id, e.entry_date::text as date, e.label, sum(l.book_debit)::text as dr, sum(l.book_credit)::text as cr, j.kind = 'opening' as opening
      from journal_entries e join journals j on j.id = e.journal_id join journal_lines l on l.entry_id = e.id and l.business_id = e.business_id
     where e.business_id = ${businessId}::uuid and e.state = 'posted' and l.account_id = any(${ids}::uuid[])
       and e.entry_date between ${period.from}::date and ${period.to}::date
     group by e.id, e.entry_date, e.label, j.kind order by e.entry_date desc, e.id`.execute(tx)).rows;
  let inn = ZERO, out = ZERO, opening = ZERO;
  const shown: MoneyRow[] = [];
  for (const r of rows) {
    const dr = dec(r.dr), cr = dec(r.cr);
    if (r.opening) { opening = addDecimal(opening, subDecimal(dr, cr)); continue; }
    const moved = min(dr, cr);
    const i = subDecimal(dr, moved), o = subDecimal(cr, moved);
    inn = addDecimal(inn, i); out = addDecimal(out, o);
    if (signOf(i) !== 0 || signOf(o) !== 0) shown.push({ id: r.id, date: r.date, label: r.label, in: i, out: o });
  }
  return { period, state: 'available', in: inn, out, opening, rows: shown };
}

export type TaxRow = { readonly code: string; readonly label: string; readonly rate: Decimal; readonly kind: string; readonly base: Decimal; readonly tax: Decimal };
export type Tax = { readonly period: Period; readonly collected: Decimal; readonly deductible: Decimal; readonly owed: Decimal; readonly rows: readonly TaxRow[] };
/** The pack's own tax reading (D3): each code's base and its tax at its rate, from the lines that carry it. */
export async function taxReport(tx: Tx, businessId: string, period: Period): Promise<Tax> {
  const rows = (await sql<{ code: string; label: string; rate: string; kind: string; base: string; tax: string }>`
    select t.code, t.label, t.rate::text as rate, t.kind,
           (case when t.kind = 'deductible' then sum(l.book_debit - l.book_credit) else sum(l.book_credit - l.book_debit) end)::text as base,
           round(case when t.kind = 'deductible' then sum(l.book_debit - l.book_credit) else sum(l.book_credit - l.book_debit) end * t.rate / 100, 2)::text as tax
      from journal_lines l join journal_entries e on e.id = l.entry_id join tax_codes t on t.id = l.tax_code_id
     where e.business_id = ${businessId}::uuid and e.state = 'posted' and e.entry_date between ${period.from}::date and ${period.to}::date
     group by t.code, t.label, t.rate, t.kind order by t.kind, t.code`.execute(tx)).rows;
  const shown = rows.map((r) => ({ code: r.code, label: r.label, kind: r.kind, rate: dec(r.rate), base: dec(r.base), tax: dec(r.tax) }));
  const collected = sum(shown.filter((r) => r.kind === 'collected').map((r) => r.tax)), deductible = sum(shown.filter((r) => r.kind === 'deductible').map((r) => r.tax));
  return { period, collected, deductible, owed: subDecimal(collected, deductible), rows: shown };
}

export type CustomerRow = { readonly partyId: string; readonly name: string; readonly invoices: number; readonly billed: Decimal; readonly currency: string };
export type Customers = { readonly period: Period; readonly rows: readonly CustomerRow[]; readonly others: { readonly customers: number; readonly billed: Decimal } | null; readonly total: Decimal };
/** Issued invoices in the period by customer, less the credit notes issued against them in the period; the ten largest, the rest counted. */
export async function customersReport(tx: Tx, businessId: string, period: Period, top = 10): Promise<Customers> {
  const rows = (await sql<{ party_id: string; name: string; invoices: number; billed: string; currency: string }>`
    select i.party_id::text as party_id, coalesce(i.party_name, p.name) as name, count(*)::int as invoices, i.currency,
           (sum(invoice_total(i.id)) - coalesce(sum((select coalesce(sum(credit_note_total(c.id)), 0) from credit_notes c where c.invoice_id = i.id and c.state = 'issued'
             and c.issue_date between ${period.from}::date and ${period.to}::date)), 0))::text as billed
      from invoices i join parties p on p.id = i.party_id
     where i.business_id = ${businessId}::uuid and i.state = 'issued' and i.issue_date between ${period.from}::date and ${period.to}::date
     group by i.party_id, coalesce(i.party_name, p.name), i.currency`.execute(tx)).rows;
  // Largest first, by the figure (the text cast above would sort "600" above "3360"), then by name.
  const all = rows.map((r) => ({ partyId: r.party_id, name: r.name, invoices: r.invoices, billed: dec(r.billed), currency: r.currency }))
    .sort((a, b) => compareDecimal(b.billed, a.billed) || a.name.localeCompare(b.name));
  const rest = all.slice(top);
  return { period, rows: all.slice(0, top), total: sum(all.map((r) => r.billed)),
    others: rest.length ? { customers: rest.length, billed: sum(rest.map((r) => r.billed)) } : null };
}

export type AgeBucket = 'not_due' | 'd1_30' | 'd31_60' | 'd61_90' | 'over_90';
export const AGE_BUCKETS: readonly AgeBucket[] = ['not_due', 'd1_30', 'd31_60', 'd61_90', 'over_90'];
/** Days past due, counted from the day after the due date; no due date is "not due". */
export const ageBucket = (daysPastDue: number | null): AgeBucket =>
  daysPastDue === null || daysPastDue <= 0 ? 'not_due' : daysPastDue <= 30 ? 'd1_30' : daysPastDue <= 60 ? 'd31_60' : daysPastDue <= 90 ? 'd61_90' : 'over_90';
export type UnpaidRow = { readonly id: string; readonly key: string; readonly name: string; readonly dueDate: string | null; readonly daysPastDue: number | null; readonly bucket: AgeBucket; readonly owed: Decimal; readonly currency: string };
export type Unpaid = { readonly today: string; readonly rows: readonly UnpaidRow[]; readonly byBucket: Readonly<Record<AgeBucket, Decimal>>; readonly total: Decimal };
/** What is still owed on each issued invoice as of today (payments and credit notes to date), by how long past due. */
export async function unpaidReport(tx: Tx, businessId: string, today: string): Promise<Unpaid> {
  const rows = (await sql<{ id: string; year: number; number: number; name: string; due_date: string | null; days: number | null; owed: string; currency: string }>`
    select i.id::text as id, i.year, i.number, coalesce(i.party_name, p.name) as name, i.due_date::text as due_date,
           case when i.due_date is null then null else (${today}::date - i.due_date) end as days, i.currency,
           (invoice_total(i.id)
             - coalesce((select sum(credit_note_total(c.id)) from credit_notes c where c.invoice_id = i.id and c.state = 'issued' and c.issue_date <= ${today}::date), 0)
             - coalesce((select sum(signed) from (select case when kind = 'refund' then -amount else amount end as signed from invoice_payments where invoice_id = i.id and paid_on <= ${today}::date) paid), 0))::text as owed
      from invoices i join parties p on p.id = i.party_id
     where i.business_id = ${businessId}::uuid and i.state = 'issued' and i.issue_date <= ${today}::date`.execute(tx)).rows
    .map((r) => ({ ...r, owed: dec(r.owed) })).filter((r) => signOf(r.owed) > 0)
    .map((r): UnpaidRow => ({ id: r.id, key: `F-${r.year}-${String(r.number).padStart(4, '0')}`, name: r.name, dueDate: r.due_date, daysPastDue: r.days, bucket: ageBucket(r.days), owed: r.owed, currency: r.currency }))
    .sort((a, b) => (b.daysPastDue ?? -1) - (a.daysPastDue ?? -1));
  const byBucket = Object.fromEntries(AGE_BUCKETS.map((b) => [b, sum(rows.filter((r) => r.bucket === b).map((r) => r.owed))])) as Record<AgeBucket, Decimal>;
  return { today, rows, byBucket, total: sum(rows.map((r) => r.owed)) };
}
