import type { Db } from '../db/client.js';
import { dueDeletionRequests } from '../db/deletionRequests.js';
import { deletionOverdue } from '../core/ops/deletions.js';
import type { NotifyJob } from '../queue/boss.js';

/**
 * CC-02a — the daily deadline check. /data-deletion promises every buyer that
 * Nomi's operator carries a deletion out within 30 days of the business
 * recording it; a promise with a date on it needs somebody told before the
 * date, not after. So once a day this asks, across every business, which open
 * requests are within 7 days of their 30 or past them, and when any are,
 * returns the ONE operator alert that names them all — to the owner of the
 * business the job names (whoever runs this installation), by e-mail always,
 * as the backup alert goes (`OPERATOR_ALERT_KINDS`).
 *
 * Null when nothing is due: no alert, not an alert saying "none". One a day at
 * most — the schedule is daily and the send is a singleton per day
 * (src/main.ts) — and one a day for as long as any request stays open and
 * due, which is the point: a late deletion is news every day until it is done.
 */
export async function deletionDueAlert(db: Db, operatorBusinessId: string, now: Date): Promise<NotifyJob | null> {
  const due = await dueDeletionRequests(db);
  if (due.length === 0) return null;
  return {
    businessId: operatorBusinessId, kind: 'deletion_due', conversationId: null,
    deletionsDue: due.map((d) => ({
      business: d.business, scope: d.scope, askedAt: d.askedAt.toISOString(),
      overdue: deletionOverdue(d.askedAt, now),
    })),
  };
}
