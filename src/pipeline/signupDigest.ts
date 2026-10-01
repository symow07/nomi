import { signupForms, loadFunnel } from './funnel.js';
import { mailSendsOn } from '../db/mailCaps.js';
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
  // G9 — where the cohort stands: how many workspaces, how many finished Practice, how many replied.
  const funnel = await loadFunnel(db);
  const cohort = { workspaces: funnel.length, practised: funnel.filter((f) => f.checklistCompleteAt).length, replied: funnel.filter((f) => f.firstReplyAt).length };
  // MAIL — the last UTC day's mail strangers caused, and what the daily caps held back.
  const day = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  const sends = await mailSendsOn(db, day);
  const mail = {
    codes: sends.find((s) => s.kind === 'code')?.sent ?? 0,
    alerts: sends.find((s) => s.kind === 'alert')?.sent ?? 0,
    refused: sends.reduce((n, s) => n + s.refused, 0),
  };
  if (rows.length === 0 && flags.length === 0 && forms.forms === 0 && mail.refused === 0) return null;
  return {
    businessId: operatorBusinessId, kind: 'signup_digest', conversationId: null,
    signups: rows.map((r) => ({ business: r.name, kind: r.kind, country: r.country, at: r.signed_up_at.toISOString() })),
    ...(flags.length ? { flags: flagLines(flags) } : {}),
    forms,
    ...(cohort.workspaces ? { cohort } : {}),
    ...(mail.codes || mail.alerts || mail.refused ? { mail } : {}),
  };
}
