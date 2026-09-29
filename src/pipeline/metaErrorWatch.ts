import { sql } from 'kysely';
import type { Db } from '../db/client.js';
import type { NotifyJob } from '../queue/boss.js';
import { metaErrorAlarms, META_ERROR_WINDOW_HOURS, type MetaErrorRate } from '../core/ops/metaErrors.js';

/**
 * CEIL — the hourly look at Meta's error rate per workspace, and the operator
 * alert when one has crossed the line (src/core/ops/metaErrors.ts says where).
 *
 * Asked across EVERY workspace through `meta_error_rates()` (migration 0085),
 * a definer function, on the plain connection — as `deletion_requests_due()`
 * is: there is no tenant to bind. It answers with the workspace's name, its
 * counts and the provider's own words; never a customer, never a message.
 */
export async function metaErrorRates(db: Db, since: Date): Promise<MetaErrorRate[]> {
  const r = await sql<{ business_name: string; attempted: number; failed: number; errors: string[] | null }>`
    select business_name, attempted, failed, errors from meta_error_rates(${since})`.execute(db);
  return r.rows.map((x) => ({
    business: x.business_name, attempted: Number(x.attempted), failed: Number(x.failed), errors: x.errors ?? [],
  }));
}

export async function metaErrorAlert(db: Db, operatorBusinessId: string, now: Date): Promise<NotifyJob | null> {
  const alarms = metaErrorAlarms(await metaErrorRates(db, new Date(now.getTime() - META_ERROR_WINDOW_HOURS * 3_600_000)));
  if (alarms.length === 0) return null;
  return {
    businessId: operatorBusinessId, kind: 'meta_errors', conversationId: null,
    metaErrors: alarms.map((a) => ({ business: a.business, attempted: a.attempted, failed: a.failed, errors: [...a.errors] })),
  };
}
