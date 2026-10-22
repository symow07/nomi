import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * THE PINNED NODE, OR NOTHING RUNS (the owner, 2026-10-23). `.nvmrc` pins the Node that production (Railway's
 * Railpack reads it: #353 was built on 22.23.3) and CI (`node-version-file: .nvmrc`) run. The verification set ran
 * on whatever Node the shell found instead: Node 22 left this Mac on 2026-10-07, CLAUDE.md still named its path, and
 * a PATH pointing at a folder that is not there falls through, silently, to the next Node on it (24, then 26). A
 * check on another runtime proves nothing about the pinned one, so the runners stop instead, and say why.
 *
 * Called first by `npm run check`, `npm run trust`, tools/run-integration.mjs, tools/run-integration-isolated.mjs
 * and tools/pre-pilot.mjs. NOT by `build` or `start`: those are what Railway runs, and a guard of the checks must
 * never be what stops a deploy (Railway picks its Node from the same pin).
 */
const NVMRC = fileURLToPath(new URL('../../.nvmrc', import.meta.url));

/** Why `running` is not the Node `pin` names, or null when it is. "22" pins a major, "22.23" a minor. */
export function pinnedNodeProblem(running, pin) {
  const want = String(pin).trim().replace(/^v/, '');
  const have = String(running).trim().replace(/^v/, '');
  if (!/^\d+(\.\d+){0,2}$/.test(want)) return `.nvmrc says "${String(pin).trim()}", which is not a Node version`;
  const h = have.split('.');
  return want.split('.').every((part, i) => part === h[i]) ? null : `this is Node ${have}; .nvmrc pins ${want}`;
}

/** Stops the process, loudly, unless it runs on the pinned Node. */
export function requirePinnedNode(what) {
  const pin = readFileSync(NVMRC, 'utf8').trim();
  const problem = pinnedNodeProblem(process.versions.node, pin);
  if (problem === null) return;
  let installed = [];
  try { installed = readdirSync(join(homedir(), '.nvm', 'versions', 'node')).filter((v) => pinnedNodeProblem(v, pin) === null); } catch { /* no nvm */ }
  process.stderr.write([
    `✗ ${what}: NOT RUN. ${problem}.`,
    '  Production (Railway) and CI run the pinned Node; a run on another one proves nothing about them.',
    installed.length > 0
      ? `  Put it first on the PATH and run again:  PATH="$HOME/.nvm/versions/node/${installed.sort().pop()}/bin:$PATH"`
      : `  No Node ${pin} is installed under ~/.nvm: \`nvm install ${pin}\`, then put it first on the PATH.`,
    '',
  ].join('\n'));
  process.exit(1);
}
