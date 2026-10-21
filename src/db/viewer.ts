import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * B0 (Phase 5; the owner, 2026-10-22) — WHO IS ASKING, for the database. A signed-in request runs inside this scope,
 * and every tenant transaction it opens says so (`app.viewer_id`), so the database can answer for itself what an
 * accountant may see: the books, and no row of the sales side (0177, `viewer_is_accountant()`). The route guard
 * (A5) is the first wall; this is the second, for the day a route forgets.
 *
 * Outside a request (the worker, the webhooks, the tools) there is no viewer and nothing changes.
 */
const scope = new AsyncLocalStorage<{ readonly personId: string }>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Run `fn` as this person. The environment's owner before M47 has no person row ('owner'): no viewer is set. */
export function asViewer<T>(personId: string, fn: () => T): T {
  return UUID.test(personId) ? scope.run({ personId }, fn) : fn();
}

/** The person this transaction is opened for, or '' (the setting's "nobody"). */
export function viewerId(): string {
  return scope.getStore()?.personId ?? '';
}
