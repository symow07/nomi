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
