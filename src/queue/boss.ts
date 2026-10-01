import { PgBoss } from 'pg-boss';

/**
 * Queue topology. (ADR-0004)
 *
 * pg-boss = queues in Postgres: retries with backoff, DLQ via dead-letter
 * queues, singleton keys, transactional enqueue. No Redis, nothing new to
 * operate. Remember the division of labour:
 *
 *   singletonKey prevents CONCURRENT duplicates;
 *   the orders_one_open_per_conversation unique index prevents ALL duplicates.
 *
 * Money gets a database invariant, not just a queue guarantee.
 */

export const QUEUES = {
  /** one job per inbound message; serialized per conversation */
  inbound: 'message.inbound',
  /** delivery of a reply back to the channel */
  outbound: 'message.outbound',
  /** telegram/slack alerts: hot lead, handoff, delivery-failure */
  notify: 'notify.team',
  /**
   * C4.b — the once-a-minute look at which follow-ups are due. A cron tick, not
   * a job per step: the schedule lives in `sequence_enrollments.next_due_at`,
   * where a lost job cannot lose a follow-up (src/outbound/sequences.ts).
   */
  sequences: 'outreach.sequences',
  /**
   * The once-a-day look at `backup_runs`: has the scheduled backup completed
   * lately? Not the backup itself — that runs as a Railway cron service
   * outside this process (backup/run.sh) — only the question of whether it
   * did, and the owner alert when it did not (src/core/ops/backups.ts).
   */
  backups: 'ops.backups',
  /**
   * CC-02a — the once-a-day look at deletion requests: is any open one within
   * seven days of its thirty, or past them? Only the question and the
   * operator alert; the deletion itself is carried out by hand
   * (docs/DATA-DELETION-RUNBOOK.md).
   */
  deletions: 'ops.deletions',
  /**
   * CC-10 — every five minutes: the error alert the hourly limit held back,
   * once the hour has room for it (src/db/appErrors.ts). Errors are recorded
   * where they happen; this only makes sure a held one is not forgotten when
   * the flood that held it has stopped.
   */
  errors: 'ops.errors',
  /**
   * CEIL — every hour: has any workspace's error rate on Meta's channels
   * crossed the line (src/core/ops/metaErrors.ts)? Only the question and the
   * operator alert; what to do about it is the operator's.
   */
  metaErrors: 'ops.meta_errors',
  /**
   * CC-10 — the uptime heartbeat: every five minutes the app checks itself and
   * pings HEALTH_PING_URL (src/worker/heartbeat.ts). Scheduled only when that
   * is set, and only once the server listens.
   */
  heartbeat: 'ops.heartbeat',
  /**
   * P6 — once a day: every copy's practice conversations quiet for thirty days
   * are erased (0089, `practice_expire`). Practice is not kept.
   */
  practiceExpiry: 'ops.practice_expiry',
  /**
   * CH3 — a message the business's own account sent, come back from Meta. Held
   * a little before it is read (`ECHO_SETTLE_SECONDS`), so Nomi's own send has
   * recorded the id Meta gave it and is recognised as ours (src/pipeline/echo.ts).
   */
  echo: 'message.echo',
  /**
   * G5b — every ten minutes: a reply waiting past the day its channel allows
   * an answer is marked expired (0098, `expire_waiting_drafts`).
   */
  draftExpiry: 'ops.draft_expiry',
  /** G1 — once a day: the operator's list of the last day's sign-ups. */
  signupDigest: 'ops.signup_digest',
  // G3 — every five minutes: who crossed 80% or 100% of today's allowance.
  allowance: 'ops.allowance',
} as const;

/** CH3 — an echo, as the webhook carried it. Dates as ISO strings. */
export type EchoJob = {
  businessId: string;
  channel: 'instagram' | 'messenger';
  mid: string;
  customer: string;
  account: string;
  text: string | null;
  received: string;
  appId: string | null;
  occurredAt: string;
};

export type SequenceSweepJob = { businessId: string };
export type BackupWatchJob = { businessId: string };
/** The business whose owner runs this installation — the alert goes to them. */
export type DeletionWatchJob = { businessId: string };
export type ErrorSweepJob = { businessId: string };
export type MetaErrorWatchJob = { businessId: string };
export type HeartbeatJob = Record<string, never>;
export type PracticeExpiryJob = Record<string, never>;

/** `app_error` only: the error the alert is about, as recorded — redacted, cut. Dates as ISO strings. */
export type AppErrorAlertJob = {
  fingerprint: string;
  where: string;
  name: string;
  message: string;
  frame: string | null;
  route: string | null;
  count: number;
  firstSeen: string;
  lastSeen: string;
  /** Other errors the hourly limit held back, counted in this alert. */
  more: number;
};

export async function startBoss(connectionString: string): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString,
    schema: 'pgboss',
    // migrations run as the app role's owner; pg-boss manages its own schema
  });
  boss.on('error', (err: Error) => console.error('[pg-boss]', err));
  await boss.start();

  // Dead queues FIRST: pg-boss v12 validates the deadLetter target exists at
  // createQueue time (found by the production boot-and-probe — this function
  // had never run against a real database before).
  for (const name of Object.values(QUEUES)) {
    await boss.createQueue(`${name}.dead`, {});
  }
  for (const name of Object.values(QUEUES)) {
    await boss.createQueue(name, {
      retryLimit: 5,
      retryBackoff: true,
      retryDelay: 10,               // seconds, doubled per attempt
      deadLetter: `${name}.dead`,   // exhausted jobs land here and alert
    });
  }
  return boss;
}

