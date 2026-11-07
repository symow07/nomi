import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { stepsFromRows, type Procedure, type ValidProcedure } from '../core/owner/procedures.js';

/**
 * PROCEDURES (Block 3 PR 2; 0229) — the owner's step-by-step for one situation, stored as the validator wrote it.
 * Live rows only reach the turn (`activeProcedures`); removing one archives it (the app role cannot delete), so a
 * conversation in the middle of it stops following it and its record still names it.
 */
/** The audit trail's line, as the assistants' writes leave theirs. */
const audit = (tx: Tx, businessId: BusinessId, action: 'procedure_added' | 'procedure_archived', actor: string, detail: unknown) =>
  sql`insert into channel_audit (business_id, channel_id, action, actor, detail)
      values (${businessId}::uuid, null, ${action}, ${actor}, ${JSON.stringify(detail)}::jsonb)`.execute(tx);

type Row = { id: string; title: string; steps: unknown; created_at: string; archived: boolean };
const toProcedure = (r: Row): Procedure => ({ id: r.id, title: r.title, steps: stepsFromRows(r.steps) });

export async function activeProcedures(tx: Tx, businessId: BusinessId): Promise<readonly Procedure[]> {
  const r = await sql<Row>`select id::text as id, title, steps, created_at::text as created_at, false as archived
    from procedures where business_id = ${businessId}::uuid and archived_at is null order by created_at`.execute(tx);
  return r.rows.map(toProcedure);
}

export type ProcedureRow = Procedure & { readonly createdAt: string };
export async function listProcedures(tx: Tx, businessId: BusinessId): Promise<readonly ProcedureRow[]> {
  const r = await sql<Row>`select id::text as id, title, steps, created_at::text as created_at, false as archived
    from procedures where business_id = ${businessId}::uuid and archived_at is null order by created_at`.execute(tx);
  return r.rows.map((x) => ({ ...toProcedure(x), createdAt: x.created_at }));
}

export async function addProcedure(tx: Tx, businessId: BusinessId, by: string, v: ValidProcedure): Promise<string> {
  const r = await sql<{ id: string }>`insert into procedures (business_id, title, steps, created_by)
    values (${businessId}::uuid, ${v.title}, ${JSON.stringify(v.steps)}::jsonb, ${by}) returning id::text as id`.execute(tx);
  const id = r.rows[0]!.id;
  await audit(tx, businessId, 'procedure_added', by, { id, title: v.title, steps: v.steps.length });
  return id;
}

export async function archiveProcedure(tx: Tx, businessId: BusinessId, by: string, id: string): Promise<boolean> {
  const r = await sql`update procedures set archived_at = now() where business_id = ${businessId}::uuid and id = ${id}::uuid and archived_at is null`.execute(tx);
  const done = Number(r.numAffectedRows ?? 0) > 0;
  if (done) await audit(tx, businessId, 'procedure_archived', by, { id });
  return done;
}
