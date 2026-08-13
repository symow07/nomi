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
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'nomi-int-'));
const out = join(dir, 'results.json');

const run = spawnSync(
  'npx',
  ['vitest', 'run', 'tests/integration/', '--reporter=json', `--outputFile=${out}`,
   '--reporter=default', ...process.argv.slice(2)],
  { stdio: 'inherit', encoding: 'utf8' },
);

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
