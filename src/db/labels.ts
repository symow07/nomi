import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { labelNameOf } from '../core/owner/labels.js';

/**
 * S2 (Phase 5, item 19; 0196) — labels, and the labels on a buyer. A label put on a buyer by its name: the label in
 * use of that name, or a new one. Taken off, the row says so and stays (G20); a label archived stops being offered
 * and filtering, and its rows stay. A buyer's labels are erased with the buyer (the erasure contract).
 */
export type Label = { readonly id: string; readonly name: string; readonly archived: boolean; readonly buyers: number };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isLabelId = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/** The workspace's labels — in use first, by name — with how many buyers carry each now. */
export async function listLabels(tx: Tx, businessId: BusinessId, o: { readonly archived?: boolean } = {}): Promise<Label[]> {
  return (await sql<{ id: string; name: string; archived: boolean; buyers: number }>`
    select l.id::text as id, l.name, l.archived_at is not null as archived,
           (select count(*)::int from buyer_labels b where b.label_id = l.id and b.removed_at is null) as buyers
      from labels l where l.business_id = ${businessId}::uuid and (${o.archived ?? false} or l.archived_at is null)
     order by l.archived_at is not null, lower(l.name)`.execute(tx)).rows;
}

/** A buyer's labels in use, by name. */
export async function labelsOf(tx: Tx, businessId: BusinessId, clientId: string): Promise<{ readonly id: string; readonly name: string }[]> {
  if (!UUID.test(clientId)) return [];
  return (await sql<{ id: string; name: string }>`
    select l.id::text as id, l.name from buyer_labels b join labels l on l.id = b.label_id
     where b.business_id = ${businessId}::uuid and b.client_id = ${clientId}::uuid and b.removed_at is null and l.archived_at is null
     order by lower(l.name)`.execute(tx)).rows;
}

export type LabelRefusal = 'name' | 'not_found' | 'taken';

/** Put a label on a buyer by its name (a new label when none in use has it). Already on: nothing changes. */
export async function putLabel(tx: Tx, businessId: BusinessId, clientId: string, rawName: unknown, by: string):
  Promise<{ readonly kind: 'put' | 'already'; readonly name: string } | { readonly kind: 'refused'; readonly reason: LabelRefusal }> {
  const name = labelNameOf(rawName);
  if (!name) return { kind: 'refused', reason: 'name' };
  if (!UUID.test(clientId)) return { kind: 'refused', reason: 'not_found' };
  const buyer = (await sql<{ n: number }>`select count(*)::int as n from clients where business_id = ${businessId}::uuid and id = ${clientId}::uuid`.execute(tx)).rows[0]!.n;
  if (buyer === 0) return { kind: 'refused', reason: 'not_found' };
  const found = (await sql<{ id: string; name: string }>`select id::text as id, name from labels where business_id = ${businessId}::uuid
    and archived_at is null and lower(btrim(name)) = lower(${name})`.execute(tx)).rows[0];
  const label = found ?? (await sql<{ id: string; name: string }>`insert into labels (business_id, name, created_by)
    values (${businessId}::uuid, ${name}, ${by}) returning id::text as id, name`.execute(tx)).rows[0]!;
  const on = (await sql<{ n: number }>`select count(*)::int as n from buyer_labels where client_id = ${clientId}::uuid
    and label_id = ${label.id}::uuid and removed_at is null`.execute(tx)).rows[0]!.n > 0;
  if (on) return { kind: 'already', name: label.name };
  await sql`insert into buyer_labels (business_id, client_id, label_id, added_by) values (${businessId}::uuid, ${clientId}::uuid, ${label.id}::uuid, ${by})`.execute(tx);
  return { kind: 'put', name: label.name };
}

/** Take a label off a buyer (the row stays, marked). True when it was on. */
export async function takeOffLabel(tx: Tx, businessId: BusinessId, clientId: string, labelId: string, by: string): Promise<boolean> {
  if (!UUID.test(clientId) || !UUID.test(labelId)) return false;
  return ((await sql`update buyer_labels set removed_at = now(), removed_by = ${by}
    where business_id = ${businessId}::uuid and client_id = ${clientId}::uuid and label_id = ${labelId}::uuid and removed_at is null`
    .execute(tx)).numAffectedRows ?? 0n) > 0n;
}

/** A label's new name; one another label in use has is `taken`. */
export async function renameLabel(tx: Tx, businessId: BusinessId, labelId: string, rawName: unknown):
  Promise<{ readonly kind: 'renamed' } | { readonly kind: 'refused'; readonly reason: LabelRefusal }> {
  const name = labelNameOf(rawName);
  if (!name) return { kind: 'refused', reason: 'name' };
  if (!UUID.test(labelId)) return { kind: 'refused', reason: 'not_found' };
  if (await nameTaken(tx, businessId, name, labelId)) return { kind: 'refused', reason: 'taken' };
  const n = (await sql`update labels set name = ${name} where business_id = ${businessId}::uuid and id = ${labelId}::uuid`.execute(tx)).numAffectedRows ?? 0n;
  return n > 0n ? { kind: 'renamed' } : { kind: 'refused', reason: 'not_found' };
}

/** Archived, or in use again (only while no other label in use has its name). True when it changed. */
export async function setLabelArchived(tx: Tx, businessId: BusinessId, labelId: string, by: string, archived: boolean): Promise<boolean> {
  if (!UUID.test(labelId)) return false;
  if (!archived) {
    const row = (await sql<{ name: string }>`select name from labels where business_id = ${businessId}::uuid and id = ${labelId}::uuid`.execute(tx)).rows[0];
    if (!row || await nameTaken(tx, businessId, row.name, labelId)) return false;
  }
  return ((await sql`update labels set archived_at = ${archived ? sql`now()` : null}, archived_by = ${archived ? by : null}
    where business_id = ${businessId}::uuid and id = ${labelId}::uuid and (archived_at is null) = ${archived}`.execute(tx)).numAffectedRows ?? 0n) > 0n;
}

async function nameTaken(tx: Tx, businessId: BusinessId, name: string, except: string): Promise<boolean> {
  return (await sql<{ n: number }>`select count(*)::int as n from labels where business_id = ${businessId}::uuid and archived_at is null
    and lower(btrim(name)) = lower(btrim(${name})) and id <> ${except}::uuid`.execute(tx)).rows[0]!.n > 0;
}
