/**
 * E3 (Phase 5; 0207) — WHERE THE BOOKS' OPEN WINDOW BEGINS, and so what an import holds that is HISTORY, NOT IN THE
 * BOOKS: an entry dated before the first day an entry can be written. That day is the earliest open fiscal year's
 * first day, or the day after the lock date where the lock reaches into it. (D10's open periods, when built, narrow
 * the window here, in one place.)
 *
 * Entries after the window with no year to hold them are not history: they stay refused, as before.
 */
export type YearWindow = { readonly startsOn: string; readonly endsOn: string; readonly state: string };

const nextDay = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** The first day an entry can be written, or null when no open year has one (then nothing is history: all refused). */
export function firstOpenDay(years: readonly YearWindow[], lock: string | null): string | null {
  const after = lock === null ? null : nextDay(lock);
  const days: string[] = [];
  for (const y of years) {
    if (y.state !== 'open') continue;
    const day = after !== null && after > y.startsOn ? after : y.startsOn;
    if (day <= y.endsOn) days.push(day);   // a year the lock covers whole opens nothing
  }
  return days.sort()[0] ?? null;
}

/** An entry is history when it is dated before the window opens. */
export const isHistory = (date: string, opensOn: string | null): boolean => opensOn !== null && date < opensOn;
