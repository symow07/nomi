/**
 * 0167 — is production running what `main` has had for more than an hour? (the owner, 2026-10-15: "reports when they
 * diverge for more than an hour"). Pure: the rule only. The look itself is src/pipeline/deployWatch.ts.
 *
 * THE CLOCK STARTS AT THE OLDEST MERGE PRODUCTION LACKS (the owner, 2026-10-16). It first started at main's newest
 * commit, and every new merge restarted it: merges arriving less than an hour apart — what an active day looks like —
 * postponed the alarm for as long as they kept coming. Now a merge that has not arrived after the grace is the alarm,
 * however many merges follow it. The outside watcher (tools/deploy-drift.mjs) keeps the same rule.
 */

/** A merge that has not arrived after this long is an alarm. Railway's builds here have taken up to half an hour. */
export const DEPLOY_GRACE_MS = 60 * 60_000;

export type DeployVerdict =
  /** No running commit (not deployed from git: local, or a hand upload), or main could not be read. */
  | 'unknown'
  /** Production runs main's head. */
  | 'current'
  /** Production lacks merges, the oldest of them younger than the grace: a deploy may be on its way. */
  | 'deploying'
  /** Production lacks a merge older than the grace: the alarm. */
  | 'behind';

/** One commit on main's first-parent line. */
export type MainCommit = { readonly sha: string; readonly at: Date; readonly title: string };

export type DeployLook = {
  readonly verdict: DeployVerdict;
  /** The oldest merge production lacks (the one the clock runs from); null when nothing is missing or unknown. */
  readonly late: MainCommit | null;
  /** Minutes since `late` reached main. */
  readonly minutes: number;
};

/**
 * `chain` is main's first parents, NEWEST FIRST, from the head back to production's commit when it was found. A chain
 * that does not reach production's commit (too far behind to list, or not on main) counts from its oldest entry: at
 * least that late, never "caught up".
 */
export function deployVerdict(
  running: string | null, chain: readonly MainCommit[] | null, now: Date, graceMs: number = DEPLOY_GRACE_MS,
): DeployLook {
  if (!running || !chain || chain.length === 0) return { verdict: 'unknown', late: null, minutes: 0 };
  const r = running.toLowerCase();
  const same = (sha: string) => sha.toLowerCase().startsWith(r) || r.startsWith(sha.toLowerCase());
  const at = chain.findIndex((c) => same(c.sha));
  if (at === 0) return { verdict: 'current', late: null, minutes: 0 };
  const late = at === -1 ? chain[chain.length - 1]! : chain[at - 1]!;
  const lagMs = now.getTime() - late.at.getTime();
  return { verdict: lagMs > graceMs ? 'behind' : 'deploying', late, minutes: Math.round(lagMs / 60_000) };
}
