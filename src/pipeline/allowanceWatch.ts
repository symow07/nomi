import { sql } from 'kysely';
import type { Db } from '../db/client.js';
import type { NotifyJob } from '../queue/boss.js';
import { allowanceRenewsAt } from '../db/allowance.js';

/**
 * G3 — every five minutes, the workspaces that crossed a line of today's
 * allowance and were not yet told: at the budget's soft-warn line (80%) and at
 * 100%. `claim_allowance_alerts()` (0101, a definer on the plain connection —
 * there is no tenant to bind) writes each line's row as it answers, so a line
 * is told once a UTC day however often this runs; a workspace past both since
 * the last look hears only that it is used up. Practice copies are never
 * asked: their turns are charged to the workspace that pays.
 */
export async function allowanceAlerts(db: Db, now: Date): Promise<NotifyJob[]> {
  const rows = (await sql<{ business_id: string; used: boolean; pct: number }>`
    select business_id::text as business_id, used, pct from claim_allowance_alerts()`.execute(db)).rows;
  const renewsAt = allowanceRenewsAt(now).toISOString();
  return rows.map((r) => ({
    businessId: r.business_id, kind: r.used ? 'allowance_reached' : 'allowance_warn', conversationId: null,
    allowancePct: Math.min(100, Number(r.pct)), renewsAt,
  }));
}

/**
 * KS5 (0113) — the operator hears, once a UTC day, the first sweep after the
 * installation passed its ceiling: how much was used, against what, and that
 * the beta waits while the pilots run. `claim_spend_breaker_alert()` writes the
 * day's row as it answers, so two sweeps never send it twice.
 */
export async function spendBreakerAlert(db: Db, operatorBusinessId: string): Promise<NotifyJob | null> {
  const r = (await sql<{ tokens: string; calls: string; max_tokens: string; max_calls: number }>`
    select tokens::text, calls::text, max_tokens::text, max_calls from claim_spend_breaker_alert()`.execute(db)).rows[0];
  if (!r) return null;
  return {
    businessId: operatorBusinessId, kind: 'spend_breaker', conversationId: null,
    spend: { tokens: Number(r.tokens), calls: Number(r.calls), maxTokens: Number(r.max_tokens), maxCalls: Number(r.max_calls) },
  };
}
