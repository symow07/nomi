/**
 * THE MIGRATOR'S MARK — proof that the pre-deploy step ran (2026-10-28, the owner's order).
 *
 * #396's deploy ran with `preDeployCommand ["node tools/migrate.mjs"]`, yet its log held no "done" line, and Railway's
 * dashboard shows no pre-deploy log of its own. A log line is not proof. So every run of the migrator leaves its mark
 * in the database it migrated: the comment on `_migrations`, which only the table's owner (the migrator's admin role)
 * can write. No schema change — a comment is not a column, and nothing reads it but this file's two callers:
 *
 *   · tools/migrate.mjs writes it at the end of every run, with Railway's own commit and deployment id;
 *   · tools/migrate-mark.mjs reads it after a deploy (read-only) and says whether it names that deploy's commit.
 *
 * Pure here: the text and its reading, so a test can hold both.
 */

const SHA = /^[0-9a-f]{7,40}$/;
const DEPLOYMENT = /^[0-9a-zA-Z-]{1,64}$/;

/** What Railway gives the pre-deploy step about itself; anything else (a laptop, CI) is "local" / "none". */
export function runOf(env) {
  const sha = String(env['RAILWAY_GIT_COMMIT_SHA'] ?? '').trim().toLowerCase();
  const dep = String(env['RAILWAY_DEPLOYMENT_ID'] ?? '').trim();
  return { commit: SHA.test(sha) ? sha : 'local', deployment: DEPLOYMENT.test(dep) ? dep : 'none' };
}

/** The mark itself, one line. Only characters a SQL literal needs no escaping for, so it can be written as one. */
export function markText({ at, commit, deployment, applied, recorded }) {
  const text = `migrate ran ${at.toISOString()} · commit ${commit} · deployment ${deployment} · applied ${applied} · recorded ${recorded}`;
  if (text.includes("'")) throw new Error('a migrator mark never holds a quote');
  return text;
}

/** The mark read back; null when the comment is not one (never written, or written by someone else). */
export function readMark(comment) {
  const m = /^migrate ran (\S+) · commit (\S+) · deployment (\S+) · applied (\d+) · recorded (\d+)$/.exec(String(comment ?? ''));
  if (!m) return null;
  const at = new Date(m[1]);
  if (Number.isNaN(at.getTime())) return null;
  return { at, commit: m[2], deployment: m[3], applied: Number(m[4]), recorded: Number(m[5]) };
}

/** Does this mark prove the migrator ran for the expected commit? A short sha (7+) matches its full form. */
export function markProves(mark, expected) {
  const want = String(expected ?? '').trim().toLowerCase();
  if (!mark || !SHA.test(want) || !SHA.test(mark.commit)) return false;
  return mark.commit.startsWith(want) || want.startsWith(mark.commit);
}
