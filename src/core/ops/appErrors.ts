/**
 * CC-10 — WHAT WENT WRONG INSIDE THE INSTALLATION, AS RULES.
 *
 * The audit: "If the app throws at 3 a.m. nobody learns." Every failure path —
 * a page that crashed, a queue job that failed, the process itself — now
 * records the error in `app_errors` (0074), and the operator is e-mailed. This
 * module is the part of that which is RULES rather than I/O, so it is tested
 * without a database or a clock:
 *
 *   · how one error is told apart from another — the inputs to its
 *     fingerprint: where it happened, its name, and the first stack frame
 *     inside this repository (or, for an error with no such frame, the shape
 *     of its message);
 *   · what is kept of its words — secret-shaped text removed, then cut;
 *   · when an alert is owed — first sight, then again only after six hours
 *     without one, and never more than six in an hour.
 *
 * Never a request body, never a buyer's message beyond what the error message
 * itself holds: the recorder is handed an error and a little context (a route
 * PATTERN, a business id), and that is all it can write down.
 */

/** Where an error happened: a page, a queue's worker, or the process itself. */
export type ErrorWhere = 'web' | 'process' | `worker:${string}`;

/** What the caller knows beyond the error. Never a body, never an address as asked. */
export type ErrorContext = {
  /** The workspace the failing work was for, when there is one — context only. */
  readonly businessId?: string | null;
  /** A page's route PATTERN (`GET /app/inbox/:id`), never the URL, which can carry a token. */
  readonly route?: string | null;
};

/**
 * The one call every failure path makes. It never rejects and never throws
 * into its caller: an error while recording an error is logged, not recorded,
 * so it cannot loop.
 */
export type ReportError = (err: unknown, where: ErrorWhere, context?: ErrorContext) => Promise<void>;

/** A fingerprint is alerted when first seen, then again only if it recurs this long after its last alert. */
export const ALERT_AGAIN_AFTER_HOURS = 6;
/** At most this many error alerts leave in any hour; the rest are held and counted in the next. */
export const ALERTS_PER_HOUR = 6;
/** What is kept of an error's message, after redaction. */
export const MESSAGE_MAX = 500;

/**
 * Is an alert owed for this fingerprint now? Not while it is already held for
 * one; yes when it has never been alerted; otherwise only once six hours have
 * passed since the last alert.
 */
export function alertOwed(
  row: { readonly lastAlertedAt: Date | null; readonly heldAt: Date | null }, now: Date,
): boolean {
  if (row.heldAt) return false;
  if (!row.lastAlertedAt) return true;
  return now.getTime() - row.lastAlertedAt.getTime() >= ALERT_AGAIN_AFTER_HOURS * 3_600_000;
}

/** `where` in the one shape the table accepts: `web`, `process`, or `worker:<queue>`. */
export function errorWhere(raw: string): ErrorWhere {
  if (raw === 'web' || raw === 'process') return raw;
  const queue = (raw.startsWith('worker:') ? raw.slice('worker:'.length) : raw)
    .toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 100);
  return `worker:${queue || 'unknown'}`;
}

/** Anything thrown, as a name, a message (with one level of cause), a stack and a code. */
export type Thrown = {
  readonly name: string;
  readonly message: string;
  readonly stack: string | null;
  /** A driver's own code — Postgres's SQLSTATE, a socket's ECONNREFUSED. */
  readonly code: string | null;
};

const text = (v: unknown): string => {
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
};

