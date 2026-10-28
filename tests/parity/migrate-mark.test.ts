import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — the operator tools, plain JS on purpose.
import { runOf, markText, readMark, markProves } from '../../tools/lib/migrate-mark.mjs';

/**
 * THE MIGRATOR'S MARK (2026-10-28) — the text and its reading, and where tools/migrate.mjs writes them. The run
 * against a real database is tests/integration/migrate-mark.test.ts.
 */
const read = (p: string) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8');
const SHA = '856791f579d306c847be15cb1ee58c39bb52e2fb';

describe('the mark: written from Railway\'s own variables, read back, and held to its commit', () => {
  it('Railway\'s commit and deployment id, or "local" / "none" when they are absent or not what they should be', () => {
    expect(runOf({ RAILWAY_GIT_COMMIT_SHA: SHA, RAILWAY_DEPLOYMENT_ID: 'b8c47c08-98cf-4d30-8262-427c6b1e8f1a' }))
      .toEqual({ commit: SHA, deployment: 'b8c47c08-98cf-4d30-8262-427c6b1e8f1a' });
    expect(runOf({})).toEqual({ commit: 'local', deployment: 'none' });
    expect(runOf({ RAILWAY_GIT_COMMIT_SHA: "x'; drop table _migrations; --", RAILWAY_DEPLOYMENT_ID: "a'b" }))
      .toEqual({ commit: 'local', deployment: 'none' });
  });

  it('round trip; a comment that is not a mark reads as none; a quote can never be written', () => {
    const at = new Date('2026-10-28T08:35:40.000Z');
    const text = markText({ at, commit: SHA, deployment: 'b8c47c08', applied: 0, recorded: 216 });
    expect(text).toBe(`migrate ran 2026-10-28T08:35:40.000Z · commit ${SHA} · deployment b8c47c08 · applied 0 · recorded 216`);
    expect(readMark(text)).toEqual({ at, commit: SHA, deployment: 'b8c47c08', applied: 0, recorded: 216 });
    for (const other of [null, '', 'One row per applied migration.', 'migrate ran never · commit x · deployment y · applied 0 · recorded 1']) {
      expect(readMark(other), String(other)).toBeNull();
    }
    expect(() => markText({ at, commit: "a'b", deployment: 'none', applied: 0, recorded: 1 })).toThrow();
  });

  it('proves its own commit, by a short or full sha, and nothing else — never a laptop\'s run', () => {
    const mark = readMark(markText({ at: new Date(), commit: SHA, deployment: 'd', applied: 0, recorded: 216 }));
    expect(markProves(mark, '856791f5')).toBe(true);
    expect(markProves(mark, SHA)).toBe(true);
    expect(markProves(mark, 'c212c741')).toBe(false);
    expect(markProves(mark, 'not-a-sha')).toBe(false);
    expect(markProves(null, '856791f5')).toBe(false);
    const local = readMark(markText({ at: new Date(), commit: 'local', deployment: 'none', applied: 0, recorded: 216 }));
    expect(markProves(local, '856791f5')).toBe(false);
  });
});

describe('tools/migrate.mjs writes it where it proves something', () => {
  const src = read('tools/migrate.mjs');
  it('the start line comes before the connection, so a run that cannot connect has still said it started', () => {
    expect(src.indexOf('console.log(`migrate: start · commit ${run.commit} · deployment ${run.deployment}`)'))
      .toBeLessThan(src.indexOf('await client.connect()'));
  });
  it('the mark is written after every migration has applied and before "done", and a failure to write it is not fatal', () => {
    const loop = src.indexOf('for (const f of pending)');
    const mark = src.indexOf('comment on table public._migrations is');
    const done = src.indexOf('console.log(`done — ${count.n} migrations recorded`)');
    expect(loop).toBeGreaterThan(0);
    expect(mark).toBeGreaterThan(loop);
    expect(done).toBeGreaterThan(mark);
    expect(src.slice(mark - 200, done)).toMatch(/try \{[\s\S]*comment on table[\s\S]*\} catch \(e\) \{[\s\S]*could not be written/);
  });
  it('the deploy docs run the check after every deploy', () => {
    const doc = read('docs/DEPLOYMENT.md');
    expect(doc).toContain('node tools/migrate-mark.mjs --expect');
  });
});
