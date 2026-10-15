import { sql } from 'kysely';
import type { Db } from '../db/client.js';
import type { NotifyJob } from '../queue/boss.js';
import { deployVerdict, type DeployVerdict } from '../core/ops/deployWatch.js';

/**
 * 0167 — THE DEPLOY ALARM (the owner, 2026-10-15: "During the pilot week, a silent deploy failure means I ship a fix
 * for a live customer and it never arrives, and we both think it did").
 *
 * Every ten minutes the running app asks GitHub for the head of `main` (the public API, no key) and compares it with
 * the commit it was itself deployed from (`RAILWAY_GIT_COMMIT_SHA`, which Railway injects into every deployment).
 * A head an hour past its merge that is not running is written to `deploy_lag` once and the operator is told — by
 * e-mail always, WhatsApp where the operator alerts go (`deploy_behind`); when production runs the head again, told
 * once more (`deploy_caught_up`). GitHub not answering says nothing, either way: the alarm is about Railway.
 *
 * What it cannot see: a production that is not running at all (the heartbeat's job), and a production on code from
 * before this alarm existed.
 */

export type MainHead = { readonly sha: string; readonly at: Date; readonly title: string };

/** GitHub's answer for `main`'s head, or null when it does not answer usably. Never throws. */
export async function readMainHead(repo: string, fetchImpl: typeof fetch = fetch): Promise<MainHead | null> {
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/commits/main`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'nomi-deploy-watch' },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status !== 200) return null;
    const body = await res.json() as { sha?: unknown; commit?: { committer?: { date?: unknown }; message?: unknown } };
    const sha = typeof body.sha === 'string' && /^[0-9a-f]{40}$/.test(body.sha) ? body.sha : null;
    const at = typeof body.commit?.committer?.date === 'string' ? new Date(body.commit.committer.date) : null;
    if (!sha || !at || Number.isNaN(at.getTime())) return null;
    const title = typeof body.commit?.message === 'string' ? body.commit.message.split('\n')[0]!.slice(0, 120) : '';
    return { sha, at, title };
  } catch {
    return null;
  }
}

export type DeployWatchDeps = {
  readonly db: Db;
  /** RAILWAY_GIT_COMMIT_SHA, as this process was deployed; null: not deployed from git (local, a hand upload). */
  readonly running: string | null;
  readonly readMain: () => Promise<MainHead | null>;
  /** The workspace whose owner runs this installation; null: written down, nobody told. */
  readonly operatorBusinessId: string | null;
  readonly send: (job: NotifyJob, key: string) => Promise<void>;
  readonly now?: () => Date;
  readonly log?: (line: string) => void;
};

/** One look. Returns what it saw; writes and alerts at most once per head of main. */
export async function deployWatchSweep(deps: DeployWatchDeps): Promise<DeployVerdict> {
  const now = deps.now?.() ?? new Date();
  const log = deps.log ?? ((line: string) => console.warn(line));
  if (!deps.running) return 'unknown';
  const main = await deps.readMain();
  const verdict = deployVerdict(deps.running, main, now);
  const short = (s: string) => s.slice(0, 7);
  if (verdict === 'behind' && main) {
    await sql`insert into deploy_lag (main_sha, running_sha, main_at, noticed_at)
              values (${main.sha}, ${deps.running}, ${main.at}, ${now}) on conflict (main_sha) do nothing`.execute(deps.db);
    const claimed = (await sql<{ main_sha: string }>`
      update deploy_lag set alerted_at = ${now} where main_sha = ${main.sha} and alerted_at is null
      returning main_sha`.execute(deps.db)).rows[0];
    const minutes = Math.round((now.getTime() - main.at.getTime()) / 60_000);
    if (claimed) {
      log(`[deploy] production runs ${short(deps.running)}, but main has been at ${short(main.sha)} for ${minutes} minutes: the deploy never arrived`);
      if (deps.operatorBusinessId) {
        await deps.send({
          businessId: deps.operatorBusinessId, kind: 'deploy_behind', conversationId: null,
          deploy: { running: short(deps.running), main: short(main.sha), minutes, title: main.title },
        }, `deploy_behind:${main.sha}`);
      }
    }
  } else if (verdict === 'current' && main) {
    const caught = (await sql<{ main_sha: string }>`
      update deploy_lag set caught_up_at = ${now} where caught_up_at is null and alerted_at is not null
      returning main_sha`.execute(deps.db)).rows;
    if (caught.length > 0) {
      log(`[deploy] production runs the head of main again (${short(main.sha)})`);
      if (deps.operatorBusinessId) {
        await deps.send({
          businessId: deps.operatorBusinessId, kind: 'deploy_caught_up', conversationId: null,
          deploy: { running: short(deps.running), main: short(main.sha), minutes: 0, title: main.title },
        }, `deploy_caught_up:${main.sha}`);
      }
    }
  }
  return verdict;
}

