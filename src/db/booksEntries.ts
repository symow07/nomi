import { sql } from 'kysely';
import type { CustomValues } from '../core/books/interchange.js';
import { fieldsOf } from './booksInterchange.js';
import type { Tx } from './client.js';
import { parseDecimal, type Decimal } from '../core/types/decimal.js';

/**
 * C1 (Phase 5, item 3) — JOURNAL ENTRIES, BY HAND: drafted, posted, discarded, reversed. Every rule is the database's
 * (0169–0182): a draft has no number; posting numbers it in its journal with no gap, converts each foreign line at
 * the owner's rate, and refuses an entry that does not balance, a closed or locked day, a missing rate, a tax not in
 * force, a posting by an accountant; a posted entry never changes — it is REVERSED by a new entry, its lines swapped,
 * linked to it, with its own number. This file only asks, and turns a refusal into its reason for the page.
 */

/** Why the database refused, by its own error code (NB…), and the figures it gave where they help. */
export type EntryRefusal = {
  readonly kind: 'refused';
  readonly reason: 'unbalanced' | 'period' | 'needs_document' | 'no_rate' | 'tax_not_in_force' | 'fx_accounts'
    | 'accountant' | 'not_a_draft' | 'not_posted' | 'no_fiscal_year' | 'invoice_locked' | 'payment_refused' | 'opening_day' | 'other';
  readonly detail: string | null;
};
const REASON_OF: Record<string, EntryRefusal['reason']> = {
  NB009: 'unbalanced', NB006: 'period', NB008: 'needs_document', NB014: 'no_rate', NB012: 'tax_not_in_force',
  NB017: 'fx_accounts', NB016: 'accountant',
  // DZ (0200) — an accountant's write to an entry or its lines, refused by the database whatever the route forgot.
  NB021: 'accountant', NB005: 'not_a_draft', NB010: 'not_posted',
  // C2 (0184) — an issued invoice's rules, a payment's.
  NB018: 'invoice_locked', NB019: 'payment_refused',
  // 0216 — the opening journal takes only the opening entry, on its year's first day or the books' start day.
  NB027: 'opening_day',
};
/** The database's refusal as its reason; anything that is not one of the books' own refusals is thrown on. */
export function refusalOf(e: unknown): EntryRefusal {
  const code = String((e as { code?: unknown } | null)?.code ?? '');
  if (!/^NB0\d\d$/.test(code)) throw e;
  const message = String((e as { message?: unknown }).message ?? '');
  // Only the figures after the dash ("MAD: debits 997.66, credits 997.65"; "USD to MAD on or before 2026-04-09").
  const detail = code === 'NB009' ? (/— ([^;]+)/.exec(message)?.[1] ?? null)
    : code === 'NB014' ? (/for (\w{3} to \w{3} on or before \d{4}-\d{2}-\d{2})/.exec(message)?.[1] ?? null)
    : code === 'NB012' ? (/tax code (\S+) is not in force on (\S+)/.exec(message)?.slice(1).join(' · ') ?? null)
    : code === 'NB027' ? (/first day \((\d{4}-\d{2}-\d{2})\)/.exec(message)?.[1] ?? null) : null;
  return { kind: 'refused', reason: REASON_OF[code] ?? 'other', detail };
}

export type EntryRow = {
  readonly id: string; readonly key: string; readonly journal: string; readonly date: string; readonly label: string;
  readonly state: 'draft' | 'posted' | 'discarded'; readonly total: string; readonly currency: string;
  readonly reverses: string | null; readonly reversedBy: string | null;
};
export type EntryLine = {
  readonly lineNo: number; readonly account: string; readonly accountName: string; readonly party: string | null;
  readonly taxCode: string | null; readonly currency: string; readonly debit: Decimal | null; readonly credit: Decimal | null;
  readonly bookDebit: Decimal | null; readonly bookCredit: Decimal | null; readonly rate: string | null;
  readonly label: string | null; readonly isFx: boolean;
  /** D7 — the line's custom values. */
  readonly custom: CustomValues;
};
export type EntryView = EntryRow & {
  readonly documentRef: string | null; readonly documentDate: string | null; readonly postedBy: string | null; readonly custom: CustomValues;
  readonly lines: readonly EntryLine[];
};

