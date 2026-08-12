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
  /** Employee-authored, or the owner's own typed reply that never left. */
  readonly origin: 'employee' | 'owner';
};

/**
 * Every reason the worker can write. A row whose reason is not one of these is
 * not shown: a refusal we cannot name is one we cannot explain, and inventing a
 * label would be the same silence wearing a different coat. The list is also
 * the SQL filter, so the count and the list can never disagree.
 */
export const REFUSAL_REASONS: readonly RefusalReason[] = [
  'handed_off', 'paused', 'window_closed', 'not_activated',
  'not_allowlisted', 'daily_ceiling', 'window_needs_owner',
  'media_unsupported', 'silenced',
];

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
        left join client_channels cc on cc.client_id = c.client_id and cc.channel = 'whatsapp'
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
        origin: r.origin === 'owner' ? 'owner' as const : 'employee' as const,
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
