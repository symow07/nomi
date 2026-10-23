import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — the operator tools, plain JS on purpose.
import { pinnedNodeProblem } from '../../tools/lib/pinned-node.mjs';

/**
 * The pinned Node, or nothing runs (the owner, 2026-10-23; tools/lib/pinned-node.mjs). Node 22 left this Mac on
 * 2026-10-07 and a PATH to its folder fell through, silently, to 24 and 26: the verification set ran on a runtime
 * neither production nor CI uses. The runners now stop, and say why.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (f: string) => readFileSync(`${ROOT}${f}`, 'utf8');
const problem = pinnedNodeProblem as (running: string, pin: string) => string | null;

describe('the verification set runs on the pinned Node, or not at all', () => {
  it('"22" pins the major: any 22 passes, 24 and 26 do not', () => {
    expect(problem('22.23.4', '22\n')).toBeNull();
    expect(problem('v22.0.0', '22')).toBeNull();
    expect(problem('24.20.0', '22')).toBe('this is Node 24.20.0; .nvmrc pins 22');
    expect(problem('26.8.1', '22')).toBe('this is Node 26.8.1; .nvmrc pins 22');
    expect(problem('2.23.4', '22')).not.toBeNull();
    expect(problem('22.23.4', '22.23')).toBeNull();
    expect(problem('22.22.0', '22.23')).not.toBeNull();
    expect(problem('22.23.4', 'lts/*')).toMatch(/not a Node version/);
  });

  it('the pin is the one production and CI read', () => {
    expect(read('.nvmrc').trim()).toBe('22');
    expect(read('.github/workflows/ci.yml')).toMatch(/node-version-file: \.nvmrc/);
    expect(JSON.parse(read('package.json')).engines.node).toBe('>=22 <23');
  });

  it('check and trust start with it; build and start never do (Railway runs those)', () => {
    const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>;
    expect(scripts['check']).toMatch(/^node tools\/require-node\.mjs "npm run check" && /);
    expect(scripts['trust']).toMatch(/^node tools\/require-node\.mjs "npm run trust" && /);
    expect(scripts['build']).not.toMatch(/require-node/);
    expect(scripts['start']).not.toMatch(/require-node/);
  });

  it('the integration runners and pre-pilot ask before they do anything', () => {
    // each file's first line of work, at the start of a line: the guard comes before it
    for (const [file, first] of [
      ['tools/run-integration.mjs', '\nconst dir = mkdtempSync('],
      ['tools/run-integration-isolated.mjs', '\nfor (const bin of ['],
      ['tools/pre-pilot.mjs', '\nconst argv = '],
    ] as const) {
      const src = read(file);
      const call = src.indexOf('\nrequirePinnedNode(');
      expect(call, file).toBeGreaterThan(0);
      expect(src.indexOf(first), file).toBeGreaterThan(call);
    }
  });

  it('CLAUDE.md names the Node that is installed and pinned', () => {
    const doc = read('CLAUDE.md');
    expect(doc).not.toContain('v22.23.2');
    expect(doc).toContain('v22.23.4');
  });
});
