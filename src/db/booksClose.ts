import { sql } from 'kysely';
import type { Tx } from './client.js';

/**
 * D2 (Phase 5, item 6; 0189) — CLOSING THE BOOKS. The rules are the database's (`books_lock_to`, `books_reopen_to`,
 * `books_close_year`, `books_close_checklist`): a lock only forward and only with the checklist clear; a reopening
 * the owner's, with a reason, recorded; a year closed by one entry in the closing journal, then never again written
 * in; at most two years open. This file asks, and turns a refusal into its reason.
 */
export const CHECKLIST = ['draft_entries', 'draft_invoices', 'draft_credit_notes', 'unmatched_statement_lines'] as const;
export type ChecklistItem = (typeof CHECKLIST)[number];
export type FiscalYear = { readonly id: string; readonly startsOn: string; readonly endsOn: string; readonly state: 'open' | 'closed' };
export type LockEvent = { readonly action: 'lock' | 'reopen' | 'close'; readonly fromDate: string | null; readonly toDate: string | null;
  readonly reason: string | null; readonly by: string; readonly at: string };

export type CloseRefusal = { readonly kind: 'refused'; readonly reason:
  | 'not_clear' | 'backwards' | 'future' | 'not_owner' | 'no_reason' | 'not_back' | 'not_open' | 'not_ended'
  | 'not_closing_journal' | 'not_equity' | 'overlap' | 'two_open' | 'bad_year' | 'other'; readonly detail: string | null };

function closeRefusalOf(e: unknown): CloseRefusal {
  const code = String((e as { code?: unknown } | null)?.code ?? '');
  const m = String((e as { message?: unknown }).message ?? '');
  const r = (reason: CloseRefusal['reason'], detail: string | null = null): CloseRefusal => ({ kind: 'refused', reason, detail });
  if (code === 'NB024') return r('not_owner');
  if (code === 'NB023') {
    const clear = /checklist is not clear for (\S+) — (\w+): (\d+)/.exec(m);
    if (clear) return r('not_clear', `${clear[2]}:${clear[3]}`);
    if (/moves only forward/.test(m)) return r('backwards', /locked to (\S+) already/.exec(m)?.[1] ?? null);
    if (/today at the latest/.test(m)) return r('future');
    if (/says why/.test(m)) return r('no_reason');
    if (/moves the lock back/.test(m)) return r('not_back');
    if (/not open/.test(m)) return r('not_open');
    if (/once it has ended/.test(m)) return r('not_ended', /\((\S+)\)/.exec(m)?.[1] ?? null);
    return r('other');
  }
  if (code === 'NB025') return /equity/.test(m) ? r('not_equity') : r('not_closing_journal');
  if (code === 'NB002') return r('overlap');
  if (code === 'NB003') return r('two_open');
  if (code === '23514' || code === '22007' || code === '22008') return r('bad_year');
  if (code === '23505') return r('other');
  throw e;
}

async function attempt<T>(tx: Tx, name: string, fn: () => Promise<T>): Promise<T | CloseRefusal> {
  try {
    await sql`savepoint ${sql.raw(name)}`.execute(tx);
    const out = await fn();
    await sql`release savepoint ${sql.raw(name)}`.execute(tx);
    return out;
  } catch (e) {
    await sql`rollback to savepoint ${sql.raw(name)}`.execute(tx);
    return closeRefusalOf(e);
  }
}

export async function closeState(tx: Tx, businessId: string) {
  const lock = (await sql<{ d: string | null }>`select lock_date::text as d from books_settings where business_id = ${businessId}::uuid`.execute(tx)).rows[0]?.d ?? null;
  const years = (await sql<{ id: string; starts_on: string; ends_on: string; state: FiscalYear['state'] }>`select id::text as id, starts_on::text as starts_on,
    ends_on::text as ends_on, state from fiscal_years where business_id = ${businessId}::uuid order by starts_on desc`.execute(tx)).rows
    .map((y): FiscalYear => ({ id: y.id, startsOn: y.starts_on, endsOn: y.ends_on, state: y.state }));
  const history = (await sql<{ action: LockEvent['action']; from_date: string | null; to_date: string | null; reason: string | null; by_person: string; at: string }>`
    select action, from_date::text as from_date, to_date::text as to_date, reason, by_person, to_json(at) #>> '{}' as at from period_locks
     where business_id = ${businessId}::uuid order by at desc limit 50`.execute(tx)).rows
    .map((h): LockEvent => ({ action: h.action, fromDate: h.from_date, toDate: h.to_date, reason: h.reason, by: h.by_person, at: h.at }));
  const q = <T>(s: ReturnType<typeof sql<T>>) => s.execute(tx).then((r) => r.rows);
  return {
    lock, years, history,
    equity: await q(sql<{ id: string; code: string; name: string }>`select id::text as id, code, name from accounts where business_id = ${businessId}::uuid
      and kind = 'equity' and is_active order by code`),
    closingJournals: await q(sql<{ id: string; code: string; name: string }>`select id::text as id, code, name from journals where business_id = ${businessId}::uuid
      and kind = 'closing' order by code`),
  };
}

export async function checklistFor(tx: Tx, businessId: string, day: string): Promise<{ readonly item: ChecklistItem; readonly n: number }[]> {
  return (await sql<{ item: ChecklistItem; n: number }>`select item, n from books_close_checklist(${businessId}::uuid, ${day}::date)`.execute(tx)).rows;
}

export const lockTo = (tx: Tx, businessId: string, day: string, by: string) =>
  attempt(tx, 'lock_to', async () => { await sql`select books_lock_to(${day}::date, ${by})`.execute(tx); return { kind: 'done' as const }; });

export const reopenTo = (tx: Tx, businessId: string, day: string | null, by: string, reason: string) =>
  attempt(tx, 'reopen_to', async () => { await sql`select books_reopen_to(${day}::date, ${by}, ${reason})`.execute(tx); return { kind: 'done' as const }; });

export const closeYear = (tx: Tx, businessId: string, p: { readonly yearId: string; readonly resultAccountId: string; readonly journalId: string;
  readonly by: string; readonly label: string; readonly ref: string }) =>
  attempt(tx, 'close_year', async () => {
    const e = (await sql<{ e: string | null }>`select books_close_year(${p.yearId}::uuid, ${p.resultAccountId}::uuid, ${p.journalId}::uuid, ${p.by}, ${p.label}, ${p.ref})::text as e`
      .execute(tx)).rows[0]!.e;
    return { kind: 'closed' as const, entryId: e };
  });

/** A fiscal year: the owner's to open (the database refuses an overlap, and a third open one). */
export const openYear = (tx: Tx, businessId: string, startsOn: string, endsOn: string) =>
  attempt(tx, 'open_year', async () => {
    await sql`insert into fiscal_years (business_id, starts_on, ends_on) values (${businessId}::uuid, ${startsOn}::date, ${endsOn}::date)`.execute(tx);
    return { kind: 'done' as const };
  });

/** The closing journal, for a chart that has none: code CL, kind closing. */
export const addClosingJournal = (tx: Tx, businessId: string, name: string) =>
  attempt(tx, 'closing_journal', async () => {
    await sql`insert into journals (business_id, code, name, kind) values (${businessId}::uuid, 'CL', ${name}, 'closing')`.execute(tx);
    return { kind: 'done' as const };
  });
