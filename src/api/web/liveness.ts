import { sql } from 'kysely';
import { type Db, withTenantTx } from '../../db/client.js';
import type { BusinessId } from '../../core/types/ids.js';

/**
 * S1 — is the person behind this session still someone who works here?
 *
 * The session is a signed cookie with no store behind it (session.ts), which
 * is why a deploy logs nobody out — and also why, until now, REMOVING someone
 * logged nobody out either: the cookie kept verifying for up to seven days, and
 * nothing looked at `people.archived_at`. Someone who left could read and
 * answer buyers for a week.
 *
 * So every workspace request asks, at most once a minute per person, whether
 * the row is still live — and the answer is dropped at once, in this process,
 * when she removes someone or changes a password, so the common case is
 * immediate rather than "within a minute".
 */
export type Liveness = {
  /** The person is not archived and the business is active. */
  readonly live: boolean;
  /** When her password last changed, in ms — null for someone with no login. */
  readonly passwordChangedAt: number | null;
};

export async function readLiveness(db: Db, businessId: BusinessId, personId: string): Promise<Liveness> {
  return withTenantTx(db, businessId, async (tx) => {
    const r = (await sql<{ live: boolean; pwd: string | null }>`
      select (p.archived_at is null and b.is_active) as live,
             (select (extract(epoch from l.password_changed_at) * 1000)::bigint::text
                from logins l where l.person_id = p.id and l.archived_at is null limit 1) as pwd
        from people p join businesses b on b.id = p.business_id
       where p.id = ${personId}::uuid and p.business_id = ${businessId}::uuid`.execute(tx)).rows[0];
    // No row at all is someone who does not work here.
    return r ? { live: r.live === true, passwordChangedAt: r.pwd === null ? null : Number(r.pwd) } : { live: false, passwordChangedAt: null };
  });
}

export type LivenessCache = {
  get(key: string, now: number): Liveness | null;
  set(key: string, value: Liveness, now: number): void;
  evict(key: string): void;
};

export function makeLivenessCache(ttlMs = 60_000, maxKeys = 5000): LivenessCache {
  const held = new Map<string, { readonly value: Liveness; readonly at: number }>();
  return {
    get(key, now) {
      const hit = held.get(key);
      if (!hit) return null;
      if (now - hit.at >= ttlMs) { held.delete(key); return null; }
      return hit.value;
    },
    set(key, value, now) {
      held.set(key, { value, at: now });
      if (held.size > maxKeys) {
        const first = held.keys().next().value;
        if (first !== undefined) held.delete(first);
      }
    },
    evict(key) { held.delete(key); },
  };
}

export const livenessKey = (businessId: string, personId: string): string => `${businessId}:${personId}`;

/**
 * Does this session still stand?
 *
 * A session opened with a password she has since changed is one she meant to
 * end by changing it. The stamp is the login's own `password_changed_at`, and
 * it is compared for equality — no clock is consulted, so a process and a
 * database that disagree about the time cannot log anyone out or keep anyone
 * in. A cookie with no stamp (signed before this milestone, or opened with an
 * access code) is judged on the person alone, so a deploy logs nobody out.
 */
export function sessionStands(v: Liveness, passwordVersion: number | undefined): boolean {
  if (!v.live) return false;
  if (v.passwordChangedAt === null || passwordVersion === undefined) return true;
  return passwordVersion === v.passwordChangedAt;
}
