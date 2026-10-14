import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * GATE A — the pilot kit names only what exists (docs/GATE-A-KIT.md, rewritten 2026-10-14). The July kit sent its
 * reader to a provider sandbox, a SQL editor, a page and a module that had all gone; this holds the new one to the
 * tree: every file it names is there, every page it sends the owner to is a route, every tool it runs is a tool.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const app = readFileSync(`${ROOT}src/api/web/app.ts`, 'utf8');
/**
 * The runbooks held to the tree. The kit, and (the owner, 2026-10-14) the live verification it sends the reader to:
 * "a stale doc pointing at the wrong route is how the wrong thing gets done at 11pm on day 3".
 */
const RUNBOOKS = ['docs/GATE-A-KIT.md', 'docs/LIVE-VERIFICATION.md'] as const;
/** The web modules' named addresses (`export const ASSISTANT_HOME = '/app/settings/assistant'`), so a route registered by name counts. */
const NAMED = new Map([...readdirSync(`${ROOT}src/api/web`).filter((f) => f.endsWith('.ts'))
  .flatMap((f) => [...readFileSync(`${ROOT}src/api/web/${f}`, 'utf8').matchAll(/export const ([A-Z_]+) = '(\/[^']+)'/g)])]
  .map((m) => [m[2]!, m[1]!]));
const served = (path: string): boolean => app.includes(`app.get('${path}'`) || (NAMED.has(path) && app.includes(`app.get(${NAMED.get(path)},`));

for (const doc of RUNBOOKS) describe(`Gate A · ${doc} names only what exists`, () => {
  const text = readFileSync(`${ROOT}${doc}`, 'utf8');
  const ticked = [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!);

  it('every file and folder it names is in the tree', () => {
    // A ticked command names its tool first: `tools/pilot-log.mjs set --id <n> …` is the file tools/pilot-log.mjs.
    const paths = ticked.filter((s) => /^(docs|tools|src|tests|migrations)\//.test(s)).map((s) => s.split(/\s/)[0]!.replace(/[#:].*$/, ''));
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.filter((p) => !existsSync(`${ROOT}${p}`))).toEqual([]);
  });

  it('every page it sends the owner to is a route the app serves', () => {
    const pages = ticked.filter((s) => /^\/(app|site)[/a-z_-]*$/.test(s));
    expect(pages.filter((p) => !served(p))).toEqual([]);
  });

  it('every command it runs names a tool that exists', () => {
    const runs = [...text.matchAll(/node (tools\/[a-z-]+\.mjs)/g)].map((m) => m[1]!);
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.filter((t) => !existsSync(`${ROOT}${t}`))).toEqual([]);
  });

  it('never sends the reader to what is gone', () => {
    for (const gone of ['/app/employee', 'src/pilot/', 'Supabase', 'D360_API_KEY', 'renderTriage()', 'src/api/server.ts',
      'runTestConnection', 'src/core/owner/channel.ts', 'waba-sandbox']) expect(text, gone).not.toContain(gone);
  });
});

describe('Gate A · the kit\'s own tools', () => {
  it('the observation kinds it points to are the tool\'s nineteen', async () => {
    const { KINDS } = await import('../../tools/pilot-log.mjs' as string) as { KINDS: string[] };
    expect(KINDS).toHaveLength(19);
    expect(readFileSync(`${ROOT}docs/GATE-A-KIT.md`, 'utf8')).toContain('hesitated_before_approval');
    expect(KINDS).toContain('hesitated_before_approval');
  });
});

describe('Gate A · decision 2 — the billing exemption loosens billing only', () => {
  it('neither the send ceiling nor the model allowance reads an exemption', () => {
    const allowance = readFileSync(`${ROOT}src/db/allowance.ts`, 'utf8');
    expect(allowance).not.toMatch(/exempt/i);
    const store = readFileSync(`${ROOT}src/db/channels.ts`, 'utf8');
    expect(store).toContain('dailyCeilingReached: (c?.sent_today ?? 0) >= (c?.send_ceiling ?? DAILY_OUTBOUND_CEILING),');
    expect(store).not.toMatch(/exempt/i);
  });
});

describe('Gate A · the number\'s status with Meta, read without a secret on show', () => {
  it('prints the listed fields only, Meta\'s code on a refusal, and never the token', () => {
    const tool = readFileSync(`${ROOT}tools/wa-number-status.mjs`, 'utf8');
    expect(tool).toContain("export const FIELDS = ['display_phone_number', 'verified_name', 'name_status'");
    expect(tool).not.toMatch(/console\.\w+\([^)]*\btoken\b/);
    expect(tool).not.toMatch(/console\.\w+\([^)]*body\.error\.message/);
  });
});
