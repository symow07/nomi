import { sql } from 'kysely';
import type { Db, Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';

/**
 * What the scheduled backup left behind (migration 0069). Not tenant data —
 * the installation has one backup and every workspace is in it — so this is
 * read on the plain connection, not inside a tenant transaction.
 */
export type BackupRun = {
  readonly name: string;
  readonly takenAt: Date;
  readonly uploadedAt: Date;
  readonly dumpBytes: number;
  readonly schemaVersion: number;
};

/** The newest backup that restored cleanly in its drill, else null: none ever has. */
export async function latestBackupRun(db: Db): Promise<BackupRun | null> {
  const r = (await sql<{ name: string; taken_at: Date; uploaded_at: Date; dump_bytes: string; schema_version: number }>`
    select name, taken_at, uploaded_at, dump_bytes::text as dump_bytes, schema_version
      from backup_runs where drill_passed
     order by uploaded_at desc limit 1`.execute(db)).rows[0];
  return r ? { name: r.name, takenAt: r.taken_at, uploadedAt: r.uploaded_at, dumpBytes: Number(r.dump_bytes), schemaVersion: r.schema_version } : null;
}

/**
 * Where an installation alert reaches the owner when no channel is live: the
 * e-mail the owner signs in with (A1). Null before there is a login — a
 * workspace provisioned by the operator tool, or the demo.
 */
export async function ownerLoginEmail(tx: Tx, businessId: BusinessId): Promise<string | null> {
  const r = (await sql<{ email: string }>`
    select l.email from logins l
      join people p on p.id = l.person_id and p.is_owner and p.archived_at is null
     where l.business_id = ${businessId}::uuid and l.archived_at is null
     order by l.created_at limit 1`.execute(tx)).rows[0];
  return r?.email ?? null;
}

/** Is a channel activated for this workspace — the fact that makes a WhatsApp alert deliverable? */
export async function channelIsLive(tx: Tx, businessId: BusinessId): Promise<boolean> {
  const r = (await sql<{ live: boolean }>`
    select exists(select 1 from channels where business_id = ${businessId}::uuid and activated_at is not null) as live`
    .execute(tx)).rows[0];
  return r?.live === true;
}
