import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import type { BusinessId } from '../../core/types/ids.js';
import { RECEIVED_KINDS } from '../../core/conversation/inbound.js';
import { DELETION_WAITING, IS_BLOCKED } from '../../db/buyersList.js';
import { readAttention, type AttentionCounts } from './operations.js';
import { isRefusal, UNCERTAIN } from './refusals.js';
import { conversationUrl } from './layout.js';
import type { LiveWatch } from './flash.js';

/**
 * CC-26 — THE PAGE LEARNS THAT SOMETHING NEW ARRIVED, AND SAYS SO.
 *
 * The audit's last open P1: "Nothing on the page updates by itself. A new buyer
 * message appears only if she reloads, and there is no script anywhere in the
 * app to tell her." Three pages watch, each for what it shows:
 *
 *   - a conversation (`/app/inbox/:id`): a new message from the buyer; a new
 *     reply waiting for her review — the draft she is about to approve may no
 *     longer be the newest one; or the conversation itself changed — handed to
 *     a person (the worker does that seconds after the message that caused
 *     it), taken by a colleague, or a message that did not go;
 *   - Buyers (`/app/inbox`): anything that would change the list — a newest
 *     message, who holds a conversation, a reply waiting, a deletion request
 *     waiting, a message that did not go;
 *   - Today (`/app`): the counts under "Needs your attention".
 *
 * The buyer's own page (`/app/conversations/:id`) does NOT watch. It is the
 * buyer's record — the name, a summary of the history, the deletion decision —
 * and nothing on it answers a buyer: the conversation page is one door away,
 * is where a new message is read and answered, and carries the line. A page
 * nobody keeps open to wait for a reply would only add asking for nothing.
 *
 * HOW. A page is drawn with a MARK — a few numbers (and, for a conversation,
 * the id of the reply waiting) that the database gives at that moment. The
 * page's script sends the mark back every twenty seconds; this module reads
 * the mark again and compares. The browser's clock never decides anything,
 * so a phone whose clock is wrong is told the same as one whose clock is right.
 *
 * POLLING, NOT SERVER-SENT EVENTS. One Node process on Railway serves the app
 * and runs the workers. A stream per open tab would hold a connection open
 * for as long as the tab is, through a proxy that is free to close it, and
 * a deploy would drop every one at once; and it would need something to
 * push. The messages are written by the worker (pg-boss jobs), so either the
 * send path would have to announce each one, or Postgres would (LISTEN/NOTIFY:
 * a trigger, so a migration, and a connection held open to listen on). A
 * question every twenty seconds from the few tabs an owner keeps open costs one
 * indexed read each (measured: well under a millisecond for a conversation,
 * about three for Buyers over five hundred conversations), needs nothing from
 * the send path, and carries on across a deploy; and a buyer waits minutes for
 * an answer, not seconds. The script asks nothing while the tab is hidden.
 *
 * WHICH MOMENT A MARK NAMES. For a conversation and for Buyers the route reads
 * the mark BEFORE it reads the page. A message that lands between the two is
 * on the page and not in the mark, so the line says "new" once more than it
 * had to; the other order would lose it. Today's mark is the counts the page
 * shows, read by the same function (`readAttention`), so the two cannot differ.
 */

export type LiveKind = 'conversation' | 'buyers' | 'today';

/** What the line can say: one sentence each (`live.<what>` in the catalogue). */
export type LiveNews = 'message' | 'reply' | 'changed' | 'list' | 'today';

/** What the page's script is told. `what` only when there is news. */
export type LiveSaid = { readonly news: false } | { readonly news: true; readonly what: LiveNews };

const COUNT = '(?:0|[1-9][0-9]{0,9})';
const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/**
 * The marks, exactly as they are written — digits, hex, dots and hyphens:
 * nothing a URL encodes, so no `%` reaches a page.
 *
 *   conversation  `<buyer messages>.<the reply waiting, or 0>.<eight hex of who holds it and what did not go>`
 *   buyers        `<conversations>.<sixteen hex of the list's fingerprint>`
 *   today         `<replies waiting>.<waiting for a person>.<held by a person>.<did not go>.<deletion asked>`
 */
