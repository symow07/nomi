import type { Reporter, TestModule } from 'vitest/node';

/**
 * Say out loud how much of the suite did not run.
 *
 * `npm run check` printing green means two different things depending on
 * whether DATABASE_URL was set, and nothing said which one you got. 223 of 1294
 * assertions — 17% — only run against real Postgres, and they are not a
 * peripheral 17%: RLS tenant isolation, the activation and rollback drills, and
 * refusal visibility over real data. Every milestone this month was signed off
 * on the weaker green without the sign-off ever saying so.
 *
 * This is the `ownerCodeStable` / `credentialKeyStable` pattern applied to the
 * test suite itself: report the ABSENCE rather than let silence read as
 * presence. It fails nothing and blocks nothing — a developer without a
 * database is not locked out, only told what they did not just prove.
 *
 * The count is DERIVED from the run. A transcribed "223" would be wrong the
 * first time anyone adds an integration test, and stale numbers presented as
 * current are the bug this whole line of work exists to remove.
 */
export default class SkippedReporter implements Reporter {
  onTestRunEnd(testModules: ReadonlyArray<TestModule>): void {
    let skipped = 0;
    let total = 0;
    const files = new Set<string>();
    for (const mod of testModules) {
      for (const test of mod.children.allTests()) {
        total += 1;
        if (test.result().state === 'skipped') {
          skipped += 1;
          files.add(mod.moduleId);
        }
      }
    }
    if (skipped === 0) return;

    // Only the database-gated suites get the DATABASE_URL advice, because only
    // they are unlocked by it. A test skipped for any other reason is somebody
    // else's message to write, and claiming a variable would run it would be
    // the same false instruction as the incident runbook's kill switch.
    const dbGated = [...files].some((f) => f.includes('/tests/integration/'));
    const hint = dbGated
      ? ' — set DATABASE_URL to include them'
      : '';
    const noun = skipped === 1 ? 'assertion' : 'assertions';
    console.log(`\n  ${skipped} ${noun} did not run${hint} (${total - skipped} of ${total} ran)`);
  }
}
