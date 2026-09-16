import { sql } from 'kysely';
import { withTenantTx, type Db } from '../db/client.js';
import { parseBusinessId } from '../core/types/ids.js';

/**
 * 0052 — what a person decides about a message nobody can account for.
 *
 * The worker calls the provider and then records the answer. When the process
 * dies between those two steps, the row is marked 'uncertain' and stops: it may
 * have reached the buyer, and nothing here can find out. WhatsApp will not
 * answer for a message whose id we never received, and SMTP has nothing to ask.
 *
 * So the decision is hers, and this module carries it out. It lives beside the
 * worker rather than with the owner's screens because it WRITES to
 * `outbound_messages`: `src/api/web/refusals.ts` reads those rows back for her
 * and a parity test holds that file to reading only — a surface that can change
 * a send is a second send path by another name.
 */

/** What she decided about one of them. */
export type UncertainDecision = 'send_again' | 'leave_it';

export type UncertainOutcome = {
  readonly done: boolean;
  /** Where to send her back to, and which conversation the worker should look at. */
  readonly conversationId: string | null;
};

/**
 * Carry out her decision, and ONLY from 'uncertain' — a row that moved on since
 * she opened the page (a late receipt, a colleague answering first) is left
 * alone, so two people pressing at once cannot send the message twice between
 * them. That is the same claim-by-status rule the sequence sweep uses.
 *
 * 'send_again' produces an ordinary queued row: it meets `gateOutbound` again
 * like any other message, because the hours it waited may have closed the reply
 * window or brought a suppression. 'leave_it' closes it as canceled, which is
 * the honest record — this product never saw it leave.
 */
export async function decideUncertainSend(
  db: Db, businessIdRaw: string, outboundId: string, decision: UncertainDecision, by: string,
): Promise<UncertainOutcome> {
  const bid = parseBusinessId(businessIdRaw);
  const none: UncertainOutcome = { done: false, conversationId: null };
  if (!bid.ok || !/^[0-9a-f-]{36}$/i.test(outboundId)) return none;

  return withTenantTx(db, bid.value, async (tx) => {
    const to = decision === 'send_again' ? 'queued' : 'canceled';
    const detail = decision === 'send_again'
      ? `sent again by ${by}: she judged it had not arrived`
      : `left by ${by}: it may already have arrived`;

    const r = (await sql<{ conversation_id: string }>`
      update outbound_messages
         set status = ${to},
             sending_since = null,
             cancel_reason = ${decision === 'leave_it' ? detail : null}
       where id = ${outboundId}::uuid and business_id = ${bid.value}::uuid and status = 'uncertain'
       returning conversation_id::text as conversation_id
    `.execute(tx)).rows[0];
    if (!r) return none;

    // The audit row is shaped the way `transition()` shapes one: from where, to
    // where, and in whose words. Her name is in the detail because this is the
    // one send decision no rule made.
    await sql`insert into outbound_transitions (business_id, outbound_id, from_status, to_status, detail)
              values (${bid.value}::uuid, ${outboundId}::uuid, 'uncertain', ${to}, ${detail})`.execute(tx);
    return { done: true, conversationId: r.conversation_id };
  });
}
