#!/usr/bin/env node
/**
 * Is every module that claims to be a feature actually REACHED?
 *
 * THE BUG THIS EXISTS FOR, twice over:
 *
 *   M27 — the prompt loader read from process.cwd(). Correct under the test
 *         runner, would have thrown on the first real buyer message.
 *   M34 — imageTurn.ts was written in M4, fully tested, and imported by
 *         nothing but its own test. A buyer's photo reached it never. The
 *         feature "existed" for months and the suite was green the whole time.
 *
 * Both are the same defect: a test proves a function WORKS; nothing proved it
 * was REACHED. `check-boundaries.mjs` already refuses to let core stop being
 * pure — this refuses to let a module stop being wired.
 *
 * THE RULE. Every module in a WIRED directory must be reachable from a
 * production entrypoint through a chain of non-test imports. A module reachable
 * only from tests/ is dead code claiming to be a feature.
 *
 * Deliberate gaps are allowed and must be DECLARED. An intentional gap is a
 * decision; an invisible one is the bug. Each entry carries the reason, so the
 * list is reviewable rather than a place things quietly accumulate.
 *
 * Run: node tools/check-reachable.mjs
 *      node tools/check-reachable.mjs --inventory   (report all of src/, exit 0)
 *
 * INVENTORY MODE reports every unreachable module in the whole tree without
 * enforcing anything. Enforcement covers WIRED_DIRS; the inventory exists to
 * find out what enforcement SHOULD cover, before deciding module by module.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';

/** Where production starts. Nothing else counts as a root. */
const ENTRYPOINTS = ['src/main.ts', 'src/worker/main.ts'];

/**
 * Directories whose modules must be reachable.
 *
 * `src/pipeline` is the one the bug lived in twice. `src/outbound` and
 * `src/channels` are included because they are the other two places where a
 * whole path can exist without a caller — but see OPTIONAL below: a channel
 * adapter that an installation may legitimately not use is a different thing
 * from a pipeline nobody calls.
 */
const WIRED_DIRS = ['src/pipeline', 'src/outbound', 'src/channels'];

/**
 * Declared gaps. Each is a decision someone made on purpose, with the reason
 * written down. Adding to this list should feel like an admission.
 *
 * NOT a dumping ground: a module here is not shipped, and the reason must say
 * when it becomes reachable or why it never will.
 */
const DECLARED_UNWIRED = {
  'src/channels/whatsapp/simulator.ts':
    'Local development only, by construction — its factory throws if NODE_ENV is production. Never reachable and never should be.',
  'src/channels/testflow.ts':
    'M4.5 FINDING, not a decision: the M3 five-check 测试连接 flow was superseded by testChannel() in api/web/channels.ts, which reads channel health instead and shares none of this code. Orphaned, still tested, sends to the owner\'s own number if ever revived. Delete it or wire it — do not leave it here indefinitely.',
};

const isTs = (p) => p.endsWith('.ts') && !p.endsWith('.d.ts');

const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : isTs(p) ? [p] : [];
  });

/** Every relative import in a file, resolved to a repo-relative .ts path. */
function importsOf(file) {
  const src = readFileSync(file, 'utf8');
  const out = new Set();
  // Covers `import … from './x.js'`, `export … from './x.js'`, and
  // `await import('./x.js')` — the lazy form is a real edge in this repo.
  const re = /(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g;
  for (const m of src.matchAll(re)) {
    const spec = m[1];
    // Source is ESM-with-.js-extensions compiled from .ts; map back.
    const asTs = spec.replace(/\.js$/, '.ts');
    const resolved = normalize(join(dirname(file), asTs));
    if (existsSync(resolved)) out.add(resolved);
    else {
      const asIndex = normalize(join(dirname(file), spec.replace(/\.js$/, ''), 'index.ts'));
      if (existsSync(asIndex)) out.add(asIndex);
    }
  }
  return [...out];
}

/** Everything reachable from the entrypoints, following non-test imports only. */
function reachableFrom(roots) {
  const seen = new Set();
  const queue = [...roots];
  while (queue.length) {
    const f = queue.pop();
    if (!f || seen.has(f)) continue;
    seen.add(f);
    for (const dep of importsOf(f)) if (!seen.has(dep)) queue.push(dep);
  }
  return seen;
}

const missingRoot = ENTRYPOINTS.find((e) => !existsSync(e));
if (missingRoot) {
  console.error(`  ✗ entrypoint ${missingRoot} does not exist — fix this file, not the code`);
  process.exit(1);
}

const reachable = reachableFrom(ENTRYPOINTS);

// ── Inventory mode: report the whole tree, enforce nothing, exit 0. ──────────
if (process.argv.includes('--inventory')) {
  const all = walk('src').map((f) => relative('.', f)).sort();
  const dead = all.filter((f) => !reachable.has(normalize(f)));
  const byDir = new Map();
  for (const f of dead) {
    const d = dirname(f);
    byDir.set(d, [...(byDir.get(d) ?? []), f]);
  }
  console.log(`INVENTORY — ${all.length} modules under src/, ${all.length - dead.length} reachable, ${dead.length} NOT reachable\n`);
  for (const [dir, files] of [...byDir].sort()) {
    console.log(`${dir}/`);
    for (const f of files) {
      const declared = Object.hasOwn(DECLARED_UNWIRED, f) ? '  [declared]' : '';
      const enforced = WIRED_DIRS.some((d) => f.startsWith(`${d}/`)) ? ' [enforced dir]' : '';
      console.log(`  ${f.slice(dir.length + 1)}${declared}${enforced}`);
    }
  }
  process.exit(0);
}

let violations = 0;
const declaredButReachable = [];

for (const dir of WIRED_DIRS) {
  if (!existsSync(dir)) continue;
  for (const file of walk(dir)) {
    const key = relative('.', file);
    const declared = Object.hasOwn(DECLARED_UNWIRED, key);
    if (reachable.has(normalize(file))) {
      // A declared gap that is now wired is stale bookkeeping — the list must
      // shrink when the code catches up, or it stops meaning anything.
      if (declared) declaredButReachable.push(key);
      continue;
    }
    if (declared) continue;
    console.error(`  ✗ ${key}  is imported by no production path — reachable only from tests`);
    violations++;
  }
}

for (const key of declaredButReachable) {
  console.error(`  ✗ ${key}  is declared unwired but IS reachable — remove it from DECLARED_UNWIRED`);
  violations++;
}

if (violations === 0) {
  const n = [...reachable].filter(isTs).length;
  console.log(`  ✓ every module in ${WIRED_DIRS.join(', ')} is reached from production (${n} modules live)`);
}
process.exit(violations ? 1 : 0);
