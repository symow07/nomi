import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

/**
 * A TEST NEVER WRITES INTO THE TREE THE OTHER TESTS ARE READING.
 *
 * 2026-09-27: one `npm run check` counted 2962 tests instead of 2960, and two
 * of them failed; the next runs were back to 2960. The cause was one test
 * writing into the repository while the others ran beside it:
 *
 *   - m45-image-wired's reachability probe wrote `tools/.probe-check.mjs`,
 *     ran it, and deleted it;
 *   - no-secret-in-argv builds two tests for every `tools/*.mjs` it finds at
 *     the moment it LOADS.
 *
 * Loaded inside that window, it gained two tests named after the probe. They
 * passed if the file was still there when they ran, and failed with ENOENT if
 * the probe had already cleaned up. Reproduced both ways: one run in twenty
 * counted 2962 naturally, and deleting the file between collection and
 * execution failed exactly those two.
 *
 * The rule: a file-system write in tests/ takes a COMPUTED path — a directory
 * made under the system's temporary directory — never a literal one. A literal
 * path is a path into the repository, relative or absolute, and the other test
 * files are reading it.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SELF = fileURLToPath(import.meta.url);

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|mjs|js)$/.test(f) ? [p] : [];
  });

/** A write whose first argument is a string literal: a path fixed in the source. */
const LITERAL_WRITE = /\b(writeFileSync|writeFile|appendFileSync|appendFile|rmSync|rm|rmdirSync|rmdir|unlinkSync|unlink|mkdirSync|mkdir|renameSync|rename|copyFileSync|copyFile|cpSync|cp|symlinkSync|symlink)\(\s*['"`]/;

const literalWrites = (src: string): string[] =>
  src.split('\n').flatMap((line, i) => (LITERAL_WRITE.test(line) ? [`${i + 1}: ${line.trim()}`] : []));

describe('tests leave the tree alone', () => {
  it('no file under tests/ writes to a literal path', () => {
    const bad = walk(join(ROOT, 'tests'))
      .filter((f) => f !== SELF)
      .flatMap((f) => literalWrites(readFileSync(f, 'utf8')).map((l) => `${relative(ROOT, f)}:${l}`));
    expect(bad, 'write under a temporary directory instead (mkdtempSync(join(tmpdir(), …)))').toEqual([]);
  });

  it('the rule sees the write that caused the phantom run — a probe written into tools/', () => {
    // The old probe, as it stood: writes inside a script string passed to node -e.
    const old = [
      "      writeFileSync('tools/.probe-check.mjs', s);",
      "      writeFileSync('tools/.probe-entry.ts', 'export const nothing = 1;\\n');",
      "        `import {rmSync} from 'node:fs'; rmSync('tools/.probe-check.mjs',{force:true});`]);",
    ].join('\n');
    expect(literalWrites(old)).toHaveLength(3);
    // …and lets a computed one through.
    expect(literalWrites('    writeFileSync(check, probe);\n    rmSync(dir, { recursive: true, force: true });')).toEqual([]);
  });
});
