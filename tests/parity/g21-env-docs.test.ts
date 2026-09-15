import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';

/**
 * G21 — the environment documentation matches the environment.
 *
 * `docs/env-checklist.md` opens by promising "everything the running process
 * reads". It was true when it was written and then quietly stopped being: the
 * `PORT` default said 8080 while `validateEnv` used 8787, and the three pool
 * settings in `.env.example` appeared in no table at all. A checklist that is
 * wrong about the port is worse than no checklist, because an operator checks
 * it instead of the code.
 *
 * So the promise is now enforced: every `process.env` name in `src/` must
 * appear in the checklist. Not the other way round — the file also documents
 * `MIGRATE_DATABASE_URL`, which the app deliberately never reads.
 */

const SRC = new URL('../../src/', import.meta.url);

async function envNames(dir = SRC): Promise<ReadonlySet<string>> {
  const found = new Set<string>();
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const at = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) for (const n of await envNames(at)) found.add(n);
    else if (entry.name.endsWith('.ts')) {
      const src = await readFile(at, 'utf8');
      for (const m of src.matchAll(/process\.env\[?['"]([A-Z][A-Z0-9_]{2,})['"]\]?/g)) found.add(m[1]!);
      // `intEnv('DATABASE_POOL_MAX', 10)` — read through a helper, still read.
      for (const m of src.matchAll(/intEnv\(\s*'([A-Z][A-Z0-9_]{2,})'/g)) found.add(m[1]!);
    }
  }
  return found;
}

describe('G21 · the checklist knows what the code reads', () => {
  it('every environment variable src/ reads is in docs/env-checklist.md', async () => {
    const doc = await readFile(new URL('../../docs/env-checklist.md', import.meta.url), 'utf8');
    const missing = [...await envNames()].filter((n) => !doc.includes(n)).sort();
    expect(missing, `undocumented environment variables:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('and .env.example offers the ones an operator must set by hand', async () => {
    const example = await readFile(new URL('../../.env.example', import.meta.url), 'utf8');
    // The four that have no safe default: the deployment serves nobody without
    // them, or serves the wrong factory.
    for (const name of ['DATABASE_URL', 'ANTHROPIC_API_KEY', 'PILOT_BUSINESS_ID', 'OWNER_ACCESS_CODE']) {
      expect(example, `${name} is not in .env.example`).toContain(`${name}=`);
    }
  });

  it('the PORT default is one number, and both files say the same one', async () => {
    const main = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8');
    const fromCode = /PORT[^\n]*\|\|\s*(\d{2,5})/.exec(main)?.[1];
    expect(fromCode, 'validateEnv no longer defaults PORT the way this test reads it').toBeTruthy();
    const doc = await readFile(new URL('../../docs/env-checklist.md', import.meta.url), 'utf8');
    expect(doc).toContain(`| \`PORT\` | \`${fromCode}\` |`);
    // …and the "verifying" curl at the bottom points at the same port.
    expect(doc).toContain(`http://localhost:${fromCode}/health`);
  });
});
