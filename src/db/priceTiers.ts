import { sql } from 'kysely';
import type { Tx } from './client.js';

/**
 * 0224 (Block 1 #6) — ONE larger-order price, taken off ONE product of the business the transaction is for. Through
 * the one definer function, as a name customers use is (0122): the app role deletes nothing directly. Never the
 * product's first band (its price); R3's trigger unvets the product on the delete, so its next quote waits for the
 * owner like any price change. The caller writes the removal on the audit trail.
 */
export async function removePriceTier(tx: Tx, productId: string, minQty: number): Promise<boolean> {
  return (await sql<{ ok: boolean }>`select remove_price_tier(${productId}::uuid, ${minQty}::integer) as ok`.execute(tx)).rows[0]?.ok === true;
}
