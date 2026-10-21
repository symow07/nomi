import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { withTenantTx, type Db, type Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { parseDecimal, type Decimal } from '../core/types/decimal.js';
import {
  booksProblems, canonical, changedRecords, recordsOf, taxCodeKey,
  type BooksData, type BooksEntry, type BooksProblem, type BooksProblemReason, type BooksRecord, type RecordKind,
} from '../core/books/interchange.js';
import type { BooksSystem } from '../core/books/connector.js';

/**
 * B2 / B5 (Phase 5; items 12 and 13, part 1) — THE BOOKS IN AND OUT OF NOMI'S LEDGER, in the one shape every connector
 * speaks (src/core/books/interchange.ts).
 *
 * OUT (`readBooks`): the chart, journals, parties, tax codes, and every entry not discarded — a posted one under the
 * name Nomi gave it (journal, year, number: "VE-2026-12"), a draft as "draft-<id>".
 *
 * IN (`applyBooks`): what a source said, read in as ONE change or not at all.
 *   · A record Nomi holds the same: nothing. One it does not hold: added — an entry as a DRAFT, whatever the source
 *     calls it, for the owner to post (the database refuses anyone else's posting, A5).
 *   · The same record read again from the same source (its digest in `connector_records`, 0178): nothing, even if
 *     Nomi has moved on since (the owner posted the draft, renamed the account) — Nomi is the record, and an unchanged
 *     source says nothing new.
 *   · A record the source CHANGED: a draft it made is replaced (the old one discarded, never deleted); anything else
 *     that differs from Nomi is a problem, named by its row — a posted entry changes only by a reversal, and the chart
 *     is changed in Nomi, never overwritten from outside (C4 shows such conflicts; here they stop the read-in).
 *   · Any problem, anywhere: nothing is read in. The caller's transaction is rolled back.
 */

const digest = (content: string): string => createHash('sha256').update(content).digest('hex');
/** An entry's text without its State: the source's word for it is not a difference (Nomi says what it is). */
const withoutState = (content: string): string => canonical({ ...(JSON.parse(content) as Record<string, unknown>), state: null });

/** Thrown to roll the read-in back: a problem found after something was written. */
class ReadInRefused extends Error {
  constructor(readonly problems: readonly BooksProblem[], readonly undatedTaxes?: readonly { code: string; label: string }[]) { super('books: read-in refused'); }
}
const dec = (v: string | null): Decimal | null => (v === null ? null : parseDecimal(v));
/** A line's side: the ledger keeps the empty side as 0 (0169: one side each); the books' shape leaves it empty. */
const side = (v: string): Decimal | null => { const d = parseDecimal(v); return d === null || d === '0' ? null : d; };
const DRAFT_KEY = /^draft-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** The books Nomi holds, as every connector receives them. */
export async function readBooks(tx: Tx, businessId: string): Promise<BooksData> {
  const accounts = (await sql<{ code: string; name: string; kind: BooksData['accounts'][number]['kind']; parent: string | null }>`
    select a.code, a.name, a.kind, p.code as parent from accounts a left join accounts p on p.id = a.parent_id
     where a.business_id = ${businessId}::uuid order by a.code`.execute(tx)).rows;
  const journals = (await sql<BooksData['journals'][number]>`
    select code, name, kind from journals where business_id = ${businessId}::uuid order by code`.execute(tx)).rows;
  const parties = (await sql<{ code: string; name: string; kind: BooksData['parties'][number]['kind']; country: string | null; ice: string | null; tax_number: string | null }>`
    select code, name, kind, country, ice, tax_number from parties where business_id = ${businessId}::uuid order by code`.execute(tx)).rows;
  const taxCodes = (await sql<{ code: string; label: string; rate: string; kind: BooksData['taxCodes'][number]['kind']; account: string | null; valid_from: string; valid_to: string | null }>`
    select t.code, t.label, t.rate::text as rate, t.kind, a.code as account, t.valid_from::text as valid_from, t.valid_to::text as valid_to
      from tax_codes t left join accounts a on a.id = t.account_id
     where t.business_id = ${businessId}::uuid order by t.code, t.valid_from`.execute(tx)).rows;
  const heads = (await sql<{ id: string; key: string; journal: string; date: string; label: string; document_ref: string | null; document_date: string | null; state: 'draft' | 'posted' }>`
    select e.id::text as id,
           case when e.state = 'posted' then j.code || '-' || extract(year from f.starts_on)::int || '-' || e.number else 'draft-' || e.id end as key,
           j.code as journal, e.entry_date::text as date, e.label, e.document_ref, e.document_date::text as document_date, e.state
      from journal_entries e join journals j on j.id = e.journal_id join fiscal_years f on f.id = e.fiscal_year_id
     where e.business_id = ${businessId}::uuid and e.state <> 'discarded'
     order by e.entry_date, e.number nulls last, e.created_at, e.id`.execute(tx)).rows;
  const lines = (await sql<{ entry_id: string; account: string; party: string | null; tax_code: string | null; currency: string; debit: string; credit: string; label: string | null }>`
    select l.entry_id::text as entry_id, a.code as account, p.code as party, t.code as tax_code, l.currency,
           l.debit::text as debit, l.credit::text as credit, l.label
      from journal_lines l join accounts a on a.id = l.account_id
      left join parties p on p.id = l.party_id left join tax_codes t on t.id = l.tax_code_id
     where l.business_id = ${businessId}::uuid
     order by l.entry_id, l.line_no`.execute(tx)).rows;
  const byEntry = new Map<string, typeof lines>();
  for (const l of lines) byEntry.set(l.entry_id, [...(byEntry.get(l.entry_id) ?? []), l]);
  return {
    accounts,
    journals,
    parties: parties.map((p) => ({ code: p.code, name: p.name, kind: p.kind, country: p.country, ice: p.ice, taxNumber: p.tax_number })),
    taxCodes: taxCodes.map((t) => ({ code: t.code, label: t.label, rate: dec(t.rate)!, kind: t.kind, account: t.account, validFrom: t.valid_from, validTo: t.valid_to })),
    entries: heads.map((h): BooksEntry => ({
      key: h.key, journal: h.journal, date: h.date, label: h.label, documentRef: h.document_ref, documentDate: h.document_date, state: h.state,
      lines: (byEntry.get(h.id) ?? []).map((l) => ({
        account: l.account, party: l.party, taxCode: l.tax_code, currency: l.currency, debit: side(l.debit), credit: side(l.credit), label: l.label,
      })),
    })),
  };
}

export type ApplyOutcome =
  | { readonly kind: 'applied'; readonly added: number; readonly replaced: number; readonly unchanged: number }
  | { readonly kind: 'refused'; readonly problems: readonly BooksProblem[];
      /** C0 — the taxes its source gave no start date, when an entry before Nomi's day for them stopped the read: the owner's to date. */
      readonly undatedTaxes?: readonly { readonly code: string; readonly label: string }[] };

/**
 * Read `data` in from `system`, as one change or none: its own tenant transaction, rolled back on any problem — found
 * before writing, or after (a tax code not in force on an entry's day). `where` says where a record came from in the
 * source, for the problems.
 */
export async function readInBooks(
  db: Db, businessId: BusinessId, by: string, system: BooksSystem, data: BooksData,
  where: (kind: RecordKind, key: string, line?: number) => { readonly sheet: string; readonly row: number },
): Promise<ApplyOutcome> {
  try {
    return await withTenantTx(db, businessId, async (tx) => {
      const out = await applyBooks(tx, businessId, by, system, data, where);
      if (out.kind === 'refused') throw new ReadInRefused(out.problems, out.undatedTaxes);
      return out;
    });
  } catch (e) {
    if (e instanceof ReadInRefused) return { kind: 'refused', problems: e.problems, ...(e.undatedTaxes ? { undatedTaxes: e.undatedTaxes } : {}) };
    throw e;
  }
}

async function applyBooks(
  tx: Tx, businessId: string, by: string, system: BooksSystem, data: BooksData,
  where: (kind: RecordKind, key: string, line?: number) => { readonly sheet: string; readonly row: number },
): Promise<ApplyOutcome> {
  const problems: BooksProblem[] = [];
  const at = (kind: RecordKind, key: string, column: string, reason: BooksProblemReason, line?: number) =>
    problems.push({ ...where(kind, key, line), column, reason });
  const nomi = await readBooks(tx, businessId);
  const held = new Map(recordsOf(nomi).map((r) => [`${r.kind}:${r.key}`, r.content]));
  const last = new Map((await sql<{ kind: RecordKind; key: string; digest: string; nomi_id: string | null }>`
    select kind, key, digest, nomi_id::text as nomi_id from connector_records
     where business_id = ${businessId}::uuid and system = ${system}`.execute(tx)).rows.map((r) => [`${r.kind}:${r.key}`, r]));
  const bookCurrency = (await sql<{ c: string }>`select books_currency(${businessId}::uuid) as c`.execute(tx)).rows[0]!.c;

  // References: what the books name must exist, here or in Nomi.
  problems.push(...booksProblems(data, {
    accounts: new Set(nomi.accounts.map((a) => a.code)), journals: new Set(nomi.journals.map((j) => j.code)),
    parties: new Set(nomi.parties.map((p) => p.code)), taxCodes: new Set(nomi.taxCodes.map((t) => t.code)), bookCurrency,
  }, where));

  // Each record: the same, new, read before and unchanged at its source, or changed.
  type Plan = { record: BooksRecord; action: 'add' | 'replace' | 'note'; draftOf?: string | null };
  const plan: Plan[] = [];
  let unchanged = 0;
  const entryState = async (id: string) => (await sql<{ state: string }>`
    select state from journal_entries where id = ${id}::uuid and business_id = ${businessId}::uuid`.execute(tx)).rows[0]?.state ?? null;
  // What the source says that it did not say the last time it was read (B5: the same change read twice is recorded once).
  const fresh = new Set(changedRecords(recordsOf(data), new Map([...last].map(([k, v]) => [k, v.digest])), digest).map((r) => `${r.kind}:${r.key}`));
  for (const r of recordsOf(data)) {
    const k = `${r.kind}:${r.key}`;
    const seen = last.get(k);
    if (!fresh.has(k)) { unchanged++; continue; }   // the source says nothing new
    if (r.kind === 'tax_code' && r.key.endsWith('@unknown')) {
      // A tax its source gives no start date (Odoo): Nomi's tax of that code, whatever day Nomi took it from — or new,
      // in force from today. Compared without the day, which the source never said.
      const code = r.key.slice(0, -'@unknown'.length);
      const mine = nomi.taxCodes.filter((t) => t.code === code).sort((a, b) => (a.validFrom ?? '').localeCompare(b.validFrom ?? '')).pop();
      const undated = (c: string) => canonical({ ...(JSON.parse(c) as Record<string, unknown>), validFrom: null });
      if (!mine) plan.push({ record: r, action: 'add' });
      else if (undated(canonical(mine)) === undated(r.content)) { unchanged++; plan.push({ record: r, action: 'note' }); }
      else at(r.kind, r.key, 'Code', 'differs_from_nomi');
      continue;
    }
    if (r.kind !== 'entry') {
      const mine = held.get(k);
      if (mine === undefined) plan.push({ record: r, action: 'add' });
      else if (mine === r.content) { unchanged++; plan.push({ record: r, action: 'note' }); }
      else at(r.kind, r.key, 'Code', 'differs_from_nomi');
      continue;
    }
    // An entry: Nomi's own name for it, a draft this source made, or new.
    const own = held.get(k);
    if (own !== undefined) {
      if (withoutState(own) === withoutState(r.content)) { unchanged++; continue; }
      const draft = DRAFT_KEY.exec(r.key)?.[1];
      if (draft) plan.push({ record: r, action: 'replace', draftOf: draft });
      else at('entry', r.key, 'Entry', 'posted_differs');
      continue;
    }
    if (seen?.nomi_id) {
      const state = await entryState(seen.nomi_id);
      if (state === 'posted') { at('entry', r.key, 'Entry', 'posted_differs'); continue; }
      plan.push({ record: r, action: state === 'draft' ? 'replace' : 'add', draftOf: state === 'draft' ? seen.nomi_id : null });
      continue;
    }
    plan.push({ record: r, action: 'add' });
  }

  // Each entry to write needs an open year and a day the lock date has not closed.
  const entries = new Map(data.entries.map((e) => [e.key, e]));
  const years = (await sql<{ id: string; starts_on: string; ends_on: string; state: string }>`
    select id::text as id, starts_on::text as starts_on, ends_on::text as ends_on, state from fiscal_years where business_id = ${businessId}::uuid`.execute(tx)).rows;
  const lock = (await sql<{ d: string | null }>`select lock_date::text as d from books_settings where business_id = ${businessId}::uuid`.execute(tx)).rows[0]?.d ?? null;
  const yearOf = new Map<string, string>();
  // A tax whose start its source never gave counts from the day it was first read (today, if it is new now): an entry
  // before that day cannot use it — said for what it is, not as an unknown tax.
  const today = (await sql<{ d: string }>`select current_date::text as d`.execute(tx)).rows[0]!.d;
  // C0 (0181) — the day the owner confirmed, where they did; else the day Nomi first read it; else today.
  const confirmed = new Map((await sql<{ code: string; d: string }>`select code, valid_from::text as d from tax_start_dates
    where business_id = ${businessId}::uuid and system = ${system}`.execute(tx)).rows.map((r) => [r.code, r.d]));
  const undatedFrom = new Map<string, string>();
  for (const t of data.taxCodes) {
    if (t.validFrom !== null) continue;
    const kept = nomi.taxCodes.filter((x) => x.code === t.code).map((x) => x.validFrom ?? today).sort()[0];
    undatedFrom.set(t.code, confirmed.get(t.code) ?? kept ?? today);
  }
  for (const p of plan.filter((x) => x.record.kind === 'entry' && x.action !== 'note')) {
    const e = entries.get(p.record.key)!;
    e.lines.forEach((l, i) => {
      const from = l.taxCode === null ? undefined : undatedFrom.get(l.taxCode);
      if (from !== undefined && e.date < from) at('entry', e.key, 'Tax code', 'tax_before_known', i);
    });
    const y = years.find((f) => f.starts_on <= e.date && e.date <= f.ends_on);
    if (!y) { at('entry', e.key, 'Date', 'no_fiscal_year'); continue; }
    if (y.state !== 'open' || (lock !== null && e.date <= lock)) { at('entry', e.key, 'Date', 'period_closed'); continue; }
    yearOf.set(e.key, y.id);
  }
  if (problems.length > 0) {
    const asked = problems.some((p) => p.reason === 'tax_before_known');
    return { kind: 'refused', problems, ...(asked ? { undatedTaxes: data.taxCodes.filter((t) => t.validFrom === null).map((t) => ({ code: t.code, label: t.label })) } : {}) };
  }

  // Write: the chart and the rest first (parents before children), then the entries.
  const ids = { account: new Map<string, string>(), journal: new Map<string, string>(), party: new Map<string, string>() };
  const loadIds = async () => {
    for (const r of (await sql<{ code: string; id: string }>`select code, id::text as id from accounts where business_id = ${businessId}::uuid`.execute(tx)).rows) ids.account.set(r.code, r.id);
    for (const r of (await sql<{ code: string; id: string }>`select code, id::text as id from journals where business_id = ${businessId}::uuid`.execute(tx)).rows) ids.journal.set(r.code, r.id);
    for (const r of (await sql<{ code: string; id: string }>`select code, id::text as id from parties where business_id = ${businessId}::uuid`.execute(tx)).rows) ids.party.set(r.code, r.id);
  };
  await loadIds();
  let added = 0;
  let replaced = 0;
  const adds = (kind: RecordKind) => plan.filter((p) => p.record.kind === kind && p.action === 'add').map((p) => p.record.key);
  let pending = data.accounts.filter((a) => adds('account').includes(a.code));
  while (pending.length > 0) {
    const ready = pending.filter((a) => a.parent === null || ids.account.has(a.parent));
    if (ready.length === 0) { for (const a of pending) at('account', a.code, 'Parent', 'unknown_account'); return { kind: 'refused', problems }; }
    for (const a of ready) {
      const id = (await sql<{ id: string }>`insert into accounts (business_id, code, name, kind, parent_id)
        values (${businessId}::uuid, ${a.code}, ${a.name}, ${a.kind}, ${a.parent === null ? null : ids.account.get(a.parent)!}::uuid) returning id::text as id`.execute(tx)).rows[0]!.id;
      ids.account.set(a.code, id);
      added++;
    }
    pending = pending.filter((a) => !ready.includes(a));
  }
  for (const j of data.journals.filter((x) => adds('journal').includes(x.code))) {
    ids.journal.set(j.code, (await sql<{ id: string }>`insert into journals (business_id, code, name, kind)
      values (${businessId}::uuid, ${j.code}, ${j.name}, ${j.kind}) returning id::text as id`.execute(tx)).rows[0]!.id);
    added++;
  }
  for (const p of data.parties.filter((x) => adds('party').includes(x.code))) {
    ids.party.set(p.code, (await sql<{ id: string }>`insert into parties (business_id, code, name, kind, country, ice, tax_number)
      values (${businessId}::uuid, ${p.code}, ${p.name}, ${p.kind}, ${p.country}, ${p.ice}, ${p.taxNumber}) returning id::text as id`.execute(tx)).rows[0]!.id);
    added++;
  }
  for (const t of data.taxCodes.filter((x) => adds('tax_code').includes(taxCodeKey(x)))) {
    await sql`insert into tax_codes (business_id, code, label, rate, kind, account_id, valid_from, valid_to)
      values (${businessId}::uuid, ${t.code}, ${t.label}, ${t.rate}::numeric, ${t.kind}, ${t.account === null ? null : ids.account.get(t.account)!}::uuid,
              coalesce(${t.validFrom}::date, ${confirmed.get(t.code) ?? null}::date, current_date), ${t.validTo}::date)`.execute(tx);
    added++;
  }
  const madeEntries = new Map<string, string>();
  for (const p of plan.filter((x) => x.record.kind === 'entry' && x.action !== 'note')) {
    const e = entries.get(p.record.key)!;
    if (p.action === 'replace' && p.draftOf) {
      await sql`update journal_entries set state = 'discarded' where id = ${p.draftOf}::uuid and business_id = ${businessId}::uuid and state = 'draft'`.execute(tx);
    }
    const id = (await sql<{ id: string }>`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, document_ref, document_date, created_by)
      values (${businessId}::uuid, ${ids.journal.get(e.journal)!}::uuid, ${yearOf.get(e.key)!}::uuid, ${e.date}::date, ${e.label},
              ${e.documentRef}, ${e.documentDate}::date, ${by}) returning id::text as id`.execute(tx)).rows[0]!.id;
    let n = 0;
    for (const l of e.lines) {
      const tax = l.taxCode === null ? null : (await sql<{ id: string }>`select id::text as id from tax_codes
        where business_id = ${businessId}::uuid and code = ${l.taxCode} and valid_from <= ${e.date}::date and (valid_to is null or valid_to > ${e.date}::date)
        order by valid_from desc limit 1`.execute(tx)).rows[0]?.id;
      if (l.taxCode !== null && !tax) { at('entry', e.key, 'Tax code', 'unknown_tax_code', n); return { kind: 'refused', problems }; }
      await sql`insert into journal_lines (business_id, entry_id, line_no, account_id, label, currency, debit, credit, party_id, tax_code_id)
        values (${businessId}::uuid, ${id}::uuid, ${++n}, ${ids.account.get(l.account)!}::uuid, ${l.label}, ${l.currency},
                ${l.debit ?? '0'}::numeric, ${l.credit ?? '0'}::numeric, ${l.party === null ? null : ids.party.get(l.party)!}::uuid, ${tax ?? null}::uuid)`.execute(tx);
    }
    madeEntries.set(e.key, id);
    if (p.action === 'replace') replaced++; else added++;
  }
  // What the source said, remembered: the next read of the same thing changes nothing.
  for (const p of plan) {
    const nomiId = p.record.kind === 'entry' ? (madeEntries.get(p.record.key) ?? null) : null;
    await sql`insert into connector_records (business_id, system, kind, key, digest, nomi_id)
      values (${businessId}::uuid, ${system}, ${p.record.kind}, ${p.record.key}, ${digest(p.record.content)}, ${nomiId}::uuid)
      on conflict (business_id, system, kind, key) do update set digest = excluded.digest, nomi_id = coalesce(excluded.nomi_id, connector_records.nomi_id), read_at = now()`.execute(tx);
  }
  return { kind: 'applied', added, replaced, unchanged };
}
