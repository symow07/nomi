import type { SendResult } from './contract.js';

/**
 * Audit batch 1 (B5, 2026-10-30) — A SEND THAT GOT NO ANSWER MAY HAVE LEFT.
 *
 * A provider that timed out, or dropped the connection after the request was
 * written, may well have accepted the message: retrying it is how a customer
 * gets the same reply twice. Only a request that provably never reached the
 * provider — the address did not resolve, the connection was refused — is
 * safe to try again. Everything else is `uncertain`: the row stops, and the
 * owner is shown it and decides (0052), exactly as for a send a crash cut off.
 */

/** Error codes that mean the request was never written to the provider. */
const NEVER_LEFT = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT',
]);

const codeOf = (e: unknown): string | null => {
  if (typeof e !== 'object' || e === null) return null;
  const own = (e as { code?: unknown }).code;
  if (typeof own === 'string') return own;
  const cause = (e as { cause?: unknown }).cause;
  return cause === e ? null : codeOf(cause);
};

/** Did this thrown error happen before the request reached the provider? */
export function neverLeft(e: unknown): boolean {
  const code = codeOf(e);
  return code !== null && NEVER_LEFT.has(code);
}

/** What a send that THREW reports: retried only when it provably never left. */
export function thrownSend(provider: string, e: unknown): Extract<SendResult, { ok: false }> {
  if (neverLeft(e)) return { ok: false, retryable: true, error: `${provider} unreachable` };
  const timedOut = typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'TimeoutError';
  return { ok: false, retryable: false, uncertain: true, error: `${provider}: ${timedOut ? 'no answer in time' : 'connection lost'}` };
}

/** A provider said yes and named nothing it accepted: it may be on its way, and nothing here can tell. */
export const acceptedWithoutId = (provider: string): Extract<SendResult, { ok: false }> =>
  ({ ok: false, retryable: false, uncertain: true, error: `${provider} accepted without an id` });
