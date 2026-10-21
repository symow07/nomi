import { sql } from 'kysely';
import type { Tx } from './client.js';
import { parseDecimal, type Decimal } from '../core/types/decimal.js';
import { trialBalance, type AccountKind, type TrialBalance } from '../core/books/trialBalance.js';

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
