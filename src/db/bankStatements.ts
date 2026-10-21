import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { Tx } from './client.js';
import { parseDecimal, type Decimal } from '../core/types/decimal.js';
import type { StatementFormat, StatementLine } from '../core/books/statements.js';

/**
 * C3 (Phase 5, item 4; 0185) — STATEMENTS READ IN, AND MATCHED BY A PERSON. A line already read in (its fingerprint,
 * per bank account) is refused, never doubled. A match is SUGGESTED by rule — a posted line of the same account,
 * currency and amount (money in against a debit, out against a credit), within seven days, not matched already —
 * and made only when a person presses it; the database checks every match it is given. Undone, a match is set
 * aside, and both lines are exactly as they were.
 */
export async function importStatement(tx: Tx, businessId: string, by: string, accountId: string, format: StatementFormat, raw: string,
  lines: readonly StatementLine[]): Promise<{ readonly added: number; readonly refused: number }> {
  const have = new Set((await sql<{ f: string }>`select fingerprint as f from statement_lines
    where business_id = ${businessId}::uuid and account_id = ${accountId}::uuid and fingerprint = any(${lines.map((l) => l.fingerprint)}::text[])`.execute(tx)).rows.map((r) => r.f));
  // already read in, or a second line in this very file under the same reference: the first one counts
  const fresh = lines.filter((l) => { if (have.has(l.fingerprint)) return false; have.add(l.fingerprint); return true; });
  const id = (await sql<{ id: string }>`insert into statement_imports (business_id, account_id, format, sha256, added, refused, imported_by)
    values (${businessId}::uuid, ${accountId}::uuid, ${format}, ${createHash('sha256').update(raw).digest('hex')}, ${fresh.length}, ${lines.length - fresh.length}, ${by})
    returning id::text as id`.execute(tx)).rows[0]!.id;
  for (const l of fresh) {
    await sql`insert into statement_lines (business_id, import_id, account_id, booked_on, amount, currency, wording, reference, fingerprint)
      values (${businessId}::uuid, ${id}::uuid, ${accountId}::uuid, ${l.bookedOn}::date, ${l.amount}::numeric, ${l.currency}, ${l.wording}, ${l.reference}, ${l.fingerprint})`.execute(tx);
  }
  return { added: fresh.length, refused: lines.length - fresh.length };
}

export type Suggestion = { readonly journalLineId: string; readonly entryId: string; readonly key: string; readonly date: string; readonly label: string };
export type OpenLine = {
  readonly id: string; readonly bookedOn: string; readonly amount: Decimal; readonly currency: string; readonly wording: string | null;
  readonly reference: string | null; readonly suggestions: readonly Suggestion[];
};
export type MatchedLine = OpenLine & { readonly matchId: string; readonly entryId: string; readonly key: string };

/** The account's lines not matched yet, each with what the rule suggests — nothing is matched by it. */
export async function openLines(tx: Tx, businessId: string, accountId: string): Promise<OpenLine[]> {
  const lines = (await sql<{ id: string; booked_on: string; amount: string; currency: string; wording: string | null; reference: string | null }>`
    select s.id::text as id, s.booked_on::text as booked_on, s.amount::text as amount, s.currency, s.wording, s.reference
      from statement_lines s
     where s.business_id = ${businessId}::uuid and s.account_id = ${accountId}::uuid
       and not exists (select 1 from statement_matches m where m.statement_line_id = s.id and m.unmatched_at is null)
     order by s.booked_on, s.id limit 200`.execute(tx)).rows;
  const out: OpenLine[] = [];
  for (const l of lines) {
    const suggestions = (await sql<Suggestion>`
      select jl.id::text as "journalLineId", e.id::text as "entryId",
             j.code || '-' || extract(year from f.starts_on)::int || '-' || e.number as key, e.entry_date::text as date, e.label
        from journal_lines jl join journal_entries e on e.id = jl.entry_id join journals j on j.id = e.journal_id join fiscal_years f on f.id = e.fiscal_year_id
       where jl.business_id = ${businessId}::uuid and jl.account_id = ${accountId}::uuid and e.state = 'posted' and jl.currency = ${l.currency}
         and (case when ${l.amount}::numeric > 0 then jl.debit = ${l.amount}::numeric else jl.credit = -${l.amount}::numeric end)
         and abs(e.entry_date - ${l.booked_on}::date) <= 7
         and not exists (select 1 from statement_matches m where m.journal_line_id = jl.id and m.unmatched_at is null)
       order by abs(e.entry_date - ${l.booked_on}::date), e.number limit 5`.execute(tx)).rows;
    out.push({ id: l.id, bookedOn: l.booked_on, amount: parseDecimal(l.amount)!, currency: l.currency, wording: l.wording, reference: l.reference, suggestions });
  }
  return out;
}

export async function matchedLines(tx: Tx, businessId: string, accountId: string): Promise<MatchedLine[]> {
  return (await sql<{ id: string; booked_on: string; amount: string; currency: string; wording: string | null; reference: string | null; match_id: string; entry_id: string; key: string }>`
    select s.id::text as id, s.booked_on::text as booked_on, s.amount::text as amount, s.currency, s.wording, s.reference, m.id::text as match_id,
           e.id::text as entry_id, j.code || '-' || extract(year from f.starts_on)::int || '-' || e.number as key
      from statement_matches m join statement_lines s on s.id = m.statement_line_id join journal_lines jl on jl.id = m.journal_line_id
      join journal_entries e on e.id = jl.entry_id join journals j on j.id = e.journal_id join fiscal_years f on f.id = e.fiscal_year_id
     where m.business_id = ${businessId}::uuid and s.account_id = ${accountId}::uuid and m.unmatched_at is null
     order by s.booked_on desc limit 200`.execute(tx)).rows.map((r) => ({
    id: r.id, bookedOn: r.booked_on, amount: parseDecimal(r.amount)!, currency: r.currency, wording: r.wording, reference: r.reference,
    suggestions: [], matchId: r.match_id, entryId: r.entry_id, key: r.key,
  }));
}

/** A person's match: the database checks the account, the amount, the side, and that each line has one at a time. */
export async function matchLine(tx: Tx, businessId: string, by: string, statementLineId: string, journalLineId: string): Promise<boolean> {
  try {
    await sql`savepoint match_line`.execute(tx);
    await sql`insert into statement_matches (business_id, statement_line_id, journal_line_id, matched_by)
      values (${businessId}::uuid, ${statementLineId}::uuid, ${journalLineId}::uuid, ${by})`.execute(tx);
    await sql`release savepoint match_line`.execute(tx);
    return true;
  } catch (e) {
    await sql`rollback to savepoint match_line`.execute(tx);
    const code = String((e as { code?: unknown } | null)?.code ?? '');
    if (code === 'NB020' || code === '23505' || code === '23503' || code === '22P02') return false;
    throw e;
  }
}

/** Set a match aside: both lines are as they were, and either can be matched again. */
export async function unmatch(tx: Tx, businessId: string, by: string, matchId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(matchId)) return false;
  const r = await sql`update statement_matches set unmatched_at = now(), unmatched_by = ${by}
    where business_id = ${businessId}::uuid and id = ${matchId}::uuid and unmatched_at is null`.execute(tx);
  return Number(r.numAffectedRows ?? 0) > 0;
}

/** The accounts a statement can be read against: the asset accounts of the chart. */
export async function bankAccounts(tx: Tx, businessId: string) {
  return (await sql<{ id: string; code: string; name: string }>`select id::text as id, code, name from accounts
    where business_id = ${businessId}::uuid and kind = 'asset' and is_active order by code`.execute(tx)).rows;
}
