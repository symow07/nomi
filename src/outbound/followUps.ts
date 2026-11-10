import { sql } from 'kysely';
import { lockConversation, withTenantTx, type Db } from '../db/client.js';
import { parseBusinessId, type BusinessId } from '../core/types/ids.js';
import { foldFollowUpQuote, presentFollowUp, type FollowUpRun } from '../db/followUps.js';

/** No adapter, model, queue or allowance writer is available to this job. */
export type FollowUpDeps = { readonly db: Db; readonly now: () => Date };
export const FOLLOW_UP_BATCH = 100;

export async function runDueFollowUps(deps: FollowUpDeps, businessId: BusinessId): Promise<number> {
  const now = deps.now();
  const quotes = await withTenantTx(deps.db, businessId, async (tx) => (await sql<{ id: string; conversation_id: string }>`
    select id, conversation_id from follow_up_observations where business_id = ${businessId}::uuid
      and kind = 'quote' and processed_at is null and quoted_at <= ${now}
    order by quoted_at, id limit ${FOLLOW_UP_BATCH}`.execute(tx)).rows);
  for (const q of quotes) await withTenantTx(deps.db, businessId, async (tx) => {
    await lockConversation(tx, q.conversation_id);
    await foldFollowUpQuote(tx, businessId, q.id, now);
  });
  const runs = await withTenantTx(deps.db, businessId, async (tx) => (await sql<{ id: string; conversation_id: string }>`
    select r.id, r.conversation_id from follow_up_runs r
    where r.business_id = ${businessId}::uuid and (r.state in ('scheduled', 'window_closed')
      or (r.state = 'draft' and exists(select 1 from drafts d where d.id = r.draft_id and d.status = 'pending')))
    order by r.checked_at nulls first, r.id limit ${FOLLOW_UP_BATCH}`.execute(tx)).rows);
  let made = 0;
  for (const candidate of runs) made += await withTenantTx(deps.db, businessId, async (tx) => {
    await lockConversation(tx, candidate.conversation_id);
    const r = (await sql<FollowUpRun>`select * from follow_up_runs where id = ${candidate.id}::uuid
      and business_id = ${businessId}::uuid for no key update skip locked`.execute(tx)).rows[0];
    if (!r) return 0;
    const presented = await presentFollowUp(tx, businessId, r, now);
    await sql`update follow_up_runs set checked_at = ${now} where id = ${r.id}::uuid`.execute(tx);
    return presented ? 1 : 0;
  });
  return made;
}

/** Bounded discovery, independent of the outreach area and of sending being connected. */
export async function sweepFollowUpWorkspaces(deps: FollowUpDeps): Promise<number> {
  const rows = (await sql<{ business_id: string }>`select business_id from follow_up_workspaces(${deps.now()}) limit 100`.execute(deps.db)).rows;
  let made = 0;
  const deadline = deps.now().getTime() + 40_000;
  for (const row of rows) {
    if (deps.now().getTime() >= deadline) break;
    const bid = parseBusinessId(row.business_id);
    if (bid.ok) made += await runDueFollowUps(deps, bid.value);
  }
  return made;
}
