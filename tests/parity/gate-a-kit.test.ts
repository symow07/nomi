import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * GATE A — the pilot kit names only what exists (docs/GATE-A-KIT.md, rewritten 2026-10-14). The July kit sent its
 * reader to a provider sandbox, a SQL editor, a page and a module that had all gone; this holds the new one to the
 * tree: every file it names is there, every page it sends the owner to is a route, every tool it runs is a tool.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const kit = readFileSync(`${ROOT}docs/GATE-A-KIT.md`, 'utf8');
const app = readFileSync(`${ROOT}src/api/web/app.ts`, 'utf8');
/** The web modules' named addresses (`export const ASSISTANT_HOME = '/app/settings/assistant'`), so a route registered by name counts. */
const NAMED = new Map([...readdirSync(`${ROOT}src/api/web`).filter((f) => f.endsWith('.ts'))
  .flatMap((f) => [...readFileSync(`${ROOT}src/api/web/${f}`, 'utf8').matchAll(/export const ([A-Z_]+) = '(\/[^']+)'/g)])]
  .map((m) => [m[2]!, m[1]!]));
const served = (path: string): boolean => app.includes(`app.get('${path}'`) || (NAMED.has(path) && app.includes(`app.get(${NAMED.get(path)},`));
const ticked = [...kit.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!);

describe('Gate A · the kit names only what exists', () => {
  it('every file and folder it names is in the tree', () => {
    // A ticked command names its tool first: `tools/pilot-log.mjs set --id <n> …` is the file tools/pilot-log.mjs.
    const paths = ticked.filter((s) => /^(docs|tools|src|tests|migrations)\//.test(s)).map((s) => s.split(/\s/)[0]!.replace(/[#:].*$/, ''));
    expect(paths.length).toBeGreaterThan(5);
    expect(paths.filter((p) => !existsSync(`${ROOT}${p}`))).toEqual([]);
  });

  it('every page it sends the owner to is a route the app serves', () => {
    const pages = ticked.filter((s) => /^\/(app|site)[/a-z_-]*$/.test(s));
    expect(pages.length).toBeGreaterThan(2);
    expect(pages.filter((p) => !served(p))).toEqual([]);
  });

  it('every command it runs names a tool that exists, run the way the tools are run', () => {
    const runs = [...kit.matchAll(/node (tools\/[a-z-]+\.mjs)/g)].map((m) => m[1]!);
    expect(runs).toContain('tools/pilot-log.mjs');
    expect(runs.filter((t) => !existsSync(`${ROOT}${t}`))).toEqual([]);
  });

  it('never sends the reader to what is gone', () => {
    for (const gone of ['/app/employee', 'src/pilot/', 'Supabase', 'D360_API_KEY', 'renderTriage()']) expect(kit, gone).not.toContain(gone);
  });

  it('the observation kinds it points to are the tool\'s nineteen', async () => {
    const { KINDS } = await import('../../tools/pilot-log.mjs' as string) as { KINDS: string[] };
    expect(KINDS).toHaveLength(19);
    expect(kit).toContain('hesitated_before_approval');
    expect(KINDS).toContain('hesitated_before_approval');
  });
});
