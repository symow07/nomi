import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * A SMOKE TEST THAT ALWAYS STOPS IS WORSE THAN NONE (the owner, 2026-10-13). `smoke.sh` asked `/app/employee` for the
 * assistant's page; the page had moved to Settings and the old address only redirected, so `get` (which does not
 * follow) saw a 302 and every run stopped there. This holds the script to the app as it is: every page it checks is
 * an address that renders, never one left behind to redirect.
 */

const SMOKE = readFileSync('.claude/skills/run-nomi/smoke.sh', 'utf8');
const APP = readFileSync('src/api/web/app.ts', 'utf8');
const LAYOUT = readFileSync('src/api/web/layout.ts', 'utf8');

/** The GET routes whose whole handler is a redirect: an address something moved away from. */
function redirectOnly(): Set<string> {
  const consts = new Map<string, string>();
  for (const src of [APP, LAYOUT]) for (const m of src.matchAll(/(?:export )?const ([A-Z_]+) = '([^']+)'(?: \+ '([^']+)')?;/g)) consts.set(m[1]!, m[2]! + (m[3] ?? ''));
  const out = new Set<string>();
  const regs = [...APP.matchAll(/\n {2}app\.get\(([^,]+),/g)];
  regs.forEach((m, i) => {
    const body = APP.slice(m.index!, regs[i + 1]?.index ?? m.index! + 4000);
    const renders = /\.send\(|bodyHtml|authed\(|ownerPage\(|render[A-Z]|page\(req/.test(body);
    if (renders || !/redirect\(/.test(body)) return;
    const arg = m[1]!.trim();
    const path = arg.startsWith("'") ? arg.slice(1, -1) : consts.get(arg);
    if (path) out.add(path);
  });
  return out;
}

/** Every address the script checks: `get <path> …` and the doors its loop opens. */
const smokePaths = (): string[] => [
  ...[...SMOKE.matchAll(/^\s*get\s+(\/\S*)/gm)].map((m) => m[1]!),
  ...[...SMOKE.matchAll(/[\w-]+\.html:(\/[^\s;]+)/g)].map((m) => m[1]!),
];

describe('the smoke script checks the app as it is', () => {
  it('finds the redirects it must avoid (the old assistant address among them) and the pages it checks', () => {
    expect(redirectOnly()).toContain('/app/employee');
    expect(smokePaths()).toContain('/app/settings/assistant');
    expect(smokePaths().length).toBeGreaterThan(8);
  });

  it('no page the script checks is an address that only redirects', () => {
    const moved = redirectOnly();
    expect(smokePaths().filter((p) => moved.has(p)), 'smoke would stop on a 302 here').toEqual([]);
  });
});
