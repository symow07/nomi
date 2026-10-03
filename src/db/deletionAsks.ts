import { sql } from 'kysely';
import { withTenantTx, type Db, type Tx } from './client.js';
import { parseBusinessId, type BusinessId } from '../core/types/ids.js';
import { asksForDeletion } from '../core/safety/deletion.js';

/**
 * 0076 — A DELETION REQUEST IN CHAT IS WRITTEN DOWN WHEN IT ARRIVES.
 *
 * The hand-off (0075) sends the buyer nothing and gives the conversation to a
 * person. This is what it leaves behind: a row that says this buyer asked, in
 * this conversation, in this message, at this time — so the request survives
 * the conversation being handed back, and nobody has to remember to write it
 * down first. It is the reminder, not the action: nothing is erased because of
 * it and Nomi's operator is not told. The owner decides on the buyer's page:
 * record it as a deletion request, or mark it as not one.
 *
 * Every write is scoped by business as well as by row, like the read models.
 */

export type DeletionAskNoted =
  /** A new request, waiting for the owner. */
  | 'noted'
  /** They asked again while one waits: the same request, counted. */
  | 'asked_again'
  /** The owner already recorded a deletion request for them: nothing new. */
  | 'already_recorded'
  /** The conversation has no buyer to name — nothing can be written. */
  | 'no_buyer';

/**
 * How far back the line that asked is looked for. A merged batch (M51.1) is
 * one turn over several messages, and the turn's own message is the LAST of
 * them; the one that asked may be earlier. Only the batch: a message from last
 * month that asked, and was decided, is not this request.
 */
const BATCH_REACH = '10 minutes';

export async function noteDeletionAsk(
  tx: Tx, businessId: BusinessId,
  input: { readonly conversationId: string; readonly messageId: string; readonly now: Date },
): Promise<DeletionAskNoted> {
  const client = (await sql<{ client_id: string | null }>`
    select client_id::text as client_id from conversations
     where id = ${input.conversationId}::uuid and business_id = ${businessId}::uuid`.execute(tx)).rows[0]?.client_id ?? null;
  if (client === null) return 'no_buyer';

  const recorded = (await sql<{ yes: boolean }>`
    select exists (select 1 from deletion_requests
                    where business_id = ${businessId}::uuid and client_id = ${client}::uuid
                      and scope = 'buyer' and state = 'open') as yes`.execute(tx)).rows[0]?.yes === true;
  if (recorded) return 'already_recorded';

  // The turn's message, then the earlier lines of its batch: the first whose
  // own words ask is the one that asked. When none does — the reply promised a
  // deletion to words no pattern knows (layer 2) — it is the turn's message.
  const turn = (await sql<{ id: string; sent_at: Date }>`
    select id::text as id, sent_at from messages
     where conversation_id = ${input.conversationId}::uuid and external_id = ${input.messageId}
     limit 1`.execute(tx)).rows[0] ?? null;
  const batch = turn === null ? [] : (await sql<{ id: string; text_content: string | null; sent_at: Date }>`
    select id::text as id, text_content, sent_at from messages
     where conversation_id = ${input.conversationId}::uuid and direction = 'inbound'
       and sent_at <= ${turn.sent_at} and sent_at > ${turn.sent_at}::timestamptz - ${BATCH_REACH}::interval
     order by sent_at desc, id desc
     limit 20`.execute(tx)).rows;
  const asking = batch.find((m) => asksForDeletion(m.text_content ?? '') !== null) ?? turn;

  const r = (await sql<{ inserted: boolean }>`
    insert into deletion_asks (business_id, client_id, conversation_id, message_id, asked_at, last_asked_at)
    values (${businessId}::uuid, ${client}::uuid, ${input.conversationId}::uuid,
            ${asking?.id ?? null}::uuid, ${asking?.sent_at ?? input.now}, ${input.now})
    on conflict (client_id) where state = 'waiting'
    do update set asks = deletion_asks.asks + 1, last_asked_at = excluded.last_asked_at
    returning (xmax = 0) as inserted`.execute(tx)).rows[0];
  return r?.inserted ? 'noted' : 'asked_again';
}

/** A request noted from chat that is waiting for the owner, as the pages show it. */
export type WaitingAsk = {
  readonly id: string;
  readonly askedAt: Date;
  readonly asks: number;
  readonly conversationId: string;
  /** Their message, when it is still there. */
  readonly words: string | null;
  readonly buyer: string | null;
  /** The warmth pass — who asked, for their face on Your data's list. */
  readonly clientId?: string | null;
};

type AskRow = {
  id: string; asked_at: Date; asks: number; conversation_id: string;
  words: string | null; buyer: string | null; client_id: string | null;
};
const askOf = (r: AskRow): WaitingAsk => ({
  id: r.id, askedAt: r.asked_at, asks: r.asks, conversationId: r.conversation_id,
  words: r.words, buyer: r.buyer, clientId: r.client_id,
});

/** The waiting request of THIS conversation's buyer, from any of their conversations. */
export async function waitingAskOf(tx: Tx, conversationId: string): Promise<WaitingAsk | null> {
  const r = (await sql<AskRow>`
    select a.id::text as id, a.asked_at, a.asks, a.conversation_id::text as conversation_id,
           m.text_content as words, c.display_name as buyer, a.client_id::text as client_id
      from deletion_asks a
      left join messages m on m.id = a.message_id
      left join clients c on c.id = a.client_id
     where a.state = 'waiting'
       and a.client_id = (select client_id from conversations where id = ${conversationId}::uuid)
     limit 1`.execute(tx)).rows[0];
  return r ? askOf(r) : null;
}

/** Every request waiting for the owner, oldest first: the one that has waited longest leads. */
export async function waitingAsks(tx: Tx, businessId: BusinessId): Promise<readonly WaitingAsk[]> {
  return (await sql<AskRow>`
    select a.id::text as id, a.asked_at, a.asks, a.conversation_id::text as conversation_id,
           m.text_content as words, c.display_name as buyer, a.client_id::text as client_id
      from deletion_asks a
      left join messages m on m.id = a.message_id
      left join clients c on c.id = a.client_id
     where a.business_id = ${businessId}::uuid and a.state = 'waiting'
     order by a.asked_at
     limit 100`.execute(tx)).rows.map(askOf);
}

/**
 * The owner decided it was not a deletion request. It stops waiting and is
 * kept, with who decided and when; a new ask starts a new one. Matched on
 * `state = 'waiting'`, so a request already recorded cannot be dismissed.
 */
export async function dismissDeletionAsk(
  db: Db, businessIdRaw: string, conversationId: string, actor: string,
): Promise<'dismissed' | 'not_waiting' | 'failed'> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return 'failed';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId)) return 'not_waiting';
  return withTenantTx(db, bid.value, async (tx) => {
    const r = await sql<{ id: string }>`
      update deletion_asks set state = 'dismissed', decided_at = now(), decided_by = ${actor}
       where business_id = ${bid.value}::uuid and state = 'waiting'
         and client_id = (select client_id from conversations where id = ${conversationId}::uuid)
      returning id::text as id`.execute(tx);
    const id = r.rows[0]?.id;
    if (!id) return 'not_waiting';
    // The trail says a noted request was set aside, and which — never whose.
    await sql`insert into channel_audit (business_id, channel_id, action, actor, detail)
              values (${bid.value}, null, 'deletion_dismissed', ${actor},
                      ${JSON.stringify({ ask: id })}::jsonb)`.execute(tx);
    return 'dismissed';
  });
}
