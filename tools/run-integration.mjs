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

let report;
try {
  report = JSON.parse(readFileSync(out, 'utf8'));
} catch {
  rmSync(dir, { recursive: true, force: true });
  console.error('\n  ✗ the integration suite produced no report — treating as a failure');
  process.exit(1);
}
rmSync(dir, { recursive: true, force: true });

const total = report.numTotalTests ?? 0;
const passed = report.numPassedTests ?? 0;
const failed = report.numFailedTests ?? 0;
const skipped = (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0);

if (failed > 0 || run.status !== 0) {
  console.error(`\n  ✗ integration: ${failed} failed of ${total}`);
  process.exit(1);
}

if (skipped > 0) {
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
  process.exit(1);
}

console.log(`\n  ✓ integration: ${passed} of ${total} ran, none skipped`);
