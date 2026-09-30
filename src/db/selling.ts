import { sql } from 'kysely';
import { withTenantTx, type Db } from './client.js';
import { parseBusinessId } from '../core/types/ids.js';

/**
 * K5 — "PRICES GO TO ME" (0094). The owner's choice: the business states no
 * price, and every price question is handed to her (the turn's two layers,
 * pipeline/turn.ts). Setup's products step accepts it in place of a priced
 * product. Money is the owner's (rule 11): the route is `price_rules`.
 */
export async function pricesGoToOwner(db: Db, businessIdRaw: string): Promise<boolean> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return false;
  return withTenantTx(db, bid.value, async (tx) => (await sql<{ on: boolean }>`
    select prices_to_owner as on from businesses where id = ${bid.value}`.execute(tx)).rows[0]?.on ?? false);
}

/** Set it; audited, and only when it changes. Returns whether it changed. */
export async function setPricesGoToOwner(db: Db, businessIdRaw: string, actor: string, on: boolean): Promise<boolean> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return false;
  return withTenantTx(db, bid.value, async (tx) => {
    const r = await sql`update businesses set prices_to_owner = ${on}
                         where id = ${bid.value} and prices_to_owner is distinct from ${on}`.execute(tx);
    const changed = Number(r.numAffectedRows ?? 0) > 0;
    if (changed) {
      await sql`insert into channel_audit (business_id, channel_id, action, actor, detail)
                values (${bid.value}, null, 'prices_to_owner_set', ${actor}, ${JSON.stringify({ on })}::jsonb)`.execute(tx);
    }
    return changed;
  });
}