const MARK: Record<LiveKind, RegExp> = {
  conversation: new RegExp(`^${COUNT}\\.(?:0|${ID})\\.[0-9a-f]{8}$`),
  buyers: new RegExp(`^${COUNT}\\.[0-9a-f]{16}$`),
  today: new RegExp(`^${COUNT}(?:\\.${COUNT}){5}$`),
};

/** Is this a mark of this kind, as a page would carry it? */
export const isMark = (kind: LiveKind, raw: unknown): raw is string =>
  typeof raw === 'string' && MARK[kind].test(raw);

/**
 * THE COMPARISON — the one place "is there news?" is decided.
 *
 * A conversation: the buyer wrote something the page would show (their count
 * rose); else a reply is waiting that is not the one the page shows; else the
 * conversation changed hands or a message did not go. A reply that was
 * decided elsewhere, and nothing waiting now, is not news: the page is stale,
 * but the one thing she could do there is refused with a sentence.
 *
 * Buyers and Today: any difference at all. What changed may be fewer rows
 * (she answered someone in another tab); the list is still not the list the
 * page shows, and the sentence says "changed", never "new".
 */
export function liveNews(kind: LiveKind, since: string, now: string): LiveSaid {
  if (kind === 'conversation') {
    const [said0 = '0', waiting0 = '0', state0 = ''] = since.split('.');
    const [said1 = '0', waiting1 = '0', state1 = ''] = now.split('.');
    if (Number(said1) > Number(said0)) return { news: true, what: 'message' };
    if (waiting1 !== '0' && waiting1 !== waiting0) return { news: true, what: 'reply' };
    if (state1 !== state0) return { news: true, what: 'changed' };
    return { news: false };
  }
  return since === now ? { news: false } : { news: true, what: kind === 'buyers' ? 'list' : 'today' };
}

/** A conversation id as Postgres stores one; anything else names no conversation. */
const UUID = new RegExp(`^${ID}$`, 'i');

/**
 * A buyer's message the conversation page SHOWS — the transcript's own rule
 * (`loadConversationDetail` in inbox.ts): words, a voice note, or something
 * named that could not be read. A reaction or a sticker is recorded and left
 * out (G2c), so it is not news either. `tests/integration/live-refresh.test.ts`
 * holds the two against each other.
 */
const SHOWN = sql<boolean>`(m.text_content is not null or m.input_type = 'voice'
  or m.ai_analysis->>'received' = any(${[...RECEIVED_KINDS]}::text[]))`;

/**
 * A conversation's mark: how many messages from the buyer the page would show;
 * the reply waiting for review (the newest pending draft, as the page picks
 * it); and eight hex of its state — who holds it, and how many of its
 * messages the send gate refused or nobody can account for (the page's own
 * cards, by their own predicates). Each through an index: the messages by
 * `(conversation_id, sent_at)`, the waiting reply by the business's pending
 * drafts, the sends by `(conversation_id, seq)`. Null when the conversation is
 * not this business's — row security hides it, so it is simply not there.
 */
export async function conversationMark(db: Db, bid: BusinessId, conversationId: string): Promise<string | null> {
  if (!UUID.test(conversationId)) return null;
  return withTenantTx(db, bid, async (tx) => {
    const row = (await sql<{ said: number; waiting: string | null; state: string }>`
      select (select count(*)::int from messages m
               where m.conversation_id = c.id and m.direction = 'inbound' and ${SHOWN}) as said,
             (select d.id::text from drafts d
               where d.business_id = c.business_id and d.status = 'pending' and d.conversation_id = c.id
               order by d.created_at desc, d.id desc limit 1) as waiting,
             left(md5(concat_ws('/', coalesce(c.assigned_to, '-'),
               (select count(*) from outbound_messages o where o.conversation_id = c.id and ${isRefusal})::text,
               (select count(*) from outbound_messages o where o.conversation_id = c.id and ${UNCERTAIN})::text)), 8) as state
        from conversations c
       where c.id = ${conversationId}::uuid and c.business_id = ${bid}`.execute(tx)).rows[0];
    return row ? `${row.said}.${row.waiting ?? '0'}.${row.state}` : null;
  });
}

/**
 * The Buyers list's mark: how many conversations, and a fingerprint of what
 * each row is drawn from — its newest message (the list's own order: newest
 * stamp, then id), who holds it, whether a reply waits, whether a deletion
 * request waits, whether a message did not go. The same predicates the list
 * groups and counts by (`src/db/buyersList.ts`), so the line speaks exactly
 * when the rows, the groups or the tab counts would change. One pass over the
 * business's conversations, each newest message found through its index.
 */