const side = (v: string): Decimal | null => { const d = parseDecimal(v); return d === null || d === '0' ? null : d; };
const KEY = sql`case when e.state = 'posted' then j.code || '-' || extract(year from f.starts_on)::int || '-' || e.number else 'draft' end`;

/** The newest entries first (drafts and posted; a discarded draft only when asked), 50 at a time. */
export async function listEntries(tx: Tx, businessId: string, o: { readonly withDiscarded?: boolean } = {}): Promise<EntryRow[]> {
  return (await sql<EntryRow>`
    select e.id::text as id, ${KEY} as key, j.code as journal, e.entry_date::text as date, e.label, e.state,
           coalesce((select sum(l.debit) from journal_lines l where l.entry_id = e.id), 0)::text as total,
           coalesce((select min(l.currency) from journal_lines l where l.entry_id = e.id), '') as currency,
           e.reverses_id::text as reverses,
           (select r.id::text from journal_entries r where r.reverses_id = e.id limit 1) as "reversedBy"
      from journal_entries e join journals j on j.id = e.journal_id join fiscal_years f on f.id = e.fiscal_year_id
     where e.business_id = ${businessId}::uuid ${o.withDiscarded ? sql`` : sql`and e.state <> 'discarded'`}
     order by e.entry_date desc, e.number desc nulls first, e.created_at desc limit 50`.execute(tx)).rows;
}

export async function loadEntry(tx: Tx, businessId: string, id: string): Promise<EntryView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const head = (await sql<EntryRow & { documentRef: string | null; documentDate: string | null; postedBy: string | null; custom: CustomValues }>`
    select e.id::text as id, ${KEY} as key, j.code as journal, e.entry_date::text as date, e.label, e.state,
           coalesce((select sum(l.debit) from journal_lines l where l.entry_id = e.id), 0)::text as total,
           coalesce((select min(l.currency) from journal_lines l where l.entry_id = e.id), '') as currency,
           e.reverses_id::text as reverses, (select r.id::text from journal_entries r where r.reverses_id = e.id limit 1) as "reversedBy",
           e.document_ref as "documentRef", e.document_date::text as "documentDate", e.posted_by as "postedBy", e.custom
      from journal_entries e join journals j on j.id = e.journal_id join fiscal_years f on f.id = e.fiscal_year_id
     where e.business_id = ${businessId}::uuid and e.id = ${id}::uuid`.execute(tx)).rows[0];
  if (!head) return null;
  const lines = (await sql<{ line_no: number; account: string; account_name: string; party: string | null; tax_code: string | null; currency: string;
    debit: string; credit: string; book_debit: string | null; book_credit: string | null; rate: string | null; label: string | null; is_fx: boolean; custom: CustomValues }>`
    select l.line_no, a.code as account, a.name as account_name, p.code as party, t.code as tax_code, l.currency,
           l.debit::text as debit, l.credit::text as credit, l.book_debit::text as book_debit, l.book_credit::text as book_credit,
           l.rate::text as rate, l.label, l.is_fx, l.custom
      from journal_lines l join accounts a on a.id = l.account_id
      left join parties p on p.id = l.party_id left join tax_codes t on t.id = l.tax_code_id
     where l.entry_id = ${id}::uuid order by l.line_no`.execute(tx)).rows;
  return { ...head, lines: lines.map((l) => ({
    lineNo: l.line_no, account: l.account, accountName: l.account_name, party: l.party, taxCode: l.tax_code, currency: l.currency,
    debit: side(l.debit), credit: side(l.credit), bookDebit: l.book_debit === null ? null : side(l.book_debit),
    bookCredit: l.book_credit === null ? null : side(l.book_credit), rate: l.rate, label: l.label, isFx: l.is_fx, custom: l.custom,
  })) };
}

