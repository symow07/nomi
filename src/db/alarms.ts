import { sql } from 'kysely';
import type { Db, Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';

/**
 * 0217 — an alarm that reaches somebody. A store: it decides nothing.
 *
 *   · backup_failures — written by the scheduled job when a run fails (backup/run.sh), read here;
 *   · mail_accounts.attention_alerted_at — a dead mailbox told to its owner once;
 *   · undelivered_alerts — an operator alert or account letter that reached nobody, until it does.
 */

export type BackupFailure = { readonly name: string; readonly failedAt: Date; readonly step: string; readonly reason: string };

/** The newest completed run (drill passed) and the newest failed one. */
export async function backupTimes(db: Db): Promise<{ readonly lastRunAt: Date | null; readonly lastFailure: BackupFailure | null }> {
  const run = (await sql<{ uploaded_at: Date }>`
    select uploaded_at from backup_runs where drill_passed order by uploaded_at desc limit 1`.execute(db)).rows[0];
  const failed = (await sql<{ name: string; failed_at: Date; step: string; reason: string }>`
    select name, failed_at, step, reason from backup_failures order by failed_at desc limit 1`.execute(db)).rows[0];
  return {
    lastRunAt: run?.uploaded_at ?? null,
    lastFailure: failed ? { name: failed.name, failedAt: failed.failed_at, step: failed.step, reason: failed.reason } : null,
  };
}

/** The failed runs nobody has been told of, claimed: each is answered once. */
export async function claimBackupFailures(db: Db): Promise<BackupFailure[]> {
  const rows = (await sql<{ name: string; failed_at: Date; step: string; reason: string }>`
    select name, failed_at, step, reason from claim_backup_failures()`.execute(db)).rows;
  return rows.map((r) => ({ name: r.name, failedAt: r.failed_at, step: r.step, reason: r.reason }));
}

export type DeadMailbox = { readonly businessId: string; readonly address: string; readonly reason: string; readonly since: Date };

/** Every workspace's mailbox whose grant died and whose owner has not been told, claimed: each is told once. */
export async function claimMailboxAttention(db: Db): Promise<DeadMailbox[]> {
  const rows = (await sql<{ business_id: string; address: string; reason: string; since: Date }>`
    select business_id::text as business_id, address, reason, since from claim_mailbox_attention()`.execute(db)).rows;
  return rows.map((r) => ({ businessId: r.business_id, address: r.address, reason: r.reason, since: r.since }));
}

export type OpenUndelivered = {
  readonly id: string; readonly businessId: string; readonly kind: string; readonly firstFailedAt: Date; readonly tries: number;
};

/** Still undelivered, across workspaces, from the last seven days; with `every`, only those not tried within it. */
export async function openUndeliveredAlerts(db: Db, every?: '55 minutes'): Promise<OpenUndelivered[]> {
  const rows = (await sql<{ id: string; business_id: string; kind: string; first_failed_at: Date; tries: number }>`
    select id::text as id, business_id::text as business_id, kind, first_failed_at, tries
      from undelivered_alerts_open(${every ?? null}::interval)`.execute(db)).rows;
  return rows.map((r) => ({ id: r.id, businessId: r.business_id, kind: r.kind, firstFailedAt: r.first_failed_at, tries: r.tries }));
}

/**
 * Nobody was reached: one open row per workspace and kind. A second failure while it is open keeps the newest job
 * (what is true now), says why, and counts the try.
 */
export async function noteUndelivered(tx: Tx, bid: BusinessId, kind: string, job: unknown, why: string): Promise<void> {
  const said = why.trim().slice(0, 500) || 'no way out worked';
  await sql`
    insert into undelivered_alerts as u (business_id, kind, job, why)
    values (${bid}::uuid, ${kind}, ${JSON.stringify(job)}::jsonb, ${said})
    on conflict (business_id, kind) where delivered_at is null do update
      set job = excluded.job, why = excluded.why, last_tried_at = now(), tries = u.tries + 1`.execute(tx);
}

/** A way worked: whatever of this kind waited for this workspace has now been said. */
export async function markAlertDelivered(tx: Tx, bid: BusinessId, kind: string): Promise<void> {
  await sql`update undelivered_alerts set delivered_at = now()
             where business_id = ${bid}::uuid and kind = ${kind} and delivered_at is null`.execute(tx);
}

/** The workspace's live mailbox, as the alarms need it: its address and whether its grant died. Null: none connected. */
export async function mailboxState(tx: Tx, bid: BusinessId): Promise<{ readonly address: string; readonly needsAttention: string | null } | null> {
  const r = (await sql<{ address: string; last_error: string | null }>`
    select address, last_error from mail_accounts where business_id = ${bid}::uuid and archived_at is null limit 1`.execute(tx)).rows[0];
  return r ? { address: r.address, needsAttention: r.last_error } : null;
}

/** The job an open row holds, to try again. */
export async function undeliveredJob(tx: Tx, id: string): Promise<unknown> {
  const r = (await sql<{ job: unknown }>`
    select job from undelivered_alerts where id = ${id}::uuid and delivered_at is null`.execute(tx)).rows[0];
  return r?.job ?? null;
}
