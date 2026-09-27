import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CompiledQuery } from 'kysely';
import type { PgBoss } from 'pg-boss';
import type { Db, Tx } from '../db/client.js';
import {
  recordAppError, releaseHeldAppErrorAlert, type AppErrorAlert, type AppErrorEntry,
} from '../db/appErrors.js';
import { redactSecrets } from '../security/credentials.js';
import {
  cut, describeThrown, errorWhere, firstRepoFrame, messageShape, scrubSecrets, MESSAGE_MAX,
  type ErrorContext, type ErrorWhere, type ReportError,
} from '../core/ops/appErrors.js';
import { QUEUES, type NotifyJob } from '../queue/boss.js';

/**
 * CC-10 — THE ERROR RECORDER. One per process, built by `startWorker` beside
 * the pool and pg-boss it writes through, and handed to every failure path:
 *
 *   · web      — the Fastify error handler, for a response of 500 or above;
 *   · worker   — every queue job that fails (`reportJobFailures` wraps
 *                `boss.work` once, so no handler can forget), each dead
 *                letter, and the minute sweep's own caught failures;
 *   · process  — unhandledRejection / uncaughtException (`installCrashReporting`).
 *
 * It writes `app_errors` and, when the rule in src/db/appErrors.ts says an
 * alert is owed, queues ONE `app_error` notify job in the same transaction —
 * the operator alert path (src/pipeline/notify.ts): e-mail to the pilot's
 * sign-in address always, WhatsApp too where a channel is live.
 *
 * IT NEVER THROWS INTO ITS CALLER AND NEVER LOOPS. Recording is bounded in
 * time and in number; a failure to record is logged — never recorded, which
 * would be the loop — and an alert about an error that failed to deliver is
 * not reported either (`isAppErrorAlertJob`).
 */

/** The repository root, whichever tree this runs from: src/ under the tests, dist/ in production. */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The values this environment holds that must never be written down: every
 * key, token, secret and password, the owner's access code, and the database
 * URLs — whole, and their passwords alone, which is how a driver quotes them.
 */
export function secretValuesIn(env: Readonly<Record<string, string | undefined>>): string[] {
  const out = new Set<string>();
  for (const [name, value] of Object.entries(env)) {
    if (!value || value.length < 8) continue;
    if (/(KEY|TOKEN|SECRET|PASSWORD|ACCESS_CODE)$/.test(name) || /(DATABASE|PING)_URL$/.test(name)) out.add(value);
    if (/DATABASE_URL$/.test(name)) {
      try {
        const password = decodeURIComponent(new URL(value).password);
        if (password.length >= 6) out.add(password);
      } catch { /* not a URL: the whole value is already listed */ }
    }
  }
  return [...out];
}

/** Everything written down passes through here: the shared redactor, then the shapes it does not know. */
const clean = (s: string, knownSecrets: readonly string[]): string => scrubSecrets(redactSecrets(s, knownSecrets));

/**
 * One occurrence as it is written down, and its fingerprint: a hash of where
 * it happened, its name and its first frame inside this repository — or,
 * with no such frame (the database raised it), of the route and the SHAPE of
 * its message, so two different database errors stay two rows.
 */
export function appErrorEntry(
  err: unknown, where: ErrorWhere, context: ErrorContext,
  opts: { readonly root: string; readonly knownSecrets: readonly string[] },
): AppErrorEntry {
  const thrown = describeThrown(err);
  const w = errorWhere(where);
  const name = cut(clean(thrown.name, opts.knownSecrets), 120);
  const message = cut(clean(thrown.message, opts.knownSecrets), MESSAGE_MAX);
  const frame = firstRepoFrame(thrown.stack, opts.root);
  const route = context.route ? cut(clean(context.route, opts.knownSecrets), 300) : null;
  const identity = frame
    ? [w, name, frame]
    : [w, name, route ?? '', `${thrown.code ?? ''} ${messageShape(message)}`];
  return {
    fingerprint: createHash('sha256').update(identity.join('\n')).digest('hex').slice(0, 16),
    where: w, name, message, frame, route,
    businessId: context.businessId && UUID.test(context.businessId) ? context.businessId : null,
  };
}

