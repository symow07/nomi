import { sql } from 'kysely';
import type { Db, Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { lockNewCustomers } from './channels.js';
import {
  CONTACT_IMPORT_COLUMNS, type ContactImportColumns, type ContactImportConfirmResult, type ContactImportMapping,
  type ContactImportPreview,
} from '../core/onboard/setupMinutes.js';
import {
  candidatePhones, contactColumnsView, contactsPreview, guessColumns, readContacts,
  type ContactRecords, type ExistingCustomer,
} from '../core/onboard/contactImport.js';

/**
 * BLOCK 4.4 — CUSTOMERS FROM A FILE, KEPT WHILE THE OWNER CHECKS IT (0232). The rules are
 * src/core/onboard/contactImport.ts; this is where the file waits and where its customers are written.
 *
 * The file waits in `contact_imports` — never `catalog_imports` — and goes when the owner adds its customers or
 * discards it, after seven days (`expire_contact_imports`, an hourly job; a file older than that already reads as gone
 * here), and with the workspace. Every read names the workspace as well as RLS: an admin connection sees every row.
 *
 * ADDING writes, for each ticked row that is still nobody's number, a `clients` row (name, the number in the digits
 * WhatsApp sends from, notes, and the file's language as `stated_language`) and its WhatsApp address in
 * `client_channels` — exactly what ensureConversation
 * would have written had the customer written first, so their first WhatsApp message lands on this customer — and
 * NOTHING else: no consent, conversation, allowlist entry, activation or message. A customer already on record is
 * never changed. It runs in one transaction, under the lock ensureConversation takes before it makes a WhatsApp
 * customer (`lockNewCustomers`), and reads every number again under it: a customer who wrote while the owner was
 * checking is matched, not made twice.
 *
 * THE FILE'S LANGUAGE IS NEVER `preferred_language` (t1r's ruling, 2026-11-08). That column is the customer's own
 * reading, written by the analyser (G11), and the send path trusts it: surveys and invoice reminders prefer it to the
 * language of the customer's own messages (src/db/surveys.ts, src/outbound/invoiceReminders.ts: `coalesce(cl.
 * preferred_language, …detected_language…)`), the send gate reads it (src/db/channels.ts, `buyer_locale`), and a turn
 * with no analysis gives it to the gate language (src/pipeline/turn.ts, `analysedLanguage`). An owner's file must
 * release nothing, so it goes to `stated_language`, which nothing on the send path reads
 * (tests/parity/contact-import.test.ts holds that).
 */

export type KeptContactImport = {
  readonly id: string;
  readonly source: 'file' | 'paste';
  readonly records: ContactRecords;
  readonly hasHeader: boolean;
  readonly mapping: ContactImportMapping;
  /** The record numbers the owner ticked; null is every row that can be added. */
  readonly selected: readonly number[] | null;
  readonly createdAt: Date;
};

/** How long a kept file lasts (0232's `expire_contact_imports` removes it after the same). */
export const CONTACT_IMPORT_KEPT_DAYS = 7;

const recordsOf = (v: unknown): ContactRecords =>
  Array.isArray(v) ? v.map((r) => (Array.isArray(r) ? r.map((c) => (typeof c === 'string' ? c : '')) : [])) : [];

const mappingOf = (v: unknown): ContactImportMapping => {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const at = (k: string): number | null => (Number.isSafeInteger(o[k]) && (o[k] as number) >= 0 ? (o[k] as number) : null);
  return { name: at('name'), phone: at('phone'), language: at('language'), notes: at('notes') };
};

const mappingJson = (m: ContactImportMapping): string =>
  JSON.stringify(Object.fromEntries(CONTACT_IMPORT_COLUMNS.map((k) => [k, m[k]])));

/** A file read, kept with the columns pre-chosen from its header. Returns its id. */
export async function createContactImport(tx: Tx, businessId: BusinessId,
  input: { readonly source: 'file' | 'paste'; readonly records: ContactRecords; readonly createdBy: string }): Promise<string> {
  const guess = guessColumns(input.records);
  const r = await sql<{ id: string }>`
    insert into contact_imports (business_id, source, cells, has_header, mapping, created_by)
    values (${businessId}::uuid, ${input.source}, ${JSON.stringify(input.records)}::jsonb, ${guess.hasHeader},
            ${mappingJson(guess.mapping)}::jsonb, ${input.createdBy})
    returning id::text as id`.execute(tx);
  return r.rows[0]!.id;
}

/** The workspace's kept file, or null when it is not there (another workspace's, added, discarded or expired). */
export async function loadContactImport(tx: Tx, businessId: BusinessId, id: string,
  opts: { readonly forUpdate?: boolean } = {}): Promise<KeptContactImport | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const row = (await sql<{ id: string; source: 'file' | 'paste'; cells: unknown; has_header: boolean; mapping: unknown; selected: number[] | null; created_at: Date }>`
    select id::text as id, source, cells, has_header, mapping, selected, created_at
      from contact_imports
     where id = ${id}::uuid and business_id = ${businessId}::uuid
       and created_at > now() - make_interval(days => ${CONTACT_IMPORT_KEPT_DAYS})
     ${opts.forUpdate ? sql`for update` : sql``}`.execute(tx)).rows[0];
  if (!row) return null;
  return {
    id: row.id, source: row.source, records: recordsOf(row.cells), hasHeader: row.has_header,
    mapping: mappingOf(row.mapping), selected: row.selected, createdAt: row.created_at,
  };
}

