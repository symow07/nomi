import { sql } from 'kysely';
import { withTenantTx, type Db } from '../db/client.js';
import type { NotifyJob } from '../queue/boss.js';
import { parseBusinessId } from '../core/types/ids.js';
import { ensureSpotChecks } from './spotChecks.js';

/**
 * R5 (0109) — SUPERVISION AFTER PROMOTION.
 *
 * Every five minutes: each workspace whose assistant stepped back on its own
 * since the last look — a guard tripped in auto, a spot check found something,
 * a wrong price — is told, once, by e-mail always (WhatsApp where live).
 * `claim_self_demotions()` marks the rows told as it returns them, so two
 * sweeps never send one twice; practice copies are marked and not told.
 */
export async function demotionAlerts(db: Db): Promise<NotifyJob[]> {
  const rows = (await sql<{ business_id: string; capabilities: string[]; reasons: string[] }>`
    select business_id::text as business_id, capabilities, reasons from claim_self_demotions()`.execute(db)).rows;
  return rows.map((r) => ({
    businessId: r.business_id, kind: 'self_demoted', conversationId: null,
    demoted: { capabilities: r.capabilities, reasons: r.reasons },
  }));
}

/**
 * Once a day: spot checks are offered on work that went out alone. Until R5
 * they were offered only when a draft was decided, so a workspace whose
 * replies all went alone was never checked at all. Each workspace with
 * replies sent alone in the last week gets `ensureSpotChecks` — the same
 * three a week, auto work first — in its own tenant transaction.
 */
export async function spotCheckSweep(db: Db): Promise<number> {
  const ids = (await sql<{ business_id: string }>`
    select business_id::text as business_id from spot_check_workspaces()`.execute(db)).rows;
  let offered = 0;
  for (const { business_id } of ids) {
    const b = parseBusinessId(business_id);
    if (!b.ok) continue;
    offered += await withTenantTx(db, b.value, (tx) => ensureSpotChecks(tx, b.value));
  }
  return offered;
}
