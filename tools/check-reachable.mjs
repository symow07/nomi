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

/** Where the servers start. */
const SERVER_ENTRYPOINTS = ['src/main.ts', 'src/worker/main.ts'];

/**
 * The npm scripts are entrypoints too.
 *
 * `npm run seed:demo` reaches src/demo/factory.ts and src/demo/trust.ts through
 * a `tsx -e` snippet, which no import-graph walk can see. They were reported as
 * dead for a whole inventory before anyone noticed — a checker with a blind spot
 * is exactly what this checker exists to prevent — so the roots are DERIVED from
 * the scripts rather than listed by hand.
 *
 * It matches an IMPORT of a src path, not a mention of one: the first version
 * matched any quoted 'src/....ts' and read this file's own exemption list as
 * entrypoints, declaring every exempt module reachable.
 */
function scriptEntrypoints() {
  if (!existsSync('tools')) return [];
  const out = new Set();
  for (const f of readdirSync('tools')) {
    if (!f.endsWith('.mjs')) continue;
    const src = readFileSync(join('tools', f), 'utf8');
    for (const m of src.matchAll(/import\s*(?:\{[^}]*\}|[\w*\s,]+)\s*from\s*['"`][^'"`]*?(src\/[A-Za-z0-9_./-]+\.ts)['"`]/g)) {
      if (existsSync(m[1])) out.add(m[1]);
    }
  }
  return [...out];
}

/** Where production starts. Nothing else counts as a root. */
const ENTRYPOINTS = [...SERVER_ENTRYPOINTS, ...scriptEntrypoints()];

/**
 * Directories whose modules must be reachable: ALL of src/, as of M34.8.
 *
 * It began as three, because that is where the bug had been caught twice. Then
 * an inventory over the whole tree found 39 unreachable modules — a kill switch
 * the incident runbook told operators to throw, a promotion ladder with no
 * producer, and 27 modules superseded years ago and never deleted. Enforcing
 * three directories while the other twelve rotted was itself a check pointed at
 * the wrong artifact.
 */
const WIRED_DIRS = ['src'];

/**
 * Declared gaps. Each is a decision someone made on purpose, with the reason
 * written down. Adding to this list should feel like an admission.
 *
 * NOT a dumping ground: a module here is not shipped, and the reason must say
 * when it becomes reachable or why it never will.
 */
const DECLARED_UNWIRED = {
  // ── Permanent, by construction ──────────────────────────────────────────
  'src/channels/whatsapp/simulator.ts':
    'NEVER EXPIRES. Local development only, by construction — its factory throws if NODE_ENV is production, so being unreachable from production is the guarantee, not the gap.',
  'src/core/ops/perf.ts':
    'NEVER EXPIRES. A constants table whose only consumer is a test: m8-ops.test.ts measures quote-compute against it in CI. Not a module waiting to be wired — data the suite reads. The doc claim that a device enforces it was corrected in M34.8; there is no device build.',

  // ── Expire at a named milestone ─────────────────────────────────────────
  'src/core/commerce/invoice.ts':
    'EXPIRES AT M46. docs/ROADMAP.md M46 ("After the order") names this file: "confirmable.ts and invoice.ts exist; the trail stops at confirmation". Built early, deliberately unwired until the milestone that needs it.',
  'src/core/conversation/batching.ts':
    'EXPIRES AT META GO-LIVE. docs/ASSUMPTIONS.md P1: buyers send four fragments in ten seconds, and debounce-and-batch must be built BEFORE shadow traffic. Messaging is off, so this is not yet a defect; the day real buyers arrive it is one. message_fragments (0009) exists with no writer.',

  // ── Decisions not yet made. Each is a question with a deadline ──────────
  'src/core/trust/editScope.ts':
    'DECISION PENDING. Held to see whether it could weigh spot-check evidence by edit size; on inspection it classifies the SCOPE of what an edit teaches (one_time / buyer / product / style / policy), not the SIZE of an edit, and every input it needs is a signal nothing derives. drafts.status plus a draft_text/sent_text diff answers the size question directly. Wire it for edit LEARNING, or delete it.',
  'src/core/ops/degrade.ts':
    'DECISION PENDING. Two runbooks claimed this ladder engaged automatically during an LLM outage; M34.8 corrected them to what actually happens (SDK retries, the turn throws, pg-boss retries five times, dead-letters, alerts the owner). What it models — a night-shift hold ack, a five-minute owner alert — is better than what runs today. Wire it or delete it.',
  'src/core/budget.ts':
    'DECISION PENDING. The per-tenant budget gate was meant to run BEFORE the analyzer call, the expensive one. It never runs. Its pause rule is meanwhile re-implemented in SQL in db/channels.ts, whose own comment says so: the same rule in two places, one enforced and one merely tested. Wire the pre-call gate and delete the duplicate, or delete this and keep the SQL.',
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


// ── Symbol mode: which EXPORTS has nothing called? Report only, exit 0. ─────
//
// The last hole in "nothing half-wired", and the one every instance so far has
// slipped through: this checker measures MODULES. `security/credentials.ts` is
// reachable — the worker imports `redactSecrets` — while `encryptSecret` and
// `decryptSecret` have no caller anywhere in src/. channel_credentials is
// written and never read, and CREDENTIAL_KEY guards data nothing decrypts. A
// module-level walk cannot see that by construction.
//
// References are resolved from IMPORT BINDINGS, not by grepping for names: a
// name that merely appears in another file proves nothing, and this repo has
// been bitten by text-matching checks before.
if (process.argv.includes('--symbols')) {
  const files = walk('src').map((f) => relative('.', f));

  /** Named exports of a file, with their kind. Types are collected to be excluded. */
  const exportsOf = (file) => {
    const src = readFileSync(file, 'utf8');
    const out = [];
    const re = /^export\s+(?:declare\s+)?(async\s+)?(function|const|let|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm;
    for (const m of src.matchAll(re)) out.push({ name: m[3], kind: m[2] });
    // `export { a, b as c }` — the re-export/aggregate form.
    for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim();
        if (name && /^[A-Za-z_$][\w$]*$/.test(name)) out.push({ name, kind: 'const' });
      }
    }
    return out;
  };

  /** Every named binding a file imports, keyed by the resolved source file. */
  const importBindings = (file) => {
    const src = readFileSync(file, 'utf8');
    const pairs = [];
    const re = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"`](?:\$\{root\})?([^'"`]+)['"`]/g;
    for (const m of src.matchAll(re)) {
      const raw = m[2];
      if (!raw.startsWith('.') && !raw.includes('src/')) continue;
      const spec = raw.replace(/\.js$/, '.ts');
      let target = raw.includes('src/')
        ? normalize(spec.slice(spec.indexOf('src/')))
        : normalize(join(dirname(file), spec));
      if (!existsSync(target)) {
        const asIndex = normalize(join(dirname(file), m[2].replace(/\.js$/, ''), 'index.ts'));
        target = existsSync(asIndex) ? asIndex : target;
      }
      for (const part of m[1].split(',')) {
        const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]?.trim();
        if (name) pairs.push([relative('.', target), name]);
      }
    }
    return pairs;
  };

  // walk() is .ts-only, and tools/ is .mjs — scanning it with walk() would have
  // reported `sandboxSeedSql` as called by nothing when seed-sandbox.mjs calls
  // it. A blind spot in the tool that hunts blind spots.
  const walkAny = (dir) =>
    readdirSync(dir).flatMap((f) => {
      const q = join(dir, f);
      return statSync(q).isDirectory() ? walkAny(q) : /\.(ts|mjs|js)$/.test(q) ? [q] : [];
    });

  const usedBy = (roots) => {
    const seen = new Set();
    for (const dir of roots) {
      if (!existsSync(dir)) continue;
      for (const f of walkAny(dir)) for (const [target, name] of importBindings(f)) seen.add(`${target}::${name}`);
    }
    return seen;
  };

  const fromSrc = new Set();
  for (const f of files) for (const [t, n] of importBindings(f)) fromSrc.add(`${t}::${n}`);
  const fromTestsTools = usedBy(['tests', 'tools']);

  const testsOnly = [];
  const nothing = [];
  for (const file of files) {
    if (Object.hasOwn(DECLARED_UNWIRED, file)) continue;   // already declared, module-level
    if (!reachable.has(normalize(file))) continue;         // module-level check owns these
    for (const { name, kind } of exportsOf(file)) {
      if (kind === 'type' || kind === 'interface') continue;   // signatures dominate and mean nothing
      const key = `${file}::${name}`;
      if (fromSrc.has(key)) continue;
      // A symbol its OWN module still uses is internal machinery that happens to
      // be exported so a test can reach it — `PROMOTION_REQUIREMENTS` is read by
      // `promotionDecision` three lines down. That is not dead behaviour, and
      // including it buries the signal under eighty rows of noise.
      const body = readFileSync(file, 'utf8');
      const uses = [...body.matchAll(new RegExp(`\\b${name}\\b`, 'g'))].length;
      if (uses > 1) continue;
      (fromTestsTools.has(key) ? testsOnly : nothing).push(`${file}  ${name}  (${kind})`);
    }
  }

  const show = (title, rows) => {
    console.log(`\n${title} — ${rows.length}`);
    for (const r of rows.sort()) console.log(`  ${r}`);
  };
  console.log('SYMBOL REACHABILITY — exported functions/consts inside REACHABLE modules');
  console.log('that no other src/ file imports. Types and declared modules excluded.');
  show('REFERENCED BY tests/ OR tools/ ONLY  (the credentials.ts shape)', testsOnly);
  show('REFERENCED BY NOTHING AT ALL', nothing);

  /**
   * M35.3 — A RATCHET, NOT A ZERO.
   *
   * Zero is not reachable and pretending otherwise would make this unusable:
   * much of the tests-only list is legitimate test-consumed DATA
   * (BANNED_OWNER_TERMS, PROMOTION_REQUIREMENTS, the design budgets). What must
   * not happen is silent GROWTH, which is what a report-only mode allows.
   *
   * The ceiling lives in a committed baseline file rather than a number typed
   * into this script, so lowering it is a visible, reviewable edit — and the
   * numbers cannot drift from what was actually measured.
   */
  if (process.argv.includes('--ratchet')) {
    const baselinePath = 'tools/symbol-baseline.json';
    if (!existsSync(baselinePath)) {
      console.error(`\n  ✗ ${baselinePath} is missing — refusing to pass without a ceiling`);
      process.exit(1);
    }
    const base = JSON.parse(readFileSync(baselinePath, 'utf8'));
    let bad = 0;
    const check = (name, actual, ceiling) => {
      if (actual > ceiling) {
        console.error(`\n  ✗ ${name}: ${actual}, ceiling ${ceiling} — this list may shrink, never grow.`);
        console.error('    Wire the symbol, delete it, or lower the ceiling deliberately in ' + baselinePath);
        bad++;
      } else if (actual < ceiling) {
        console.log(`\n  ✓ ${name}: ${actual}, below the ceiling of ${ceiling} — lower it in ${baselinePath}`);
      } else {
        console.log(`\n  ✓ ${name}: ${actual}, at the ceiling`);
      }
    };
    check('referenced by tests/tools only', testsOnly.length, base.testsOnly);
    check('referenced by nothing', nothing.length, base.nothing);
    process.exit(bad ? 1 : 0);
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