export type DraftLine = {
  readonly accountId: string; readonly partyId: string | null; readonly taxCodeId: string | null; readonly currency: string;
  readonly debit: Decimal | null; readonly credit: Decimal | null; readonly label: string | null; readonly isFx: boolean;
  /** D7 — the line's custom values (none: the database's empty object). */
  readonly custom?: CustomValues;
};
export type DraftInput = {
  readonly journalId: string; readonly date: string; readonly label: string;
  readonly documentRef: string | null; readonly documentDate: string | null; readonly lines: readonly DraftLine[];
  /** C1 (0183) — the Nomi order this entry records; an order has one entry that is not discarded. */
  readonly sourceOrderId?: string | null;
  /** D7 — the entry's custom values. */
  readonly custom?: CustomValues;
  /** 0216 (c) — a payment that settles in one currency what arrived in another: it balances in the books' currency only. */
  readonly acrossCurrencies?: boolean;
};

async function writeEntryLines(tx: Tx, businessId: string, id: string, lines: readonly DraftLine[]): Promise<void> {
  let n = 0;
  for (const l of lines) {
    await sql`insert into journal_lines (business_id, entry_id, line_no, account_id, label, currency, debit, credit, party_id, tax_code_id, is_fx, custom)
      values (${businessId}::uuid, ${id}::uuid, ${++n}, ${l.accountId}::uuid, ${l.label}, ${l.currency}, ${l.debit ?? '0'}::numeric,
              ${l.credit ?? '0'}::numeric, ${l.partyId}::uuid, ${l.taxCodeId}::uuid, ${l.isFx}, ${JSON.stringify(l.custom ?? {})}::jsonb)`.execute(tx);
  }
}

/** A figure as a form shows it: no trailing zeros ("10.000" reads two ways in a box; "10" one). */
export const formFigure = (x: string): string => (x.includes('.') ? x.replace(/0+$/, '').replace(/\.$/, '') : x);

/** 0216 (a) — a draft entry as its form's values (the names `renderNewEntry` reads), or null when it is not a draft. */
export async function draftEntryForm(tx: Tx, businessId: string, id: string): Promise<Record<string, string> | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const h = (await sql<{ journal: string; date: string; label: string; ref: string | null; doc: string | null; custom: CustomValues }>`
    select journal_id::text as journal, entry_date::text as date, label, document_ref as ref, document_date::text as doc, custom
      from journal_entries where business_id = ${businessId}::uuid and id = ${id}::uuid and state = 'draft'`.execute(tx)).rows[0];
  if (!h) return null;
  const v: Record<string, string> = { journal: h.journal, date: h.date, label: h.label, documentRef: h.ref ?? '', documentDate: h.doc ?? '' };
  for (const [k, x] of Object.entries(h.custom ?? {})) v[`cf_entry_${k}`] = String(x);
  const lines = (await sql<{ account: string; party: string | null; tax: string | null; currency: string; debit: string; credit: string; label: string | null; fx: boolean; custom: CustomValues }>`
    select account_id::text as account, party_id::text as party, tax_code_id::text as tax, currency, debit::text as debit, credit::text as credit, label, is_fx as fx, custom
      from journal_lines where entry_id = ${id}::uuid and business_id = ${businessId}::uuid order by line_no`.execute(tx)).rows;
  lines.forEach((l, i) => {
    v[`account${i}`] = l.account; v[`currency${i}`] = l.currency; v[`party${i}`] = l.party ?? ''; v[`tax${i}`] = l.tax ?? ''; v[`label${i}`] = l.label ?? '';
    if (Number(l.debit) !== 0) v[`debit${i}`] = formFigure(l.debit);
    if (Number(l.credit) !== 0) v[`credit${i}`] = formFigure(l.credit);
    if (l.fx) v[`fx${i}`] = '1';
    for (const [k, x] of Object.entries(l.custom ?? {})) v[`cf_line${i}_${k}`] = String(x);
  });
  return v;
}

/**
 * 0216 (a) — A DRAFT EDITED: its header as given, its lines written again (the old ones through the database's one
 * door, `books_clear_draft`). Only a draft: a posted entry is corrected by its reversal, never edited.
 */
