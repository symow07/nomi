import { sql } from 'kysely';
import type { Tx } from './client.js';
import { customerValues, SPEND_STATUSES, type CustomerValue } from './customerValue.js';
import { faceVersions } from './faces.js';
import type { CustomerPanel } from './customerPanel.js';
import type { PlayFacts, Speaker } from '../core/conversation/stateOfPlay.js';

/**
 * THE WARMTH RUN (2026-10-03), phase 5 — THE CATCH-UP STRIP's rows: what the
 * head of a conversation tells somebody who has never seen it. Who they are
 * and where they write (the customer panel's own reading, passed in, so the
 * two cannot disagree), their face, what they have bought and spent
 * (`customerValues`, the one definition), and the rows the state of play is
 * decided from (`stateOfPlay`, pure).
 *
 *   BOUGHT — the products of their orders that STAND: `SPEND_STATUSES`, the
 *     same statuses spend is summed over, so the strip never lists a product
 *     whose order counts for nothing in the total beside it. Newest first,
 *     each with how many of their orders it was.
 *   THE NEWEST ORDER that stands, and when it was confirmed — the time
 *     customerValue counts it from (`confirmed_at`, else when it was made).
 *   A QUOTE THEY WERE GIVEN — the newest quote of theirs that was not held
 *     back: its turn's reply, if it became a draft, was approved as written
 *     (G7b's rule, `priorQuotesForClient`); then the first reply that LEFT in
 *     its conversation from then on (sent, delivered or read — never queued,
 *     failed or cancelled). A sent row does not name the turn it answers, so
 *     this is the first reply out after the price was worked out; one that
 *     never left means no quote is waiting on them.
 *   WHAT THEY ASKED ABOUT — the panel's reading (the products the turns'
 *     analysis found), else the product of the newest price worked out for
 *     them: a price is worked out because they asked. The fix wave
 *     (w4-conversation-05): with turns the analysis never named a product in,
 *     a customer quoted for string lights read as one who had asked nothing.
 *   THEIR NEWEST MESSAGE, in any of their conversations, and this
 *     conversation's newest message with who wrote it (the transcript's own
 *     reading of a sent row's origin, CH3's echo included).
 */

/** How many products the strip names before it says how many more. */
export const BOUGHT_SHOWN = 3;

export type Bought = { readonly name: string | null; readonly nameZh: string | null; readonly orders: number };

export type CatchUp = Pick<CustomerPanel, 'clientId' | 'channel' | 'address'> & Pick<PlayFacts, 'lastOrder' | 'quoteSentAt' | 'lastFromThemAt' | 'lastMessage'> & {
  /** The photo's version (`faceVersions`), or null: the face draws their initial. */
  readonly photo: string | null;
  readonly value: CustomerValue;
  readonly bought: readonly Bought[];
  /** Products bought beyond those named. */
  readonly boughtMore: number;
  /** What they asked about most recently (the panel's reading, else the newest price worked out for them). */
  readonly askedAbout: { readonly name: string | null; readonly nameZh: string | null } | null;
};

export async function loadCatchUp(
  tx: Tx, panel: Pick<CustomerPanel, 'clientId' | 'channel' | 'address' | 'askedAbout'>, conversationId: string, now: Date,
): Promise<CatchUp> {
  const client = panel.clientId;
  const spend = [...SPEND_STATUSES];
  // One transaction, one connection: asked in turn.
  const photos = await faceVersions(tx, [client]);
  const values = await customerValues(tx, [client], now);

  const bought = (await sql<{ name: string | null; name_zh: string | null; n: number; products: number }>`
    select p.name, p.name_zh, count(*)::int as n, (count(*) over ())::int as products
      from orders o join products p on p.id = o.product_id
     where o.client_id = ${client}::uuid and o.status = any(${spend}::text[])
     group by p.id, p.name, p.name_zh
     order by max(coalesce(o.confirmed_at, o.created_at)) desc
     limit ${BOUGHT_SHOWN}`.execute(tx)).rows;

  const lastOrder = (await sql<{ reference: string; at: Date }>`
    select o.order_reference as reference, coalesce(o.confirmed_at, o.created_at) as at
      from orders o
     where o.client_id = ${client}::uuid and o.status = any(${spend}::text[])
     order by coalesce(o.confirmed_at, o.created_at) desc limit 1`.execute(tx)).rows[0];

  const quote = (await sql<{ left_at: Date | null }>`
    select (select min(coalesce(o.sent_at, o.created_at)) from outbound_messages o
             where o.conversation_id = q.conversation_id
               and o.status in ('sent', 'delivered', 'read') and o.origin in ('employee', 'owner')
               and o.created_at >= q.created_at) as left_at
      from quotes q join conversations c on c.id = q.conversation_id
     where c.client_id = ${client}::uuid
       and not exists (
         select 1 from turns t join drafts d on d.turn_message_id = t.message_id
          where t.quote_id = q.id and d.status <> 'approved')
     order by q.created_at desc limit 1`.execute(tx)).rows[0];

  const fromThem = (await sql<{ at: Date | null }>`
    select max(m.sent_at) as at
      from messages m join conversations c on c.id = m.conversation_id
     where c.client_id = ${client}::uuid and m.direction = 'inbound'`.execute(tx)).rows[0];

  const newest = (await sql<{ direction: string; at: Date; origin: string | null }>`
    select m.direction, m.sent_at as at,
           coalesce(o.origin, case when m.external_id like 'echo:%' then 'owner' end) as origin
      from messages m
      left join outbound_messages o on m.direction = 'outbound' and m.external_id = 'out:' || o.id::text
     where m.conversation_id = ${conversationId}::uuid
     order by m.sent_at desc, m.id desc limit 1`.execute(tx)).rows[0];
  const from: Speaker | null = !newest ? null
    : newest.direction === 'inbound' ? 'buyer' : newest.origin === 'owner' ? 'person' : 'assistant';

  const asked = panel.askedAbout[0] ?? (await sql<{ name: string | null; name_zh: string | null }>`
    select p.name, p.name_zh
      from quotes q join conversations c on c.id = q.conversation_id join products p on p.id = q.product_id
     where c.client_id = ${client}::uuid
     order by q.created_at desc limit 1`.execute(tx)).rows.map((r) => ({ name: r.name, nameZh: r.name_zh }))[0];
  return {
    clientId: client, channel: panel.channel, address: panel.address,
    photo: photos.get(client) ?? null,
    value: values.get(client) ?? { clientId: client, spent: null, orders: 0, lastOrderAt: null, regular: false, quietSince: null },
    bought: bought.map((r) => ({ name: r.name, nameZh: r.name_zh, orders: r.n })),
    boughtMore: Math.max(0, (bought[0]?.products ?? 0) - bought.length),
    askedAbout: asked ? { name: asked.name, nameZh: asked.nameZh } : null,
    lastOrder: lastOrder ? { reference: lastOrder.reference, confirmedAt: lastOrder.at } : null,
    quoteSentAt: quote?.left_at ?? null,
    lastFromThemAt: fromThem?.at ?? null,
    lastMessage: newest && from ? { from, at: newest.at } : null,
  };
}