export async function buyersMark(db: Db, bid: BusinessId): Promise<string> {
  return withTenantTx(db, bid, async (tx) => {
    const row = (await sql<{ n: number; print: string }>`
      select count(*)::int as n,
             md5(coalesce(string_agg(concat_ws('/', c.id::text, coalesce(lm.id::text, '-'), coalesce(c.assigned_to, '-'),
                   (exists (select 1 from drafts d where d.conversation_id = c.id and d.status = 'pending'))::text,
                   (${DELETION_WAITING})::text, (${IS_BLOCKED})::text), ',' order by c.id), '')) as print
        from conversations c
        left join lateral (select m.id from messages m where m.conversation_id = c.id
                            order by m.sent_at desc, m.id desc limit 1) lm on true
       where c.business_id = ${bid}`.execute(tx)).rows[0];
    return `${row?.n ?? 0}.${(row?.print ?? '').slice(0, 16)}`;
  });
}

/**
 * Today's mark: the attention counts, in `readAttention`'s order. A snapshot
 * built before 0076 has no deletion count; it had none to show.
 */
export const todayMark = (a: Omit<AttentionCounts, 'deletionAsks' | 'ordersWaiting'> & {
  readonly deletionAsks?: number; readonly ordersWaiting?: number;
}): string =>
  [a.pendingApprovals, a.handoffs, a.ownerHandling, a.blockedMessages, a.deletionAsks ?? 0, a.ordersWaiting ?? 0].join('.');

/**
 * 0080 — how many orders customers said yes to are waiting for the owner, in
 * the whole business. Every live answer carries it, whichever page asked, so a
 * page left open anywhere can tell the owner — in the browser, when they asked
 * for that — that a new one arrived (liveScript.ts).
 */
export async function ordersWaitingCount(db: Db, bid: BusinessId): Promise<number> {
  return withTenantTx(db, bid, async (tx) => (await sql<{ n: number }>`
    select count(*)::int as n from order_proposals
     where business_id = ${bid} and state = 'pending'`.execute(tx)).rows[0]?.n ?? 0);
}

/** What the address answers: the status, and what the page's script is told. */
export type LiveAnswer = { readonly status: 200 | 400 | 404; readonly said: LiveSaid; readonly orders?: number };

/**
 * The address a watching page asks. The session has already said whose
 * business this is (the route); every read here is inside that tenant's own
 * transaction, so another business's conversation is simply not found (404)
 * and another business's messages never count. A mark no page could carry is
 * 400, which the script takes as "stop", never as "try again".
 */
export async function liveAnswer(
  db: Db, bid: BusinessId, kind: LiveKind, since: unknown, conversationId = '',
): Promise<LiveAnswer> {
  if (!isMark(kind, since)) return { status: 400, said: { news: false } };
  const now = kind === 'conversation' ? await conversationMark(db, bid, conversationId)
    : kind === 'buyers' ? await buyersMark(db, bid)
    : todayMark(await readAttention(db, bid));
  if (now === null) return { status: 404, said: { news: false } };
  return { status: 200, said: liveNews(kind, since, now), orders: await ordersWaitingCount(db, bid) };
}

/** A conversation watches its own address; the door lands on its newest message (CC-25). */
export const conversationWatch = (conversationId: string, mark: string): LiveWatch => ({
  ask: `/app/live/conversation/${encodeURIComponent(conversationId)}?since=${mark}`,
  door: conversationUrl(conversationId),
  says: [{ what: 'message', key: 'live.message' }, { what: 'reply', key: 'live.reply' }, { what: 'changed', key: 'live.changed' }],
});

/** Buyers watches the whole list; the door is the first page of the tab and the search she is on. */
export const buyersWatch = (mark: string, door: string): LiveWatch => ({
  ask: `/app/live/buyers?since=${mark}`,
  door,
  says: [{ what: 'list', key: 'live.list' }],
});

/** Today watches its attention counts; the door is Today again, from the top. */
export const todayWatch = (mark: string): LiveWatch => ({
  ask: `/app/live/today?since=${mark}`,
  door: '/app',
  says: [{ what: 'today', key: 'live.today' }],
});
