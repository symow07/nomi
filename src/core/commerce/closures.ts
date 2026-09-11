/**
 * M44 — the factory closure calendar.
 *
 * Nothing in this product knows about Chinese New Year, and every lead time it
 * quotes in January is therefore a lie stated with confidence. "25 days" from
 * the 20th of January lands inside two weeks when the machines are off, the
 * workers are on trains, and the owner is at her mother's table. The number is
 * correct arithmetic and a false promise, which is the worst combination
 * available: it is checkable, and a buyer will check it.
 *
 * ── THE CALENDAR IS HERS ──────────────────────────────────────────────────
 *
 * There is no built-in holiday table here, and that is the whole design.
 *
 *   · The dates move. Chinese New Year is lunar; Ramadan is lunar and shifts
 *     eleven days a year against the Gregorian calendar.
 *   · The LENGTH is not a date at all, it is a business decision. One factory
 *     in Yiwu closes for eight days and one closes for five weeks, and both are
 *     normal. A table would have to guess, and a guess about when someone
 *     else's factory is shut is exactly the kind of outside number this product
 *     refuses everywhere else.
 *   · She already knows. She has known since November.
 *
 * So she states her closures, the same way she states her floor and her rate,
 * and this module does nothing but check dates against what she wrote.
 *
 * ── IT REFUSES; IT DOES NOT RESCHEDULE ────────────────────────────────────
 *
 * The obvious alternative is to add the closed days to the lead time and quote
 * the later date. That is an invented promise: a factory does not resume at
 * full rate the morning it reopens, half her staff may not come back, and the
 * new date is one SHE never agreed to. So a blocked lead time becomes no lead
 * time — and the numeral guard then makes it impossible for any reply to state
 * one, because a number that is not in the quote cannot be said.
 *
 * Pure per ADR-0002. Loading her closures is the caller's job.
 */

/** A period the factory is shut, as the owner stated it. */
export type FactoryClosure = {
  /** Her own words: "春节", "Eid", "annual maintenance". Never inferred. */
  readonly label: string;
  /** Inclusive first closed day. */
  readonly from: Date;
  /** Inclusive last closed day. */
  readonly to: Date;
};

export type LeadTimeBlocked = {
  readonly kind: 'factory_closed';
  readonly closure: FactoryClosure;
  /** The date the lead time WOULD have promised. Never stated to a buyer. */
  readonly wouldShipOn: Date;
};

/**
 * G5 — what is kept with a quote whose date she withheld: her closure, and
 * NOT `wouldShipOn`. This is what the buyer's proof page reads, and the date a
 * lead time would have promised is exactly the date that must never reach
 * him — not on the page, and not in a column the page can select.
 */
export type WithheldLeadTime = { readonly label: string; readonly from: Date; readonly to: Date };

export const withheldOf = (b: LeadTimeBlocked): WithheldLeadTime =>
  ({ label: b.closure.label, from: b.closure.from, to: b.closure.to });

/**
 * G5 — the note the reply writer is given when a closure withheld the date,
 * so the BUYER hears why rather than only noticing that no date came. Her
 * label only: the closure's own dates are not in it, because every digit a
 * reply may contain must be sourced, and a date in a note is a date the model
 * will restate.
 */
export function closureNote(b: LeadTimeBlocked): string {
  return `The factory is closed for ${b.closure.label}, so no delivery date can be promised `
    + `for this order yet. Say so plainly and kindly. Do not state or estimate a lead time.`;
}

const DAY_MS = 86_400_000;

/** Midnight-to-midnight, so a closure that starts today counts as today. */
const startOfDay = (d: Date): number =>
  Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
const endOfDay = (d: Date): number => startOfDay(d) + DAY_MS - 1;

/**
 * Does anything she stated fall inside the window this lead time promises?
 *
 * The window is [now, now + leadTimeDays]. A closure ANYWHERE inside it blocks
 * the promise — not only one at the end. Fifteen days shut in the middle of a
 * twenty-five-day lead time is twenty-five days of nothing being made.
 *
 * Returns the FIRST blocking closure by start date, because that is the one she
 * needs to see: the nearest reason the date cannot be met.
 */
