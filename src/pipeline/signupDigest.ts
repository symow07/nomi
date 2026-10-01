import { signupForms } from './funnel.js';
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

/** force_draft is one row per capability: the digest says it once per workspace. */
const flagLines = (rows: readonly { flag: string; capability: string | null; business: string | null; set_at: Date }[]) => {
  const seen = new Map<string, { flag: string; business: string | null; since: string }>();
  for (const r of rows) {
    const key = `${r.flag}\u0000${r.business ?? ''}`;
    if (!seen.has(key)) seen.set(key, { flag: r.flag, business: r.business, since: r.set_at.toISOString() });
  }
  return [...seen.values()];
};

export async function signupDigestAlert(db: Db, operatorBusinessId: string, now: Date): Promise<NotifyJob | null> {
  const since = new Date(now.getTime() - SIGNUP_DIGEST_HOURS * 3_600_000);
  const rows = (await sql<{ name: string; kind: string | null; country: string | null; signed_up_at: Date }>`
    select name, kind, country, signed_up_at from signups_since(${since})`.execute(db)).rows;
  // G7 (KS4) — and a line for every operator switch still on, so none is forgotten.
  const flags = (await sql<{ flag: string; capability: string | null; business: string | null; set_at: Date }>`
    select flag, capability, business, set_at from active_ops_flags()`.execute(db)).rows;
  // G9 — the day's sign-up forms, and how many came back with their code (counts only).
  const forms = await signupForms(db, since);
  if (rows.length === 0 && flags.length === 0 && forms.forms === 0) return null;
  return {
    businessId: operatorBusinessId, kind: 'signup_digest', conversationId: null,
    signups: rows.map((r) => ({ business: r.name, kind: r.kind, country: r.country, at: r.signed_up_at.toISOString() })),
    ...(flags.length ? { flags: flagLines(flags) } : {}),
    forms,
  };
}