/** The Columns step's view of a kept file. */
export async function contactImportColumns(tx: Tx, businessId: BusinessId, id: string): Promise<ContactImportColumns | null> {
  const imp = await loadContactImport(tx, businessId, id);
  return imp && contactColumnsView(imp.id, imp.records, imp.hasHeader, imp.mapping);
}

/** The owner's columns. A new mapping is a new set of rows, so the ticks start again (every row). */
export async function saveContactColumns(tx: Tx, businessId: BusinessId, id: string,
  input: { readonly hasHeader: boolean; readonly mapping: ContactImportMapping }): Promise<boolean> {
  const r = await sql`
    update contact_imports set has_header = ${input.hasHeader}, mapping = ${mappingJson(input.mapping)}::jsonb,
                               selected = null, updated_at = now()
     where id = ${id}::uuid and business_id = ${businessId}::uuid
       and created_at > now() - make_interval(days => ${CONTACT_IMPORT_KEPT_DAYS})`.execute(tx);
  return Number(r.numAffectedRows ?? 0) > 0;
}

/** The owner's ticks: the record numbers to add, or null for every row ("Tick all"); [] is "Untick all". */
export async function saveContactSelection(tx: Tx, businessId: BusinessId, id: string, selected: readonly number[] | null): Promise<boolean> {
  const r = await sql`
    update contact_imports set selected = ${selected === null ? null : [...selected]}::integer[], updated_at = now()
     where id = ${id}::uuid and business_id = ${businessId}::uuid
       and created_at > now() - make_interval(days => ${CONTACT_IMPORT_KEPT_DAYS})`.execute(tx);
  return Number(r.numAffectedRows ?? 0) > 0;
}

/**
 * Which of these numbers are a customer already, and who: by `clients.phone` read as digits (a leading 00 dropped, as
 * the import reads a number) and by the WhatsApp address in `client_channels`. Several customers for one number are
 * all returned — the file cannot say which it means.
 */
export async function contactMatches(tx: Tx, businessId: BusinessId, phones: readonly string[]): Promise<ReadonlyMap<string, readonly ExistingCustomer[]>> {
  const out = new Map<string, ExistingCustomer[]>();
  if (phones.length === 0) return out;
  const rows = (await sql<{ phone: string; id: string; name: string | null }>`
    with wanted as (select distinct unnest(${[...phones]}::text[]) as phone),
    known as (
      select cl.id, regexp_replace(regexp_replace(cl.phone, '\\D', '', 'g'), '^00', '') as phone
        from clients cl
       where cl.business_id = ${businessId}::uuid and cl.phone is not null
      union
      select cc.client_id, cc.channel_user_id
        from client_channels cc
       where cc.business_id = ${businessId}::uuid and cc.channel = 'whatsapp'
    )
    select distinct k.phone, cl.id::text as id, cl.display_name as name
      from known k
      join wanted w on w.phone = k.phone
      join clients cl on cl.id = k.id and cl.business_id = ${businessId}::uuid
     order by k.phone, id`.execute(tx)).rows;
  for (const r of rows) out.set(r.phone, [...(out.get(r.phone) ?? []), { id: r.id, name: r.name }]);
  return out;
}

/** The Check step: every row of a kept file, and what adding would make of it now. */
export async function previewContactImport(tx: Tx, businessId: BusinessId, id: string): Promise<ContactImportPreview | null> {
  const imp = await loadContactImport(tx, businessId, id);
  if (!imp || imp.mapping.phone === null) return null;
  const rows = readContacts(imp.records, imp.hasHeader, imp.mapping);
  return contactsPreview(imp.id, rows, await contactMatches(tx, businessId, candidatePhones(rows)), imp.selected);
}

