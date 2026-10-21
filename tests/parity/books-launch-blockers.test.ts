import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * The books' launch blockers (the owner, 2026-10-22; docs/LAUNCH-CHECKLIST.md). While a workspace holding papers
 * cannot close, the books are switched on for nobody: `tools/books-area.mjs --on` refuses, before it connects, and
 * names what is still to build. The tool's list and the checklist's section are one list.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p: string) => readFileSync(`${ROOT}${p}`, 'utf8');
const BIZ = '00000000-0000-4000-8000-000000000001';
// Nothing listens here: a refusal that tried to connect first would say so.
const NOWHERE = 'postgresql://nobody@127.0.0.1:9/none';
const run = (args: string[]) => {
  const r = spawnSync(process.execPath, ['tools/books-area.mjs', ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: 30_000, env: { PATH: process.env['PATH'] ?? '', MIGRATE_DATABASE_URL: NOWHERE },
  });
  return { code: r.status, err: r.stderr };
};
const blockers = (): string[] => {
  const body = /const BLOCKERS = \[([\s\S]*?)\];/.exec(read('tools/books-area.mjs'))?.[1] ?? '';
  return [...body.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]!.replace(/\\'/g, "'"));
};

describe('the books are switched on for nobody while a launch blocker stands', () => {
  it('--on refuses before connecting, names every blocker, and changes nothing', () => {
    const r = run(['--business', BIZ, '--on']);
    expect(r.code).toBe(3);
    expect(r.err).toContain('Nothing was changed');
    expect(r.err).not.toMatch(/ECONNREFUSED|connect/i);
    for (const b of blockers()) expect(r.err).toContain(b);
  });

  it('--off is never blocked: hiding the books always works (it fails here only on the database nobody runs)', () => {
    expect(run(['--business', BIZ, '--off']).code).not.toBe(3);
  });

  it('the tool and the checklist are one list: the papers and the public pages', () => {
    const list = blockers();
    expect(list).toHaveLength(2);
    const section = /## Before the books are switched on for ANY workspace — BLOCKING[\s\S]*?(?=\n## )/.exec(read('docs/LAUNCH-CHECKLIST.md'))?.[0] ?? '';
    expect(section).toContain('tools/books-area.mjs');
    expect(section).toMatch(/The owner's copy of their papers, and closure of a workspace holding\s+papers/);
    expect(section).toMatch(/The public pages describe the books/);
    expect(list[0]).toMatch(/copy of their papers/);
    expect(list[1]).toMatch(/public pages/);
  });

  it('the refusal it rests on is real: a workspace holding papers does not close (0174)', () => {
    expect(read('migrations/0174_documents.sql')).toMatch(/NE011/);
  });
});
