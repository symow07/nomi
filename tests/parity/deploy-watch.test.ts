import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEPLOY_GRACE_MS, deployVerdict } from '../../src/core/ops/deployWatch.js';
import { readMainChain } from '../../src/pipeline/deployWatch.js';
import { renderOwnerAlert, goesByMail, OPERATOR_ALERT_KINDS } from '../../src/pipeline/notify.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

/**
 * 0167 — the deploy alarm (the owner, 2026-10-15: "something that compares main's HEAD against what production is
 * actually running, and reports when they diverge for more than an hour"). Over Postgres:
 * tests/integration/deploy-watch.test.ts.
 *
 * 2026-10-16 — THE CLOCK STARTS AT THE OLDEST MERGE PRODUCTION LACKS. It started at main's newest commit, and every
 * merge restarted it: merges under an hour apart postponed the alarm for as long as they kept coming.
 */

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const SHA = '531f934db6b0f2e5f1c2a3b4c5d6e7f8091a2b3c';
const OLD = '2ecdad05a7eb9c8a706a864a22a1d1cff222db06';
const NOW = new Date('2026-10-15T12:00:00Z');
const ago = (m: number) => new Date(NOW.getTime() - m * 60_000);
const sha = (i: number) => `${String(i).padStart(2, '0')}${'c'.repeat(38)}`;
/** main's first parents, newest first: a merge every `gap` minutes, the newest 5 minutes old; production last. */
const line = (merges: number, gap: number) => [
  ...Array.from({ length: merges }, (_, i) => ({ sha: sha(i), at: ago(5 + i * gap), title: `#${400 - i}` })),
  { sha: OLD, at: ago(5 + merges * gap + 60), title: '#353' },
];

describe('0167 · the rule', () => {
  it('running the head is current; a missing merge under an hour old is deploying; over an hour is the alarm', () => {
    expect(deployVerdict(SHA, [{ sha: SHA, at: ago(300), title: '' }], NOW).verdict).toBe('current');
    expect(deployVerdict('531f934', [{ sha: SHA, at: ago(300), title: '' }], NOW).verdict).toBe('current');   // Railway may give it short
    const one = (m: number) => [{ sha: SHA, at: ago(m), title: '#362' }, { sha: OLD, at: ago(900), title: '#353' }];
    expect(deployVerdict(OLD, one(59), NOW)).toMatchObject({ verdict: 'deploying', minutes: 59 });
    expect(deployVerdict(OLD, one(61), NOW)).toMatchObject({ verdict: 'behind', minutes: 61, late: { sha: SHA } });
    expect(DEPLOY_GRACE_MS).toBe(60 * 60_000);
  });
  it('THE HOLE IT CLOSES: a merge every 20 minutes, the newest 5 minutes old — the oldest missing one is the alarm', () => {
    const v = deployVerdict(OLD, line(8, 20), NOW);
    expect(v).toMatchObject({ verdict: 'behind', minutes: 145, late: { sha: sha(7), title: '#393' } });
  });
  it('a line that never reaches production counts from its oldest merge: at least that late, never caught up', () => {
    const v = deployVerdict('f'.repeat(40), line(3, 30).slice(0, 3), NOW);
    expect(v).toMatchObject({ verdict: 'behind', late: { sha: sha(2) } });
  });
  it('no running commit, or nothing from GitHub: unknown — never an alarm', () => {
    expect(deployVerdict(null, line(1, 10), NOW).verdict).toBe('unknown');
    expect(deployVerdict(SHA, null, NOW).verdict).toBe('unknown');
    expect(deployVerdict(SHA, [], NOW).verdict).toBe('unknown');
  });
});

