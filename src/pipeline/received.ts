import { sql } from 'kysely';
import { lockConversation, type Tx } from '../db/client.js';
import type { tenantRepos } from '../db/repos.js';
import { parseBusinessId, parseConversationId, type BusinessId, type ConversationId } from '../core/types/ids.js';
import type { Signal } from '../core/scoring/signals.js';
import type { TurnEffects } from './turn.js';
import { QUEUES, type InboundJob } from '../queue/boss.js';
import { ownershipOf, canTransition, WAITING_HUMAN_AGENT } from '../core/conversation/ownership.js';
import { asksForDeletion } from '../core/safety/deletion.js';

/**
 * G2c — recording a message she will not answer: a reaction or a sticker she
 * ignores, or a document, video or location she cannot read and hands to a
 * person.
 *
 * Recorded either way, for the same reason `recordImageMessage` records a photo
 * she could not see: a row that exists only when she answered makes "he sent
 * something" indistinguishable from "he sent nothing". The kind of thing that
 * arrived goes in `ai_analysis`, so the owner's timeline can name it.
 *
 * `input_type` 'unknown' has been in the CHECK since the baseline. `text_content`
 * is the buyer's own caption on a document or video, when he wrote one.
 */
/**
 * G10a — a line the buyer TYPED, on the timeline the owner reads.
 *
 * Nothing in production wrote one. A voice note, a photo and a file each had
 * their writer; a typed message only ever became a batching fragment, so the
 * conversation page, Buyers' latest line, the analytics counts and the
 * contacts' "he wrote first" evidence all read a `messages` table that held
 * everything a buyer said except the words he typed. The demo seed wrote
 * them directly, which is why every screen looked right.
 *
 * One row per WhatsApp message, as it arrives — before any batching — so the
 * timeline shows his lines as he sent them. Idempotent on the provider's id.
 */
export async function recordTypedMessage(
  tx: Tx, conversationId: string, messageId: string, text: string,
): Promise<void> {
  await sql`
    insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at)
    values (${conversationId}, ${messageId}, 'inbound', 'text', ${text}, clock_timestamp())
    on conflict do nothing
  `.execute(tx);
}

export async function recordReceivedMessage(
  tx: Tx,
  conversationId: string,
  messageId: string,
  caption: string | null,
  received: string,
  /** CH7 — the catalogue product a shared post or story was matched to. */
  about?: string | null,
): Promise<void> {
  await sql`
    insert into messages
      (conversation_id, external_id, direction, input_type, text_content, ai_analysis, sent_at)
    values
      (${conversationId}, ${messageId}, 'inbound', 'unknown', ${caption},
       ${JSON.stringify(about ? { received, about } : { received })}::jsonb, clock_timestamp())
    on conflict do nothing
  `.execute(tx);
}

/**
 * G2c — she could not read what the buyer sent, so a PERSON must.
 *
 * C4.c — moved here from the worker's closure, unchanged, because an e-mail
 * reply hands the conversation to a person the same way and a second copy of
 * this transition would be a second place to get it wrong.
 *
 * Records the reason, and moves the conversation to "waiting for a person"
 * when she is the one holding it.
 *
 * Before this, the unheard-note and unclear-photo paths recorded their
 * signal and a handoff event and left the conversation with her. Those
 * signals score no problem points, so ownership never changed, and the
 * conversation never appeared under "needs you" — the owner learned of it
 * only if the WhatsApp alert happened to arrive.
 *
 * The ownership model is unchanged: this is the existing AI → WAITING_HUMAN
 * transition, taken through `canTransition`. A conversation a person already
 * holds is left with that person.
 *
 * 0076 — AND WHAT THE BUYER WROTE, WHEN THERE WERE WORDS. No turn runs on
 * these paths (the assistant is stopped or paused, the number is not on the
 * list, a stranger answered a cold e-mail), so the turn's own check cannot see
 * a deletion request in them. This one does: the request is written down with
 * the hand-off and named as its own reason and its own alert, exactly as the
 * turn would have — an emergency stop is the worst moment for one to be
 * filed under "stopped" and forgotten.
 */
