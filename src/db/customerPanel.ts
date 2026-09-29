import { sql } from 'kysely';
import type { Tx } from './client.js';
import { type Money, moneyFromRow } from '../core/types/money.js';

/**
 * THE CUSTOMER PANEL (the design pass, 2026-09-29; the plan's §3): the
 * customer's facts beside their conversation, each block from rows the
 * product already keeps. Nothing here is inferred, scored or summarised:
 *
 *   Asked about     — the product each turn's analysis found, counted per customer;
 *   Prices worked   — their quotes, each a door to the conversation it was worked
 *   out               out in. (The plan said "Told a price"; a quote is not
 *                     linked to the message that carried it, so the panel says
 *                     what the row proves: the price was worked out.)
 *   On record       — their samples and orders;
 *   Activity        — who acted, newest first: the assistant (✦), a person (●),
 *                     nobody yet (○). Read from the sent rows' own origin and the
 *                     drafts the owner decided.
 *
 * "On the calendar" is the calendar's own loader, filtered to this customer
 * (`loadCalendar`, `buyer`), so the two can never disagree.
 */

export type PanelActivity = {
  readonly kind: 'alone' | 'draft_sent' | 'edit_sent' | 'owner' | 'not_reached' | 'waiting';
  /** For `not_reached`: whose reply it was. */
  readonly by?: 'assistant' | 'person';
  readonly at: Date;
};

export type CustomerPanel = {
  readonly clientId: string;
  readonly name: string | null;
  readonly country: string | null;
  /** The channel of this conversation, and the customer's address on it where it is one a person reads (a number, an e-mail). */
  readonly channel: string;
  readonly address: string | null;
  /** The language the newest analysed turn found them writing in. */
  readonly language: string | null;
  readonly firstWrote: Date | null;
  readonly conversations: number;
  readonly askedAbout: readonly { readonly name: string | null; readonly nameZh: string | null; readonly count: number; readonly lastAt: Date }[];
  readonly prices: readonly { readonly unitPrice: Money; readonly name: string | null; readonly nameZh: string | null; readonly at: Date; readonly conversationId: string }[];
  readonly samples: readonly { readonly askedAt: Date; readonly handledAt: Date | null }[];
  readonly orders: readonly { readonly id: string; readonly reference: string; readonly status: string; readonly at: Date }[];
  readonly activity: readonly PanelActivity[];
};

const ACTIVITY_SHOWN = 6;

