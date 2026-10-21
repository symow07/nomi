import { sql } from 'kysely';
import type { Tx } from './client.js';
import { fieldShapeProblem, fieldValueProblem, type BooksField, type CustomValues } from '../core/books/interchange.js';

/**
 * D7 (Phase 5, item 9; 0170, 0192) — THE OWNER'S CUSTOM FIELDS: defined here, on an entry, a line or a party; a text,
 * an exact number, a day, or one of its choices (a category). A field is never deleted and never changes its key or
 * its kind (values were written to it, 0170): one no longer wanted is RETIRED — no form offers it and no new row takes
 * a value under it; the values it has stay, and travel with it — and it can be used again. Only a party's field can be
 * required (0192).
 */
export type FieldRow = BooksField & { readonly id: string; readonly inUse: boolean };

export async function listFields(tx: Tx, businessId: string): Promise<FieldRow[]> {
  return (await sql<{ id: string; applies_to: BooksField['appliesTo']; key: string; label: string; kind: BooksField['kind']; choices: string[] | null;
    required: boolean; is_active: boolean }>`
    select id::text as id, applies_to, key, label, kind, choices, required, is_active from custom_field_defs
     where business_id = ${businessId}::uuid order by is_active desc, applies_to, key`.execute(tx)).rows
    .map((f) => ({ id: f.id, appliesTo: f.applies_to, key: f.key, label: f.label, kind: f.kind, choices: f.choices, required: f.required, inUse: f.is_active }));
}

export type FieldRefusal = 'bad_field' | 'required_not_party' | 'taken';

export async function addField(tx: Tx, businessId: string, f: BooksField): Promise<{ readonly kind: 'added' } | { readonly kind: 'refused'; readonly reason: FieldRefusal }> {
  if (fieldShapeProblem(f)) return { kind: 'refused', reason: 'bad_field' };
  if (f.required && f.appliesTo !== 'party') return { kind: 'refused', reason: 'required_not_party' };
  const taken = (await sql<{ n: number }>`select count(*)::int as n from custom_field_defs
    where business_id = ${businessId}::uuid and applies_to = ${f.appliesTo} and key = ${f.key}`.execute(tx)).rows[0]!.n > 0;
  if (taken) return { kind: 'refused', reason: 'taken' };
  await sql`insert into custom_field_defs (business_id, applies_to, key, label, kind, choices, required)
    values (${businessId}::uuid, ${f.appliesTo}, ${f.key}, ${f.label.trim()}, ${f.kind}, ${f.choices === null ? null : [...f.choices]}::text[], ${f.required})`.execute(tx);
  return { kind: 'added' };
}

/** Retire a field, or use it again. True when there was such a field. */
export async function setFieldInUse(tx: Tx, businessId: string, id: string, inUse: boolean): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  return ((await sql`update custom_field_defs set is_active = ${inUse} where business_id = ${businessId}::uuid and id = ${id}::uuid`
    .execute(tx)).numAffectedRows ?? 0n) > 0n;
}

/**
 * A form's custom values for one kind of row (`<prefix><key>` in the form), checked as the database checks them:
 * each a value its field takes, every required one there. What is wrong is named by the field's label.
 */
export function customFromForm(fields: readonly BooksField[], applies: BooksField['appliesTo'], form: Readonly<Record<string, string>>, prefix: string):
  { readonly values: CustomValues; readonly wrong: readonly { readonly label: string; readonly why: 'bad_field_value' | 'required_field' }[] } {
  const values: Record<string, string> = {};
  const wrong: { label: string; why: 'bad_field_value' | 'required_field' }[] = [];
  for (const f of fields.filter((x) => x.appliesTo === applies)) {
    const v = (form[`${prefix}${f.key}`] ?? '').trim();
    if (v === '') { if (f.required) wrong.push({ label: f.label, why: 'required_field' }); continue; }
    if (fieldValueProblem(f, v)) { wrong.push({ label: f.label, why: 'bad_field_value' }); continue; }
    values[f.key] = v;
  }
  return { values, wrong };
}
