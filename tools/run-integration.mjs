#!/usr/bin/env node
/**
 * Run the integration suite, and FAIL if any of it was skipped.
 *
 * THE BUG THIS EXISTS FOR. `npx vitest run tests/integration/` exits 0 when
 * tests are SKIPPED, and every file in that directory self-skips on a missing
 * DATABASE_URL (`const d = DATABASE_URL ? describe : describe.skip`). So if that
 * variable were ever unset, renamed, or pointed at an unreachable host, CI would
 * print a green check having run ZERO of them — RLS tenant isolation, the boot
 * guards, the send path, activation, promotion, demotion. Roughly a fifth of the
 * suite, and the fifth that cannot run anywhere else.
 *
 * A run that skipped everything must not be distinguishable from a run that
 * failed. It is the same defect as every other one this month: a green check
 * that means something different from what it appears to mean.
 *
 * ZERO SKIPPED, not "at least N". A minimum count is a transcribed number, and
 * a transcribed number drifts — this repo has been bitten by that nine times.
 * Zero stays correct as the suite grows.
 *
 * Run: node tools/run-integration.mjs [extra vitest args]
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { toolClient } from './lib/db.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'nomi-int-'));
const out = join(dir, 'results.json');

/**
 * ONE FILE AT A TIME. G2b — several files build the whole PRODUCTION
 * composition (`buildProduction`), and each starts a real pg-boss worker on the
 * one database. Their queues are the same queues, so with files in parallel a
 * job enqueued by one file's webhook could be taken by ANOTHER file's worker —
 * built with different adapters, media ports and models. The first test that
 * waited for a voice note to be answered found it answered by the wrong
 * process. Production runs exactly one worker per database; this makes the
 * suite do the same. The suite is small enough that the cost is seconds.
 */
/**
 * TAKE BACK WHAT EARLIER RUNS LEFT, before this one starts.
 *
 * Every run seeds its own tenant (`seedRunTenant`) plus a business or two per
 * file, and nothing took them away again — a development database grew by
 * about thirty tenants a run, forever. It reached 1,432 businesses here, and
 * the cost is not disk: the minute sweep walks live businesses, so a fat
 * database makes this suite slower and eventually fails whole FILES on a
 * budget that has nothing to do with what they test.
 *
 * BEFORE, not after, and on purpose. A run that crashed or was interrupted
 * still gets cleaned next time, and the tenant a FAILING test left behind
 * survives until you choose to run again — which is exactly when you want to
 * look at it. The same reason the report below is kept on failure.
 *
 * It refuses any host that is not local unless forced, and never touches the
 * demo factory or the sandbox.
 */
if (process.env['MIGRATE_DATABASE_URL'] && !process.argv.includes('--no-prune')) {
  spawnSync('node', ['tools/prune-test-tenants.mjs'], { stdio: 'inherit', encoding: 'utf8' });
}

/**
 * THE SUITE LEAVES THE SCHEMA AS THE MIGRATIONS MADE IT (found 2026-09-30).
 *
 * THE BUG THIS EXISTS FOR. money-currency.test.ts drops a currency check to
 * force a row the code cannot read, and put back a check of its own — USD
 * only — after 0092 had widened it. Every later file met a database that
 * refused dirhams, and the failures they showed looked like the currency
 * work's. Where rows in other currencies already existed, the re-add failed
 * instead and the check was simply gone: the files after it passed against a
 * database with no check at all. Either way a test changed what every other
 * test ran against, and nothing said so.
 *
 * So every constraint in the schemas the app uses is read before the suite and
 * again after it; a difference fails the run and names it. A test may change
 * the schema only if it puts it back exactly.
 */
const SCHEMA_SQL = `
  select n.nspname || '.' || c.conrelid::regclass::text || ' ' || c.conname || ' ' || pg_get_constraintdef(c.oid) as line
    from pg_constraint c join pg_namespace n on n.oid = c.connamespace
   where n.nspname in ('public', 'shadow') and c.conrelid <> 0
   order by 1`;
async function constraints() {
  const url = process.env['MIGRATE_DATABASE_URL'];
  if (!url) return null;
  const client = toolClient(url, { replyTimeoutMs: 60_000 });
  try {
    await client.connect();
    return (await client.query(SCHEMA_SQL)).rows.map((r) => r.line);
  } finally {
    await client.end().catch(() => {});
  }
}
const schemaBefore = await constraints();

/**
 * A HOOK OUTLASTS A GRACEFUL STOP. Most files end with `await prod.close()`,
 * and close stops pg-boss gracefully: it waits — up to pg-boss's own 30 s — for
 * a job already running to finish (a buyer's turn, the minute's sweep). The
 * suite gave that hook vitest's default 10 s, so whether a file passed
 * depended on whether a job happened to be in flight when it ended: found
 * 2026-09-28, meta-messaging's `afterAll` timing out with all thirteen of its
 * tests green, after its buyer's turn started a moment before close. The stop
 * is right to wait; the hook was too short. 45 s covers the 30 s bound.
 */
const HOOK_TIMEOUT_MS = 45_000;