export async function redraftEntry(tx: Tx, businessId: string, id: string, d: DraftInput): Promise<{ readonly kind: 'drafted'; readonly id: string } | EntryRefusal> {
  const fy = (await sql<{ id: string }>`select id::text as id from fiscal_years where business_id = ${businessId}::uuid
    and starts_on <= ${d.date}::date and ends_on >= ${d.date}::date`.execute(tx)).rows[0];
  if (!fy) return { kind: 'refused', reason: 'no_fiscal_year', detail: d.date };
  try {
    await sql`savepoint redraft_entry`.execute(tx);
    const cleared = (await sql<{ ok: boolean }>`select books_clear_draft('entry', ${id}::uuid) as ok`.execute(tx)).rows[0]!.ok;
    if (!cleared) { await sql`rollback to savepoint redraft_entry`.execute(tx); return { kind: 'refused', reason: 'not_a_draft', detail: null }; }
    await sql`update journal_entries set journal_id = ${d.journalId}::uuid, fiscal_year_id = ${fy.id}::uuid, entry_date = ${d.date}::date, label = ${d.label},
        document_ref = ${d.documentRef}, document_date = ${d.documentDate}::date, custom = ${JSON.stringify(d.custom ?? {})}::jsonb,
        across_currencies = ${d.acrossCurrencies === true}
      where business_id = ${businessId}::uuid and id = ${id}::uuid and state = 'draft'`.execute(tx);
    await writeEntryLines(tx, businessId, id, d.lines);
    await sql`release savepoint redraft_entry`.execute(tx);
    return { kind: 'drafted', id };
  } catch (e) {
    await sql`rollback to savepoint redraft_entry`.execute(tx);
    return refusalOf(e);
  }
}

/** A draft, in the fiscal year its day falls in. The day must be open and unlocked; balance is the posting's to check. */
export async function draftEntry(tx: Tx, businessId: string, by: string, d: DraftInput): Promise<{ readonly kind: 'drafted'; readonly id: string } | EntryRefusal> {
  const fy = (await sql<{ id: string }>`select id::text as id from fiscal_years where business_id = ${businessId}::uuid
    and starts_on <= ${d.date}::date and ends_on >= ${d.date}::date`.execute(tx)).rows[0];
  if (!fy) return { kind: 'refused', reason: 'no_fiscal_year', detail: d.date };
  try {
    await sql`savepoint draft_entry`.execute(tx);
    const id = (await sql<{ id: string }>`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, document_ref, document_date, created_by, source_order_id, custom,
                                                                 across_currencies)
      values (${businessId}::uuid, ${d.journalId}::uuid, ${fy.id}::uuid, ${d.date}::date, ${d.label}, ${d.documentRef}, ${d.documentDate}::date, ${by}, ${d.sourceOrderId ?? null}::uuid,
              ${JSON.stringify(d.custom ?? {})}::jsonb, ${d.acrossCurrencies === true})
      returning id::text as id`.execute(tx)).rows[0]!.id;
    await writeEntryLines(tx, businessId, id, d.lines);
    await sql`release savepoint draft_entry`.execute(tx);
    return { kind: 'drafted', id };
  } catch (e) {
    await sql`rollback to savepoint draft_entry`.execute(tx);
    return refusalOf(e);
  }
}

/** Post a draft: the database numbers it, converts it, and refuses it if anything is wrong. */
export async function postEntry(tx: Tx, businessId: string, id: string, by: string): Promise<{ readonly kind: 'posted'; readonly key: string } | EntryRefusal> {
  try {
    await sql`savepoint post_entry`.execute(tx);
    const r = await sql`update journal_entries set state = 'posted', posted_by = ${by}
      where business_id = ${businessId}::uuid and id = ${id}::uuid and state = 'draft'`.execute(tx);
    if (Number(r.numAffectedRows ?? 0) === 0) { await sql`release savepoint post_entry`.execute(tx); return { kind: 'refused', reason: 'not_a_draft', detail: null }; }
    await sql`release savepoint post_entry`.execute(tx);
  } catch (e) {
    await sql`rollback to savepoint post_entry`.execute(tx);
    return refusalOf(e);
  }
  return { kind: 'posted', key: (await loadEntry(tx, businessId, id))!.key };
}

