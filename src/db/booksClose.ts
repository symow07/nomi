import { sql } from 'kysely';
import type { Tx } from './client.js';

/**
 * D2 (Phase 5, item 6; 0189) — CLOSING THE BOOKS. The rules are the database's (`books_lock_to`, `books_reopen_year`,
 * `books_close_year`, `books_close_checklist`): a lock only forward and only with the checklist clear; a reopening
 * the owner's, with a reason, recorded; a year closed by one entry in the closing journal, then never again written
 * in; at most two years open. This file asks, and turns a refusal into its reason.
 *
 * D10 (0211) — EACH FISCAL YEAR HAS ITS OWN LOCK, the one thing that decides what can be written; the books start
 * once (`books_start`: the day and the period length); and, for a Moroccan workspace, Avis 24's two current periods
 * are kept on the set of locks (`books_period_floors`, `books_roll_periods`, run by the worker every hour).
 */
export const CHECKLIST = ['draft_entries', 'draft_invoices', 'draft_credit_notes', 'unmatched_statement_lines'] as const;
export type ChecklistItem = (typeof CHECKLIST)[number];
export type FiscalYear = { readonly id: string; readonly startsOn: string; readonly endsOn: string; readonly state: 'open' | 'closed';
  /** D10 — the year's own lock: everything on or before it, in this year, is closed. */
  readonly lockDate: string | null };
export type BooksStart = { readonly day: string; readonly length: 'month' | 'quarter'; readonly by: string; readonly at: string };
export type LockEvent = { readonly action: 'lock' | 'reopen' | 'close' | 'start' | 'period'; readonly fromDate: string | null; readonly toDate: string | null;
  readonly reason: string | null; readonly by: string; readonly at: string };

export type CloseRefusal = { readonly kind: 'refused'; readonly reason:
  | 'not_clear' | 'backwards' | 'future' | 'not_owner' | 'no_reason' | 'not_back' | 'not_open' | 'not_ended'
  | 'not_closing_journal' | 'not_equity' | 'overlap' | 'two_open' | 'bad_year' | 'started' | 'ceiling' | 'before_start' | 'no_open_year' | 'other';
  readonly detail: string | null };

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
    if (/moves the (year's )?lock back/.test(m)) return r('not_back');
    if (/started on (\S+) already/.test(m)) return r('started', /started on (\S+) already/.exec(m)?.[1] ?? null);
    if (/two current periods open at most/.test(m)) return r('ceiling', /locked to (\S+) at least/.exec(m)?.[1] ?? null);
    if (/nothing before it reopens/.test(m)) return r('before_start', /start on (\S+);/.exec(m)?.[1] ?? null);
    if (/in no open fiscal year|inside an open fiscal year/.test(m)) return r('no_open_year');
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
  const years = (await sql<{ id: string; starts_on: string; ends_on: string; state: FiscalYear['state']; lock_date: string | null }>`select id::text as id,
    starts_on::text as starts_on, ends_on::text as ends_on, state, lock_date::text as lock_date from fiscal_years where business_id = ${businessId}::uuid
    order by starts_on desc`.execute(tx)).rows
    .map((y): FiscalYear => ({ id: y.id, startsOn: y.starts_on, endsOn: y.ends_on, state: y.state, lockDate: y.lock_date }));
  const st = (await sql<{ day: string | null; length: BooksStart['length']; by: string | null; at: string | null; country: string | null }>`
    select s.books_start::text as day, coalesce(s.period_length, 'month') as length, s.books_started_by as by, to_json(s.books_started_at) #>> '{}' as at, b.country
      from businesses b left join books_settings s on s.business_id = b.id where b.id = ${businessId}::uuid`.execute(tx)).rows[0];
  const start: BooksStart | null = st?.day ? { day: st.day, length: st.length, by: st.by ?? '', at: st.at ?? '' } : null;
  const morocco = st?.country === 'MA';
  const history = (await sql<{ action: LockEvent['action']; from_date: string | null; to_date: string | null; reason: string | null; by_person: string; at: string }>`
    select action, from_date::text as from_date, to_date::text as to_date, reason, by_person, to_json(at) #>> '{}' as at from period_locks
     where business_id = ${businessId}::uuid order by at desc limit 50`.execute(tx)).rows
    .map((h): LockEvent => ({ action: h.action, fromDate: h.from_date, toDate: h.to_date, reason: h.reason, by: h.by_person, at: h.at }));
  const q = <T>(s: ReturnType<typeof sql<T>>) => s.execute(tx).then((r) => r.rows);
  return {
    years, history, start, morocco,
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

/** D10 — a year's lock moved back (or lifted): the owner's, with a reason; never below the start, nor past Avis 24's ceiling. */
export const reopenTo = (tx: Tx, businessId: string, yearId: string, day: string | null, by: string, reason: string) =>
  attempt(tx, 'reopen_to', async () => { await sql`select books_reopen_year(${yearId}::uuid, ${day}::date, ${by}, ${reason})`.execute(tx); return { kind: 'done' as const }; });

/** D10 — the books begin: once, the day and the period length, by the owner. */
export const startBooks = (tx: Tx, businessId: string, day: string, length: 'month' | 'quarter', by: string) =>
  attempt(tx, 'books_start', async () => { await sql`select books_start(${day}::date, ${length}, ${by})`.execute(tx); return { kind: 'done' as const }; });

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

/** 0216 — the opening journal, for a chart that has none: code AN, kind opening (the opening entry and nothing else). */
export const addOpeningJournal = (tx: Tx, businessId: string, name: string) =>
  attempt(tx, 'opening_journal', async () => {
    await sql`insert into journals (business_id, code, name, kind) values (${businessId}::uuid, 'AN', ${name}, 'opening')`.execute(tx);
    return { kind: 'done' as const };
  });

/** The closing journal, for a chart that has none: code CL, kind closing. */
export const addClosingJournal = (tx: Tx, businessId: string, name: string) =>
  attempt(tx, 'closing_journal', async () => {
    await sql`insert into journals (business_id, code, name, kind) values (${businessId}::uuid, 'CL', ${name}, 'closing')`.execute(tx);
    return { kind: 'done' as const };
  });