export function describeThrown(err: unknown): Thrown {
  if (typeof err !== 'object' || err === null) {
    return { name: 'NonError', message: text(err), stack: null, code: null };
  }
  const e = err as { name?: unknown; message?: unknown; stack?: unknown; code?: unknown; cause?: unknown };
  const name = typeof e.name === 'string' && e.name.trim() !== '' ? e.name.trim() : 'Error';
  let message = 'message' in e ? text(e.message) : text(err);
  // `fetch failed` says nothing; its cause says which address refused.
  const cause = e.cause;
  if (typeof cause === 'object' && cause !== null && 'message' in cause) {
    const c = cause as { name?: unknown; message?: unknown };
    message += ` (cause: ${typeof c.name === 'string' ? c.name : 'Error'}: ${text(c.message)})`;
  }
  const code = typeof e.code === 'string' || typeof e.code === 'number' ? String(e.code).slice(0, 40) : null;
  return { name, message, stack: typeof e.stack === 'string' ? e.stack : null, code };
}

/**
 * The first frame of a stack that lies inside this repository — outside
 * `node_modules`, outside Node's own code — as `src/api/web/app.ts:619`.
 *
 * The line is kept on purpose: two errors of one kind thrown from two places
 * are two things to fix. A deploy that moves the line makes a recurring error
 * "new" again, which is one alert, and says the deploy did not fix it.
 *
 * Frames arrive as plain paths or as `file://` URLs (ESM), percent-encoded —
 * this checkout's own path has a space and a curly apostrophe in it.
 */
export function firstRepoFrame(stack: string | null, root: string): string | null {
  if (!stack) return null;
  const base = root.replace(/\/+$/, '');
  for (const raw of stack.split('\n').slice(1)) {
    const m = /\(?((?:file:\/\/)?\/[^()]*?):(\d+):\d+\)?$/.exec(raw.trim());
    if (!m) continue;
    let path = m[1]!;
    if (path.startsWith('file://')) {
      try { path = decodeURIComponent(path.slice('file://'.length)); } catch { continue; }
    }
    if (!path.startsWith(`${base}/`) || path.includes('/node_modules/')) continue;
    return `${path.slice(base.length + 1)}:${m[2]}`.slice(0, 300);
  }
  return null;
}

/**
 * A message with what changes from one occurrence to the next taken out — ids,
 * numbers, quoted values. It stands in for the stack frame when there is none:
 * an error the database raised carries no frame of ours, and without this every
 * one of them in a queue would be the same row, and a new one would be silent
 * for six hours behind an old one.
 */
export function messageShape(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\b(?:0x)?[0-9a-f]{8,}\b/gi, '<hex>')
    .replace(/'[^']*'/g, "'…'")
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/** A run inside an address that is a key rather than a word: long, letters AND digits. */
const OPAQUE = /^[A-Za-z0-9_-]{20,}$/;
const opaque = (s: string): boolean => OPAQUE.test(s) && /\d/.test(s) && /[A-Za-z]/.test(s);

/**
 * Secret-shaped text the shared redactor (`redactSecrets`: Bearer, api_key,
 * password, the 360dialog key, the values the environment holds) does not
 * know. Run after it, on anything written to `app_errors`:
 *
 *   · the password inside a connection URL (`postgres://user:PASSWORD@host`);
 *   · the query string of any address — tokens travel there (`?t=`, `?code=`);
 *   · a long opaque segment of an address path — a ping key, a proof token;
 *   · keys and tokens by their well-known shapes (`sk-…`, Meta's `EAA…`, JWTs);
 *   · `token=…`, `secret: …`, `authorization=…` and their kin.
 */
export function scrubSecrets(input: string): string {
  return input
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, '$1[redacted]@')
    .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (url) => {
      const q = url.indexOf('?');
      const path = (q >= 0 ? url.slice(0, q) : url)
        .split('/').map((seg, i) => (i > 2 && opaque(seg) ? '[redacted]' : seg)).join('/');
      return q >= 0 ? `${path}?[redacted]` : path;
    })
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, '[redacted]')
    .replace(/\bEAA[A-Za-z0-9]{20,}/g, '[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}/g, '[redacted]')
    .replace(/\b((?:access_token|refresh_token|client_secret|secret|token|authorization|cookie)["']?\s*[:=]\s*["']?)[^\s"',;}&]+/gi,
      '$1[redacted]');
}

/** Cut to `max` characters, saying so. */
export function cut(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
