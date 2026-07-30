import { describe, it, expect, beforeAll } from 'vitest';
import { SCENARIOS } from '../../src/trust/scenarios.js';
import { runAll, formatReport, type HarnessReport } from './runner.js';

/**
 * M12.1 — The trust gate.
 *
 * This test IS the safety harness: it runs every golden scenario through the
 * real production pipeline and asserts every declared trust invariant holds.
 * It is part of `npm run check`, so a regression that lets the AI quote below
 * the floor, invent a certification, skip a human handoff, or silently
 * escalate a draft to an auto-send fails CI. Also runnable on its own via
 * `npm run trust`, which prints the report below.
 */

describe('M12.1 · Trust Harness', () => {
  let report: HarnessReport;

  beforeAll(async () => {
    report = await runAll(SCENARIOS);
    // The report is the deliverable — always print it, pass or fail.
    // eslint-disable-next-line no-console
    console.log('\n' + formatReport(report) + '\n');
  });

  it('covers all seven required trust areas', () => {
    const categories = new Set(SCENARIOS.map((s) => s.category));
    for (const required of ['price', 'claims', 'handoff', 'unknown', 'unconfirmed', 'image', 'autonomy']) {
      expect(categories.has(required as never), `missing scenarios for: ${required}`).toBe(true);
    }
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(15);
  });

  it('every scenario declares at least one invariant', () => {
    for (const s of SCENARIOS) expect(s.expect.length, s.id).toBeGreaterThan(0);
  });

  it('every trust invariant holds across the golden set', () => {
    const failures = report.scenarios
      .filter((s) => !s.passed)
      .map((s) => `${s.id}: ` + s.checks.filter((c) => !c.pass).map((c) => `${c.invariant} — ${c.detail}`).join('; '));
    expect(failures, `\n${failures.join('\n')}\n`).toHaveLength(0);
    expect(report.failed).toBe(0);
  });

  // One assertion per scenario, so a failure names the exact case in the report.
  it.each(SCENARIOS.map((s) => [s.id] as const))('%s — invariants hold', async (id) => {
    const s = report.scenarios.find((r) => r.id === id)!;
    for (const c of s.checks) {
      expect(c.pass, `${id} · ${c.invariant}: ${c.detail}`).toBe(true);
    }
  });
});
