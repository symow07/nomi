import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { addDays, dayStart } from '../core/owner/i18n/format.js';

/**
 * 0082 — THE OWNER'S OWN DATES (the design pass, decided 2026-09-29).
 *
 * A date nobody wrote down anywhere else — a photo shoot, a trade fair, a
 * stocktake — put on the calendar by the owner or a colleague (closures are
 * theirs to set as well, rule 11). It belongs to the business, never to a
 * customer. Taking one off archives it (`removed_at`); nothing is deleted.
 */

export type NewEntry = {
  readonly title: string;
  /** 'YYYY-MM-DD', the business's day. */
  readonly day: string;
  /** 'HH:MM', or null for the whole day. */
  readonly from: string | null;
  readonly to: string | null;
};

export type EntryProblem = 'title' | 'day' | 'time' | 'order';

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * What the form sent, checked and turned into instants — or why not. A time
 * is read in the workspace's own day (`dayStart` in its zone), so "09:00" is
 * nine in the morning where the business is, whoever's browser sent it.
 */
export function readEntry(form: Record<string, unknown>, zone: string): { ok: true; entry: { title: string; startsAt: Date; endsAt: Date | null; allDay: boolean } } | { ok: false; problem: EntryProblem } {
  const title = typeof form['title'] === 'string' ? form['title'].trim() : '';
  if (title.length < 1 || Array.from(title).length > 80) return { ok: false, problem: 'title' };
  const day = typeof form['day'] === 'string' ? form['day'] : '';
  const m = YMD.exec(day);
  if (!m || Number(m[1]) < 2000 || Number(m[1]) > 2099 || addDays(day, 0) !== day) return { ok: false, problem: 'day' };
  const time = (v: unknown): number | null | undefined => {
    if (typeof v !== 'string' || v.trim() === '') return null;
    const t = HM.exec(v.trim());
    return t ? Number(t[1]) * 60 + Number(t[2]) : undefined;
  };
  const from = time(form['from']);
  const to = time(form['to']);
  if (from === undefined || to === undefined || (from === null && to !== null)) return { ok: false, problem: 'time' };
  const base = dayStart(day, zone).getTime();
  if (from === null) return { ok: true, entry: { title, startsAt: new Date(base), endsAt: null, allDay: true } };
  if (to !== null && to < from) return { ok: false, problem: 'order' };
  return {
    ok: true,
    entry: { title, startsAt: new Date(base + from * 60_000), endsAt: to === null ? null : new Date(base + to * 60_000), allDay: false },
  };
}

export async function addEntry(
  tx: Tx, businessId: BusinessId, e: { title: string; startsAt: Date; endsAt: Date | null; allDay: boolean }, by: string,
): Promise<string> {
  return (await sql<{ id: string }>`
    insert into calendar_entries (business_id, title, starts_at, ends_at, all_day, created_by)
    values (${businessId}::uuid, ${e.title}, ${e.startsAt}, ${e.endsAt}, ${e.allDay}, ${by})
    returning id::text as id`.execute(tx)).rows[0]!.id;
}

/** Take one off the calendar: archived, never deleted. False when there was none of this business's to take. */
export async function removeEntry(tx: Tx, businessId: BusinessId, id: string, by: string): Promise<boolean> {
  const r = await sql`
    update calendar_entries set removed_at = now(), removed_by = ${by}
     where id = ${id}::uuid and business_id = ${businessId}::uuid and removed_at is null`.execute(tx);
  return Number(r.numAffectedRows ?? 0) > 0;
}

/**
 * The first day of the business's week (the plan's §5): Monday in China and
 * the UK, Sunday in Saudi Arabia and the US, Saturday in Egypt — from the
 * country given at sign-up, not the owner's language. 1 = Monday … 7 = Sunday;
 * Monday when the country is unknown.
 */
export function firstDayOfWeek(country: string | null): number {
  if (!country || !/^[A-Z]{2}$/.test(country)) return 1;
  try {
    const loc = new Intl.Locale(`und-${country}`) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number };
    };
    const info = loc.getWeekInfo?.() ?? loc.weekInfo;
    return info && info.firstDay >= 1 && info.firstDay <= 7 ? info.firstDay : 1;
  } catch {
    return 1;
  }
}

export async function businessCountry(tx: Tx, businessId: BusinessId): Promise<string | null> {
  return (await sql<{ country: string | null }>`
    select country from businesses where id = ${businessId}::uuid`.execute(tx)).rows[0]?.country ?? null;
}
