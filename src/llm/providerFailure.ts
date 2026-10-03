/**
 * BILLING RESILIENCE (2026-10-04) — WHY THE MODEL PROVIDER DID NOT ANSWER.
 *
 * On 2026-10-01 the provider's account ran out of credit and Nomi stalled for
 * hours with nothing saying why. This tells a refusal FOR MONEY apart from
 * everything else a provider can do, because the two need opposite handling:
 * a timeout or an overloaded moment is worth retrying; a billing refusal is
 * not — it answers the same way until somebody tops the account up, so the
 * turn goes to a person at once and the operator is told the real reason.
 *
 * The documented shapes, and only those (each held by
 * tests/parity/provider-failure.test.ts with the documented body):
 *
 *   · HTTP 402, from any provider. DeepSeek: "402 - Insufficient Balance —
 *     You have run out of balance" (api-docs.deepseek.com/quick_start/error_codes).
 *     Anthropic: "402 - billing_error: There's an issue with your billing or
 *     payment information" (platform.claude.com/docs/en/api/errors).
 *   · Any status whose words say DeepSeek's "Insufficient Balance".
 *   · Anthropic's "Your credit balance is too low to access the Anthropic
 *     API…", an HTTP 400 `invalid_request_error` — the body Anthropic sends
 *     when prepaid credits run out (the status is 400, so the words decide).
 *   · Anthropic's spend limits (platform.claude.com/docs/en/api/rate-limits):
 *     a limit the operator set answers HTTP 400 `invalid_request_error` whose
 *     message begins "You have reached your specified API usage limits" (or
 *     "…workspace API usage limits"); the tier's monthly cap answers HTTP 429
 *     `rate_limit_error` with `error.details.error_code`
 *     "enforced_spend_limit_reached" — not a rate limit: retrying fails until
 *     the month turns or the limit is raised.
 *
 * Everything else is NOT billing: a 429 that is a rate limit, 529/503
 * overloaded, other 5xx, a timeout, an invalid request, a bad key. A body that
 * merely mentions "balance" is not enough.
 *
 * Pure, and duck-typed over the SDK's error (status, error body, message), so a
 * stub server's answer and the SDK's thrown error are read by one function.
 */

export type ProviderFailure =
  /** The provider refuses for money. `words` are its own (cut, for the operator only). */
  | { readonly kind: 'billing'; readonly status: number | null; readonly words: string }
  /** No answer in time, or the connection was cut: worth the queue's retry. */
  | { readonly kind: 'timeout' }
  /** 529, 503, or Anthropic's `overloaded_error`. */
  | { readonly kind: 'overloaded'; readonly status: number | null }
  /** A rate limit that clears by itself (a spend cap is billing, above). */
  | { readonly kind: 'rate_limited'; readonly status: number }
  /** 401 / 403: the key is wrong or revoked — the operator's, but not money. */
  | { readonly kind: 'auth'; readonly status: number }
  /** Any other 5xx. */
  | { readonly kind: 'server'; readonly status: number }
  /** Anything else: an invalid request, an unknown shape, a plain exception. */
  | { readonly kind: 'other'; readonly status: number | null };

/** The provider's own words are kept this long at most, for the operator's alert. */
export const PROVIDER_WORDS_MAX = 200;

type Obj = { readonly [k: string]: unknown };
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The error object inside a body: Anthropic's `{type:'error', error:{…}}` and DeepSeek's `{error:{…}}` alike. */
function errorOf(body: unknown): Obj | null {
  if (!isObj(body)) return null;
  const e = body['error'];
  return isObj(e) ? e : null;
}

/** Every string the provider said about it: the message, its type and code, the details' code. */
function wordsOf(body: unknown, fallback = ''): { readonly message: string; readonly type: string; readonly code: string; readonly detailCode: string } {
  const e = errorOf(body);
  const details = e && isObj(e['details']) ? e['details'] : null;
  return {
    message: str(e?.['message']) || (typeof body === 'string' ? body : '') || fallback,
    type: str(e?.['type']),
    code: str(e?.['code']),
    detailCode: str(details?.['error_code']),
  };
}

const INSUFFICIENT_BALANCE = /insufficient[ _-]?balance/i;
const CREDIT_TOO_LOW = /credit balance is too low/i;
const SPEND_LIMIT_SET = /^you have reached your specified (workspace )?api usage limits/i;

/** One line, no control characters, cut: what the operator reads in an alert. */
export function providerWords(s: string): string {
  // eslint-disable-next-line no-control-regex
  const one = s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return one.length > PROVIDER_WORDS_MAX ? `${one.slice(0, PROVIDER_WORDS_MAX - 1)}…` : one;
}

/**
 * A response the provider sent: its status and its parsed body (or text).
 * Null for a success (2xx): nothing failed.
 */
export function classifyProviderResponse(status: number, body: unknown): ProviderFailure | null {
  if (status >= 200 && status < 300) return null;
  const w = wordsOf(body);
  const said = providerWords(w.message || w.code || w.type || `HTTP ${status}`);
  const billing =
    status === 402
    || w.type === 'billing_error'
    || INSUFFICIENT_BALANCE.test(w.message) || INSUFFICIENT_BALANCE.test(w.code)
    || CREDIT_TOO_LOW.test(w.message)
    || (status === 400 && SPEND_LIMIT_SET.test(w.message.trim()))
    || w.detailCode === 'enforced_spend_limit_reached';
  if (billing) return { kind: 'billing', status, words: said };
  if (status === 529 || status === 503 || w.type === 'overloaded_error') return { kind: 'overloaded', status };
  if (status === 429) return { kind: 'rate_limited', status };
  if (status === 401 || status === 403) return { kind: 'auth', status };
  if (status === 408 || status === 504 || w.type === 'timeout_error') return { kind: 'timeout' };
  if (status >= 500) return { kind: 'server', status };
  return { kind: 'other', status };
}

/** What a timeout looks like once thrown: the SDK's own, an abort, or the platform's. */
function isTimeoutLike(e: Obj): boolean {
  const name = str(e['name']) || str((e as { constructor?: { name?: unknown } }).constructor?.name);
  const message = str(e['message']);
  return name === 'APIConnectionTimeoutError' || name === 'AbortError' || name === 'TimeoutError'
    || /timed? ?out/i.test(message);
}

/**
 * A thrown error, whatever threw it: the SDK's APIError (status, parsed body,
 * message), a connection error, or anything else.
 */
export function classifyProviderFailure(e: unknown): ProviderFailure {
  if (!isObj(e)) return { kind: 'other', status: null };
  const status = typeof e['status'] === 'number' ? e['status'] : null;
  if (status !== null) {
    // The SDK keeps the parsed body as `error`; a body that was not JSON is its message.
    const body = errorOf(e['error']) ? e['error'] : str(e['message']);
    return classifyProviderResponse(status, body) ?? { kind: 'other', status };
  }
  if (isTimeoutLike(e)) return { kind: 'timeout' };
  const cause = e['cause'];
  if (isObj(cause) && isTimeoutLike(cause)) return { kind: 'timeout' };
  // A connection error carries no status; its words may still be a billing refusal (a proxy's).
  const message = str(e['message']);
  if (INSUFFICIENT_BALANCE.test(message) || CREDIT_TOO_LOW.test(message)) {
    return { kind: 'billing', status: null, words: providerWords(message) };
  }
  return { kind: 'other', status: null };
}

export const isBillingRefusal = (e: unknown): boolean => classifyProviderFailure(e).kind === 'billing';
