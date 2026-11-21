import type pg from 'pg';

/**
 * The owner alerts (`notify.team`) a file queued and left waiting: removed when the file ends.
 *
 * THE FLAKE THIS EXISTS FOR (2026-11-21, Block 5's verification). boot.test.ts › P3 waits up to 30 s for every other
 * file's alerts to drain before it times its own, and failed twice in four local runs with 26 still queued. They were
 * not boot.test's, and mostly not any file's own work: the morning summary (`QUEUES.morningSummary`, src/main.ts) is
 * scheduled every fifteen minutes and runs in whichever composition is up at the quarter-hour. It claims a summary for
 * every owner in the database, which in a test run is every workspace every earlier file made, and queues one alert
 * each. That file then closes its worker and the alerts wait for the next file's notify worker, ahead of its own jobs.
 * Measured on a full isolated run: hear-and-see.test.ts left 66 (63 morning summaries) and surveys.test.ts 12, as each
 * happened to hold a quarter-hour; thirteen other files left one or two of their own (a hand-over, an app error).
 * Which file holds the clock, and whether boot.test runs soon after it, varies with the wall clock and the file order:
 * hence two runs in four.
 *
 * provider-billing.test.ts closed its own leak the same way on 2026-10-05; a scheduled job's alerts belong to no file
 * that could do it, so it is done once here, for every file (`alerts-go-with-file.setup.ts`). Files run one at a time
 * (`--no-file-parallelism`, tools/run-integration.mjs), so an alert queued between a file's start and its end is that
 * file's. Only alerts still WAITING go — created, or failed and due a retry: the file's workers are closed, so none of
 * its own will ever run them. One being sent (`active`) is left to finish; nothing that already ran is touched.
 *
 * "Queued during the file" means the file's only on a database no other process queues to, so the setup acts only
 * where the run owns its database (`NOMI_TEST_DB_OWNED=1`, set by tools/run-integration-isolated.mjs and by CI).
 */

/** The clock alerts are measured from: the database's, so the comparison never depends on this Mac's. */
export async function alertClock(admin: pg.Client): Promise<string> {
  return (await admin.query<{ t: string }>(`select now()::text as t`)).rows[0]!.t;
}

/** Removes the alerts queued since `since` and still waiting; says how many of each kind went. */
export async function dropAlertsLeftSince(admin: pg.Client, since: string): Promise<Record<string, number>> {
  const gone = await admin.query<{ kind: string | null }>(
    `delete from pgboss.job
      where name = 'notify.team' and state in ('created', 'retry') and created_on >= $1::timestamptz
      returning data->>'kind' as kind`, [since]);
  const byKind: Record<string, number> = {};
  for (const r of gone.rows) byKind[r.kind ?? '?'] = (byKind[r.kind ?? '?'] ?? 0) + 1;
  return byKind;
}
