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
} as const;

export type SequenceSweepJob = { businessId: string };
export type BackupWatchJob = { businessId: string };

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
  kind: 'hot_lead' | 'handoff' | 'delivery_failed' | 'dead_letter' | 'backup_stale';
  conversationId: string | null;
  /** `backup_stale` only: when the last completed backup was uploaded, ISO; null = never. */
  lastBackupAt?: string | null;
};

/**
 * Enqueue an inbound message. singletonKey = conversationId ensures two
 * messages from the same client never process concurrently (the advisory lock
 * in the worker is the belt to this brace).
 */
export async function enqueueInbound(boss: PgBoss, job: InboundJob): Promise<void> {
  await boss.send(QUEUES.inbound, job, {
    singletonKey: job.conversationId,
    retryLimit: 3,
  });
}
