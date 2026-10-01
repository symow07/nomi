import { sql } from 'kysely';
import type { Db } from '../db/client.js';
import type { NotifyJob } from '../queue/boss.js';

/**
 * RET (0116) — once a day, while the installation's `retention` switch is on:
 * each workspace that signed itself up and never connected a channel hears,
 * by e-mail, that it will be erased — at least 14 days before, then three days
 * before — and what keeps it: connecting a channel. `claim_retention_warnings()`
 * writes each warning as it returns it, so a warning goes once. The app never
 * erases; the operator does (tools/retention.mjs).
 */
export async function retentionWarnings(db: Db): Promise<NotifyJob[]> {
  const rows = (await sql<{ business_id: string; stage: string; erase_on: string }>`
    select business_id::text as business_id, stage, erase_on::text as erase_on from claim_retention_warnings()`.execute(db)).rows;
  return rows.map((r) => ({
    businessId: r.business_id, kind: 'retention_warning', conversationId: null, eraseOn: r.erase_on,
  }));
}

/** The operator's daily list: how many are past their date, warned twice, waiting for the operator's command. */
export async function retentionDue(db: Db): Promise<number> {
  return (await sql<{ n: number }>`select count(*)::int as n from retention_workspaces() where due`.execute(db)).rows[0]?.n ?? 0;
}
