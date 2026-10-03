import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import type { BusinessId } from '../../core/types/ids.js';
import { RECEIVED_KINDS } from '../../core/conversation/inbound.js';
import { DELETION_WAITING, IS_BLOCKED, ORDER_WAITING, needsOwnerFor, readBuyerCounts } from '../../db/buyersList.js';
import { readAttention, type AttentionCounts } from './operations.js';
import { isRefusal, UNCERTAIN } from './refusals.js';
import { conversationUrl } from './layout.js';
import { QUEUES } from '../../queue/boss.js';
import { billingState } from '../../db/billing.js';
import type { LiveWatch } from './flash.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import { t, tn } from './say.js';
import { isolate } from './values.js';

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

export type LiveKind = 'conversation' | 'buyers' | 'today' | 'channels' | 'practice' | 'billing';

/** What the line can say: one sentence each (`live.<what>` in the catalogue). */
export type LiveNews = 'message' | 'reply' | 'changed' | 'list' | 'today' | 'channels' | 'practice' | 'billing';

/**
 * What the page's script is told. `what` only when there is news. `working`
 * (phase 5) only on a conversation or Practice, and only while the assistant is
 * at work on it (`assistantWorking`).
 */
export type LiveSaid = ({ readonly news: false } | { readonly news: true; readonly what: LiveNews }) & { readonly working?: true };

const COUNT = '(?:0|[1-9][0-9]{0,9})';
const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/**
 * The marks, exactly as they are written — digits, hex, dots and hyphens:
 * nothing a URL encodes, so no `%` reaches a page.
 *
 *   conversation  `<buyer messages>.<the reply waiting, or 0>.<eight hex of who holds it and what did not go>`
 *   buyers        `<conversations>.<sixteen hex of the list's fingerprint>`
 *   today         `<replies waiting>.<waiting for a person>.<held by a person>.<did not go>.<deletion asked>`
 *   channels      `<channels a customer wrote on>.<sixteen hex of when, and of the Page connection>`
 *   practice      a conversation's shape, the first figure counting BOTH sides (P3)
 */
