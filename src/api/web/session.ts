import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * M9.1 — Owner session, minimal and dependency-free. A signed cookie
 * (HMAC-SHA256 over the payload, keyed off CREDENTIAL_KEY) carries the
 * owner's business id and an expiry. No session store, no user table for the
 * pilot: one owner, one access code, a stateless signed token. Pure and
 * testable; the HTTP glue lives in app.ts.
 */

export type OwnerSession = {
  readonly businessId: string;
  readonly exp: number;
  /**
   * M47 — WHO is signed in.
   *
   * Optional so a cookie signed before this milestone still verifies: an
   * absent person is the OWNER, which is what a session could only have been
   * when the access code was a single owner. Extending the payload rather than
   * changing it means nobody is logged out by a deploy.
   */
  readonly person?: { readonly id: string; readonly name: string; readonly isOwner: boolean };
  /**
   * S1 — WHICH password this session was opened with: the login's
   * `password_changed_at`, in ms, as the database wrote it. Optional for the
   * same reason `person` is — a cookie signed before this milestone, or opened
   * with an access code, has none and still verifies. A session whose stamp is
   * no longer the login's is one she ended by changing her password
   * (liveness.ts). Compared for EQUALITY, never against a clock: the process
   * and the database do not share one.
   */
  readonly pv?: number;
};

export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

export function makeSessionCodec(secret: string) {
  const mac = (payload: string): string =>
    createHmac('sha256', secret).update(payload).digest('base64url');

  return {
    sign(session: OwnerSession): string {
      const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
      return `${payload}.${mac(payload)}`;
    },
    /** Returns the session iff signature valid AND not expired. Constant-time. */
    verify(token: string | undefined, now: number): OwnerSession | null {
      if (!token) return null;
      const dot = token.indexOf('.');
      if (dot <= 0) return null;
      const payload = token.slice(0, dot);
      const sig = token.slice(dot + 1);
      const expected = mac(payload);
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
      try {
        const s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OwnerSession;
        if (typeof s.businessId !== 'string' || typeof s.exp !== 'number' || s.exp < now) return null;
        return s;
      } catch { return null; }
    },
  };
}

/** Constant-time access-code check — never a plain ===. */
export function codeMatches(input: string, actual: string): boolean {
  const a = Buffer.from(input);
  const b = Buffer.from(actual);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/** Parse a Cookie header into a map. Tiny, no dependency. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}
