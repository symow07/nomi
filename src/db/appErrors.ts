import { sql } from 'kysely';
import type { Db, Tx } from './client.js';
import { ALERTS_PER_HOUR, alertOwed } from '../core/ops/appErrors.js';

/**
 * CC-10 — `app_errors` (0074): one row per kind of error, and the decision,
 * in the same transaction, of whether the operator is owed an alert about it.
 *
 * Installation data, not a tenant's: written and read on the plain pool,
 * outside any tenant transaction (inside one, the table's policy hides it).
 *
 * THE ALERT RULE, in one place (the thresholds are in core/ops/appErrors.ts):
 *
 *   · a fingerprint is alerted when first seen, and again only if it recurs
 *     six hours or more after its last alert — a burst is one alert;
 *   · no more than six alerts in any hour, across every fingerprint. One that
 *     is owed while the hour is full is HELD (`alert_held_at`), and the next
 *     alert to leave counts the held ones in an "and N more" line. The
 *     five-minute sweep (`releaseHeldAppErrorAlert`) makes sure there IS a
 *     next one once the hour has room, even when the flood has stopped.
 *
 * THE LOCK. Deciding an alert takes one transaction-scoped advisory lock, so
 * two processes cannot both spend the hour's last alert. Only that decision
 * takes it: a recurrence — nearly every recording during a flood — is one
 * upsert and never queues behind the lock holding a pool connection. It is
 * taken AFTER the upsert's row lock, which cannot deadlock: an owed row is
 * never a held one, the lock holder only updates held rows, and whoever holds
 * a held row's lock is recording a recurrence, which does not wait for it.
 *
 * The notify job is enqueued INSIDE the same transaction (`onAlert`), so an
 * error is never marked alerted without its alert being queued, nor queued
 * without being marked.
 */

export type AppErrorEntry = {
  readonly fingerprint: string;
  readonly where: string;
  readonly name: string;
  readonly message: string;
  readonly frame: string | null;
  readonly route: string | null;
  readonly businessId: string | null;
};

/** One alert's worth: the error as recorded, and how many held ones it also stands for. */
export type AppErrorAlert = {
  readonly fingerprint: string;
  readonly where: string;
  readonly name: string;
  readonly message: string;
  readonly frame: string | null;
  readonly route: string | null;
  readonly count: number;
  readonly firstSeen: Date;
  readonly lastSeen: Date;
  /** Errors held back by the hourly limit that this alert counts in its last line. */
  readonly more: number;
};

/** Called inside the recording transaction when an alert is owed: queue it there. */
export type OnAppErrorAlert = (alert: AppErrorAlert, tx: Tx) => Promise<void>;

type Row = {
  fingerprint: string; where: string; name: string; message: string;
  frame: string | null; route: string | null; count: string;
  first_seen: Date; last_seen: Date; last_alerted_at: Date | null; alert_held_at: Date | null;
};

const COLUMNS = sql.raw(`fingerprint, "where", name, message, frame, route, count::text as count,
  first_seen, last_seen, last_alerted_at, alert_held_at`);

/**
 * A recording waits a few seconds at most for any lock — a row's or the alert
 * lock: an error the recorder could not write is logged, which is better than
 * a request or a job held up behind it.
 */
async function boundLockWaits(tx: Tx): Promise<void> {
  await sql`set local lock_timeout = '5s'`.execute(tx);
}

/** The installation's one error-alert lock. */
async function lockAlerts(tx: Tx): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended('nomi.app_errors', 0))`.execute(tx);
}

/**
 * Record one occurrence. Returns the alert when one was owed and queued (by
 * `onAlert`, in this transaction), else null — already alerted, held, or no
 * sink to queue it on.
 */
export async function recordAppError(
  db: Db, e: AppErrorEntry, now: Date, onAlert: OnAppErrorAlert | null = null,
): Promise<AppErrorAlert | null> {
  return db.transaction().execute(async (tx) => {
    await boundLockWaits(tx);
    const row = (await sql<Row>`
      insert into app_errors as a
        (fingerprint, "where", name, message, frame, route, business_id, first_seen, last_seen, count)
      values (${e.fingerprint}, ${e.where}, ${e.name}, ${e.message}, ${e.frame}, ${e.route},
              ${e.businessId}::uuid, ${now}, ${now}, 1)
      on conflict (fingerprint) do update set
        count = a.count + 1,
        last_seen = greatest(a.last_seen, excluded.last_seen),
        message = excluded.message,
        route = coalesce(excluded.route, a.route),
        business_id = coalesce(excluded.business_id, a.business_id)
      returning ${COLUMNS}`.execute(tx)).rows[0];
    if (!row || !onAlert) return null;
    if (!alertOwed({ lastAlertedAt: row.last_alerted_at, heldAt: row.alert_held_at }, now)) return null;
    // Owed: now, and only now, the alert lock. This row is locked by the upsert
    // above, so what made it owed cannot change while we wait.
    await lockAlerts(tx);
    return claim(tx, row, now, onAlert);
  });
}

/**
 * The five-minute sweep: when the hour has room again, the OLDEST held error
 * gets the alert it was owed, counting the other held ones in its last line.
 */
export async function releaseHeldAppErrorAlert(
  db: Db, now: Date, onAlert: OnAppErrorAlert,
): Promise<AppErrorAlert | null> {
  return db.transaction().execute(async (tx) => {
    await boundLockWaits(tx);
    await lockAlerts(tx);
    return claim(tx, null, now, onAlert);
  });
}

/** How many error alerts left in the hour up to `now`. Each alert stamps exactly one row. */
async function alertsInTheLastHour(tx: Tx, now: Date): Promise<number> {
  const r = await sql<{ n: number }>`
    select count(*)::int as n from app_errors
     where last_alerted_at > ${now}::timestamptz - interval '1 hour'
       and last_alerted_at <= ${now}::timestamptz`.execute(tx);
  return r.rows[0]?.n ?? 0;
}

async function claim(tx: Tx, owed: Row | null, now: Date, onAlert: OnAppErrorAlert): Promise<AppErrorAlert | null> {
  if (await alertsInTheLastHour(tx, now) >= ALERTS_PER_HOUR) {
    // The hour is full: this one waits, and is counted in the next alert.
    if (owed) {
      await sql`update app_errors set alert_held_at = ${now}
                 where fingerprint = ${owed.fingerprint} and alert_held_at is null`.execute(tx);
    }
    return null;
  }
  const chosen = owed ?? (await sql<Row>`
    select ${COLUMNS} from app_errors
     where alert_held_at is not null
     order by alert_held_at, fingerprint limit 1`.execute(tx)).rows[0];
  if (!chosen) return null;
  // The others that were waiting are counted here, and stop waiting. They were
  // never described one by one, so their own next occurrence is still owed one.
  const more = (await sql<{ n: number }>`
    with released as (
      update app_errors set alert_held_at = null
       where alert_held_at is not null and fingerprint <> ${chosen.fingerprint}
      returning 1)
    select count(*)::int as n from released`.execute(tx)).rows[0]?.n ?? 0;
  const row = (await sql<Row>`
    update app_errors set last_alerted_at = ${now}, alert_held_at = null
     where fingerprint = ${chosen.fingerprint}
    returning ${COLUMNS}`.execute(tx)).rows[0]!;
  const alert: AppErrorAlert = {
    fingerprint: row.fingerprint, where: row.where, name: row.name, message: row.message,
    frame: row.frame, route: row.route, count: Number(row.count),
    firstSeen: row.first_seen, lastSeen: row.last_seen, more,
  };
  await onAlert(alert, tx);
  return alert;
}
