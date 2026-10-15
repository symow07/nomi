import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';

/**
 * 0167 — the deploy alarm over Postgres (the owner, 2026-10-15: "During the pilot week, a silent deploy failure means
 * I ship a fix for a live customer and it never arrives, and we both think it did"). The real sweep and the real
 * record; only GitHub is faked. `deploy_lag` is the installation's, so every case is rolled back.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}
const OLD = '2ecdad05a7eb9c8a706a864a22a1d1cff222db06';
const HEAD = '531f934db6b0f2e5f1c2a3b4c5d6e7f8091a2b3c';

d('0167 · production behind main is an alarm (requires DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  const inTx = async (fn: (tx: import('../../src/db/client.js').Db) => Promise<void>) => {
    await db.transaction().execute(async (tx) => { await fn(tx as never); throw new Rollback(); })
      .catch((e: unknown) => { if (!(e instanceof Rollback)) throw e; });
  };
  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
  });
  afterAll(async () => { await db?.destroy(); });

  it('THE DAY IT WAS MISSED — six merges, none deployed: told once an hour after the merge, not before, not twice; told once when it catches up', async () => {
    await inTx(async (tx) => {
      const { deployWatchSweep } = await import('../../src/pipeline/deployWatch.js');
      const merged = new Date('2026-10-15T05:09:43Z');
      let now = new Date(merged.getTime() + 30 * 60_000);
      let running = OLD;
      const sent: { kind: string; key: string; deploy?: unknown }[] = [];
      const look = () => deployWatchSweep({
        db: tx, running, operatorBusinessId: 'de300000-0000-4000-8000-0000000000b1', log: () => {}, now: () => now,
        readMain: async () => [{ sha: HEAD, at: merged, title: 'Merge pull request #362' }, { sha: OLD, at: new Date('2026-10-14T18:11:07Z'), title: '#353' }],
        send: async (j, key) => { sent.push({ kind: j.kind, key, deploy: j.deploy }); },
      });
      expect(await look()).toBe('deploying');                   // half an hour: a deploy may be on its way
      expect(sent).toEqual([]);
      now = new Date(merged.getTime() + 72 * 60_000);
      expect(await look()).toBe('behind');
      expect(sent).toEqual([{ kind: 'deploy_behind', key: `deploy_behind:${HEAD}`, deploy: { running: '2ecdad0', main: '531f934', minutes: 72, title: 'Merge pull request #362' } }]);
      now = new Date(now.getTime() + 10 * 60_000);
      await look();                                             // ten minutes later, still behind: not told again
      expect(sent).toHaveLength(1);
      expect((await sql<{ n: number }>`select count(*)::int as n from deploy_lag where main_sha = ${HEAD} and alerted_at is not null`.execute(tx)).rows[0]!.n).toBe(1);
      running = HEAD;                                            // the deploy finally arrives
      expect(await look()).toBe('current');
      expect(sent.map((s) => s.kind)).toEqual(['deploy_behind', 'deploy_caught_up']);
      await look();
      expect(sent).toHaveLength(2);
    });
  });

  it('2026-10-16 · AN ACTIVE DAY DOES NOT POSTPONE IT: a merge every 20 minutes, production stuck — told once, an hour after the FIRST merge that did not arrive', async () => {
    await inTx(async (tx) => {
      const { deployWatchSweep } = await import('../../src/pipeline/deployWatch.js');
      const first = new Date('2026-10-15T08:00:00Z');
      const merge = (i: number) => ({ sha: `${String(i).padStart(2, '0')}${'e'.repeat(38)}`, at: new Date(first.getTime() + i * 20 * 60_000), title: `#${370 + i}` });
      let now = first;
      const sent: { kind: string; key: string; deploy?: unknown }[] = [];
      const look = () => deployWatchSweep({
        db: tx, running: OLD, operatorBusinessId: 'de300000-0000-4000-8000-0000000000b1', log: () => {}, now: () => now,
        // main's line at `now`: every merge so far, newest first, then production's commit
        readMain: async () => [...Array.from({ length: Math.floor((now.getTime() - first.getTime()) / (20 * 60_000)) + 1 }, (_, i) => merge(i)).reverse(),
          { sha: OLD, at: new Date('2026-10-14T18:11:07Z'), title: '#353' }],
        send: async (j, key) => { sent.push({ kind: j.kind, key, deploy: j.deploy }); },
      });
      const verdicts: string[] = [];
      for (let m = 0; m <= 120; m += 10) { now = new Date(first.getTime() + m * 60_000); verdicts.push(await look()); }
      // The newest merge is never more than 20 minutes old; measured from it, this would read "deploying" all day.
      expect(verdicts.slice(0, 7)).toEqual(Array(7).fill('deploying'));         // 0–60 minutes
      expect(verdicts.slice(7)).toEqual(Array(6).fill('behind'));               // 70–120 minutes
      expect(sent).toEqual([{ kind: 'deploy_behind', key: `deploy_behind:${merge(0).sha}`, deploy: { running: '2ecdad0', main: merge(0).sha.slice(0, 7), minutes: 70, title: '#370' } }]);
    });
  });

  it('GitHub not answering, or no running commit: nothing written, nobody told', async () => {
    await inTx(async (tx) => {
      const { deployWatchSweep } = await import('../../src/pipeline/deployWatch.js');
      const sent: unknown[] = [];
      const base = { db: tx, operatorBusinessId: 'x', log: () => {}, send: async (j: unknown) => { sent.push(j); } };
      expect(await deployWatchSweep({ ...base, running: OLD, readMain: async () => null })).toBe('unknown');
      expect(await deployWatchSweep({ ...base, running: null, readMain: async () => [{ sha: HEAD, at: new Date(0), title: '' }] })).toBe('unknown');
      expect(sent).toEqual([]);
      expect((await sql<{ n: number }>`select count(*)::int as n from deploy_lag where main_sha = ${HEAD}`.execute(tx)).rows[0]!.n).toBe(0);
    });
  });
});
