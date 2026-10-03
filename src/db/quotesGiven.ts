import { sql } from 'kysely';

/**
 * Phase 9 of the warmth run (w4-customers-13, -20, V1-201) — WHEN A PRICE
 * WAS GIVEN, in one place. Read with the quote as `q`.
 *
 * A quote is recorded on every turn that priced something, sent or not. Four
 * pages counted "quotes" four ways: the calendar marked a price "✓ done"
 * while the reply carrying it waited for the owner's review; Today counted a
 * quote "sent" when any reply left after it, even after its own draft was
 * thrown away; Results counted every price worked out; the Inbox's band read
 * the rule below. Now all four read this:
 *
 *   GIVEN — not held back, and a line left to them after it. "Not held back"
 *   is G7b's rule (`priorQuotesForClient`, `repos.ts`): a quote whose reply
 *   became a draft counts only once that draft was approved unchanged. "A line
 *   left" is a message out in its conversation from the moment the price was
 *   worked out — `messages` holds a reply only once it was sent (channels.ts,
 *   at 'sent'), and the owner's own replies from the phone too.
 *
 *   IN REVIEW — the reply carrying it is a draft waiting for the owner's OK:
 *   its own turn's draft, or — where no turn names the quote (a price written
 *   in by hand, an older row) — a draft waiting in its conversation, made
 *   since the price was worked out: the next reply, whatever it says, has
 *   not left.
 *
 * Anything else was worked out and never reached them (a draft rewritten,
 * skipped or expired; a reply that never left).
 */
export const PRICE_GIVEN = sql<boolean>`(not exists (
    select 1 from turns t join drafts d on d.turn_message_id = t.message_id
     where t.quote_id = q.id and d.status <> 'approved')
  and exists (select 1 from messages m where m.conversation_id = q.conversation_id
               and m.direction = 'outbound' and m.sent_at >= q.created_at))`;

export const PRICE_IN_REVIEW = sql<boolean>`(exists (
    select 1 from turns t join drafts d on d.turn_message_id = t.message_id
     where t.quote_id = q.id and d.status = 'pending')
  or exists (select 1 from drafts d where d.conversation_id = q.conversation_id
              and d.status = 'pending' and d.created_at >= q.created_at))`;
