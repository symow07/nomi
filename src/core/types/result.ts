/**
 * Explicit failure. No exceptions in `core/`.
 *
 * The Milestone-0 bug was an *implicit* failure: order confirmation silently
 * could never succeed, and nothing anywhere said so. A `Result` forces the
 * caller to look at the failure case, because they cannot reach the value
 * without handling it.
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const isOk = <T, E>(r: Result<T, E>): r is { ok: true; value: T } => r.ok;
export const isErr = <T, E>(r: Result<T, E>): r is { ok: false; error: E } => !r.ok;

export function map<T, U, E>(r: Result<T, E>, f: (t: T) => U): Result<U, E> {
  return r.ok ? ok(f(r.value)) : r;
}

/** Unwrap or throw. Permitted at the edges (api/worker), never inside core. */
export function expect<T, E>(r: Result<T, E>, message: string): T {
  if (r.ok) return r.value;
  throw new Error(`${message}: ${JSON.stringify(r.error)}`);
}