export type InboundJob = {
  businessId: string;
  conversationId: string;
  messageId: string;
  text: string;
  /**
   * M34 — what the buyer actually sent. Optional so jobs queued by an older
   * build (which never set it) deserialize as text, which is what they were.
   * 'audio' routes through transcription before the turn; an untranscribable
   * note is REFUSED (audio_unheard), never treated as empty text.
   */
  messageType?: 'text' | 'image' | 'audio' | 'unsupported';
  /**
   * G2c — the provider's own type ('document', 'sticker', …), so an
   * unreadable message reaches a person by name instead of running a turn on
   * empty text. Optional for the same reason as `messageType`.
   */
  received?: string;
  /** CH7a — the shared post's or story's link, when the provider gave one. */
  ref?: string;
  /** Provider media id for audio/image — short-lived, fetch promptly. */
  mediaId?: string | null;
  /**
   * G13 — a person typed what the buyer said and asked for an answer. The turn
   * runs on THOSE words: no fragment, no second message on the timeline (the
   * corrected note is already there), and no batching to wait out. Everything
   * after that is the ordinary turn — same guards, same price rules, same gate.
   */
  answerOnly?: boolean;
};

export type OutboundJob = {
  businessId: string;
  conversationId: string;
  reply: string;
  channel: string;
};

export type NotifyJob = {
  businessId: string;
  // Language-NEUTRAL event code (P3): the notify consumer localizes via t().
  kind: 'hot_lead' | 'handoff' | 'draft_waiting' | 'signup_digest' | 'allowance_warn' | 'allowance_reached' | 'deletion_requested' | 'order_proposed' | 'delivery_failed' | 'dead_letter' | 'backup_stale' | 'deletion_due' | 'app_error' | 'meta_errors';
  conversationId: string | null;
  /** `backup_stale` only: when the last completed backup was uploaded, ISO; null = never. */
  lastBackupAt?: string | null;
  /**
   * `deletion_due` only: the open requests within seven days of their thirty,
   * or past them — whose, which kind, asked when (ISO), and whether already
   * late when the check ran. Never the buyer and never the note.
   */
  deletionsDue?: { business: string; scope: 'workspace' | 'buyer'; askedAt: string; overdue: boolean }[];
  /** `app_error` only (CC-10): what went wrong, as `app_errors` holds it. */
  appError?: AppErrorAlertJob;
  /**
   * `meta_errors` only (CEIL): the workspaces over the line, the worst first —
   * the name, the day's counts and the provider's own words. Never a customer.
   */
  metaErrors?: { business: string; attempted: number; failed: number; errors: string[] }[];
  /** `signup_digest` only (G1): who signed up in the last day. Dates as ISO strings. */
  signups?: { business: string; kind: string | null; country: string | null; at: string }[];
  /** `signup_digest` (G7, KS4): every operator switch still on — which, for whom (null: everyone), since when (ISO). */
  flags?: { flag: string; business: string | null; since: string }[];
  /** `signup_digest` (G9): the day's sign-up forms, and how many came back with their code. Counts only. */
  forms?: { forms: number; codesUsed: number };
  /** `allowance_warn` / `allowance_reached` (G3): how much is used, and when it renews (ISO). */
  allowancePct?: number;
  renewsAt?: string;
};

/**
 * FAIR (the one-month build order, 2026-09-30) — one inbound queue, shared
 * fairly between workspaces.
 *
 * Every inbound job carries its workspace as its pg-boss GROUP, and the worker
 * runs `INBOUND_WORK.localConcurrency` jobs at once, at most
 * `localGroupConcurrency` of them for any one workspace. One workspace's
 * backlog then holds one worker and
 * every other workspace is answered by the rest — before, one worker took one
 * job per poll for everybody, and a dozen of one tenant's messages held
 * another's for 24 seconds (found in the integration run for #130).
 *
 * One at a time per workspace also means one at a time per conversation: the
 * advisory lock in the worker stays the belt to this brace.
 */
//
// The IN-PROCESS count, not pg-boss's database one: the database count races —
// three workers that poll in the same millisecond each see nobody running and
// each take one of the same workspace's jobs (tests/integration/fair-queue.test.ts
// caught it). The in-process count is settled synchronously after each fetch
// and puts any excess job back. pg-boss takes one or the other; production runs
// ONE replica, so this is the installation's limit. With more replicas it
// becomes one per workspace per replica.
//
// And THREE WORKERS WHOSE POLLS ARE A THIRD OF AN INTERVAL APART, not one
// registration of three: three workers that poll in the same instant are each
// handed one of the three OLDEST jobs, and when those are all one workspace's,
// two are put back — one job per poll for everybody, the backlog first, which
// is the unfairness this exists to end (the fairness test caught it). Apart,
// each fetch sees the workspace already running and passes over it.
export const INBOUND_WORK = { workers: 3, pollSeconds: 2, localGroupConcurrency: 1 } as const;
export const inboundGroup = (businessId: string): { readonly id: string } => ({ id: businessId });

/**
 * Enqueue an inbound message. singletonKey = conversationId ensures two
 * messages from the same client never process concurrently (the advisory lock
 * in the worker is the belt to this brace).
 */
export async function enqueueInbound(boss: PgBoss, job: InboundJob): Promise<void> {
  await boss.send(QUEUES.inbound, job, {
    singletonKey: job.conversationId,
    retryLimit: 3,
    group: inboundGroup(job.businessId),
  });
}
