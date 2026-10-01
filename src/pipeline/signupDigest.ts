import { sql } from 'kysely';
import type { Db } from '../db/client.js';
import type { NotifyJob } from '../queue/boss.js';

/**
 * G1 — the operator's daily list of who signed up: every workspace made by
 * sign-up in the last 24 hours, by name, kind and country (`signups_since()`,
 * 0099, a definer function on the plain connection — there is no tenant to
 * bind). Nothing to say, nothing sent.
 */
export const SIGNUP_DIGEST_HOURS = 24;

export async function signupDigestAlert(db: Db, operatorBusinessId: string, now: Date): Promise<NotifyJob | null> {
  const since = new Date(now.getTime() - SIGNUP_DIGEST_HOURS * 3_600_000);
  const rows = (await sql<{ name: string; kind: string | null; country: string | null; signed_up_at: Date }>`
    select name, kind, country, signed_up_at from signups_since(${since})`.execute(db)).rows;
  if (rows.length === 0) return null;
  return {
    businessId: operatorBusinessId, kind: 'signup_digest', conversationId: null,
    signups: rows.map((r) => ({ business: r.name, kind: r.kind, country: r.country, at: r.signed_up_at.toISOString() })),
  };
}
