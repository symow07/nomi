import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * B (the owner, 2026-10-16): CI on pull requests and nightly on main, not on every push to main; the repeatability
 * pass (M22) nightly; and the merge script, not GitHub's branch protection (a private repo on GitHub Free has none),
 * is what makes a PR's green run the tree that lands: it refuses a PR not based on main's current head.
 */
const read = (p: string) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8');

describe('B · when CI runs', () => {
  const ci = read('.github/workflows/ci.yml');
  const on = ci.slice(ci.indexOf('\non:'), ci.indexOf('\nconcurrency:'));

  it('on pull requests, nightly, and by hand — never on a push to main', () => {
    expect(on).toMatch(/pull_request:\s*\n\s*branches: \[main\]/);
    expect(on).toMatch(/schedule:\s*\n\s*- cron: '41 4 \* \* \*'/);
    expect(on).toContain('workflow_dispatch:');
    expect(on).not.toMatch(/^\s*push:/m);
  });

  it('every run runs the suite once; the second pass (M22) is nightly and by hand only', () => {
    const steps = ci.split('\n');
    const first = steps.findIndex((l) => l.includes('- name: Integration suite') && !l.includes('again'));
    const again = steps.findIndex((l) => l.includes('- name: Integration suite, again'));
    expect(first).toBeGreaterThan(0);
    expect(steps[first + 1]).toContain('run: node tools/run-integration.mjs');
    expect(steps[again + 1]).toContain("if: github.event_name != 'pull_request'");
    expect(steps[again + 2]).toContain('run: node tools/run-integration.mjs');
  });
});

describe('B · the merge script is the requirement', () => {
  const gate = read('tools/gated-merge.sh');

  it('is in the repo and runnable, and CLAUDE.md says never to merge on github.com', () => {
    expect(statSync(fileURLToPath(new URL('../../tools/gated-merge.sh', import.meta.url))).mode & 0o111).not.toBe(0);
    expect(read('CLAUDE.md')).toContain('**Never merge on github.com; always through `tools/gated-merge.sh`**');
  });

  it('refuses, loudly and with exit 3, a PR not based on main\'s current head — asked before the checks and again right before the merge', () => {
    expect(gate).toContain('compare/main...$sha');
    expect(gate).toContain('.behind_by');
    expect(gate).toContain('REFUSED — #$pr is NOT based on main\'s current head. Nothing was merged.');
    expect(gate.match(/until based_on_main; do/g)).toHaveLength(2);
    expect(gate).toMatch(/\[ \$rc -eq 3 \] && exit 3/);
  });

  it('merges only on at least two checks on that exact SHA, all completed and green', () => {
    expect(gate).toContain('[ "$seen" -ge 2 ] && [ "$ok" = "$seen" ]');
    expect(gate).toContain('--match-head-commit "$sha"');
  });

  it('a failed GitHub call is never read as "no checks": its error is kept, not thrown away', () => {
    expect(gate).not.toContain('2>/dev/null)"');
    expect(gate).toContain('GitHub did not answer (rc=$rc)');
  });
});
