/**
 * Vitest's global setup: pg-boss's schema, made ONCE per run, before any test file is loaded.
 *
 * Production starts its queue before it serves a page, and pages read the queue (a conversation's live line asks
 * whether a reply is still on its way: `assistantWorking`, src/api/web/live.ts; a dead-lettered turn asks what was
 * answered after it: `answeredAfter`, src/pipeline/received.ts). A fresh database has no `pgboss.job` until something
 * starts the queue. `ensureQueueSchema` (tenant.ts) was called only by the files that knew to, so a file that walks a
 * conversation passed in the suite when an EARLIER file had happened to start the queue, and failed when run alone
 * (eleven such files, 2026-11-08: "relation pgboss.job does not exist"). Here every file starts with it, in any order.
 *
 * The schema is the one the app makes: `startBoss` (src/queue/boss.ts) with the app's pg-boss, then stopped — no
 * worker is left running. Without DATABASE_URL (the unit suite, the trust harness) this does nothing.
 */
export default async function setup(): Promise<void> {
  if (!process.env['DATABASE_URL']) return;
  const { ensureQueueSchema } = await import('./tenant.js');
  await ensureQueueSchema();
}
