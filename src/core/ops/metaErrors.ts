/**
 * CEIL (the one-month build order, 2026-09-30) — when does a workspace's error
 * rate on Meta's channels need the operator?
 *
 * Meta restricts an app whose messages it keeps refusing, and one app carries
 * every workspace's Instagram and Messenger: one workspace sending into errors
 * can cost all of them. So every hour the operator is told of any workspace
 * where, over the last day, Meta refused or lost at least `MIN_FAILED`
 * messages AND at least one in `RATE_DENOMINATOR` of all it was given. Both,
 * because two failures out of three is noise and forty out of four thousand
 * is a normal day.
 *
 * Counted from the outbound rows' own status and the provider's own words
 * (migration 0085, `meta_error_rates`); our gate's refusals are not Meta's
 * errors and are not counted.
 */

export const META_ERROR_WINDOW_HOURS = 24;
export const META_ERROR_MIN_FAILED = 5;
/** One in five: the share of a day's messages that makes the count news. */
export const META_ERROR_RATE_DENOMINATOR = 5;
/** At most one alert in this many hours: the next hour's check would repeat it word for word. */
export const META_ERROR_ALERT_EVERY_HOURS = 6;

export type MetaErrorRate = {
  readonly business: string;
  readonly attempted: number;
  readonly failed: number;
  /** The provider's own words, a few, as the rows hold them. */
  readonly errors: readonly string[];
};

/** The workspaces the operator must hear about, the worst share first. */
export function metaErrorAlarms(rates: readonly MetaErrorRate[]): MetaErrorRate[] {
  return rates
    .filter((r) => r.attempted > 0 && r.failed >= META_ERROR_MIN_FAILED
      && r.failed * META_ERROR_RATE_DENOMINATOR >= r.attempted)
    .sort((a, b) => b.failed / b.attempted - a.failed / a.attempted || b.failed - a.failed);
}
