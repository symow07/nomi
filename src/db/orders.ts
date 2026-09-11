import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import type { OrderState } from '../core/commerce/orderState.js';

/**
 * M46 — THE ONE WRITER OF ORDER STATE.
 *
 * ── WHICH OF THE TWO IS THE RECORD ────────────────────────────────────────
 *
 *   `order_updates` IS THE RECORD. Append-only, the app role cannot UPDATE it,
 *     and it is what she actually said and when. Every read that can reach it
 *     reads it — `latestForClient` takes the buyer-facing state from its
 *     head precisely so the answer a buyer gets and the record she keeps cannot
 *     disagree.
 *
 *   `orders.status` IS A CACHE OF ITS HEAD. Maintained here, in the same
 *     transaction, and never read where the log is available. It exists because
 *     five read models and the inbox query already join `orders` and would
 *     otherwise each need a lateral against the log for a single word.
 *
 * ── WHY THE CACHE IS STILL MAINTAINED ─────────────────────────────────────
 *
 * The obvious tidy-up is to stop writing it, since nothing in `src/` reads it.
 * That is the wrong move and the reason is worth stating: A COLUMN YOU STOP
 * MAINTAINING GOES STALE AND STARTS LYING. `confirmed` sitting on an order that
 * shipped three weeks ago is far more dangerous than a correct value nobody
 * uses, because it looks authoritative to whoever finds it next — and someone
 * will, exactly as someone did before the log existed.
 *
 * ── SO THE TWO MOVE TOGETHER OR NEITHER MOVES ─────────────────────────────
 *
 * This function is the only thing in the product that writes either of them,
 * the way `enqueueOutboundRow` is the only thing that writes an outbound row.
 * A second writer is not merely discouraged: an integration test asserts that
 * `orders.status` equals the head of `order_updates` for every order after
 * every transition, and it goes red the moment one appears.
 */
export async function writeOrderState(
  tx: Tx,
  businessId: BusinessId,
  orderId: string,
  input: {
    readonly state: OrderState;
    readonly note: string | null;
    readonly trackingReference: string | null;
    readonly actor: string;
    readonly at: Date;
  },
): Promise<void> {
  await sql`
    insert into order_updates (business_id, order_id, state, note, tracking_reference, at, by_actor)
    values (${businessId}::uuid, ${orderId}::uuid, ${input.state}, ${input.note},
            ${input.trackingReference}, ${input.at}, ${input.actor})`.execute(tx);

  // The cache, in the same transaction as the record it caches. A tracking
  // reference she did not repeat is NOT erased: recording a state twice must
  // not lose the number she typed once, and the buyer is told the one on file.
  await sql`
    update orders set status = ${input.state},
                      tracking_reference = coalesce(${input.trackingReference}, tracking_reference)
     where id = ${orderId}::uuid and business_id = ${businessId}::uuid`.execute(tx);
}
