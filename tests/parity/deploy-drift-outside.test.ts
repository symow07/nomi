import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — the operator tools, plain JS on purpose (tools/ is not type-checked).
import { driftVerdict, runningCommit, LAG_LIMIT_MIN } from '../../tools/deploy-drift.mjs';

/**
 * THE OUTSIDE DEPLOY WATCHER (the owner, 2026-10-16): a scheduled GitHub Action asks Railway which commit production
 * runs and pings Healthchecks only when production has every merge older than an hour. Built because the inside
 * watcher (#363) only watches once a deploy carries it in — and from 2026-10-14 18:11 UTC nothing deployed for a day.
 *
 * The property that decided the design: the clock starts at the OLDEST merge production lacks. Measured from main's
 * newest commit instead, merges arriving less than an hour apart would postpone the alarm for as long as they came.
 */
const MIN = 60_000;
const NOW = Date.parse('2026-10-15T18:00:00Z');
/** main's first parents, newest first, one merge every `gap` minutes; `prod` sits `back` merges down. */
const chainOf = (n: number, gap: number) =>
  Array.from({ length: n }, (_, i) => ({ sha: `${String(i).padStart(2, '0')}${'a'.repeat(38)}`, at: NOW - (5 + i * gap) * MIN }));

describe('the verdict', () => {
  it('production at main\'s head is caught up', () => {
    const chain = chainOf(5, 20);
    expect(driftVerdict(chain[0]!.sha, chain, NOW)).toEqual({ state: 'current', lagMin: 0, missing: 0 });
  });

  it('a merge under the limit is a deploy on its way; past it is the alarm, measured from the OLDEST missing merge', () => {
    const chain = [{ sha: 'c'.repeat(40), at: NOW - 59 * MIN }, { sha: 'b'.repeat(40), at: NOW - 200 * MIN }];
    expect(driftVerdict('b'.repeat(40), chain, NOW)).toMatchObject({ state: 'deploying', lagMin: 59, missing: 1 });
    const late = [{ sha: 'c'.repeat(40), at: NOW - (LAG_LIMIT_MIN + 1) * MIN }, chain[1]!];
    expect(driftVerdict('b'.repeat(40), late, NOW)).toMatchObject({ state: 'behind', lagMin: 61, missing: 1 });
  });

  it('THE HOLE IT CLOSES: merges every 20 minutes do not postpone it — the oldest missing one is 125 minutes old', () => {
    const chain = chainOf(8, 20);                     // the newest merge is 5 minutes old
    const v = driftVerdict(chain[7]!.sha, chain, NOW); // production lacks the seven above it
    expect(v).toMatchObject({ state: 'behind', missing: 7, lagMin: 125 });
  });

  it('the day it was built for: 11 merges, the oldest 23 hours old', () => {
    const chain = chainOf(12, 120);
    expect(driftVerdict(chain[11]!.sha.slice(0, 8), chain, NOW)).toMatchObject({ state: 'behind', missing: 11 });
  });

  it('production not found within the walk is behind, never caught up', () => {
    const chain = chainOf(3, 10);
    expect(driftVerdict('f'.repeat(40), chain, NOW)).toMatchObject({ state: 'behind', lost: true });
  });

  it('nothing to compare is unknown (the job then pings nothing, and Healthchecks alarms on the silence)', () => {
    expect(driftVerdict(null, chainOf(2, 10), NOW).state).toBe('unknown');
    expect(driftVerdict('a'.repeat(40), [], NOW).state).toBe('unknown');
  });

  it('a short SHA matches either way round', () => {
    const chain = chainOf(2, 10);
    expect(driftVerdict(chain[0]!.sha.slice(0, 7).toUpperCase(), chain, NOW).state).toBe('current');
  });
});

describe('Railway: the query checked against its live schema (2026-10-16), with a PROJECT token', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads the newest SUCCESS deployment of the named service through Project-Access-Token, and its commit', async () => {
    const seen: { headers: Record<string, string>; body: { query: string; variables: Record<string, unknown> } }[] = [];
    const answers = [
      { projectToken: { projectId: 'p1', environmentId: 'e1' } },
      { project: { services: { edges: [{ node: { id: 's0', name: 'backup' } }, { node: { id: 's1', name: 'nomi' } }] } } },
      { deployments: { edges: [{ node: { id: 'd1', status: 'SUCCESS', createdAt: '2026-10-14T18:11:07Z', meta: { commitHash: '2ecdad05ff' } } }] } },
    ];
    vi.stubGlobal('fetch', async (_url: string, init: { headers: Record<string, string>; body: string }) => {
      seen.push({ headers: init.headers, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ data: answers[seen.length - 1] }), { status: 200 });
    });
    const r = await runningCommit('tok', 'nomi');
    expect(r).toEqual({ sha: '2ecdad05ff', deployedAt: '2026-10-14T18:11:07Z' });
    expect(seen.every((s) => s.headers['Project-Access-Token'] === 'tok' && !('authorization' in s.headers))).toBe(true);
    expect(seen[2]!.body.variables).toEqual({ input: { projectId: 'p1', environmentId: 'e1', serviceId: 's1', status: { in: ['SUCCESS'] } } });
  });

  it('a Railway error throws, so the job fails and pings nothing', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ errors: [{ message: 'Not Authorized' }] }), { status: 200 }));
    await expect(runningCommit('bad', 'nomi')).rejects.toThrow(/Not Authorized/);
  });
});

describe('the workflow', () => {
  const yml = readFileSync(fileURLToPath(new URL('../../.github/workflows/deploy-drift.yml', import.meta.url)), 'utf8');

  it('runs on a 30-minute schedule and by hand, never on a pull request or a push', () => {
    expect(yml).toContain("cron: '*/30 * * * *'");
    expect(yml).toContain('workflow_dispatch:');
    expect(yml).not.toMatch(/^\s*(pull_request|pull_request_target|push):/m);
  });

  it('reads the repo only, and hands the secrets over through the environment, never on the command line', () => {
    expect(yml).toMatch(/permissions:\s*\n\s*contents: read/);
    expect(yml).toContain('RAILWAY_DEPLOY_WATCH_TOKEN: ${{ secrets.RAILWAY_DEPLOY_WATCH_TOKEN }}');
    expect(yml).toContain('DEPLOY_DRIFT_PING_URL: ${{ secrets.DEPLOY_DRIFT_PING_URL }}');
    const run = yml.split('\n').filter((l) => /^\s*run:/.test(l));
    expect(run).toEqual(['        run: node tools/deploy-drift.mjs $DRY_RUN']);
  });

  it('a run by hand is a dry run unless asked otherwise', () => {
    expect(yml).toMatch(/dry_run:[\s\S]*?default: true/);
  });
});