export async function loadCustomerPanel(tx: Tx, conversationId: string): Promise<CustomerPanel | null> {
  const who = (await sql<{ client_id: string; name: string | null; country: string | null; channel: string; address: string | null }>`
    select c.client_id::text as client_id, cl.display_name as name, cl.country, c.channel,
           (select cc.channel_user_id from client_channels cc
             where cc.client_id = c.client_id and cc.channel = c.channel
               and cc.channel in ('whatsapp', 'email') limit 1) as address
      from conversations c left join clients cl on cl.id = c.client_id
     where c.id = ${conversationId}::uuid`.execute(tx)).rows[0];
  if (!who) return null;
  const client = who.client_id;

  const span = (await sql<{ first: Date | null; n: number }>`
    select (select min(m.sent_at) from messages m join conversations c on c.id = m.conversation_id
             where c.client_id = ${client}::uuid and m.direction = 'inbound') as first,
           (select count(*)::int from conversations c where c.client_id = ${client}::uuid) as n`.execute(tx)).rows[0];

  const language = (await sql<{ lang: string | null }>`
    select t.analysis->'language'->>'detected' as lang
      from turns t join conversations c on c.id = t.conversation_id
     where c.client_id = ${client}::uuid and t.analysis->'language'->>'detected' is not null
     order by t.created_at desc limit 1`.execute(tx)).rows[0]?.lang ?? null;

  // Compared as text: a product id the analysis wrote that is not a uuid matches nothing, and breaks nothing.
  const askedAbout = (await sql<{ name: string | null; name_zh: string | null; n: number; last_at: Date }>`
    select p.name, p.name_zh, count(*)::int as n, max(t.created_at) as last_at
      from turns t
      join conversations c on c.id = t.conversation_id
      join products p on p.id::text = t.analysis->'intent'->'productCandidate'->>'productId'
     where c.client_id = ${client}::uuid
     group by p.id, p.name, p.name_zh
     order by max(t.created_at) desc limit 5`.execute(tx)).rows
    .map((r) => ({ name: r.name, nameZh: r.name_zh, count: r.n, lastAt: r.last_at }));

  const prices = (await sql<{ unit_price_usd: string; currency: string; at: Date; conversation_id: string; name: string | null; name_zh: string | null }>`
    select q.unit_price_usd, q.currency, q.created_at as at, q.conversation_id::text as conversation_id, p.name, p.name_zh
      from quotes q join conversations c on c.id = q.conversation_id
      left join products p on p.id = q.product_id
     where c.client_id = ${client}::uuid
     order by q.created_at desc limit 3`.execute(tx)).rows
    // G18 — a quote in a currency this build cannot price is left off, never shown in dollars.
    .flatMap((r) => {
      const unitPrice = moneyFromRow(Number(r.unit_price_usd), r.currency);
      return unitPrice ? [{ unitPrice, name: r.name, nameZh: r.name_zh, at: r.at, conversationId: r.conversation_id }] : [];
    });

  const samples = (await sql<{ asked_at: Date; handled_at: Date | null }>`
    select s.requested_at as asked_at, s.handled_at
      from sample_requests s join conversations c on c.id = s.conversation_id
     where c.client_id = ${client}::uuid
     order by s.requested_at desc limit 3`.execute(tx)).rows
    .map((r) => ({ askedAt: r.asked_at, handledAt: r.handled_at }));

  const orders = (await sql<{ id: string; reference: string; status: string; at: Date }>`
    select o.id::text as id, o.order_reference as reference, o.status, o.created_at as at
      from orders o where o.client_id = ${client}::uuid
     order by o.created_at desc limit 3`.execute(tx)).rows;

  // Who acted: each sent row by its own origin; a reply the assistant wrote is
  // the owner's approval when a draft the owner decided carried exactly those words.
  const sent = (await sql<{ origin: string; status: string; cancel_reason: string | null; at: Date; decided: string | null }>`
    select o.origin, o.status, o.cancel_reason, coalesce(o.sent_at, o.created_at) as at,
           (select d.status from drafts d
             where d.conversation_id = o.conversation_id and d.status in ('approved', 'edited')
               and d.sent_text = o.body limit 1) as decided
      from outbound_messages o join conversations c on c.id = o.conversation_id
     where c.client_id = ${client}::uuid and o.origin in ('employee', 'owner')
     order by coalesce(o.sent_at, o.created_at) desc limit ${ACTIVITY_SHOWN}`.execute(tx)).rows;
  const waiting = (await sql<{ at: Date }>`
    select d.created_at as at from drafts d join conversations c on c.id = d.conversation_id
     where c.client_id = ${client}::uuid and d.status = 'pending'
     order by d.created_at desc limit 1`.execute(tx)).rows[0];

  const activity: PanelActivity[] = [
    ...(waiting ? [{ kind: 'waiting' as const, at: waiting.at }] : []),
    ...sent.map((r): PanelActivity => {
      const by = r.origin === 'owner' ? 'person' as const : 'assistant' as const;
      if (r.status === 'canceled' || r.status === 'failed') return { kind: 'not_reached', by, at: r.at };
      if (by === 'person') return { kind: 'owner', at: r.at };
      return { kind: r.decided === 'edited' ? 'edit_sent' : r.decided === 'approved' ? 'draft_sent' : 'alone', at: r.at };
    }),
  ].slice(0, ACTIVITY_SHOWN);

  return {
    clientId: client, name: who.name, country: who.country, channel: who.channel, address: who.address,
    language, firstWrote: span?.first ?? null, conversations: span?.n ?? 0,
    askedAbout, prices, samples, orders, activity,
  };
}