/**
 * ADD: the ticked rows that are still nobody's number become customers; the kept file goes. Null when the file is not
 * there (added already, discarded, expired, another workspace's) or has no phone column. `'none_ticked'` when there are
 * rows to add and none of them is ticked: nothing is written and the file stays, so the owner can tick some (a file
 * whose every row is a customer already, or refused, is still added: its matches count). Counts only on the audit.
 */
export async function confirmContactImport(tx: Tx, businessId: BusinessId, id: string,
  input: { readonly selected: readonly number[]; readonly actor: string }): Promise<ContactImportConfirmResult | 'none_ticked' | null> {
  await lockNewCustomers(tx, businessId);
  const imp = await loadContactImport(tx, businessId, id, { forUpdate: true });
  if (!imp || imp.mapping.phone === null) return null;
  const rows = readContacts(imp.records, imp.hasHeader, imp.mapping);
  const preview = contactsPreview(imp.id, rows, await contactMatches(tx, businessId, candidatePhones(rows)), input.selected);
  const ticked = new Set(input.selected);
  const toAdd = preview.rows.flatMap((r) => (r.verdict.kind === 'to_add' && r.verdict.selected ? [r.verdict.contact] : []));
  if (toAdd.length === 0 && preview.counts.toAdd > 0) return 'none_ticked';
  if (toAdd.length > 0) {
    // Two statements, in this transaction: the customers, then their WhatsApp addresses. Not one statement with a
    // data-modifying CTE: 0155's trigger sets a client_channels row's business from its client's row, and a client
    // inserted by a sibling CTE of the same statement is not visible to it — the business came out NULL and row
    // security refused the address (found by the integration run, 2026-11-08). No `on conflict`: under the lock a
    // number taken meanwhile was matched above, and anything else is an error that leaves nothing written.
    const made = (await sql<{ id: string; phone: string }>`
      insert into clients (business_id, display_name, phone, stated_language, notes)
      select ${businessId}::uuid, i.name, i.phone, i.language, i.notes
        from unnest(${toAdd.map((c) => c.phone)}::text[], ${toAdd.map((c) => c.name)}::text[],
                    ${toAdd.map((c) => c.language)}::text[], ${toAdd.map((c) => c.notes)}::text[])
          as i(phone, name, language, notes)
      returning id::text as id, phone`.execute(tx)).rows;
    await sql`
      insert into client_channels (business_id, client_id, channel, channel_user_id)
      select ${businessId}::uuid, m.id, 'whatsapp', m.phone
        from unnest(${made.map((m) => m.id)}::uuid[], ${made.map((m) => m.phone)}::text[]) as m(id, phone)`.execute(tx);
  }
  const n = (k: string): number => preview.rows.filter((r) => r.verdict.kind === k).length;
  const result: ContactImportConfirmResult = {
    total: preview.counts.total,
    added: toAdd.length,
    existing: n('existing'),
    newlyMatched: preview.rows.filter((r) => r.verdict.kind === 'existing' && ticked.has(r.row)).length,
    notSelected: preview.rows.filter((r) => r.verdict.kind === 'to_add' && !r.verdict.selected).length,
    duplicateInFile: n('duplicate_in_file'),
    refused: n('refused'),
  };
  await sql`insert into channel_audit (business_id, channel_id, action, actor, detail)
    values (${businessId}::uuid, null, 'customers_imported', ${input.actor},
            ${JSON.stringify({ source: imp.source, ...result })}::jsonb)`.execute(tx);
  if (result.added + result.existing > 0) {
    await sql`update businesses set contacts_first_imported_at = now()
               where id = ${businessId}::uuid and contacts_first_imported_at is null`.execute(tx);
  }
  await sql`select contact_import_discard(${imp.id}::uuid)`.execute(tx);
  return result;
}

/** DISCARD: the kept file goes, nothing else. False when it was not there. */
export async function discardContactImport(tx: Tx, id: string): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return false;
  return (await sql<{ gone: boolean }>`select contact_import_discard(${id}::uuid) as gone`.execute(tx)).rows[0]?.gone === true;
}

/**
 * The hourly job: every kept file older than seven days, in every workspace, removed. Returns how many. The cut-off is
 * the database's own clock: the function takes no time, so no caller can reach a younger file.
 */
export async function expireContactImports(db: Db): Promise<number> {
  return Number((await sql<{ n: string }>`select expire_contact_imports() as n`.execute(db)).rows[0]?.n ?? 0);
}
