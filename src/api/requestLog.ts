/**
 * D2 (the data-protection audit, 2026-10-12) — WHAT A REQUEST LEAVES IN THE LOG.
 *
 * Fastify's default request log is the whole URL and the caller's address. The
 * URL carried a buyer's name, phone or e-mail in a search (`/app/inbox?q=`), an
 * address in a contact link (`?identity=`), a customer's own question
 * (`/app/sandbox?ask=`, `/app/knowledge?teach=`) and an unsubscribe token that
 * decodes to an e-mail address (`/u?t=`) — all in Railway's logs, which no
 * deletion reaches. The log keeps the method, the PATH and the host: what a
 * request was, never what it said, never who sent it.
 */

import type { FastifyServerOptions } from 'fastify';
import { loggableError } from '../security/loggable.js';

/** The path of a request URL: everything before `?`. */
export const pathOnly = (url: string | undefined): string => (url ?? '').split('?')[0] ?? '';

type RequestLike = { readonly method?: string; readonly url?: string; readonly host?: string; readonly hostname?: string };

/** The one request serializer: method, path, host. No query, no client address. */
export const requestLogLine = (req: RequestLike): { method?: string; url: string; hostname?: string } => {
  const host = req.host ?? req.hostname;
  return { ...(req.method ? { method: req.method } : {}), url: pathOnly(req.url), ...(host ? { hostname: host } : {}) };
};

/**
 * The logger option every Fastify instance here is built with: off, or on with
 * the request line above and errors as `loggableError` shows them (a database
 * error's `detail` holds the row it refused).
 */
export function requestLogger(on: boolean): NonNullable<FastifyServerOptions['logger']> {
  return on ? { serializers: { req: (req) => requestLogLine(req as RequestLike), err: (e: unknown) => { const l = loggableError(e); return { ...l, stack: l.stack ?? '' }; } } } : false;
}
