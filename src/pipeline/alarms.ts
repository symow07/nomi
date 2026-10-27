import { withTenantTx, type Db } from '../db/client.js';
import { parseBusinessId } from '../core/types/ids.js';
import { backupState, BACKUP_MAX_AGE_HOURS } from '../core/ops/backups.js';
import { backupTimes, claimBackupFailures, claimMailboxAttention, mailboxState, openUndeliveredAlerts } from '../db/alarms.js';
import type { NotifyJob } from '../queue/boss.js';

/**
 * 0217 — WHAT THE HEARTBEAT MUST NOT STAY GREEN THROUGH (the owner's approval, 2026-10-27).
 *
 * On 2026-10-22 the backup's upload was refused; the app's own alert went into a mailbox Google had revoked; and the
 * heartbeat, which only asked whether the app and its database answered, stayed green for two days. An alarm about
 * Nomi's mail must not travel by Nomi's mail alone, so these are said by the heartbeat — whose alert is
 * Healthchecks.io's, from outside Railway and outside Nomi:
 *
 *   · the last scheduled backup failed (backup_failures, written by the job), or none completed in 36 hours;
 *   · the operator's own mailbox — the way the operator's alerts leave — must be connected again;
 *   · an operator alert or an account letter reached nobody, and is still being tried (undelivered_alerts).
 *
 * Each reason is a line for the log: no address, no secret. None: nothing to say, and the ping is the healthy one.
 */
export type AlarmSources = {
  /** The installation's own workspace: whose mailbox carries the operator's alerts. */
  readonly operatorBusinessId: string;
  /** Does the operator's mail leave through a connected mailbox here (SYSTEM_SMTP_* set)? Otherwise it is not asked. */
  readonly operatorMailbox: boolean;
};

export async function alarmReasons(db: Db, o: AlarmSources, now: Date = new Date()): Promise<string[]> {
  const reasons: string[] = [];
  const { lastRunAt, lastFailure } = await backupTimes(db);
  const state = backupState(lastRunAt, lastFailure?.failedAt ?? null, now);
  if (state === 'failed') reasons.push(`the last scheduled backup failed at its ${lastFailure?.step ?? 'unknown'} step (${lastFailure?.name ?? 'no name'})`);
  if (state === 'stale') reasons.push(`no scheduled backup has completed in ${BACKUP_MAX_AGE_HOURS} h`);
  const operator = parseBusinessId(o.operatorBusinessId);
  if (o.operatorMailbox && operator.ok) {
    const mailbox = await withTenantTx(db, operator.value, (tx) => mailboxState(tx, operator.value));
    if (mailbox?.needsAttention) reasons.push(`the operator's mailbox must be connected again (${mailbox.needsAttention})`);
  }
  const open = await openUndeliveredAlerts(db);
  if (open.length > 0) {
    const kinds = [...new Set(open.map((u) => u.kind))].join(', ');
    reasons.push(`${open.length} alert${open.length === 1 ? '' : 's'} reached nobody and ${open.length === 1 ? 'is' : 'are'} being tried again (${kinds})`);
  }
  return reasons;
}

/** 0217 — each failed backup run nobody was told of, as the operator's alert (the five-minute sweep). */
export async function backupFailureAlerts(db: Db, operatorBusinessId: string): Promise<NotifyJob[]> {
  return (await claimBackupFailures(db)).map((f) => ({
    businessId: operatorBusinessId, kind: 'backup_failed', conversationId: null,
    backupFailure: { name: f.name, at: f.failedAt.toISOString(), step: f.step, reason: f.reason },
  }));
}

/** 0217 — each workspace's mailbox whose grant died, told to its owner once (the five-minute sweep). */
export async function mailboxAlerts(db: Db): Promise<NotifyJob[]> {
  return (await claimMailboxAttention(db)).map((m) => ({
    businessId: m.businessId, kind: 'mailbox_disconnected', conversationId: null,
    mailbox: { address: m.address, since: m.since.toISOString() },
  }));
}