describe('0167 · GitHub\'s answer: ONE compare call, followed along first parents', () => {
  const raw = (s: string, at: string, parents: string[], message = `m ${s.slice(0, 4)}`) =>
    ({ sha: s, parents: parents.map((p) => ({ sha: p })), commit: { committer: { date: at }, message } });
  const B1 = 'b1'.padEnd(40, '1'); const B2 = 'b2'.padEnd(40, '2');   // a PR's own commits, older dates
  const M1 = 'a1'.padEnd(40, '1'); const M2 = 'a2'.padEnd(40, '2');   // the merges on main
  const body = {
    status: 'ahead',
    base_commit: raw(OLD, '2026-10-14T18:11:00Z', []),
    commits: [
      raw(B1, '2026-10-13T09:00:00Z', [OLD]), raw(B2, '2026-10-13T10:00:00Z', [B1]),
      raw(M1, '2026-10-14T19:17:00Z', [OLD, B2], 'Merge pull request #354\n\nmore'),
      raw(M2, '2026-10-15T03:06:00Z', [M1, B2], 'Merge pull request #355'),
    ],
  };
  it('the merges production lacks, newest first, ending with production\'s own commit; branch commits left out', async () => {
    let asked = '';
    const chain = await readMainChain('symow07/nomi', OLD, (async (u: string) => { asked = u; return new Response(JSON.stringify(body), { status: 200 }); }) as never);
    expect(asked).toBe(`https://api.github.com/repos/symow07/nomi/compare/${OLD}...main`);
    expect(chain?.map((c) => c.sha)).toEqual([M2, M1, OLD]);
    expect(chain?.[1]).toEqual({ sha: M1, at: new Date('2026-10-14T19:17:00Z'), title: 'Merge pull request #354' });
    expect(deployVerdict(OLD, chain, NOW)).toMatchObject({ verdict: 'behind', late: { sha: M1 } });
  });
  it('identical: production is the head', async () => {
    const same = { status: 'identical', base_commit: raw(SHA, '2026-10-15T05:09:43Z', [OLD]), commits: [] };
    const chain = await readMainChain('symow07/nomi', SHA, (async () => new Response(JSON.stringify(same), { status: 200 })) as never);
    expect(deployVerdict(SHA, chain, NOW).verdict).toBe('current');
  });
  it('anything else is no answer — rate limited, offline, unreadable, or no single head', async () => {
    expect(await readMainChain('symow07/nomi', OLD, (async () => new Response('rate limited', { status: 403 })) as never)).toBeNull();
    expect(await readMainChain('symow07/nomi', OLD, (async () => { throw new Error('offline'); }) as never)).toBeNull();
    expect(await readMainChain('symow07/nomi', OLD, (async () => new Response('{"status":"ahead"}', { status: 200 })) as never)).toBeNull();
    const twoHeads = { ...body, commits: [...body.commits, raw('d'.repeat(40), '2026-10-15T04:00:00Z', [OLD])] };
    expect(await readMainChain('symow07/nomi', OLD, (async () => new Response(JSON.stringify(twoHeads), { status: 200 })) as never)).toBeNull();
  });
});

describe('0167 · the operator is told, in every language, by e-mail always', () => {
  for (const l of LOCALES) {
    it(`${l} · behind, and caught up`, () => {
      const deploy = { running: '2ecdad0', main: '531f934', minutes: 72, title: 'Merge pull request #362' };
      const behind = renderOwnerAlert(l, 'deploy_behind', null, { deploy });
      for (const s of ['2ecdad0', '531f934', '72', 'Merge pull request #362']) expect(behind, `${l} ${s}`).toContain(s);
      expect(renderOwnerAlert(l, 'deploy_caught_up', null, { deploy })).toContain('531f934');
      expect(behind).not.toMatch(/\{|notify\./);
    });
  }
  it('both are operator alerts: e-mail always, never depending on WhatsApp', () => {
    for (const k of ['deploy_behind', 'deploy_caught_up'] as const) {
      expect(OPERATOR_ALERT_KINDS as readonly string[]).toContain(k);
      expect(goesByMail(k)).toBe(true);
    }
  });
  it('scheduled every ten minutes from the commit Railway injects; off, and said, where there is none', () => {
    const main = src('src/main.ts');
    expect(main).toContain("const runningCommit = process.env['RAILWAY_GIT_COMMIT_SHA']?.trim() || null;");
    expect(main).toContain("await boss.schedule(QUEUES.deployWatch, '*/10 * * * *', { businessId: PILOT_BUSINESS_ID } satisfies DeployWatchJob);");
    expect(main).toContain("console.log('Deploy watch: off — this process was not deployed from git (no RAILWAY_GIT_COMMIT_SHA).');");
  });
});
