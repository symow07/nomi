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
const listed = (name: string): string[] => {
  const body = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\];`).exec(read('tools/lib/books-blockers.mjs'))?.[1] ?? '';
  return [...body.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]!.replace(/\\'/g, "'"));
};
const blockers = (): string[] => listed('BLOCKERS');

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

  it('the tool and the checklist are one list: the public pages (E1, 2026-10-22, built the papers copy, and it left)', () => {
    const list = blockers();
    expect(list).toHaveLength(1);
    const section = /## Before the books are switched on for ANY workspace — BLOCKING[\s\S]*?(?=\n## )/.exec(read('docs/LAUNCH-CHECKLIST.md'))?.[0] ?? '';
    expect(section).toContain('tools/books-area.mjs');
    expect(section).not.toMatch(/The owner's copy of their papers, and closure of a workspace holding\s+papers\.\*\*/);
    expect(section).toMatch(/The public pages describe the books/);
    expect(list[0]).toMatch(/public pages/);
    expect(list.some((x) => /copy of their papers/.test(x))).toBe(false);
  });

  it('MOROCCO: nothing blocks since R2 — the FEC\'s name is a configurable default, none being published (the ICE, IF and RC left with E2, 0206)', async () => {
    const { blockersFor, MOROCCO_BLOCKERS } = await import(new URL('../../tools/lib/books-blockers.mjs', import.meta.url).href) as { blockersFor: (c: string | null) => string[]; MOROCCO_BLOCKERS: string[] };
    expect(MOROCCO_BLOCKERS).toEqual(listed('MOROCCO_BLOCKERS'));
    expect(blockersFor('MA')).toEqual([...blockers(), ...MOROCCO_BLOCKERS]);
    expect(blockersFor('ma')).toEqual(blockersFor('MA'));
    expect(blockersFor('FR')).toEqual(blockers());
    expect(blockersFor(null)).toEqual(blockers());
    expect(MOROCCO_BLOCKERS).toEqual([]);
    // the tool reads the workspace's country and refuses a Moroccan one with these, once connected
    expect(read('tools/books-area.mjs')).toMatch(/const owed = blockersFor\(biz\.country\);\s+if \(want === true && owed\.length > 0\)/);
    // and the refusal everyone gets today names no Moroccan item
    expect(run(['--business', BIZ, '--on']).err).not.toContain('And for a Moroccan workspace');
    const section = /## Before the books are switched on for a MOROCCAN workspace — BLOCKING[\s\S]*?(?=\n## )/.exec(read('docs/LAUNCH-CHECKLIST.md'))?.[0] ?? '';
    expect(section).toMatch(/~~The business's legal identifiers — ICE, IF and RC — held on its profile,[\s\S]*?~~ \*\*Done \(E2, 0206/);
    expect(section).toMatch(/~~\*\*The FEC named as the DGI requires\.\*\*~~ \*\*Closed \(R2, 0209/);
    expect(section).toContain("Nomi's default filename convention. Your\n  accountant may ask for a different one — you can change it here.");
    expect(section).toContain('tools/lib/books-blockers.mjs');
    // and what replaced it is real: the three stored, the ICE's fifteen positions held by the database itself
    expect(read('migrations/0206_business_identifiers.sql')).toMatch(/legal_ice ~ '\^\[\^\[:space:\]\]\{15\}\$'/);
  });

  it('what replaced it is real: a workspace holding papers closes only once the owner\'s own copy holds every one (0205)', () => {
    const m = read('migrations/0205_papers_copy.sql');
    expect(m).toMatch(/and not papers_export_covers\(p_business\) then\s+raise exception[\s\S]{0,300}?using errcode = 'NE012'/);
    expect(m).toMatch(/x\.made_by = 'owner' or exists \(select 1 from people p where p\.id::text = x\.made_by and p\.is_owner\)/);
  });
});
