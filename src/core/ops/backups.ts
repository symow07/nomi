/**
 * When is the daily backup "stale"?
 *
 * The job runs once a day at 03:00 UTC and takes seconds. A day and a half
 * with no completed run means one run was missed and the next one has not
 * made up for it — or the job never ran at all, which is the same thing to
 * the owner: the last safe copy of the data is older than it should be.
 *
 * Pure, so the rule is tested without a database; `src/main.ts` asks it once
 * a day and sends the owner alert when it says so.
 */
export const BACKUP_MAX_AGE_HOURS = 36;

export type BackupFreshness =
  | { readonly stale: false; readonly hoursSince: number }
  | { readonly stale: true; readonly hoursSince: number | null };   // null: never completed

export function backupFreshness(
  latestUploadedAt: Date | null, now: Date, maxAgeHours = BACKUP_MAX_AGE_HOURS,
): BackupFreshness {
  if (!latestUploadedAt) return { stale: true, hoursSince: null };
  const hoursSince = (now.getTime() - latestUploadedAt.getTime()) / 3_600_000;
  return hoursSince > maxAgeHours ? { stale: true, hoursSince } : { stale: false, hoursSince };
}
