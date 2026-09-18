/**
 * A1 — how often the door may be tried.
 *
 * In memory, per process, and deliberately small. It is the SECOND line: the
 * first is in the database — five wrong passwords lock that login for fifteen
 * minutes (0055, `login_record`), which holds across restarts and replicas.
 * This one stops a stranger from making the process spend a slow hash, or a
 * new tenant, as fast as it can send requests.
 *
 * Sliding window over timestamps; a key that goes quiet is forgotten.
 */
export type Throttle = {
  /** Counts this attempt. False when the key has used its allowance. */
  allow(key: string, now: number): boolean;
};

export function makeThrottle(opts: { readonly max: number; readonly windowMs: number; readonly maxKeys?: number }): Throttle {
  const hits = new Map<string, number[]>();
  const maxKeys = opts.maxKeys ?? 5000;
  return {
    allow(key, now) {
      const since = now - opts.windowMs;
      const kept = (hits.get(key) ?? []).filter((t) => t > since);
      if (kept.length >= opts.max) { hits.set(key, kept); return false; }
      kept.push(now);
      hits.set(key, kept);
      // A flood of distinct keys must not grow without bound: drop the oldest.
      if (hits.size > maxKeys) {
        const first = hits.keys().next().value;
        if (first !== undefined) hits.delete(first);
      }
      return true;
    },
  };
}

/**
 * The address the last trusted hop saw. Behind the host's proxy `req.ip` is the
 * proxy itself; the proxy APPENDS the caller to `X-Forwarded-For`, so the last
 * entry is the one a client cannot forge. Anything earlier in the list is the
 * client's own claim and is ignored.
 */
export function callerKey(forwardedFor: string | string[] | undefined, socketIp: string | undefined): string {
  const raw = Array.isArray(forwardedFor) ? forwardedFor.join(',') : (forwardedFor ?? '');
  const last = raw.split(',').map((s) => s.trim()).filter(Boolean).pop();
  return last ?? socketIp ?? 'unknown';
}
