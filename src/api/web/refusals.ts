import { sql } from 'kysely';
import type { Db } from '../../db/client.js';
import { withTenantTx } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import type { RefusalReason } from '../../outbound/worker.js';

/**
 * M22 — what did NOT reach a buyer, and what the owner can do about it.
 *
 * THE RULE THIS FILE KEEPS: a refusal is not a failure of the employee; a
 * SILENT refusal is a failure of the product. `gateOutbound` was already right
 * about every one of these — it refused, the row was canceled, the reason was
 * written down. Nothing read it back. A buyer heard nothing and the owner was
 * never told, which is the defect class M21 found five times over: the system
 * was correct and mute.
 *
 * THIS IS NOT A SECOND GATE. It runs long after the decision, reads rows the
 * worker already wrote, and can change nothing. `gateOutbound` remains the only
 * authority over what is sent; `refuse()` in the worker is the only thing that
 * records a refusal; this is the only thing that reads them back.
 *
 * NO NEW STORAGE. `outbound_messages.cancel_reason` is the evidence — a column
 * that has existed since 0011 and that `transition()` has always written;
 * `outbound_transitions` timestamps it; `channel_audit(send_refused)` names it
 * for an operator. Three durable records existed before this file. It adds none.
 *
 * `cancel_reason` is read rather than `last_error` because a retry overwrites
 * `last_error` with the provider's text — the cancel reason would be the second
 * thing lost in a row that already lost its message.
 */

/** One message that did not go, in the owner's terms. */
export type Refusal = {
  readonly outboundId: string;
  readonly conversationId: string;
  /** Who it was meant for — display name when known, else the number. */
  readonly buyer: string | null;
  readonly reason: RefusalReason;
  readonly at: Date;
  /** Employee-authored, the owner's own typed reply, or (C4.a) a first message
   *  she wrote to someone who had not written to her. */
  readonly origin: 'employee' | 'owner' | 'outreach';
};

/**
 * Re-exported from the worker, which is where "every reason the worker can
 * write" actually belongs. This module is a READ MODEL and a test holds it to
 * that: it may not name the gate at all, and importing the gate's vocabulary
 * from here — even as a list of strings — would be the first step back toward a
 * page that decides something.
 */
export { REFUSAL_REASONS } from '../../outbound/worker.js';
import { REFUSAL_REASONS } from '../../outbound/worker.js';

/** `transition()` stores the detail string verbatim: "canceled: <reason>". */
const STORED = REFUSAL_REASONS.map((r) => `canceled: ${r}`);
const parseReason = (stored: string | null): RefusalReason | null => {
  const raw = (stored ?? '').replace(/^canceled:\s*/, '').trim();
  return (REFUSAL_REASONS as readonly string[]).includes(raw) ? raw as RefusalReason : null;
};

/** The one predicate both readers use, so a count can never exceed its list. */
const isRefusal = sql`status = 'canceled' and cancel_reason = any(${sql.val(STORED)}::text[])`;

/**
 * Refusals, newest first.
 *
 * Scoped to a window rather than all history: a refusal from six weeks ago is
 * archaeology, and a list that only grows is one the owner stops reading.
 * Nothing is deleted — this is a view, not a purge.
 */
