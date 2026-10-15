import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEPLOY_GRACE_MS, deployVerdict } from '../../src/core/ops/deployWatch.js';
import { readMainHead } from '../../src/pipeline/deployWatch.js';
import { renderOwnerAlert, goesByMail, OPERATOR_ALERT_KINDS } from '../../src/pipeline/notify.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

/**
 * 0167 — the deploy alarm (the owner, 2026-10-15: "something that compares main's HEAD against what production is
 * actually running, and reports when they diverge for more than an hour"). Over Postgres:
 * tests/integration/deploy-watch.test.ts.
 */

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const SHA = '531f934db6b0f2e5f1c2a3b4c5d6e7f8091a2b3c';
const NOW = new Date('2026-10-15T12:00:00Z');

describe('0167 · the rule', () => {
  it('running the head is current; behind for under an hour is deploying; over an hour is the alarm', () => {
    const head = (minutesAgo: number) => ({ sha: SHA, at: new Date(NOW.getTime() - minutesAgo * 60_000) });
    expect(deployVerdict(SHA, head(300), NOW)).toBe('current');
    expect(deployVerdict('531f934', head(300), NOW)).toBe('current');          // Railway may give it short
    expect(deployVerdict('2ecdad05a7eb9c8a706a864a22a1d1cff222db06', head(59), NOW)).toBe('deploying');
    expect(deployVerdict('2ecdad05a7eb9c8a706a864a22a1d1cff222db06', head(61), NOW)).toBe('behind');
    expect(DEPLOY_GRACE_MS).toBe(60 * 60_000);
  });
  it('no running commit, or no head from GitHub: unknown — never an alarm', () => {
    expect(deployVerdict(null, { sha: SHA, at: new Date(0) }, NOW)).toBe('unknown');
    expect(deployVerdict(SHA, null, NOW)).toBe('unknown');
  });
});

describe('0167 · GitHub\'s answer', () => {
  it('the head\'s sha, its time and its first line; anything else is no answer', async () => {
    const ok = async () => new Response(JSON.stringify({ sha: SHA, commit: { committer: { date: '2026-10-15T05:09:43Z' }, message: 'Merge pull request #362\n\nmore' } }), { status: 200 });
    expect(await readMainHead('symow07/nomi', ok as never)).toEqual({ sha: SHA, at: new Date('2026-10-15T05:09:43Z'), title: 'Merge pull request #362' });
    expect(await readMainHead('symow07/nomi', (async () => new Response('rate limited', { status: 403 })) as never)).toBeNull();
    expect(await readMainHead('symow07/nomi', (async () => { throw new Error('offline'); }) as never)).toBeNull();
    expect(await readMainHead('symow07/nomi', (async () => new Response('{"sha":"nope"}', { status: 200 })) as never)).toBeNull();
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
