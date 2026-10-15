/**
 * 0167 — is production running the head of `main`? (the owner, 2026-10-15: "reports when they diverge for more than an
 * hour"). Pure: the rule only. The look itself is src/pipeline/deployWatch.ts.
 */

/** A merge that has not arrived after this long is an alarm. Railway's builds here have taken up to half an hour. */
export const DEPLOY_GRACE_MS = 60 * 60_000;

export type DeployVerdict =
  /** No running commit (not deployed from git: local, or a hand upload), or main could not be read. */
  | 'unknown'
  /** Production runs main's head. */
  | 'current'
  /** Main moved, and its head is younger than the grace: a deploy may be on its way. */
  | 'deploying'
  /** Main's head is older than the grace and production runs something else: the alarm. */
  | 'behind';

export function deployVerdict(
  running: string | null, main: { readonly sha: string; readonly at: Date } | null, now: Date, graceMs: number = DEPLOY_GRACE_MS,
): DeployVerdict {
  if (!running || !main) return 'unknown';
  const r = running.toLowerCase();
  if (main.sha.toLowerCase().startsWith(r) || r.startsWith(main.sha.toLowerCase())) return 'current';
  return now.getTime() - main.at.getTime() > graceMs ? 'behind' : 'deploying';
}
