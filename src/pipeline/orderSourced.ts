import { sql } from 'kysely';
import { withTenantTx, type Db } from '../db/client.js';
import type { BusinessId } from '../core/types/ids.js';
import { extractNumerals, near } from '../core/safety/numerals.js';
import { orderFactNumbers, type OrderContext } from '../core/commerce/shopifyOrders.js';
import type { OrderLookup } from './orderLookup.js';

/**
 * BLOCK 5.5 — WHERE AN ORDER REPLY'S FIGURES CAME FROM, FOR THE OWNER'S CARD (t1r's ruling A, 2026-11-10).
 *
 * A reply built on a verified Shopify order is always a draft (`order_facts`), and the turn's numeral guard accepted
 * its dates because the order holds them. The card is drawn later, from the database, and nothing of the order is
 * kept (the storage ruling of 2026-11-09), so "How {name} read this" said "No source" for every one of them.
 *
 * After the turn COMMITS, in a transaction of its own, the worker writes ONE `order_sourced` event beside such a draft:
 *
 *   { draftId, order, figures }
 *
 * `order` is the order's name as the lookup row already keeps it; `figures` are the order's facts INTERSECTED with
 * the draft's own text — values the reply already writes, and nothing else: never the e-mail, a tracking number not
 * in the reply, a link, an id, or a date the reply does not state. It is provenance for figures already in the reply,
 * erased with the customer and the workspace like every conversation event.
 *
 * Written only when the lookup verified an order AND the turn's draft waits as `order_facts`. A failure to write it
 * changes nothing the turn did: the card then says "No source", as before.
 */

/** The figures the reply writes that the verified order holds; in the reply's order, each once. */
export function orderSourcedFigures(order: OrderContext, replyText: string): number[] {
  const facts = orderFactNumbers(order);
  const out: number[] = [];
  for (const n of extractNumerals(replyText)) {
    if (!Number.isFinite(n.value) || !facts.some((f) => near(f, n.value))) continue;
    if (!out.some((o) => near(o, n.value))) out.push(n.value);
  }
  return out;
}

/** The record as the card reads it back: anything malformed is no record. */
export type OrderSourced = { readonly order: string; readonly figures: readonly number[] };
export function orderSourcedOf(v: unknown): OrderSourced | null {
  if (typeof v !== 'object' || v === null) return null;
  const { order, figures } = v as { order?: unknown; figures?: unknown };
  if (typeof order !== 'string' || order.trim() === '' || order.length > 64 || !Array.isArray(figures) || figures.length > 40) return null;
  const nums = figures.filter((f): f is number => typeof f === 'number' && Number.isFinite(f));
  return nums.length === figures.length ? { order, figures: nums } : null;
}

/**
 * A lookup port that remembers the order it verified for this one turn, so the worker can write the record after the
 * turn commits. Nothing leaves this object but through `recordOrderSourced`, and it lives as long as the turn's job.
 */
export function rememberingOrderLookup(inner: OrderLookup): { readonly port: OrderLookup; readonly verified: () => OrderContext | null } {
  let verified: OrderContext | null = null;
  return {
    port: {
      async look(input) {
        const r = await inner.look(input);
        verified = r.kind === 'verified' ? r.order : null;
        return r;
      },
    },
    verified: () => verified,
  };
}

/**
 * Writes the record for `draftId` when that draft is still pending and its `draft_pending` says `order_facts`.
 * Its own transaction. Returns whether a record was written; throws only what the database threw.
 */
export async function recordOrderSourced(db: Db, businessId: BusinessId, input: {
  readonly conversationId: string; readonly draftId: string; readonly order: OrderContext;
}): Promise<boolean> {
  return withTenantTx(db, businessId, async (tx) => {
    const row = (await sql<{ text: string; reason: string | null }>`
      select d.draft_text as text,
             (select e.payload->'withheld'->>'reason' from conversation_events e
               where e.conversation_id = d.conversation_id and e.type = 'draft_pending' and e.payload->>'draftId' = d.id::text
               order by e.id desc limit 1) as reason
        from drafts d
       where d.id = ${input.draftId}::uuid and d.conversation_id = ${input.conversationId}::uuid and d.status = 'pending'
    `.execute(tx)).rows[0];
    if (!row || row.reason !== 'order_facts') return false;
    await sql`insert into conversation_events (business_id, conversation_id, type, payload)
      values (${businessId}::uuid, ${input.conversationId}::uuid, 'order_sourced',
              ${JSON.stringify({ draftId: input.draftId, order: input.order.name, figures: orderSourcedFigures(input.order, row.text) })}::jsonb)`.execute(tx);
    return true;
  });
}
