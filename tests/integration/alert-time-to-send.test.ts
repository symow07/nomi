import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sendAlert, alertPriority } from '../../src/pipeline/notify.js';
import type { NotifyJob } from '../../src/queue/boss.js';

/**
 * TIME-TO-SEND, MEASURED (the owner's word after the 106 seconds, 2026-10-13): a flood of other alerts in the queue,
 * then a customer's hand-over — on the real pg-boss, through `sendAlert` exactly as the app queues them (a private
 * queue, so no other file's worker takes a job). The worker polls as often as production's (pg-boss's default) and
 * takes a job a poll, as production's does.
 *   · BEFORE (every alert at the default priority, as before #320): the hand-over waits behind the flood.
 *   · NOW: the hand-over is the next one out, and starts within seconds while fifty wait.
 * The next batch that floods the queue at a priority the hand-over does not beat fails here.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);

d('an urgent alert is not held back by a flood (requires DATABASE_URL)', () => {
  let boss: import('pg-boss').PgBoss;
  const BEFORE = `test.alert-before.${RUN}`;
  const NOW = `test.alert-now.${RUN}`;

  beforeAll(async () => {
    const { PgBoss } = await import('pg-boss');
    boss = new PgBoss({ connectionString: DATABASE_URL!, schema: 'pgboss', schedule: false, supervise: false });
    boss.on('error', () => {});
    await boss.start();
    await boss.createQueue(BEFORE, {});
    await boss.createQueue(NOW, {});
  }, 60_000);

  afterAll(async () => {
    for (const q of [BEFORE, NOW]) { await boss?.offWork(q).catch(() => {}); await boss?.deleteQueue(q).catch(() => {}); }
    await boss?.stop({ graceful: false }).catch(() => {});
  });

  /** Fifty alerts of the kinds a sweep or a list queues in a batch, then one hand-over. */
  const FLOOD: NotifyJob['kind'][] = ['morning_summary', 'allowance_warn', 'allowance_reached', 'signup_digest', 'deletion_reminder', 'app_error', 'self_demoted'];
  const fill = async (queue: string, asTheAppDoes: boolean) => {
    const into = { send: (_: string, data: object | null, options?: object) => boss.send(queue, data, options) } as never;
    const job = (kind: NotifyJob['kind'], i: number) => ({ businessId: `b-${RUN}`, kind, conversationId: null, n: i }) as unknown as NotifyJob;
    for (let i = 0; i < 50; i++) {
      const j = job(FLOOD[i % FLOOD.length]!, i);
      if (asTheAppDoes) await sendAlert(into, j); else await boss.send(queue, j);
    }
    const handoff = { businessId: `b-${RUN}`, kind: 'handoff', conversationId: `c-${RUN}` } as NotifyJob;
    if (asTheAppDoes) await sendAlert(into, handoff); else await boss.send(queue, handoff);
  };
  /** What a worker taking one job a poll does first, and how soon it starts the hand-over. */
  const drain = async (queue: string) => {
    const order: string[] = [];
    let handoffAt: number | null = null;
    const started = Date.now();
    await boss.work<{ kind: string }>(queue, { batchSize: 1 }, async ([job]) => {
      if (!job) return;
      order.push(job.data.kind);
      if (job.data.kind === 'handoff' && handoffAt === null) handoffAt = Date.now() - started;
      await new Promise((r) => setTimeout(r, 20));
    });
    const until = Date.now() + 20_000;
    while (handoffAt === null && Date.now() < until && order.length < 3) await new Promise((r) => setTimeout(r, 100));
    await boss.offWork(queue);
    return { first: order[0], handoffAt };
  };

  it('BEFORE: at one priority for every alert, the hand-over waits behind the flood', async () => {
    await fill(BEFORE, false);
    const r = await drain(BEFORE);
    expect(r.first).not.toBe('handoff');
    expect(r.handoffAt).toBeNull();
  }, 60_000);

  it('NOW: queued as the app queues it, the hand-over is the next one out, within five seconds, fifty waiting', async () => {
    expect(alertPriority('handoff')).toBeGreaterThan(Math.max(...FLOOD.map(alertPriority)));
    await fill(NOW, true);
    const r = await drain(NOW);
    expect(r.first).toBe('handoff');
    expect(r.handoffAt).not.toBeNull();
    expect(r.handoffAt!).toBeLessThan(5_000);
  }, 60_000);
});
