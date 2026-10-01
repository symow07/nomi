import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The integration suite's hooks outlast the production composition's graceful
 * stop (tools/run-integration.mjs explains; found 2026-09-28 when
 * meta-messaging's `afterAll` timed out with every test green). pg-boss waits
 * up to 30 s for a running job when `stop()` is called with its defaults.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p: string) => readFileSync(`${ROOT}${p}`, 'utf8');

describe('an integration hook outlasts a graceful stop', () => {
  it('the runner gives hooks more than pg-boss 30 s graceful timeout, and passes it to vitest', () => {
    const runner = read('tools/run-integration.mjs');
    const ms = Number(/const HOOK_TIMEOUT_MS = ([\d_]+);/.exec(runner)?.[1]?.replace(/_/g, ''));
    expect(ms).toBeGreaterThan(30_000);
    expect(runner).toContain('`--hookTimeout=${HOOK_TIMEOUT_MS}`');
  });

  it('close stops pg-boss with its defaults, so 30 s is the bound the hook must outlast', () => {
    expect(read('src/main.ts')).toContain('await boss.stop().catch(() => {});');
  });
});

describe('the tools the suite runs are built from the code under test', () => {
  it('the runner builds before the suite, and a failed build fails the run', () => {
    const runner = read('tools/run-integration.mjs');
    const build = runner.indexOf("spawnSync('npm', ['run', 'build']");
    expect(build).toBeGreaterThan(-1);
    expect(build).toBeLessThan(runner.indexOf("['vitest', 'run', 'tests/integration/'"));
    expect(runner).toContain('if (built.status !== 0) {');
  });
});