export async function handToPerson(
  tenant: ReturnType<typeof tenantRepos>, conversationId: ConversationId, signal: Signal,
  said: readonly { readonly messageId: string; readonly text: string | null }[] = [],
): Promise<TurnEffects> {
  await tenant.signals.record(conversationId, signal);
  const asking = said.find((x) => asksForDeletion(x.text ?? '') !== null) ?? null;
  if (asking) {
    await tenant.signals.record(conversationId, { kind: 'deletion_requested' });
    await tenant.deletionAsks.note({ conversationId, messageId: asking.messageId, now: new Date() });
  }
  const state = await tenant.conversations.loadState(conversationId);
  const from = ownershipOf(state?.assignedTo ?? null);
  // Only AI → WAITING_HUMAN is an allowed move into waiting; a person who
  // already holds it keeps it.
  if (state && canTransition(from, 'WAITING_HUMAN')) {
    await tenant.conversations.assign(conversationId, WAITING_HUMAN_AGENT);
  }
  await tenant.events.append(conversationId, 'handoff', { reason: signal.kind });
  return {
    outbound: null, draftCreated: null, hotLeadAlert: false,
    handoffAlert: true, deletionAlert: asking !== null, orderProposed: null,
  } satisfies TurnEffects;
}

/**
 * 0077 — what a dead inbound job leaves for a person: the conversation, and the
 * message its turn never answered. Read defensively — a dead letter is whatever
 * was queued, possibly by an older build — and null when it names no
 * conversation, which leaves nothing to hand over (the operator's `dead_letter`
 * alert still goes).
 */
export type Unanswered = {
  readonly businessId: BusinessId;
  readonly conversationId: ConversationId;
  readonly messageId: string | null;
  readonly text: string | null;
  /**
   * How the message goes on the timeline, in case the turn's own record rolled
   * back with it (a voice note, a photo): typed words, or named as what
   * arrived — never opened. Null when it is already there: an owner's "answer
   * this" names a message on the timeline.
   */
  readonly record: { readonly kind: 'typed' } | { readonly kind: 'received'; readonly received: string } | null;
};

export function unansweredIn(data: unknown): Unanswered | null {
  if (typeof data !== 'object' || data === null) return null;
  const job = data as { readonly [K in keyof InboundJob]?: unknown };
  const businessId = parseBusinessId(typeof job.businessId === 'string' ? job.businessId : '');
  const conversationId = parseConversationId(typeof job.conversationId === 'string' ? job.conversationId : '');
  if (!businessId.ok || !conversationId.ok) return null;
  const messageId = typeof job.messageId === 'string' && job.messageId !== '' ? job.messageId : null;
  const text = typeof job.text === 'string' && job.text.trim() !== '' ? job.text : null;
  const type = typeof job.messageType === 'string' ? job.messageType : 'text';
  const record: Unanswered['record'] = messageId === null || job.answerOnly === true ? null
    : type === 'text' ? { kind: 'typed' }
    : { kind: 'received', received: type === 'image' ? 'photo' : type === 'audio' ? 'voice'
        : typeof job.received === 'string' && job.received !== '' ? job.received : 'other' };
  return { businessId: businessId.value, conversationId: conversationId.value, messageId, text, record };
}

/**
 * 0077 — A TURN THAT GAVE UP IS A BUYER NOBODY ANSWERED.
 *
 * The queue retried it and moved it to the dead letter queue. Until now that
 * only told the operator (the `dead_letter` alert, CC-10's error record): the
 * buyer's message sat unanswered, the conversation stayed with the assistant,
 * and nobody on the owner's side knew someone was waiting. Now, in the same
 * way as a voice note that could not be heard, a person answers it:
 *
 *   · the message is on the timeline — a typed line already is; a voice note
 *     or a photo whose turn rolled back is recorded by name, not opened;
 *   · the conversation is handed over as `not_answered`, which puts it on
 *     "Needs you" with its reason, and the caller sends the ordinary hand-off
 *     alert; a deletion request in those words is written down as its own
 *     reason (handToPerson);
 *   · a conversation that is gone (erased) is left alone: null.
 *
 * Lines of the buyer's still waiting in a batch stay waiting: closing one needs
 * the turn it was answered in (`processed_in` references `turns`), and no turn
 * ran. The next turn takes them — a silent one while a person holds the
 * conversation.
 *
 * 2026-10-03 — UNLESS SOMEBODY ALREADY ANSWERED IT. The job retries for minutes
 * before it is dead, and in those minutes the owner may take the conversation,
 * answer and hand it back, or a later turn may take the same line. Handing it
 * over then put the conversation on "Needs you" a second time, under "a message
 * that could not be answered", and invited a second reply to a customer who
 * already had one. So the hand-over now asks first (`answeredAfter`), under the
 * lock, before anything is written: an answered message is put on the timeline
 * if it is not there yet, noted as `dead_letter_answered`, and nobody is told.
 */
