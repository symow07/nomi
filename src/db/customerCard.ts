import { sql } from 'kysely';
import type { Tx } from './client.js';
import { faceVersions } from './faces.js';
import { customerValues, SPEND_STATUSES, type CustomerValue } from './customerValue.js';
import { NEEDS_OWNER } from './buyersList.js';

/**
 * THE WARMTH RUN (2026-10-03), phase 3 — THE PROFILE CARD's facts: who this
 * customer is, at a glance, from any face in the product.
 *
 * The owner: "large photo, name, channel, when they last talked, what they
 * have bought or asked about, total spent, order count, and a flag if they are
 * one of the people waiting on you. One clear action at the bottom: open the
 * full conversation."
 *
 * Every fact is a row the product keeps; nothing is guessed. Spent, orders and
 * "regular" are `customerValues`' (one definition for the whole product);
 * "waiting on you" is the Inbox's own rule (`NEEDS_OWNER`), so the card and
 * the list never disagree about who waits.
 */
export type CustomerCard = {
  readonly clientId: string;
  readonly name: string | null;
  readonly photo: string | null;
  /** The channels they write on, newest conversation first. */
  readonly channels: readonly string[];
  /** Their newest message to the business; null if they never wrote (a contact written to first). */
  readonly lastWrote: Date | null;
  /** What their orders that stand were for (newest first), else what they asked about. */
  readonly bought: readonly { readonly name: string | null; readonly nameZh: string | null; readonly quantity: number | null; readonly unit: string | null }[];
  readonly askedAbout: readonly { readonly name: string | null; readonly nameZh: string | null }[];
  readonly value: CustomerValue;
  readonly waiting: boolean;
  /** The conversation the card's one action opens: their newest. */
  readonly conversationId: string | null;
};

export async function loadCustomerCard(tx: Tx, clientId: string): Promise<CustomerCard | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) return null;
  const who = (await sql<{ name: string | null }>`
    select display_name as name from clients where id = ${clientId}::uuid`.execute(tx)).rows[0];
  if (!who) return null;

  const conversations = (await sql<{ id: string; channel: string; waiting: boolean }>`
    select c.id::text as id, c.channel, ${NEEDS_OWNER} as waiting
      from conversations c
     where c.client_id = ${clientId}::uuid
     order by (select max(m.sent_at) from messages m where m.conversation_id = c.id) desc nulls last, c.id`.execute(tx)).rows;

  const lastWrote = (await sql<{ at: Date | null }>`
    select max(m.sent_at) as at from messages m join conversations c on c.id = m.conversation_id
     where c.client_id = ${clientId}::uuid and m.direction = 'inbound'`.execute(tx)).rows[0]?.at ?? null;

  const bought = (await sql<{ name: string | null; name_zh: string | null; quantity: number | null; unit: string | null }>`
    select p.name, p.name_zh, sum(o.quantity)::int as quantity, min(o.unit) as unit
      from orders o left join products p on p.id = o.product_id
     where o.client_id = ${clientId}::uuid and o.status = any(${[...SPEND_STATUSES]}::text[])
     group by p.id, p.name, p.name_zh
     order by max(coalesce(o.confirmed_at, o.created_at)) desc limit 3`.execute(tx)).rows
    .map((r) => ({ name: r.name, nameZh: r.name_zh, quantity: r.quantity, unit: r.unit }));

  // As the conversation's panel reads it (customerPanel.ts): the product each analysed turn found.
  const askedAbout = bought.length > 0 ? [] : (await sql<{ name: string | null; name_zh: string | null }>`
    select p.name, p.name_zh
      from turns t
      join conversations c on c.id = t.conversation_id
      join products p on p.id::text = t.analysis->'intent'->'productCandidate'->>'productId'
     where c.client_id = ${clientId}::uuid
     group by p.id, p.name, p.name_zh
     order by max(t.created_at) desc limit 3`.execute(tx)).rows
    .map((r) => ({ name: r.name, nameZh: r.name_zh }));

  const [values, faces] = await Promise.all([customerValues(tx, [clientId]), faceVersions(tx, [clientId])]);
  return {
    clientId, name: who.name, photo: faces.get(clientId) ?? null,
    channels: [...new Set(conversations.map((c) => c.channel))],
    lastWrote, bought, askedAbout,
    value: values.get(clientId)!,
    waiting: conversations.some((c) => c.waiting),
    conversationId: conversations[0]?.id ?? null,
  };
}
