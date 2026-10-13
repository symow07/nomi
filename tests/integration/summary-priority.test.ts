import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DAILY_PRIORITY } from '../../src/pipeline/notify.js';

/**
 * THE DAILY LETTER WAITS ITS TURN (found 2026-10-13 by this suite: g3-allowance's hand-over e-mail, queued at
 * 07:45:35 UTC, left at 07:47:21 — behind the 47 morning summaries the 07:45 sweep had claimed for the run's
 * workspaces past 08:00, one a poll). In production the same happens at 08:00 in every zone with many owners.
 *
 * Against the real pg-boss, on a private queue: what the alert worker takes next, before and after.
 *   · BEFORE (every job at the default priority): the oldest first — a hand-over queued after fifty summaries
 *     is the fifty-first out.
 *   · AFTER (summaries at `DAILY_PRIORITY`): the hand-over queued last is the first out.
 * And the sweep sends at that priority.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);

d('the morning summary waits behind every alert that interrupts (requires DATABASE_URL)', () => {
  let boss: import('pg-boss').PgBoss;
  const BEFORE = `test.summary-before.${RUN}`;
  const AFTER = `test.summary-after.${RUN}`;

  beforeAll(async () => {
    const { PgBoss } = await import('pg-boss');
    boss = new PgBoss({ connectionString: DATABASE_URL!, schema: 'pgboss', schedule: false, supervise: false });
    boss.on('error', () => {});
    await boss.start();
    await boss.createQueue(BEFORE, {});
    await boss.createQueue(AFTER, {});
  }, 60_000);

  afterAll(async () => {
    await boss?.deleteQueue(BEFORE).catch(() => {});
    await boss?.deleteQueue(AFTER).catch(() => {});
    await boss?.stop({ graceful: false }).catch(() => {});
  });

  /** Fifty summaries, then a customer's hand-over a moment later; what is fetched first. */
  const firstOut = async (queue: string, summaryPriority: number | undefined): Promise<string | undefined> => {
    for (let i = 0; i < 50; i++) {
      await boss.send(queue, { kind: 'morning_summary', n: i }, summaryPriority === undefined ? {} : { priority: summaryPriority });
    }
    await boss.send(queue, { kind: 'handoff' });
    const [job] = await boss.fetch<{ kind: string }>(queue, { batchSize: 1 });
    return job?.data.kind;
  };

  it('BEFORE: at the default priority, the hand-over waits behind all fifty', async () => {
    expect(await firstOut(BEFORE, undefined)).toBe('morning_summary');
  });

  it('AFTER: at DAILY_PRIORITY, the hand-over queued last is the next one out', async () => {
    expect(DAILY_PRIORITY).toBeLessThan(0);
    expect(await firstOut(AFTER, DAILY_PRIORITY)).toBe('handoff');
  });

  it('the sweep sends every summary at DAILY_PRIORITY', () => {
    const src = readFileSync('src/main.ts', 'utf8');
    const sweep = src.slice(src.indexOf('await boss.work(QUEUES.morningSummary'), src.indexOf('});', src.indexOf('await boss.work(QUEUES.morningSummary')));
    expect(sweep).toContain("kind: 'morning_summary'");
    expect(sweep).toContain('priority: DAILY_PRIORITY');
  });
});
