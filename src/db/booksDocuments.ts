import { sql } from 'kysely';
import type { Tx } from './client.js';
import { addDecimal, signOf, type Decimal } from '../core/types/decimal.js';
import type { CheckedReading, ReadingProblem } from '../core/books/reading.js';
import { draftEntry, type DraftLine, type EntryRefusal } from './booksEntries.js';

/**
 * D6 (Phase 5, item 7; 0191) — THE BOOKS' PAPERS, READ. A paper is A4's document (sealed, in its residency); a
 * reading is what the reader said is printed on it, kept as it came with what Nomi's check found wrong. From a
 * reading with no problem the owner drafts ONE entry, choosing every account and the supplier: a purchase — each line
 * debited to the account chosen for it, its tax to its tax code's account, the supplier credited the total. A draft,
 * never posted here.
 */
export type PaperRow = {
  readonly id: string; readonly name: string; readonly mediaType: string; readonly bytes: number; readonly addedOn: string;
  readonly entryId: string | null; readonly lastOutcome: string | null; readonly lastProblems: number; readonly draftedEntryId: string | null;
};

export async function listPapers(tx: Tx, businessId: string): Promise<PaperRow[]> {
  return (await sql<PaperRow>`
    select d.id::text as id, d.name, d.media_type as "mediaType", d.bytes, d.created_at::date::text as "addedOn", d.entry_id::text as "entryId",
           r.outcome as "lastOutcome", coalesce(jsonb_array_length(r.problems), 0) as "lastProblems",
           (select entry_id::text from document_readings x where x.document_id = d.id and x.entry_id is not null limit 1) as "draftedEntryId"
      from documents d
      left join lateral (select outcome, problems from document_readings x where x.document_id = d.id order by read_at desc limit 1) r on true
     where d.business_id = ${businessId}::uuid
     order by d.created_at desc limit 200`.execute(tx)).rows;
}

export type ReadingRow = {
  readonly id: string; readonly readAt: string; readonly outcome: 'read' | 'unreadable' | 'cut_off'; readonly modelId: string;
  readonly reading: CheckedReading | null; readonly problems: readonly ReadingProblem[]; readonly entryId: string | null;
};

export async function paperOf(tx: Tx, businessId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const d = (await sql<{ id: string; name: string; media_type: string; bytes: number; entry_id: string | null }>`
    select id::text as id, name, media_type, bytes, entry_id::text as entry_id from documents where business_id = ${businessId}::uuid and id = ${id}::uuid`
    .execute(tx)).rows[0];
  if (!d) return null;
  const readings = (await sql<{ id: string; read_at: string; outcome: ReadingRow['outcome']; model_id: string; reading: CheckedReading | null;
    problems: ReadingProblem[]; entry_id: string | null }>`
    select id::text as id, to_json(read_at) #>> '{}' as read_at, outcome, model_id, reading, problems, entry_id::text as entry_id
      from document_readings where business_id = ${businessId}::uuid and document_id = ${id}::uuid order by read_at desc`.execute(tx)).rows
    .map((r): ReadingRow => ({ id: r.id, readAt: r.read_at, outcome: r.outcome, modelId: r.model_id, reading: r.reading, problems: r.problems, entryId: r.entry_id }));
  return { id: d.id, name: d.name, mediaType: d.media_type, bytes: d.bytes, entryId: d.entry_id, readings };
}

export async function keepReading(tx: Tx, businessId: string, documentId: string, by: string, r: {
  readonly outcome: ReadingRow['outcome']; readonly reading: CheckedReading | null; readonly problems: readonly ReadingProblem[];
  readonly modelId: string; readonly promptVersion: string;
}): Promise<string> {
  return (await sql<{ id: string }>`insert into document_readings (business_id, document_id, read_by, model_id, prompt_version, outcome, reading, problems)
    values (${businessId}::uuid, ${documentId}::uuid, ${by}, ${r.modelId}, ${r.promptVersion}, ${r.outcome},
            ${r.reading === null ? null : JSON.stringify(r.reading)}::jsonb, ${JSON.stringify(r.problems)}::jsonb)
    returning id::text as id`.execute(tx)).rows[0]!.id;
}

export type PaperDraftChoice = {
  readonly journalId: string; readonly partyId: string; readonly payableAccountId: string;
  /** One per line of the reading, in its order: the account its net goes to, and its tax code (or none). */
  readonly lines: readonly { readonly accountId: string; readonly taxCodeId: string | null }[];
};

type PaperRefusal = EntryRefusal | { readonly kind: 'refused'; readonly reason: 'not_draftable' | 'already_drafted' | 'tax_account'; readonly detail: string | null };

export async function draftFromReading(tx: Tx, businessId: string, readingId: string, by: string, c: PaperDraftChoice):
  Promise<{ readonly kind: 'drafted'; readonly id: string } | PaperRefusal> {
  if (!/^[0-9a-f-]{36}$/i.test(readingId)) return { kind: 'refused', reason: 'not_draftable', detail: null };
  const r = (await sql<{ reading: CheckedReading | null; problems: ReadingProblem[]; outcome: string; entry_id: string | null }>`
    select reading, problems, outcome, entry_id::text as entry_id from document_readings where business_id = ${businessId}::uuid and id = ${readingId}::uuid for update`
    .execute(tx)).rows[0];
  if (!r || r.outcome !== 'read' || r.problems.length > 0 || !r.reading || !r.reading.date || !r.reading.currency || !r.reading.number) {
    return { kind: 'refused', reason: 'not_draftable', detail: null };
  }
  if (r.entry_id) return { kind: 'refused', reason: 'already_drafted', detail: null };
  const reading = r.reading;
  if (c.lines.length !== reading.lines.length) return { kind: 'refused', reason: 'not_draftable', detail: null };
  const draft: DraftLine[] = [];
  const taxBy = new Map<string, Decimal>();
  for (const [i, l] of reading.lines.entries()) {
    const ch = c.lines[i]!;
    if (signOf(l.net) > 0) draft.push({ accountId: ch.accountId, partyId: null, taxCodeId: ch.taxCodeId, currency: reading.currency!, debit: l.net, credit: null, label: l.label.slice(0, 200), isFx: false });
    if (signOf(l.tax) > 0) {
      const account = ch.taxCodeId === null ? null : (await sql<{ a: string | null }>`select account_id::text as a from tax_codes
        where business_id = ${businessId}::uuid and id = ${ch.taxCodeId}::uuid`.execute(tx)).rows[0]?.a ?? null;
      if (!account) return { kind: 'refused', reason: 'tax_account', detail: String(i + 1) };
      taxBy.set(account, addDecimal(taxBy.get(account) ?? ('0' as Decimal), l.tax));
    }
  }
  for (const [account, tax] of taxBy) draft.push({ accountId: account, partyId: null, taxCodeId: null, currency: reading.currency!, debit: tax, credit: null, label: null, isFx: false });
  draft.push({ accountId: c.payableAccountId, partyId: c.partyId, taxCodeId: null, currency: reading.currency!, debit: null, credit: reading.total!, label: null, isFx: false });
  const made = await draftEntry(tx, businessId, by, { journalId: c.journalId, date: reading.date!,
    label: `${reading.supplierName ?? ''} ${reading.number}`.trim().slice(0, 200), documentRef: reading.number!.slice(0, 120), documentDate: reading.date!, lines: draft });
  if (made.kind === 'refused') return made;
  await sql`update document_readings set entry_id = ${made.id}::uuid, drafted_at = now(), drafted_by = ${by} where id = ${readingId}::uuid`.execute(tx);
  return made;
}
