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
} as const;

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
  kind: 'hot_lead' | 'handoff' | 'delivery_failed' | 'dead_letter';
  conversationId: string | null;
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
