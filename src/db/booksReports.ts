import { sql } from 'kysely';
import type { Tx } from './client.js';
import { parseDecimal, type Decimal } from '../core/types/decimal.js';
import { trialBalance, type AccountKind, type TrialBalance } from '../core/books/trialBalance.js';
import type { PackLine, PackTax, PackTaxAccount } from '../core/books/pack.js';
import type { FecLine } from '../core/books/fec.js';

/**
 * D1 (Phase 5, item 1) — THE TRIAL BALANCE's figures, summed by the database from the posted lines' amounts in the
 * books' currency; the shape is `src/core/books/trialBalance.ts`'s. Drafts and discarded entries are not the books.
 */
export type Period = { readonly from: string; readonly to: string };

/** The period a page opens on: the fiscal year holding `today`, from its first day to today (or the calendar year). */
export async function defaultPeriod(tx: Tx, businessId: string, today: string): Promise<Period> {
  const fy = (await sql<{ s: string }>`select starts_on::text as s from fiscal_years where business_id = ${businessId}::uuid
    and starts_on <= ${today}::date and ends_on >= ${today}::date`.execute(tx)).rows[0];
  return { from: fy?.s ?? `${today.slice(0, 4)}-01-01`, to: today };
}

export async function trialBalanceOf(tx: Tx, businessId: string, p: Period): Promise<TrialBalance> {
  // A result opens with its fiscal year: the year holding `from` (outside every year, the period's own first day).
  const yearStart = (await sql<{ s: string }>`select coalesce((select starts_on from fiscal_years where business_id = ${businessId}::uuid
    and starts_on <= ${p.from}::date and ends_on >= ${p.from}::date), ${p.from}::date)::text as s`.execute(tx)).rows[0]!.s;
  const rows = (await sql<{ code: string; name: string; kind: AccountKind; opening: string; pd: string; pc: string }>`
    select a.code, a.name, a.kind,
           coalesce(sum(l.book_debit - l.book_credit) filter (where e.entry_date < ${p.from}::date
             and (a.kind not in ('income', 'expense') or e.entry_date >= ${yearStart}::date)), 0)::text as opening,
           coalesce(sum(l.book_debit) filter (where e.entry_date >= ${p.from}::date), 0)::text as pd,
           coalesce(sum(l.book_credit) filter (where e.entry_date >= ${p.from}::date), 0)::text as pc
      from journal_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
     where l.business_id = ${businessId}::uuid and e.state = 'posted' and e.entry_date <= ${p.to}::date
     group by a.code, a.name, a.kind`.execute(tx)).rows;
  const earlier = (await sql<{ n: string }>`select coalesce(sum(l.book_debit - l.book_credit), 0)::text as n
      from journal_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
     where l.business_id = ${businessId}::uuid and e.state = 'posted' and a.kind in ('income', 'expense')
       and e.entry_date < ${yearStart}::date`.execute(tx)).rows[0]!.n;
  const dec = (v: string): Decimal => parseDecimal(v)!;
  return trialBalance(rows.map((r) => ({ code: r.code, name: r.name, kind: r.kind, opening: dec(r.opening), periodDebit: dec(r.pd), periodCredit: dec(r.pc) })), dec(earlier));
}

/**
 * D3 (Phase 5, item 2) — what the accountant pack is made from, for a period: every posted line in it (the journal
 * and the ledger), and what each tax code came to — its base (the lines that carry it, net of credit notes) and the
 * tax at its rate — beside each tax account's own movement, so a difference shows rather than hides.
 */
export async function packData(tx: Tx, businessId: string, p: Period): Promise<{ lines: PackLine[]; taxes: PackTax[]; taxAccounts: PackTaxAccount[] }> {
  const dec = (v: string): Decimal => parseDecimal(v)!;
  const lines = (await sql<{ journal_code: string; journal_name: string; number: number; entry_date: string; document_ref: string; document_date: string;
    account_code: string; account_name: string; party_code: string | null; party_name: string | null; label: string; book_debit: string; book_credit: string;
    currency: string; debit: string; credit: string; book: string; posted_at: string }>`
    select j.code as journal_code, j.name as journal_name, e.number, e.entry_date::text as entry_date, e.document_ref, e.document_date::text as document_date,
           a.code as account_code, a.name as account_name, pa.code as party_code, pa.name as party_name, coalesce(l.label, e.label) as label,
           l.book_debit::text as book_debit, l.book_credit::text as book_credit, l.currency, l.debit::text as debit, l.credit::text as credit,
           books_currency(e.business_id) as book, to_char(e.posted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as posted_at
      from journal_entries e join journal_lines l on l.entry_id = e.id join journals j on j.id = e.journal_id
      join accounts a on a.id = l.account_id left join parties pa on pa.id = l.party_id
     where e.business_id = ${businessId}::uuid and e.state = 'posted' and e.entry_date between ${p.from}::date and ${p.to}::date
     order by j.code, e.number, l.line_no`.execute(tx)).rows.map((r): PackLine => ({
    journalCode: r.journal_code, journalName: r.journal_name, number: r.number, entryDate: r.entry_date, documentRef: r.document_ref, documentDate: r.document_date,
    accountCode: r.account_code, accountName: r.account_name, partyCode: r.party_code, partyName: r.party_name, label: r.label,
    bookDebit: dec(r.book_debit), bookCredit: dec(r.book_credit), currency: r.currency, postedAt: r.posted_at,
    foreign: r.currency === r.book ? null : dec(r.debit !== '0.00' ? r.debit : `-${r.credit}`),
  }));
  const taxes = (await sql<{ code: string; label: string; rate: string; kind: string; base: string; tax: string }>`
    select t.code, t.label, t.rate::text as rate, t.kind,
           (case when t.kind = 'deductible' then sum(l.book_debit - l.book_credit) else sum(l.book_credit - l.book_debit) end)::text as base,
           round(case when t.kind = 'deductible' then sum(l.book_debit - l.book_credit) else sum(l.book_credit - l.book_debit) end * t.rate / 100, 2)::text as tax
      from journal_lines l join journal_entries e on e.id = l.entry_id join tax_codes t on t.id = l.tax_code_id
     where e.business_id = ${businessId}::uuid and e.state = 'posted' and e.entry_date between ${p.from}::date and ${p.to}::date
     group by t.code, t.label, t.rate, t.kind order by t.code`.execute(tx)).rows.map((r): PackTax => ({
    code: r.code, label: r.label, rate: dec(r.rate), kind: r.kind, base: dec(r.base), tax: dec(r.tax) }));
  const taxAccounts = (await sql<{ code: string; name: string; debit: string; credit: string }>`
    select a.code, a.name, coalesce(sum(l.book_debit), 0)::text as debit, coalesce(sum(l.book_credit), 0)::text as credit
      from accounts a join journal_lines l on l.account_id = a.id join journal_entries e on e.id = l.entry_id
     where a.business_id = ${businessId}::uuid and a.id in (select account_id from tax_codes where business_id = ${businessId}::uuid and account_id is not null)
       and e.state = 'posted' and e.entry_date between ${p.from}::date and ${p.to}::date
     group by a.code, a.name order by a.code`.execute(tx)).rows.map((r): PackTaxAccount => ({ code: r.code, name: r.name, debit: dec(r.debit), credit: dec(r.credit) }));
  return { lines, taxes, taxAccounts };
}

