import { sql } from 'kysely';
import type { Tx } from './client.js';
import { moneyFromRow, type Money } from '../core/types/money.js';
import { SPEND_STATUSES } from './customerValue.js';
import { PRICE_GIVEN } from './quotesGiven.js';
import { productPhotoPath } from './productPhotos.js';

/**
 * HOW FAR A CONVERSATION HAS GOT, in one place (the Inbox's restyle, 2026-11-05): Today's Recent customers and the Inbox
 * show the same chip and the same figure, and the Inbox filters by it. The furthest it has reached: an order that stands,
 * a sample asked for, a price given (`PRICE_GIVEN`, sent or approved, never one worked out and held back), else asked.
 * A read model: every word and figure is on rows the product already keeps.
 */

export const STAGES = ['asked', 'price', 'sample', 'order'] as const;
export type Stage = (typeof STAGES)[number];

/** The stage an address asks for; anything else is none. */
export const stageOf = (raw: unknown): Stage | null => (STAGES as readonly unknown[]).includes(raw) ? raw as Stage : null;

/** The same reading in SQL, of the conversation aliased `c`. */
export const STAGE_OF_CONVERSATION = sql<Stage>`(case
  when exists (select 1 from orders r where r.conversation_id = c.id and r.status = any(${[...SPEND_STATUSES]}::text[])) then 'order'
  when exists (select 1 from sample_requests s where s.conversation_id = c.id) then 'sample'
  when exists (select 1 from quotes q where q.conversation_id = c.id and ${PRICE_GIVEN}) then 'price'
  else 'asked' end)`;

export type StageFacts = {
  readonly stage: Stage;
  /** That order's total, or that price; a stage with no figure has none. */
  readonly value: Money | null;
  /** The product's first photo, as a path; none draws nothing. */
  readonly thumb: string | null;
  readonly product: string | null;
};

/** What each of these conversations' rows show. */
export async function stageFacts(tx: Tx, conversationIds: readonly string[]): Promise<ReadonlyMap<string, StageFacts>> {
  if (conversationIds.length === 0) return new Map();
  const rows = (await sql<{
    id: string; stage: Stage; product: string | null; product_zh: string | null; token: string | null;
    order_total: string | null; order_currency: string | null; quote_total: string | null; quote_currency: string | null;
  }>`
    select c.id::text as id, ${STAGE_OF_CONVERSATION} as stage, p.name as product, p.name_zh as product_zh,
           (select i.token from product_images i where i.product_id = p.id and i.token is not null limit 1) as token,
           o.total::text as order_total, o.currency as order_currency, g.total::text as quote_total, g.currency as quote_currency
      from conversations c
      left join conversation_state cs on cs.conversation_id = c.id
      left join products p on p.id = cs.identified_product_id
      left join lateral (select r.total_value_usd as total, r.currency from orders r where r.conversation_id = c.id
                          and r.status = any(${[...SPEND_STATUSES]}::text[]) order by coalesce(r.confirmed_at, r.created_at) desc limit 1) o on true
      left join lateral (select q.total_usd as total, q.currency from quotes q where q.conversation_id = c.id and ${PRICE_GIVEN} order by q.created_at desc limit 1) g on true
     where c.id = any(${[...conversationIds]}::uuid[])`.execute(tx)).rows;
  return new Map(rows.map((x) => [x.id, {
    stage: x.stage,
    value: x.order_total !== null && x.order_currency ? moneyFromRow(x.order_total, x.order_currency)
      : x.quote_total !== null && x.quote_currency ? moneyFromRow(x.quote_total, x.quote_currency) : null,
    thumb: x.token ? productPhotoPath(x.token) : null,
    product: x.product ?? x.product_zh,
  }]));
}