const MARK: Record<LiveKind, RegExp> = {
  conversation: new RegExp(`^${COUNT}\\.(?:0|${ID})\\.[0-9a-f]{8}$`),
  buyers: new RegExp(`^${COUNT}\\.[0-9a-f]{16}$`),
  today: new RegExp(`^${COUNT}(?:\\.${COUNT}){5}$`),
  channels: new RegExp(`^${COUNT}\\.[0-9a-f]{16}$`),
  practice: new RegExp(`^${COUNT}\\.(?:0|${ID})\\.[0-9a-f]{8}$`),
  // Phase 6 — billing: whether a card is saved, and the plan's state.
  billing: /^[01]\.[a-z_]{1,20}$/,
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
  if (kind === 'conversation' || kind === 'practice') {
    const [said0 = '0', waiting0 = '0', state0 = ''] = since.split('.');
    const [said1 = '0', waiting1 = '0', state1 = ''] = now.split('.');
    // P3 — in Practice the owner wrote the customer's side; what is news is the answer.
    if (Number(said1) > Number(said0)) return { news: true, what: kind === 'practice' ? 'practice' : 'message' };
    if (waiting1 !== '0' && waiting1 !== waiting0) return { news: true, what: 'reply' };
    if (state1 !== state0) return { news: true, what: 'changed' };
    return { news: false };
  }
  return since === now ? { news: false }
    : { news: true, what: kind === 'buyers' ? 'list' : kind === 'channels' ? 'channels' : kind === 'billing' ? 'billing' : 'today' };
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
export async function conversationMark(
  db: Db, bid: BusinessId, conversationId: string,
  /** P3 — Practice counts both sides: the owner wrote the customer's, and the news is the reply. */
  sides: 'customer' | 'both' = 'customer',
): Promise<string | null> {
  if (!UUID.test(conversationId)) return null;
  return withTenantTx(db, bid, async (tx) => {
    const row = (await sql<{ said: number; waiting: string | null; state: string }>`
      select (select count(*)::int from messages m
               where m.conversation_id = c.id and (${sides === 'both'} or m.direction = 'inbound') and ${SHOWN}) as said,
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
 * PHASE 5 OF THE UI REBUILD (2026-10-02) — IS THE ASSISTANT AT WORK ON THIS
 * CONVERSATION? A customer's message no turn has taken yet, from the last
 * fifteen minutes, in a conversation the assistant holds: a fragment with no
 * `processed_in` (0009's own "pending"), or the message still in the queue —
 * before the worker has recorded it, and a voice note or a photo, which a turn
 * takes whole and never as a fragment. Then the page says so in place — the
 * line where the reply will be — and its script asks every few seconds, and
 * draws the reply into the page when it lands, without a reload.
 *
 * Fifteen minutes because a turn that has not run by then has failed, and a
 * failed turn hands the conversation to a person (`not_answered`, PR 110): a
 * line saying the assistant is writing must never outlive the writing. A
 * conversation a person holds never shows it — the assistant is not answering.
 */
export const WORKING_WINDOW_MIN = 15;
export async function assistantWorking(db: Db, bid: BusinessId, conversationId: string): Promise<boolean> {
  if (!UUID.test(conversationId)) return false;
  return withTenantTx(db, bid, async (tx) => (await sql<{ working: boolean }>`
    select exists (select 1 from conversations c
       where c.id = ${conversationId}::uuid and c.business_id = ${bid} and c.assigned_to is null
         and (exists (select 1 from message_fragments f
                       where f.conversation_id = c.id and f.processed_in is null
                         and f.received_at > now() - make_interval(mins => ${WORKING_WINDOW_MIN}))
              or exists (select 1 from pgboss.job j
                          where j.name = ${QUEUES.inbound} and j.singleton_key = ${conversationId}
                            and j.state in ('created', 'retry', 'active')
                            and j.created_on > now() - make_interval(mins => ${WORKING_WINDOW_MIN})))) as working`.execute(tx)).rows[0]?.working === true);
}

/**
 * What the address answers: the status, and what the page's script is told.
 * (0080's count of orders waiting rode on every answer, for the browser's own
 * notice; the warmth run's phase 8 retired that notice — the rail's question
 * says a customer newly waits, an order among them.)
 */
export type LiveAnswer = { readonly status: 200 | 400 | 404; readonly said: LiveSaid };

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
    : kind === 'practice' ? await conversationMark(db, bid, conversationId, 'both')
    : kind === 'buyers' ? await buyersMark(db, bid)
    : kind === 'channels' ? await channelsMark(db, bid)
    : kind === 'billing' ? await billingMark(db, bid)
    : todayMark(await readAttention(db, bid));
  if (now === null) return { status: 404, said: { news: false } };
  const news = liveNews(kind, since, now);
  // Phase 5 — a conversation and Practice also say whether the assistant is at work on it.
  // Phase 6 — billing is "at work" while Stripe has not yet confirmed a card.
  const said: LiveSaid = ((kind === 'conversation' || kind === 'practice') && await assistantWorking(db, bid, conversationId))
    || (kind === 'billing' && now.startsWith('0.'))
    ? { ...news, working: true } : news;
  return { status: 200, said };
}

/**
 * A conversation watches its own address; the door lands on its newest message
 * (CC-25). `working` (phase 5): the page was drawn with the assistant at work.
 */
export const conversationWatch = (conversationId: string, mark: string, working = false): LiveWatch => ({
  ask: `/app/live/conversation/${encodeURIComponent(conversationId)}?since=${mark}`,
  door: conversationUrl(conversationId),
  says: [{ what: 'message', key: 'live.message' }, { what: 'reply', key: 'live.reply' }, { what: 'changed', key: 'live.changed' }],
  ...(working ? { working: true } : {}),
});

/** P3 — Practice watches the copy's practice conversation; the door is Practice, on its newest line. */
export const practiceWatch = (mark: string, working = false): LiveWatch => ({
  ask: `/app/live/practice?since=${mark}`,
  door: '/app/sandbox#latest',
  says: [{ what: 'practice', key: 'live.practice' }, { what: 'reply', key: 'live.reply' }, { what: 'changed', key: 'live.changed' }],
  ...(working ? { working: true } : {}),
});

/** Buyers watches the whole list; the door is the first page of the tab and the search she is on. */
export const buyersWatch = (mark: string, door: string): LiveWatch => ({
  ask: `/app/live/buyers?since=${mark}`,
  door,
  says: [{ what: 'list', key: 'live.list' }],
});

/**
 * Today watches its attention counts; the door is Today again, from the top.
 * THE WARMTH RUN (2026-10-03), phase 8 — "Today updating": when they change,
 * the script draws the page's `main` again in place (`redraw`) rather than
 * showing the line; the line is what is shown if the page cannot be had.
 */
export const todayWatch = (mark: string): LiveWatch => ({
  ask: `/app/live/today?since=${mark}`,
  door: '/app',
  says: [{ what: 'today', key: 'live.today' }],
  redraw: true,
});

/**
 * THE WARMTH RUN (2026-10-03), phase 8 — THE RAIL'S QUESTION, ASKED FROM EVERY
 * SIGNED-IN PAGE. The owner: "In-app, always: when something lands while the
 * owner is in Nomi, it surfaces wherever they are — a quiet marker on the rail,
 * Today updating, a toast. No sound, no badge inflation."
 *
 * The shell draws every page with the rail's one number (how many customers
 * need this reader now: Buyers' "Needs you", `readBuyerCounts`) and a slot that
 * asks this address, through the same poll as the watching pages (the one
 * script, every twenty seconds while the tab is in view). The MARK is that
 * number. The answer is the number now, read by the same function, so the rail
 * the script redraws is the rail a reload would draw; and, only when it ROSE,
 * who arrived and why, for the toast. A count that falls, or stays, is
 * redrawn and says nothing — the marker and the toast are for a customer newly
 * waiting, never for anything else.
 */
const RAIL_MARK = new RegExp(`^${COUNT}$`);
export const isRailMark = (raw: unknown): raw is string => typeof raw === 'string' && RAIL_MARK.test(raw);

/** Why a customer needs the owner, in the list's own order of groups (`LIST_RANK`). */
export type RailWhy = 'order' | 'deletion' | 'person' | 'reply';

/** The newest arrival in the reader's "Needs you": the conversation, the customer's name, and why. */
export type RailNewest = { readonly conversationId: string; readonly who: string | null; readonly why: RailWhy };

/** The rail's comparison, the one place a rise is decided: the count now against the page's mark. */
export const railRose = (since: string, now: number): boolean => now > Number(since);

/**
 * Who most recently came to need this reader: the latest of the moments a
 * conversation can enter "Needs you" — handed over, a reply waiting, an order
 * waiting, a deletion asked — and the customer's newest message, which comes
 * just before each of them (a hand-over that left no stamp is still placed).
 */
async function newestWaiting(db: Db, bid: BusinessId, viewerId: string): Promise<RailNewest | null> {
  return withTenantTx(db, bid, async (tx) => {
    const r = (await sql<{ id: string; who: string | null; why: RailWhy }>`
      select c.id::text as id, cl.display_name as who,
             case when ${ORDER_WAITING} then 'order' when ${DELETION_WAITING} then 'deletion'
                  when c.assigned_to is null then 'reply' else 'person' end as why
        from conversations c
        left join clients cl on cl.id = c.client_id
       where c.business_id = ${bid} and ${needsOwnerFor(viewerId)}
       order by greatest(
         case when c.assigned_to is not null then c.assigned_at end,
         (select max(d.created_at) from drafts d where d.conversation_id = c.id and d.status = 'pending'),
         (select max(op.created_at) from order_proposals op where op.conversation_id = c.id and op.state = 'pending'),
         (select max(a.last_asked_at) from deletion_asks a where a.conversation_id = c.id and a.state = 'waiting'),
         (select max(m.sent_at) from messages m where m.conversation_id = c.id and m.direction = 'inbound')
       ) desc nulls last, c.id desc
       limit 1`.execute(tx)).rows[0];
    return r ? { conversationId: r.id, who: r.who, why: r.why } : null;
  });
}

/** What the rail's address answers: the count now, and the newest arrival only when the count rose. */
export type RailAnswer = { readonly status: 200 | 400; readonly n: number; readonly newest: RailNewest | null };

export async function railAnswer(db: Db, bid: BusinessId, viewerId: string, since: unknown): Promise<RailAnswer> {
  if (!isRailMark(since)) return { status: 400, n: 0, newest: null };
  const n = (await withTenantTx(db, bid, (tx) => readBuyerCounts(tx, viewerId))).waiting;
  return { status: 200, n, newest: railRose(since, n) ? await newestWaiting(db, bid, viewerId) : null };
}

/**
 * The answer as the script uses it, in the reader's language: the number and
 * the mark to ask with next; the number as the rail draws it, and the entry's
 * spoken name with it (the shell's own words); and, for a rise, the toast's
 * one line — who and why — and the conversation it opens, at its newest
 * message. The script writes these as text and never as markup.
 */
export type RailSaid = {
  readonly n: number; readonly mark: string; readonly shown: string; readonly label: string;
  readonly toast?: { readonly say: string; readonly door: string };
};
export function railSaid(locale: Locale, a: RailAnswer): RailSaid {
  const said = {
    n: a.n, mark: String(a.n), shown: isolate(locale, String(a.n)),
    label: `${t(locale, 'nav.inbox')}, ${tn(locale, 'nav.needsYou', a.n)}`,
  };
  if (!a.newest) return said;
  const who = isolate(locale, a.newest.who?.trim() || t(locale, 'common.buyer'));
  return { ...said, toast: { say: t(locale, `live.toast.${a.newest.why}` as MessageKey, { who }), door: conversationUrl(a.newest.conversationId) } };
}

/**
 * CH1 — the Channels page's mark: on which channels a customer has written and
 * when last, and the state of the Page connection. It moves when a first test
 * message arrives on Instagram or Messenger, or the connection is made, lost
 * or found dead — the things "Your accounts" shows.
 */
export async function channelsMark(db: Db, bid: BusinessId): Promise<string> {
  return withTenantTx(db, bid, async (tx) => {
    const row = (await sql<{ n: number; print: string }>`
      with seen as (
        select cc.channel, max(cc.last_inbound_at) as at
          from client_channels cc join clients cl on cl.id = cc.client_id
         where cl.business_id = ${bid} and cc.last_inbound_at is not null
         group by cc.channel)
      select (select count(*)::int from seen) as n,
             md5(coalesce((select string_agg(channel || '@' || at::text, ',' order by channel) from seen), '')
                 || '|' || coalesce((select string_agg(concat_ws('/', id::text, coalesce(needs_attention_at::text, '-')), ',')
                                       from meta_accounts where business_id = ${bid} and archived_at is null), '')) as print`
      .execute(tx)).rows[0];
    return `${row?.n ?? 0}.${(row?.print ?? '').slice(0, 16)}`;
  });
}

/**
 * Phase 6 — the billing page's mark: whether a card is saved, and the plan's
 * state. Back from Stripe's page, the card is confirmed by Stripe's own message
 * a moment later; the page that said "Stripe is confirming the card" watches
 * for it and draws the answer in, so the sentence does not wait for a reload.
 */
export async function billingMark(db: Db, bid: BusinessId): Promise<string> {
  return withTenantTx(db, bid, async (tx) => {
    const s = await billingState(tx);
    return `${s.cardSavedAt ? 1 : 0}.${s.status}`;
  });
}

/** The billing page watches for the card Stripe is confirming; at work until it is. */
export const billingWatch = (mark: string, working: boolean): LiveWatch => ({
  ask: `/app/live/billing?since=${mark}`,
  door: '/app/settings/billing',
  says: [{ what: 'billing', key: 'billing.live.changed' }, { what: 'slow', key: 'billing.live.slow' }],
  ...(working ? { working: true } : {}),
});

/** The Channels page watches its own mark; the door is the page again, at "Your accounts". */
export const channelsWatch = (mark: string): LiveWatch => ({
  ask: `/app/live/channels?since=${mark}`,
  door: '/app/channels#your-accounts',
  says: [{ what: 'channels', key: 'live.channels' }],
});