/** A draft set aside (never deleted, G20). */
export async function discardEntry(tx: Tx, businessId: string, id: string): Promise<boolean> {
  const r = await sql`update journal_entries set state = 'discarded' where business_id = ${businessId}::uuid and id = ${id}::uuid and state = 'draft'`.execute(tx);
  return Number(r.numAffectedRows ?? 0) > 0;
}

/**
 * Reverse a posted entry: a new entry in the same journal on `date`, each line's debit and credit swapped, linked to
 * the original, its document the original's own number — drafted and posted in one go, or neither.
 */
export async function reverseEntry(tx: Tx, businessId: string, id: string, by: string, date: string):
  Promise<{ readonly kind: 'reversed'; readonly id: string; readonly key: string } | EntryRefusal> {
  const original = await loadEntry(tx, businessId, id);
  if (!original || original.state !== 'posted') return { kind: 'refused', reason: 'not_posted', detail: null };
  if (original.reversedBy) return { kind: 'refused', reason: 'not_posted', detail: original.reversedBy };
  const fy = (await sql<{ id: string }>`select id::text as id from fiscal_years where business_id = ${businessId}::uuid
    and starts_on <= ${date}::date and ends_on >= ${date}::date`.execute(tx)).rows[0];
  if (!fy) return { kind: 'refused', reason: 'no_fiscal_year', detail: date };
  try {
    await sql`savepoint reverse_entry`.execute(tx);
    const made = (await sql<{ id: string }>`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, document_ref, document_date, created_by, reverses_id)
      select e.business_id, e.journal_id, ${fy.id}::uuid, ${date}::date, ${original.label}, ${original.key}, ${date}::date, ${by}, e.id
        from journal_entries e where e.id = ${id}::uuid returning id::text as id`.execute(tx)).rows[0]!.id;
    await sql`insert into journal_lines (business_id, entry_id, line_no, account_id, label, currency, debit, credit, party_id, tax_code_id, is_fx)
      select l.business_id, ${made}::uuid, l.line_no, l.account_id, l.label, l.currency, l.credit, l.debit, l.party_id, l.tax_code_id, false
        from journal_lines l where l.entry_id = ${id}::uuid order by l.line_no`.execute(tx);
    await sql`update journal_entries set state = 'posted', posted_by = ${by} where id = ${made}::uuid`.execute(tx);
    await sql`release savepoint reverse_entry`.execute(tx);
    return { kind: 'reversed', id: made, key: (await loadEntry(tx, businessId, made))!.key };
  } catch (e) {
    await sql`rollback to savepoint reverse_entry`.execute(tx);
    return refusalOf(e);
  }
}

/** What a draft form chooses from: the chart, the journals, the parties, the tax codes, and the books' currency. */
export async function entryChoices(tx: Tx, businessId: string) {
  const q = <T>(s: ReturnType<typeof sql<T>>) => s.execute(tx).then((r) => r.rows);
  return {
    accounts: await q(sql<{ id: string; code: string; name: string }>`select id::text as id, code, name from accounts where business_id = ${businessId}::uuid and is_active order by code`),
    journals: await q(sql<{ id: string; code: string; name: string }>`select id::text as id, code, name from journals where business_id = ${businessId}::uuid order by code`),
    parties: await q(sql<{ id: string; code: string; name: string }>`select id::text as id, code, name from parties where business_id = ${businessId}::uuid and is_active order by code`),
    taxCodes: await q(sql<{ id: string; code: string; label: string; from: string }>`select id::text as id, code, label, valid_from::text as "from" from tax_codes where business_id = ${businessId}::uuid order by code, valid_from`),
    bookCurrency: (await q(sql<{ c: string }>`select books_currency(${businessId}::uuid) as c`))[0]!.c,
    fields: (await fieldsOf(tx, businessId)).filter((f) => !f.retired),
  };
}
