import { sql } from 'kysely';
import type { Db } from '../db/client.js';
import type { NotifyJob } from '../queue/boss.js';

/**
 * KS6 (0115) — every five minutes: each workspace whose first connection the
 * operator has decided on since the last look is told, once, by e-mail always
 * (it may have no channel at all yet). `claim_connection_decisions()` marks the
 * rows told as it returns them, so two sweeps never send one twice.
 */
export async function connectionDecisionAlerts(db: Db): Promise<NotifyJob[]> {
  const rows = (await sql<{ business_id: string; decision: string }>`
    select business_id::text as business_id, decision from claim_connection_decisions()`.execute(db)).rows;
  return rows.map((r) => ({
    businessId: r.business_id, kind: r.decision === 'approved' ? 'connection_approved' : 'connection_refused', conversationId: null,
  }));
}