/**
 * THE OPERATOR TOOLS RUN FROM `dist/`, AS THEY DO IN PRODUCTION (found
 * 2026-10-01). A few files run a tool for real (`workspaces.mjs --funnel`,
 * `acceptance-check.mjs`), and those import the compiled app. CI's integration
 * job never built it, so they failed there with "Cannot find module
 * dist/db/client.js"; here, an old `dist/` would have let them pass against
 * code that is no longer the code under test. Built once, before the suite,
 * every run: a build that fails is a failed run.
 */
const built = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', encoding: 'utf8' });
if (built.status !== 0) {
  console.error('\n  ✗ integration: the build failed, so the tools the suite runs have nothing to run');
  process.exit(1);
}

const run = spawnSync(
  'npx',
  ['vitest', 'run', 'tests/integration/', '--no-file-parallelism', `--hookTimeout=${HOOK_TIMEOUT_MS}`,
   '--reporter=json', `--outputFile=${out}`,
   '--reporter=default', ...process.argv.slice(2).filter((a) => a !== '--no-prune')],
  { stdio: 'inherit', encoding: 'utf8' },
);

// Read right after the run, whatever it did: a changed schema is most worth
// seeing on the run whose failures it caused.
const schemaAfter = schemaBefore === null ? null : await constraints();
const schemaDrift = schemaBefore !== null && schemaAfter !== null
  ? { gone: schemaBefore.filter((l) => !schemaAfter.includes(l)), added: schemaAfter.filter((l) => !schemaBefore.includes(l)) }
  : { gone: [], added: [] };
if (schemaDrift.gone.length > 0 || schemaDrift.added.length > 0) {
  console.error('\n  ✗ integration: the suite left the schema different from what it found');
  for (const l of schemaDrift.gone) console.error(`      before: ${l}`);
  for (const l of schemaDrift.added) console.error(`      after:  ${l}`);
  console.error('    A test changed a constraint and did not put it back exactly; every file after it ran against that.');
}

/**
 * THE REPORT SURVIVES A FAILURE. It is deleted on SUCCESS only.
 *
 * THE BUG THIS EXISTS FOR, and it is this file's own. The report was deleted
 * unconditionally, before the exit code was even decided. A run during M43b
 * printed `1 failed of 283` and the record of WHICH test failed was gone by the
 * time the message reached the screen. Three later runs were green; the failure
 * has never been explained and now cannot be.
 *
 * It is the same shape as the `>/dev/null 2>&1` that hid a render script's
 * failure last week, and as the skipped-suite defect this tool was written to
 * catch: something configured not to look, at the exact moment there was
 * something to see. A tool that destroys its own evidence on the one run that
 * produced any is worse than no tool, because it looks like diligence.
 */
const keep = (why) => {
  console.error(`\n    the report was KEPT so this can be read:\n      ${out}\n      (${why})`);
};

let report;
try {
  report = JSON.parse(readFileSync(out, 'utf8'));
} catch {
  console.error('\n  ✗ the integration suite produced no report — treating as a failure');
  // Nothing parseable to keep, but the directory may hold a partial write.
  keep('unparseable or absent — the raw file, if vitest wrote one');
  process.exit(1);
}

const total = report.numTotalTests ?? 0;
const passed = report.numPassedTests ?? 0;
const failed = report.numFailedTests ?? 0;
const skipped = (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0);

if (schemaDrift.gone.length > 0 || schemaDrift.added.length > 0) {
  keep('the schema changed during the run');
  process.exit(1);
}

if (failed > 0 || run.status !== 0) {
  console.error(`\n  ✗ integration: ${failed} failed of ${total}`);
  // Name them here too. The console output above scrolls; this does not, and a
  // CI log is often all anyone has.
  for (const file of report.testResults ?? []) {
    for (const t of file.assertionResults ?? []) {
      if (t.status !== 'failed') continue;
      console.error(`      ${file.name?.split('/').slice(-2).join('/') ?? '?'} › ${t.fullName ?? t.title}`);
      const first = (t.failureMessages ?? [])[0];
      if (first) console.error(`        ${first.split('\n')[0]}`);
    }
  }
  keep('failed tests, with their messages');
  process.exit(1);
}

if (skipped > 0) {
  keep('skipped tests');
  console.error(
    `\n  ✗ integration: ${skipped} of ${total} tests were SKIPPED — this is a failure, not a pass.\n` +
    '    These files self-skip when DATABASE_URL is missing or unusable, so a skipped\n' +
    '    run proves nothing about RLS isolation, the send path, or the boot guards.\n' +
    '    Check that DATABASE_URL is set and the database is reachable.',
  );
  process.exit(1);
}

// A suite that ran nothing at all is the same failure wearing a different hat.
if (total === 0 || passed === 0) {
  console.error('\n  ✗ integration: no tests ran at all');
  keep('a report with no tests in it');
  process.exit(1);
}

// The only path that deletes it: everything ran and everything passed.
rmSync(dir, { recursive: true, force: true });
console.log(`\n  ✓ integration: ${passed} of ${total} ran, none skipped`);