/** A dead letter is not an exception; it is a job that gave up. Recorded as one kind per queue. */
export function deadLetter(queue: string, jobId: string): { name: string; message: string } {
  return { name: 'DeadLetter', message: `job ${jobId} on ${queue} gave up after its retries` };
}

/** The job the notify worker delivers. Dates travel as ISO strings. */
export function appErrorNotifyJob(operatorBusinessId: string, a: AppErrorAlert): NotifyJob {
  return {
    businessId: operatorBusinessId, kind: 'app_error', conversationId: null,
    appError: {
      fingerprint: a.fingerprint, where: a.where, name: a.name, message: a.message,
      frame: a.frame, route: a.route, count: a.count,
      firstSeen: a.firstSeen.toISOString(), lastSeen: a.lastSeen.toISOString(), more: a.more,
    },
  };
}

/** A Kysely transaction, as pg-boss sends through one: the job commits with the row, or neither does. */
export function txDatabase(tx: Tx): { executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> } {
  return {
    executeSql: async (text, values = []) => ({ rows: (await tx.executeQuery(CompiledQuery.raw(text, values))).rows }),
  };
}

/**
 * Queue an alert on the notify worker, for the operator's workspace. Inside the
 * recording transaction. A day's retention: in deployment mode (no channel
 * configured) nothing consumes the notify queue, and an error alert that
 * arrives days late, when messaging comes on, is noise.
 */
export function appErrorAlertsTo(
  boss: Pick<PgBoss, 'send'>, operatorBusinessId: string,
): (a: AppErrorAlert, tx: Tx) => Promise<void> {
  return async (a, tx) => {
    const id = await boss.send(QUEUES.notify, appErrorNotifyJob(operatorBusinessId, a) satisfies NotifyJob, {
      // One job per fingerprint a minute, at most — the row's claim is the
      // real guarantee; this is the queue's own belt to that brace.
      singletonKey: `app_error:${a.fingerprint}`, singletonSeconds: 60,
      retentionSeconds: 24 * 3600,
      db: txDatabase(tx),
    });
    if (id === null) console.warn(`[errors] alert for ${a.fingerprint} was already queued this minute`);
  };
}

export type ErrorReporting = {
  readonly report: ReportError;
  /** The five-minute sweep: the held alert, once the hour has room for it. */
  readonly releaseHeld: () => Promise<void>;
  /** Settles when every recording in flight has (tests; the crash handler waits on `report`). */
  readonly idle: () => Promise<void>;
};

export function makeErrorReporter(deps: {
  readonly db: Db;
  /** Queue the alert, inside the recording transaction. Null: record only. */
  readonly enqueue: ((a: AppErrorAlert, tx: Tx) => Promise<void>) | null;
  readonly knownSecrets?: readonly string[];
  readonly now?: () => Date;
  readonly log?: (line: string) => void;
  readonly root?: string;
  /** How long a caller that awaits a report waits for it. The recording itself goes on. */
  readonly timeoutMs?: number;
  /**
   * Recordings in flight at once. Past it an error is not written down (its
   * caller has logged it), so an error flood can take at most this many of the
   * pool's connections from the requests that are still working.
   */
  readonly maxInFlight?: number;
}): ErrorReporting {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((line: string) => console.error(line));
  const knownSecrets = deps.knownSecrets ?? [];
  const root = deps.root ?? ROOT;
  const timeoutMs = deps.timeoutMs ?? 5_000;
  const maxInFlight = deps.maxInFlight ?? 4;
  const pending = new Set<Promise<void>>();
  let dropped = 0;

  /** The recording's own failure, said once and in words that cannot leak. */
  const failed = (what: string) => (e: unknown) => {
    const d = describeThrown(e);
    log(`[errors] ${what}: ${cut(clean(`${d.name}: ${d.message}`, knownSecrets), 200)}`);
  };

  const track = (p: Promise<void>): Promise<void> => {
    pending.add(p);
    void p.finally(() => pending.delete(p));
    return withDeadline(p, timeoutMs);
  };

  const report: ReportError = (err, where, context = {}) => {
    if (pending.size >= maxInFlight) {
      // Said once per burst, not once per error: this line must not become the flood.
      if (dropped++ === 0) log(`[errors] ${maxInFlight} recordings already in flight; errors from ${where} are not written down until they finish`);
      return Promise.resolve();
    }
    dropped = 0;
    return track((async () => {
      const entry = appErrorEntry(err, where, context, { root, knownSecrets });
      await recordAppError(deps.db, entry, now(), deps.enqueue);
    })().catch(failed(`an error from ${where} was not recorded`)));
  };

  const releaseHeld = (): Promise<void> => (deps.enqueue
    ? track(releaseHeldAppErrorAlert(deps.db, now(), deps.enqueue).then(() => undefined)
      .catch(failed('the held error alert was not released')))
    : Promise.resolve());

  const idle = async (): Promise<void> => {
    while (pending.size > 0) await Promise.allSettled([...pending]);
  };

  return { report, releaseHeld, idle };
}

