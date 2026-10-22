import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { firstOpenDay, isHistory } from '../../src/core/books/history.js';

/**
 * E3 (Phase 5; 0207) — where the books' open window begins, and so what an import holds that is history: an entry
 * dated before the first day an entry can be written. One rule, in one place (src/core/books/history.ts).
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const year = (startsOn: string, endsOn: string, state = 'open') => ({ startsOn, endsOn, state });

describe('E3 · the open window, and what falls before it', () => {
  it('the earliest open year\'s first day, without a lock', () => {
    expect(firstOpenDay([year('2026-01-01', '2026-12-31'), year('2025-01-01', '2025-12-31')], null)).toBe('2025-01-01');
  });

  it('a closed year opens nothing; the lock moves the first day to the day after it', () => {
    expect(firstOpenDay([year('2025-01-01', '2025-12-31', 'closed'), year('2026-01-01', '2026-12-31')], null)).toBe('2026-01-01');
    expect(firstOpenDay([year('2026-01-01', '2026-12-31')], '2026-03-31')).toBe('2026-04-01');
    // a lock that covers a whole open year: the next year opens the window
    expect(firstOpenDay([year('2025-01-01', '2025-12-31'), year('2026-01-01', '2026-12-31')], '2025-12-31')).toBe('2026-01-01');
    // the last day of February in a leap year, and of a year
    expect(firstOpenDay([year('2028-01-01', '2028-12-31')], '2028-02-28')).toBe('2028-02-29');
    expect(firstOpenDay([year('2026-01-01', '2026-12-31')], '2026-02-28')).toBe('2026-03-01');
    expect(firstOpenDay([year('2100-01-01', '2100-12-31')], '2100-02-28')).toBe('2100-03-01');   // not a leap year
    expect(firstOpenDay([year('2026-01-01', '2026-12-31'), year('2027-01-01', '2027-12-31')], '2026-12-31')).toBe('2027-01-01');
  });

  it('no open year: no window, so nothing is history — everything stays refused as before', () => {
    expect(firstOpenDay([], null)).toBeNull();
    expect(firstOpenDay([year('2025-01-01', '2025-12-31', 'closed')], null)).toBeNull();
    expect(isHistory('1999-01-01', null)).toBe(false);
  });

  it('history is strictly before the first open day; the day itself is in the books', () => {
    expect(isHistory('2026-03-31', '2026-04-01')).toBe(true);
    expect(isHistory('2026-04-01', '2026-04-01')).toBe(false);
    expect(isHistory('2027-02-01', '2026-04-01')).toBe(false);   // after the window: refused for its own reason, never history
  });

  it('the database marks history and keeps it out of entries and readings (0207)', () => {
    const m = readFileSync(`${ROOT}migrations/0207_history_kept.sql`, 'utf8');
    expect(m).toMatch(/history_entries >= 1 and history_through is not null and entry_id is null/);
    expect(m).toMatch(/create trigger document_readings_not_history before insert on document_readings/);
    expect(m).toMatch(/y_end := make_date\(extract\(year from new\.history_through\)::int, 12, 31\)/);
  });
});