export async function loadRefusals(
  db: Db, businessIdRaw: string,
  opts: { readonly conversationId?: string; readonly sinceDays?: number; readonly limit?: number } = {},
): Promise<readonly Refusal[]> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return [];
  const days = opts.sinceDays ?? 7;

  return withTenantTx(db, bid.value, async (tx) => {
    const rows = (await sql<{
      id: string; conversation_id: string; buyer: string | null; channel_user_id: string | null;
      cancel_reason: string | null; at: Date; origin: string;
    }>`
      select o.id, o.conversation_id, cl.display_name as buyer, cc.channel_user_id,
             o.cancel_reason, o.origin,
             coalesce((select max(t.at) from outbound_transitions t
                        where t.outbound_id = o.id and t.to_status = 'canceled'),
                      o.created_at) as at
        from outbound_messages o
        join conversations c on c.id = o.conversation_id
        left join clients cl on cl.id = c.client_id
        -- C4.a — his identity on THIS conversation's channel, so a refused mail
        -- names the address it was for rather than nobody.
        left join client_channels cc on cc.client_id = c.client_id and cc.channel = c.channel
       where o.business_id = ${bid.value}
         and ${isRefusal}
         and o.created_at > now() - make_interval(days => ${days})
         ${opts.conversationId ? sql`and o.conversation_id = ${opts.conversationId}` : sql``}
       order by at desc
       limit ${opts.limit ?? 50}
    `.execute(tx)).rows;

    return rows.flatMap((r) => {
      const reason = parseReason(r.cancel_reason);
      if (reason === null) return [];           // unreachable via the filter; still not guessed
      return [{
        outboundId: r.id,
        conversationId: r.conversation_id,
        buyer: r.buyer ?? r.channel_user_id,
        reason,
        at: r.at,
        origin: r.origin === 'owner' ? 'owner' as const
          : r.origin === 'outreach' ? 'outreach' as const : 'employee' as const,
      }];
    });
  });
}

/**
 * How many messages did not reach a buyer, for Today's attention list. A real
 * count of persisted rows, by the same predicate the list uses — counted by the
 * database, not derived, estimated or scored.
 */
export async function countRefusals(
  db: Db, businessIdRaw: string, sinceDays = 7,
): Promise<number> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return 0;
  return withTenantTx(db, bid.value, async (tx) => {
    const r = (await sql<{ n: number }>`
      select count(*)::int as n from outbound_messages
       where business_id = ${bid.value} and ${isRefusal}
         and created_at > now() - make_interval(days => ${sinceDays})
    `.execute(tx)).rows[0];
    return Number(r?.n ?? 0);
  });
}

/**
 * 0052 — messages whose fate nobody knows, and the two things she can do.
 *
 * A read model like the refusals above, and for the same reason: the worker
 * already wrote the row and its reason, and nothing here re-decides anything.
 * The difference is that a refusal is FINISHED — it did not go, and the gate
 * said why — while this one is a QUESTION nobody but a person can close. So it
 * carries what she needs to answer it: who it was for, what it said, and when
 * the answer went missing.
 */
export type UncertainSend = {
  readonly outboundId: string;
  readonly conversationId: string;
  readonly buyer: string | null;
  /** Her own words, so she can judge what a second copy would look like. */
  readonly body: string;
  readonly at: Date;
  readonly origin: 'employee' | 'owner' | 'outreach';
};

const UNCERTAIN = sql`status = 'uncertain'`;

export async function loadUncertainSends(
  db: Db, businessIdRaw: string,
  opts: { readonly conversationId?: string; readonly limit?: number } = {},
): Promise<readonly UncertainSend[]> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return [];

  return withTenantTx(db, bid.value, async (tx) => {
    const rows = (await sql<{
      id: string; conversation_id: string; buyer: string | null; channel_user_id: string | null;
      body: string; at: Date; origin: string;
    }>`
      select o.id, o.conversation_id, cl.display_name as buyer, cc.channel_user_id,
             o.body, o.origin,
             coalesce((select max(t.at) from outbound_transitions t
                        where t.outbound_id = o.id and t.to_status = 'uncertain'),
                      o.created_at) as at
        from outbound_messages o
        join conversations c on c.id = o.conversation_id
        left join clients cl on cl.id = c.client_id
        left join client_channels cc on cc.client_id = c.client_id and cc.channel = c.channel
       where o.business_id = ${bid.value}
         and ${UNCERTAIN}
         ${opts.conversationId ? sql`and o.conversation_id = ${opts.conversationId}` : sql``}
       order by at desc
       limit ${opts.limit ?? 50}
    `.execute(tx)).rows;

    return rows.map((r) => ({
      outboundId: r.id,
      conversationId: r.conversation_id,
      buyer: r.buyer ?? r.channel_user_id,
      body: r.body,
      at: r.at,
      origin: r.origin === 'owner' ? 'owner' as const
        : r.origin === 'outreach' ? 'outreach' as const : 'employee' as const,
    }));
  });
}