export function blockingClosure(input: {
  readonly now: Date;
  readonly leadTimeDays: number;
  readonly closures: readonly FactoryClosure[];
}): LeadTimeBlocked | null {
  const { now, leadTimeDays, closures } = input;
  if (leadTimeDays <= 0) return null;

  const windowStart = startOfDay(now);
  const windowEnd = endOfDay(new Date(startOfDay(now) + leadTimeDays * DAY_MS));

  const blocking = closures
    .filter((c) => startOfDay(c.from) <= windowEnd && endOfDay(c.to) >= windowStart)
    .sort((a, b) => startOfDay(a.from) - startOfDay(b.from))[0];

  return blocking
    ? {
        kind: 'factory_closed',
        closure: blocking,
        wouldShipOn: new Date(startOfDay(now) + leadTimeDays * DAY_MS),
      }
    : null;
}

export type ClosureError = 'label_missing' | 'from_missing' | 'to_missing' | 'not_a_date' | 'ends_before_starts';

/**
 * What she typed into the two date boxes.
 *
 * No opinion about how long a closure may be or how far ahead it may sit: a
 * six-week shutdown next March is her business, and a band would be this module
 * knowing something about her factory that it does not know.
 */
export function validateClosure(input: {
  readonly label: string | null | undefined;
  readonly from: string | null | undefined;
  readonly to: string | null | undefined;
}): { ok: true; value: FactoryClosure } | { ok: false; error: ClosureError } {
  const label = (input.label ?? '').trim();
  if (!label) return { ok: false, error: 'label_missing' };
  if (!(input.from ?? '').trim()) return { ok: false, error: 'from_missing' };
  if (!(input.to ?? '').trim()) return { ok: false, error: 'to_missing' };

  const from = parseYmd((input.from ?? '').trim());
  const to = parseYmd((input.to ?? '').trim());
  if (from === null || to === null) return { ok: false, error: 'not_a_date' };
  // A closure that ends before it starts is a typo, and a typo here silently
  // stops blocking anything — the failure would be invisible.
  if (endOfDay(to) < startOfDay(from)) return { ok: false, error: 'ends_before_starts' };

  return { ok: true, value: { label: label.slice(0, 80), from, to } };
}

/**
 * A `date` column, as either driver representation, at UTC midnight.
 *
 * node-postgres parses a bare `date` into a JS Date at LOCAL midnight, so a row
 * reading 2027-02-05 arrives as 2027-02-04T23:00:00Z in a UTC+1 process — and
 * `toISOString().slice(0,10)` then reports the day before. A closure shifted by
 * one day is a promise that lands on the first day the factory is shut.
 *
 * So the calendar parts are read in the driver's own frame and re-anchored to
 * UTC midnight, and a plain string (some drivers, and every JSON round-trip) is
 * read as the date it plainly is.
 */
export function closureDate(v: unknown): Date {
  if (v instanceof Date) {
    return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
  }
  const parsed = parseYmd(String(v).slice(0, 10));
  // A row that reached the database passed the column's own `date` type, so an
  // unparseable one here means the driver handed back something new. Epoch is
  // the loud answer: it blocks nothing and matches nothing, rather than
  // quietly becoming today.
  return parsed ?? new Date(0);
}

/**
 * "YYYY-MM-DD" at UTC midnight, or null.
 *
 * Constructed from parts and checked for round-trip rather than parsed from a
 * string: `Date.UTC(2027, 1, 30)` silently becomes the 2nd of March, and a
 * closure that moved a month would block the wrong window while looking
 * perfectly valid.
 */
function parseYmd(raw: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const at = new Date(Date.UTC(y, mo - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === mo - 1 && at.getUTCDate() === d
    ? at
    : null;
}