export async function handOverUnanswered(
  tx: Tx, tenant: ReturnType<typeof tenantRepos>, u: Unanswered,
): Promise<TurnEffects | null> {
  await lockConversation(tx, u.conversationId);
  const exists = await sql<{ one: number }>`
    select 1 as one from conversations where id = ${u.conversationId}::uuid`.execute(tx);
  if (exists.rows.length === 0) return null;
  // Read BEFORE the message is recorded below: a photo or a voice note whose
  // turn rolled back is not on the timeline yet, and recording it stamps now.
  const answered = await answeredAfter(tx, u);
  if (u.messageId !== null && u.record?.kind === 'typed') {
    await recordTypedMessage(tx, u.conversationId, u.messageId, u.text ?? '');
  } else if (u.messageId !== null && u.record?.kind === 'received') {
    await recordReceivedMessage(tx, u.conversationId, u.messageId, u.text, u.record.received);
  }
  if (answered !== null) {
    await tenant.events.append(u.conversationId, 'dead_letter_answered', { messageId: u.messageId, by: answered });
    return null;
  }
  return handToPerson(tenant, u.conversationId, { kind: 'not_answered' },
    u.messageId === null ? [] : [{ messageId: u.messageId, text: u.text }]);
}

/**
 * Has the message a dead turn names been answered since it arrived? How, or
 * null when nobody answered it:
 *
 *   · 'turn'    — its own turn was written (the job died after it committed);
 *   · 'batch'   — a later turn took the same line (`processed_in`);
 *   · 'reply'   — a reply in the conversation after it, queued or sent, by the
 *                 owner or the assistant: a reply that failed or was cancelled
 *                 reached nobody, and a follow-up a schedule sent answers
 *                 nothing the customer said;
 *   · 'replied' — a line that left after it outside the queue (the owner
 *                 answering from the phone: Meta's echo).
 *
 * "After it" is when it arrived: its line on the timeline, or — a photo or a
 * voice note whose turn rolled back is not on it — when its job was queued.
 * A dead job that names no message is read against the customer's last line;
 * with no line at all there is nothing to answer ('nothing'). A message with no
 * arrival on record is handed over, as before: unknown is not answered.
 */
export async function answeredAfter(tx: Tx, u: Unanswered): Promise<'turn' | 'batch' | 'reply' | 'replied' | 'nothing' | null> {
  const mid = u.messageId;
  const r = (await sql<{ turn: boolean; batch: boolean; at: Date | null }>`
    select exists (select 1 from turns t where ${mid}::text is not null and t.message_id = ${mid}) as turn,
           exists (select 1 from message_fragments f
                    where ${mid}::text is not null and f.id = ${mid} and f.processed_in is not null) as batch,
           coalesce(
             (select min(m.sent_at) from messages m
               where ${mid}::text is not null and m.conversation_id = ${u.conversationId}::uuid
                 and m.external_id = ${mid} and m.direction = 'inbound'),
             (select min(j.created_on) from pgboss.job j
               where ${mid}::text is not null and j.name = ${QUEUES.inbound}
                 and j.data->>'messageId' = ${mid} and j.data->>'conversationId' = ${u.conversationId}),
             (select max(m.sent_at) from messages m
               where ${mid}::text is null and m.conversation_id = ${u.conversationId}::uuid and m.direction = 'inbound')
           ) as at`.execute(tx)).rows[0];
  if (!r) return null;
  if (r.turn) return 'turn';
  if (r.batch) return 'batch';
  if (r.at === null) return mid === null ? 'nothing' : null;
  const after = (await sql<{ reply: boolean; replied: boolean }>`
    select exists (select 1 from outbound_messages o
                    where o.conversation_id = ${u.conversationId}::uuid and o.created_at > ${r.at}
                      and o.status not in ('failed', 'canceled') and o.origin <> 'outreach') as reply,
           exists (select 1 from messages m
                    where m.conversation_id = ${u.conversationId}::uuid and m.direction = 'outbound'
                      and m.sent_at > ${r.at}
                      and not exists (select 1 from outbound_messages o
                                       where m.external_id = 'out:' || o.id::text
                                         and (o.origin = 'outreach' or o.created_at <= ${r.at}))) as replied`
    .execute(tx)).rows[0];
  return after?.reply ? 'reply' : after?.replied ? 'replied' : null;
}