/** `p`, or give up waiting after `ms` — without leaving a timer to hold the process open. */
function withDeadline(p: Promise<void>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    void p.finally(() => { clearTimeout(timer); resolve(); });
  });
}

/** A failed delivery of an error alert is not itself reported: that is the loop. */
export function isAppErrorAlertJob(queue: string, jobs: readonly { readonly data?: unknown }[]): boolean {
  if (queue !== QUEUES.notify && queue !== `${QUEUES.notify}.dead`) return false;
  return jobs.some((j) => (j.data as { kind?: unknown } | undefined)?.kind === 'app_error');
}

type Handler = (jobs: { readonly data?: unknown }[]) => Promise<unknown>;

/**
 * EVERY JOB HANDLER REPORTS ITS FAILURE. Wraps `boss.work` once, before any
 * handler is registered: each handler registered after — the worker's own and
 * main.ts's — has its failure recorded (`worker:<queue>`, with the job's
 * business as context) and then rethrown, so pg-boss retries exactly as
 * before. A handler added next year cannot forget to report.
 */
export function reportJobFailures(
  boss: Pick<PgBoss, 'work'>, report: ReportError,
  skip: (queue: string, jobs: readonly { readonly data?: unknown }[]) => boolean = () => false,
): void {
  const target = boss as unknown as { work: (name: string, ...rest: unknown[]) => Promise<string> };
  const work = target.work.bind(boss);
  target.work = (name: string, ...rest: unknown[]) => {
    const handler = rest[rest.length - 1] as Handler;
    const reported: Handler = async (jobs) => {
      try {
        return await handler(jobs);
      } catch (e) {
        if (!skip(name, jobs)) {
          const businessId = (jobs[0]?.data as { businessId?: unknown } | undefined)?.businessId;
          void report(e, `worker:${name}`, { businessId: typeof businessId === 'string' ? businessId : null });
        }
        throw e;
      }
    };
    return work(name, ...rest.slice(0, -1), reported);
  };
}

/**
 * THE PROCESS ITSELF. Today an unhandled rejection or an uncaught exception
 * ends the process with code 1 and Railway restarts it; that stays true. What
 * changes is that it is written down first — for at most `waitMs`, because a
 * process in this state must not linger — and the operator hears of it.
 */
export function installCrashReporting(
  proc: { on(event: 'uncaughtException' | 'unhandledRejection', listener: (err: unknown) => void): unknown },
  deps: {
    readonly report: ReportError;
    readonly exit: (code: number) => void;
    readonly log: (line: string, err: unknown) => void;
    readonly waitMs?: number;
  },
): void {
  let crashing = false;
  const crash = (event: string) => (err: unknown) => {
    deps.log(`[${event}]`, err);
    if (crashing) return;                 // the first one is being written down; this one is in the log
    crashing = true;
    let exited = false;
    const exit = () => { if (!exited) { exited = true; deps.exit(1); } };
    setTimeout(exit, deps.waitMs ?? 2_000);   // not unref'd: this timer IS the exit
    void deps.report(err, 'process').finally(exit);
  };
  proc.on('uncaughtException', crash('uncaughtException'));
  proc.on('unhandledRejection', crash('unhandledRejection'));
}
