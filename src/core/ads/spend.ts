/**
 * 0238 — ad spend, the pure parts: Meta's amount as a decimal string, the usage headers, the placements' names
 * and a month's days. No I/O.
 */

/** Meta's `spend`: a numeric string. Digits, at most one point, nothing else: no sign, no exponent, no comma. */
export const isMetaAmount = (s: string): boolean => /^[0-9]{1,15}(\.[0-9]{1,6})?$/.test(s);

// ── The usage headers (Graph rate limiting; Insights best practices) ─────────────────────────────────────────

export type Usage = {
  /** The three headers, as Meta sent them, parsed; a header that is not JSON is kept as null. Never a token. */
  readonly headers: Readonly<Record<string, unknown>>;
  /** The highest percentage any of them reports, or null when none was sent. */
  readonly peak: number | null;
  /** How long Meta says to wait, in seconds: `estimated_time_to_regain_access` (minutes) or `reset_time_duration`. */
  readonly waitSec: number | null;
};

export const USAGE_HEADERS = ['x-business-use-case-usage', 'x-ad-account-usage', 'x-fb-ads-insights-throttle'] as const;
const PCT_KEYS = ['call_count', 'total_cputime', 'total_time', 'acc_id_util_pct', 'app_id_util_pct'] as const;

const parseJson = (s: string | null): unknown => {
  if (s === null) return undefined;
  try { return JSON.parse(s); } catch { return null; }
};

/** Every object inside a header's value: the BUC header nests an array of them under each business id. */
const objectsIn = (v: unknown, out: Record<string, unknown>[] = [], depth = 0): Record<string, unknown>[] => {
  if (depth > 4 || v === null || typeof v !== 'object') return out;
  if (Array.isArray(v)) { for (const x of v) objectsIn(x, out, depth + 1); return out; }
  out.push(v as Record<string, unknown>);
  for (const x of Object.values(v as Record<string, unknown>)) if (typeof x === 'object') objectsIn(x, out, depth + 1);
  return out;
};

export function readUsage(header: (name: string) => string | null): Usage {
  const headers: Record<string, unknown> = {};
  let peak: number | null = null; let waitSec: number | null = null;
  for (const name of USAGE_HEADERS) {
    const parsed = parseJson(header(name));
    if (parsed === undefined) continue;
    headers[name] = parsed;
    for (const o of objectsIn(parsed)) {
      for (const k of PCT_KEYS) {
        const n = o[k];
        if (typeof n === 'number' && Number.isFinite(n) && (peak === null || n > peak)) peak = n;
      }
      const regain = o['estimated_time_to_regain_access'];
      if (typeof regain === 'number' && regain > 0 && (waitSec === null || regain * 60 > waitSec)) waitSec = regain * 60;
      const reset = o['reset_time_duration'];
      if (typeof reset === 'number' && reset > 0 && (waitSec === null || reset > waitSec)) waitSec = reset;
    }
  }
  return { headers, peak, waitSec };
}

// ── Placements and channels ──────────────────────────────────────────────────────────────────────────────────

/**
 * The placements with a name on the page (O3: Meta's list is not in the saved pages). Any other value is kept
 * exactly as sent and shown under "Other placements", each on its own line — never folded into one of these.
 */
export const NAMED_PLATFORMS = ['instagram', 'facebook', 'messenger'] as const;
export type NamedPlatform = (typeof NAMED_PLATFORMS)[number];
export const isNamedPlatform = (p: string): p is NamedPlatform => (NAMED_PLATFORMS as readonly string[]).includes(p);

/**
 * Which conversations' orders stand beside a placement's spend. Instagram ads beside Instagram conversations,
 * Messenger ads beside Messenger conversations. Facebook placements have no conversation channel of their own
 * (their messages arrive on Messenger), so they are shown with spend only and no order is ever counted twice.
 */
export const CHANNEL_OF: Readonly<Record<NamedPlatform, 'instagram' | 'messenger' | null>> = {
  instagram: 'instagram', messenger: 'messenger', facebook: null,
};

// ── Months ───────────────────────────────────────────────────────────────────────────────────────────────────

/** `YYYY-MM` → its first and last day, as the account's own dates (Meta reports days in the account's zone). */
export function monthDays(month: string): { readonly first: string; readonly last: string; readonly next: string } | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]);
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const ny = mo === 12 ? y + 1 : y; const nm = mo === 12 ? 1 : mo + 1;
  return { first: `${month}-01`, last: `${month}-${String(lastDay).padStart(2, '0')}`, next: `${ny}-${String(nm).padStart(2, '0')}-01` };
}

/** Today's date in a zone, `YYYY-MM-DD`. */
export const dayIn = (at: Date, zone: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

/** A date plus or minus whole days, `YYYY-MM-DD`. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

/** Meta's data does not change after 28 days of being reported: the re-read covers that window. */
export const REREAD_DAYS = 28;

/**
 * What a read asks for: on the first, from the first day of the previous month (so the last full month is
 * there); afterwards the last 28 days. Both end today, in the account's zone.
 */
export function readSpan(today: string, firstRead: boolean): { readonly since: string; readonly until: string } {
  if (!firstRead) return { since: addDays(today, -(REREAD_DAYS - 1)), until: today };
  const [y, m] = today.split('-').map(Number);
  const py = m === 1 ? y! - 1 : y!; const pm = m === 1 ? 12 : m! - 1;
  return { since: `${py}-${String(pm).padStart(2, '0')}-01`, until: today };
}