/**
 * D4 (Avis 24, annex 3 and 2.2 b) — a fiscal year's FEC lines, its journals' numbers for the check program, and the
 * accounts whose number does not begin as the CGNC's do (Num_Compte: « trois premiers caractères correspondant aux
 * chiffres respectant les normes comptables applicables »).
 */
export async function fecData(tx: Tx, businessId: string, yearId: string) {
  const year = (await sql<{ starts_on: string; ends_on: string; state: string }>`select starts_on::text as starts_on, ends_on::text as ends_on, state
    from fiscal_years where business_id = ${businessId}::uuid and id = ${yearId}::uuid`.execute(tx)).rows[0];
  if (!year) return null;
  const dec = (v: string): Decimal => parseDecimal(v)!;
  const rows = (await sql<{ jc: string; jn: string; number: number; entry_date: string; ac: string; an: string; pc: string | null; pn: string | null;
    document_ref: string; document_date: string; label: string; bd: string; bc: string; currency: string; debit: string; credit: string; book: string; posted: string }>`
    select j.code as jc, j.name as jn, e.number, e.entry_date::text as entry_date, a.code as ac, a.name as an, pa.code as pc, pa.name as pn,
           e.document_ref, e.document_date::text as document_date, coalesce(l.label, e.label) as label, l.book_debit::text as bd, l.book_credit::text as bc,
           l.currency, l.debit::text as debit, l.credit::text as credit, books_currency(e.business_id) as book,
           to_char(e.posted_at at time zone 'UTC', 'YYYY-MM-DD') as posted
      from journal_entries e join journal_lines l on l.entry_id = e.id join journals j on j.id = e.journal_id
      join accounts a on a.id = l.account_id left join parties pa on pa.id = l.party_id
     where e.business_id = ${businessId}::uuid and e.fiscal_year_id = ${yearId}::uuid and e.state = 'posted'
     order by e.entry_date, j.code, e.number, l.line_no`.execute(tx)).rows;
  const lines: FecLine[] = rows.map((r) => ({
    journalCode: r.jc, journalName: r.jn, number: r.number, entryDate: r.entry_date, accountCode: r.ac, accountName: r.an, partyCode: r.pc, partyName: r.pn,
    documentRef: r.document_ref, documentDate: r.document_date, label: r.label, debit: dec(r.bd), credit: dec(r.bc), validatedOn: r.posted,
    foreign: r.currency === r.book ? null : { amount: dec(r.debit !== '0.00' ? r.debit : `-${r.credit}`), currency: r.currency },
  }));
  const numbers = new Map<string, number[]>();
  for (const n of (await sql<{ code: string; number: number }>`select j.code, e.number from journal_entries e join journals j on j.id = e.journal_id
    where e.business_id = ${businessId}::uuid and e.fiscal_year_id = ${yearId}::uuid and e.state = 'posted'`.execute(tx)).rows) {
    numbers.set(n.code, [...(numbers.get(n.code) ?? []), n.number]);
  }
  const offChart = (await sql<{ code: string; name: string }>`select distinct a.code, a.name from journal_lines l join journal_entries e on e.id = l.entry_id
      join accounts a on a.id = l.account_id
     where e.business_id = ${businessId}::uuid and e.fiscal_year_id = ${yearId}::uuid and e.state = 'posted'
       and left(a.code, 3) not in (select left(code, 3) from chart_template_accounts where template = 'cgnc-normal' and length(code) >= 3)
     order by a.code`.execute(tx)).rows;
  return { year, lines, numbers, offChart };
}
