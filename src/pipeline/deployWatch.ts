import { sql } from 'kysely';
import type { Db } from '../db/client.js';
import type { NotifyJob } from '../queue/boss.js';
import { deployVerdict, type DeployVerdict, type MainCommit } from '../core/ops/deployWatch.js';

/**
 * 0167 — THE DEPLOY ALARM (the owner, 2026-10-15: "During the pilot week, a silent deploy failure means I ship a fix
 * for a live customer and it never arrives, and we both think it did").
 *
 * Every ten minutes the running app asks GitHub what `main` has that it lacks (the public API, no key), against the
 * commit it was itself deployed from (`RAILWAY_GIT_COMMIT_SHA`, which Railway injects into every deployment).
 * A merge production has lacked for over an hour is written to `deploy_lag` once and the operator is told — by
 * e-mail always, WhatsApp where the operator alerts go (`deploy_behind`); when production runs the head again, told
 * once more (`deploy_caught_up`). GitHub not answering says nothing, either way: the alarm is about Railway.
 *
 * What it cannot see: a production that is not running at all (the heartbeat's job), and a production on code from
 * before this alarm existed.
 */

/**
 * Main's first-parent line from its head back to `running`, NEWEST FIRST, in ONE call to GitHub's compare endpoint —
 * or null when GitHub does not answer usably. Never throws.
 *
 * One call, not one per merge: the app asks without a key, and GitHub allows such callers 60 requests an hour.
 * Walking back merge by merge every ten minutes would run out exactly when production is far behind — the alarm's
 * moment — and a refused request reads as "unknown", which says nothing.
 *
 * The compare lists every commit main has that `running` lacks (branch commits too, with their older dates); the
 * first-parent line is followed from the one commit nothing else lists as a parent. It ends with `running` itself when
 * the line reaches it; a line that does not (more than GitHub lists at once, or production off main) ends without it.
 */
export async function readMainChain(repo: string, running: string, fetchImpl: typeof fetch = fetch): Promise<MainCommit[] | null> {
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/compare/${running}...main`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'nomi-deploy-watch' },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status !== 200) return null;
    type Raw = { sha?: unknown; parents?: { sha?: unknown }[]; commit?: { committer?: { date?: unknown }; message?: unknown } };
    const body = await res.json() as { status?: unknown; base_commit?: Raw; commits?: Raw[] };
    const toCommit = (c: Raw | undefined): MainCommit | null => {
      const sha = typeof c?.sha === 'string' && /^[0-9a-f]{40}$/.test(c.sha) ? c.sha : null;
      const at = typeof c?.commit?.committer?.date === 'string' ? new Date(c.commit.committer.date) : null;
      if (!sha || !at || Number.isNaN(at.getTime())) return null;
      const title = typeof c?.commit?.message === 'string' ? c.commit.message.split('\n')[0]!.slice(0, 120) : '';
      return { sha, at, title };
    };
    const base = toCommit(body.base_commit);
    if (!base) return null;
    if (body.status === 'identical') return [base];
    const raws = Array.isArray(body.commits) ? body.commits : [];
    const bySha = new Map<string, Raw>();
    for (const c of raws) if (typeof c.sha === 'string') bySha.set(c.sha, c);
    const parentOfSomething = new Set(raws.flatMap((c) => (c.parents ?? []).map((p) => p.sha)));
    const heads = raws.filter((c) => typeof c.sha === 'string' && !parentOfSomething.has(c.sha));
    if (heads.length !== 1) return null;
    const chain: MainCommit[] = [];
    let c: Raw | undefined = heads[0];
    while (c) {
      const commit = toCommit(c);
      if (!commit) return null;
      chain.push(commit);
      const parent = c.parents?.[0]?.sha;
      if (parent === base.sha) { chain.push(base); break; }
      c = typeof parent === 'string' ? bySha.get(parent) : undefined;
    }
    return chain;
  } catch {
    return null;
  }
}

export type DeployWatchDeps = {
  readonly db: Db;
  /** RAILWAY_GIT_COMMIT_SHA, as this process was deployed; null: not deployed from git (local, a hand upload). */
  readonly running: string | null;
  /** Main's first-parent line, newest first, back to `running` (readMainChain); null: GitHub did not answer. */
  readonly readMain: () => Promise<readonly MainCommit[] | null>;
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
  const chain = await deps.readMain();
  const { verdict, late, minutes } = deployVerdict(deps.running, chain, now);
  const short = (s: string) => s.slice(0, 7);
  // One row and one alert per merge that did not arrive — the oldest production lacks, which the clock runs from.
  if (verdict === 'behind' && late) {
    await sql`insert into deploy_lag (main_sha, running_sha, main_at, noticed_at)
              values (${late.sha}, ${deps.running}, ${late.at}, ${now}) on conflict (main_sha) do nothing`.execute(deps.db);
    const claimed = (await sql<{ main_sha: string }>`
      update deploy_lag set alerted_at = ${now} where main_sha = ${late.sha} and alerted_at is null
      returning main_sha`.execute(deps.db)).rows[0];
    if (claimed) {
      log(`[deploy] production runs ${short(deps.running)}, but ${short(late.sha)} has been on main for ${minutes} minutes: the deploy never arrived`);
      if (deps.operatorBusinessId) {
        await deps.send({
          businessId: deps.operatorBusinessId, kind: 'deploy_behind', conversationId: null,
          deploy: { running: short(deps.running), main: short(late.sha), minutes, title: late.title },
        }, `deploy_behind:${late.sha}`);
      }
    }
  } else if (verdict === 'current' && chain?.[0]) {
    const head = chain[0];
    const caught = (await sql<{ main_sha: string }>`
      update deploy_lag set caught_up_at = ${now} where caught_up_at is null and alerted_at is not null
      returning main_sha`.execute(deps.db)).rows;
    if (caught.length > 0) {
      log(`[deploy] production runs the head of main again (${short(head.sha)})`);
      if (deps.operatorBusinessId) {
        await deps.send({
          businessId: deps.operatorBusinessId, kind: 'deploy_caught_up', conversationId: null,
          deploy: { running: short(deps.running), main: short(head.sha), minutes: 0, title: head.title },
        }, `deploy_caught_up:${head.sha}`);
      }
    }
  }
  return verdict;
}

