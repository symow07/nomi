import { sql } from 'kysely';
import type { Tx } from './client.js';

/**
 * Phase 9 of the warmth run (w4-customers-25, w4-conversation-12) — WHAT A
 * CUSTOMER ASKED ABOUT, in one reading.
 *
 * The profile card said "Nothing bought or asked about yet" over a
 * conversation about LED String Lights with a price on it: it read only the
 * product each ANALYSED turn found, and a customer whose price was worked out,
 * or whose conversation is about a product, had none. The rows already say
 * what they asked about, three ways, and every other page reads one of them:
 *
 *   - the product an analysed turn found (`turns.analysis` →
 *     intent.productCandidate.productId — the panel's reading);
 *   - every price worked out for them (`quotes.product_id`) — a price is
 *     worked out because they asked about the product, given or not;
 *   - what their conversation is about (`conversation_state.identified_product_id`)
 *     — the conversation's header, the Inbox's search and its row read this.
 *
 * Each product once, the one asked about most recently first. Compared as
 * text: a product id an analysis wrote that is not a uuid matches nothing and
 * breaks nothing.
 */
export type AskedAbout = { readonly name: string | null; readonly nameZh: string | null };

export async function askedAbout(tx: Tx, clientId: string, limit = 3): Promise<readonly AskedAbout[]> {
  return (await sql<{ name: string | null; name_zh: string | null }>`
    select p.name, p.name_zh
      from (
        select t.analysis->'intent'->'productCandidate'->>'productId' as product, t.created_at as at
          from turns t join conversations c on c.id = t.conversation_id
         where c.client_id = ${clientId}::uuid
        union all
        select q.product_id::text, q.created_at
          from quotes q join conversations c on c.id = q.conversation_id
         where c.client_id = ${clientId}::uuid
        union all
        select cs.identified_product_id::text, cs.last_message_at
          from conversation_state cs join conversations c on c.id = cs.conversation_id
         where c.client_id = ${clientId}::uuid and cs.identified_product_id is not null
      ) a
      join products p on p.id::text = a.product
     group by p.id, p.name, p.name_zh
     order by max(a.at) desc, p.id
     limit ${limit}`.execute(tx)).rows
    .map((r) => ({ name: r.name, nameZh: r.name_zh }));
}
