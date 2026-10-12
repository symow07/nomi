import { describeThrown, scrubSecrets } from '../core/ops/appErrors.js';
import { redactSecrets } from './credentials.js';

/**
 * D2 (the data-protection audit, 2026-10-12) — AN ERROR AS THE LOG MAY SHOW IT.
 *
 * The hosting platform keeps its logs, and no deletion reaches them, so a log
 * line names what failed and never a value it was carrying. Kept: the error's
 * kind, its code, its message with quoted values taken out, and the stack's
 * frames. Left out: a database error's `detail` ("Failing row contains (…)",
 * "Key (email)=(…)"), which holds the row; a parser's snippet (`"…" is not
 * valid JSON`, cut short or not), which holds the model's answer and so the
 * buyer's words; a quoted value after a colon; any quoted run that has a space
 * in it or is long (a name, a sentence) — except a provider's own
 * `"message":"…"` reason, which is how a refused key is found; the stack's
 * first line, which repeats the message.
 */
export type LoggableError = { readonly type: string; readonly code?: string; readonly message: string; readonly stack?: string };

/** A quoted run at least this long is text, not an identifier or a code. */
const LONG_QUOTE = 40;
/** A provider's error body: `{"error":{"message":"invalid x-api-key"}}`. */
const PROVIDER_REASON = /"message":\s*$/;
/** Frames kept from a stack. */
const FRAMES = 8;

export function loggableMessage(message: string): string {
  const shaped = message
    .replace(/, "[\s\S]*?"(?:\.\.\.)? is not valid JSON/g, ', "…" is not valid JSON')
    .replace(/(: )"[^"]*"/g, '$1"…"')
    .replace(/"([^"]*)"/g, (whole, body: string, at: number, all: string) =>
      PROVIDER_REASON.test(all.slice(Math.max(0, at - 12), at)) || (!/\s/.test(body) && body.length < LONG_QUOTE)
        ? whole : '"…"')
    .replace(/\s+/g, ' ')
    .trim();
  return scrubSecrets(redactSecrets(shaped)).slice(0, 300);
}

export function loggableError(err: unknown): LoggableError {
  const t = describeThrown(err);
  const frames = (t.stack ?? '').split('\n').filter((l) => /^\s+at /.test(l)).slice(0, FRAMES).map((l) => l.trim());
  return {
    type: t.name,
    ...(t.code ? { code: t.code } : {}),
    message: loggableMessage(t.message),
    ...(frames.length > 0 ? { stack: scrubSecrets(frames.join('\n')) } : {}),
  };
}

/** The same, as text for `console.error`; the frames only when asked for. */
export const loggableLine = (err: unknown, frames = true): string => {
  const e = loggableError(err);
  return `${e.type}${e.code ? ` [${e.code}]` : ''}: ${e.message}${frames && e.stack ? `\n${e.stack}` : ''}`;
};
