#!/usr/bin/env node
/**
 * Enforces the ONE architectural rule that matters (ADR-0002):
 *
 *   src/core/ is PURE. No I/O, no network, no clock, no randomness.
 *
 * This property is already accidentally true of the n8n Code nodes — it is the
 * only reason tools/test-logic.mjs can test them at all. We are not inventing
 * the boundary; we are refusing to lose it.
 *
 * A lint plugin would also work. This is 40 lines, has no config, and cannot
 * itself break — which is the right trade for a solo developer.
 *
 * Run: node tools/check-boundaries.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CORE = 'src/core';

/** core/ may import from these, and nothing else. */
const ALLOWED_IMPORT = /^(\.|zod$)/;

/** Impurities that make a function untestable and non-deterministic. */
const BANNED = [
  [/\bDate\.now\(/, 'Date.now() — inject a clock via PureDeps'],
  [/\bnew Date\((?!\s*[\w.'"])/, 'new Date() with no argument — inject a clock'],
  [/\bMath\.random\(/, 'Math.random() — inject an id generator'],
  [/\bprocess\.env\b/, 'process.env — pass config in as an argument'],
  [/\bfetch\(/, 'fetch() — core does no I/O'],
  [/\bconsole\.(log|error|warn)\(/, 'console.* — core returns values, it does not print'],
];

const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });

let violations = 0;
const fail = (file, line, msg) => {
  console.error(`  ✗ ${file}:${line}  ${msg}`);
  violations++;
};

for (const file of walk(CORE)) {
  const lines = readFileSync(file, 'utf8').split('\n');

  lines.forEach((line, i) => {
    const n = i + 1;

    const imp = line.match(/from\s+['"]([^'"]+)['"]/);
    if (imp?.[1] && !ALLOWED_IMPORT.test(imp[1])) {
      fail(file, n, `core/ must not import "${imp[1]}" — it would stop being pure`);
    }

    if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) return;
    for (const [re, msg] of BANNED) {
      if (re.test(line)) fail(file, n, msg);
    }
  });
}

if (violations === 0) {
  console.log(`  ✓ ${CORE} is pure — no I/O, no clock, no randomness, no outside imports`);
}
process.exit(violations ? 1 : 0);
