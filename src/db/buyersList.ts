import { sql, type RawBuilder } from 'kysely';
import type { Tx } from './client.js';
import { WAITING_HUMAN_AGENT } from '../core/conversation/ownership.js';

/**
 * A — Buyers and Customers are ONE list (the owner's decision 5, 2026-09-28;
 * `docs/IA-PROPOSAL.md` §A). Two pages listed the same people: Buyers ordered
 * them by who needs the owner and stopped at fifty; Customers searched them
 * and stopped at a hundred. This is the one read both became — every
 * conversation of the workspace, in the order the Buyers page groups them,
 * searchable, and paged so that nobody is left behind a cap.
 *
 * THE ORDER IS THE GROUPS. The page groups rows under "asked for their data to
 * be deleted", "needs you", "you are handling" and "{name} is handling", in
 * that order. `LIST_RANK` below ranks by exactly those groups, with the same
 * predicates the page groups by, so a page is always a run of whole groups
 * and a buyer who needs the owner can never sit behind one who does not.
 * A9's `limit 50` ranked a conversation handed to a NAMED person with the
 * assistant's own; with paging that would have put "you are handling" on
 * page three. Within a group: waiting for a person before a reply waiting for
 * review; a buyer who wrote last (nothing has answered them) before the rest;
 * then the newest first.
 *
 * PAGING IS BY KEYSET, never by offset — the transcript's rule (`transcript.ts`),
 * for the transcript's reason: an offset shifts under every message that
 * arrives while the owner reads, and shows one buyer twice or loses one at the
 * boundary. The key is (rank, newest message, id), the id breaking ties, so
 * two conversations stamped with the same instant sort the same way on every
 * request. The cursor carries the key itself, not just an id: the row it names
 * may have moved or left the tab since, and the next page must still start
 * exactly where the last one stopped.
 *
 * COUNTS ARE OF EVERYTHING (A9). The tab counts never read the page; the
 * page's own position — "51–100 of 312" — is counted over every row the tab
 * and the search hold, in the same statement that reads the page.
 */

/** How many rows a page shows. The old window's size: the page reads the same, it only stops dropping people. */
export const BUYERS_PAGE = 50;

export type BuyersFilter = 'pending' | 'all' | 'blocked' | 'mine' | 'deletion';

/**
 * 0076 — a deletion request noted from this conversation, still waiting for
 * the owner's decision. It needs the owner whoever holds the conversation —
 * handing it back to the assistant does not answer it.
 */
export const DELETION_WAITING = sql<boolean>`exists (select 1 from deletion_asks a
  where a.conversation_id = c.id and a.state = 'waiting')`;

/**
 * 0080 — a customer said yes to an order, and it waits for the owner's tap.
 * Nothing was confirmed or sent until the owner decides; it leads the list.
 */
export const ORDER_WAITING = sql<boolean>`exists (select 1 from order_proposals op
  where op.conversation_id = c.id and op.state = 'pending')`;

/**
 * A9 — "needs a person", in SQL, so no window can hide one: a pending draft,
 * an `assigned_to` that is not null (the waiting sentinel, or a named person
 * a conversation was handed to under G12), or a deletion request waiting.
 * The same rule the page's groups apply; the "Needs you" tab and its count
 * select with it.
 */
export const NEEDS_OWNER = sql<boolean>`(c.assigned_to is not null
  or exists (select 1 from drafts d where d.conversation_id = c.id and d.status = 'pending')
  or ${DELETION_WAITING} or ${ORDER_WAITING})`;

/**
 * M22 — holding a message that never reached the buyer, in the last week.
 */
export const IS_BLOCKED = sql<boolean>`exists (
  select 1 from outbound_messages o
   where o.conversation_id = c.id and o.status = 'canceled'
     and o.cancel_reason is not null
     and o.created_at > now() - make_interval(days => 7))`;

/** Which rows a tab holds, decided BEFORE any page is cut. 'mine' with no viewer is nobody's. */
export const eligibleFor = (filter: BuyersFilter, viewerId?: string): RawBuilder<boolean> =>
  filter === 'pending' ? NEEDS_OWNER
    : filter === 'blocked' ? IS_BLOCKED
    : filter === 'mine' ? (viewerId ? sql<boolean>`c.assigned_to = ${viewerId}` : sql<boolean>`false`)
    : filter === 'deletion' ? DELETION_WAITING
    : sql<boolean>`true`;

/**
 * The group, and the place in it. Read with `lm` = the conversation's newest
 * message. 0 an order waiting for the owner's tap (0080) · 1 asked for
 * deletion · 2 waiting for a person · 3 a reply waiting for review · 4–5 a
 * person here holds it (the customer wrote last, then the rest) · 6–7 the
 * assistant's (the same split, for a live conversation). `renderInboxList`
 * groups by the same predicates.
 */
const LIST_RANK = sql<number>`(case
  when ${ORDER_WAITING} then 0
  when ${DELETION_WAITING} then 1
  when c.assigned_to = ${WAITING_HUMAN_AGENT} then 2
  when exists (select 1 from drafts d where d.conversation_id = c.id and d.status = 'pending') then 3
  when c.assigned_to is not null then (case when lm.direction = 'inbound' then 4 else 5 end)
  when lm.direction = 'inbound' and c.is_active then 6
  else 7 end)`;

/**
 * WHAT A SEARCH READS, and nothing else:
 *
 *  - the buyer's name, as the owner sees it (`clients.display_name`) — the
 *    thing she remembers them by, and the one the brief requires;
 *  - their address on their channel — the phone number, the e-mail, the
 *    handle (`clients.phone`, `clients.email`, `client_channels`) — because
 *    a number is often all an owner has ("who is +971 50…?"). Typed with
 *    spaces, dashes or a plus, a number is matched on its digits alone;
 *  - the product the conversation is about, in either language — Customers'
 *    search promised "a buyer or product", and a buyer is often remembered by
 *    what they asked for.
 *
 * NOT the messages. Every word ever written is a different question (and
 * one only a full-text index answers well, which is a migration); a row
 * matched by a sentence buried in last month's messages would show a preview
 * without the word, and read as a wrong answer. No index is added: the match
 * runs inside the tenant's own rows, as the Customers search did.
 */
const likeEscape = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function matching(q: string): RawBuilder<boolean> {
  if (q === '') return sql<boolean>`true`;
  const pattern = `%${likeEscape(q)}%`;
  const digits = q.replace(/[\s()+\-./]/g, '');
  const byDigits = /^[0-9]{4,}$/.test(digits)
    ? sql`
       or regexp_replace(coalesce(cl.phone, ''), '[^0-9]', '', 'g') like ${`%${digits}%`}
       or exists (select 1 from client_channels cd where cd.client_id = c.client_id
                   and regexp_replace(cd.channel_user_id, '[^0-9]', '', 'g') like ${`%${digits}%`})`
    : sql``;
  return sql<boolean>`(cl.display_name ilike ${pattern}
       or cl.phone ilike ${pattern} or cl.email ilike ${pattern}
       or exists (select 1 from client_channels cc where cc.client_id = c.client_id
                   and cc.channel_user_id ilike ${pattern})
       or p.name ilike ${pattern} or p.name_zh ilike ${pattern}${byDigits})`;
}

/** A search as it may be used: one line, trimmed, and not a page long. */
export const searchOf = (raw: unknown): string =>
  typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, 80) : '';

/**
 * Where one conversation sits in the order: its rank, its newest message in
 * microseconds since 1970 (null: no message yet — those sort last in their
 * rank), and its id.
 */
type ListKey = { readonly rank: number; readonly at: string | null; readonly id: string };

/**
 * `<rank>_<µs or n>_<conversation id>` — digits, hex, hyphens and underscores,
 * nothing a URL percent-encodes, so no `%` reaches the page (the transcript
 * cursor's rule). Microseconds, not milliseconds: the bound is the stored
 * stamp to the microsecond, or two messages inside one millisecond could put
 * the boundary between them twice.
 */
const encodeKey = (k: ListKey): string => `${k.rank}_${k.at ?? 'n'}_${k.id}`;

// The ranks LIST_RANK can give: 0–7 (0080 added the waiting order as 0).
const KEY = /^([0-7])_(n|0|-?[1-9][0-9]{0,17})_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** Exactly the shape `encodeKey` writes, or null — and null reads as the first page. */
function parseKey(raw: unknown): ListKey | null {
  if (typeof raw !== 'string') return null;
  const m = KEY.exec(raw);
  return m ? { rank: Number(m[1]), at: m[2] === 'n' ? null : m[2]!, id: m[3]! } : null;
}

/** Rows AFTER `k` in the list's order: `rank, at desc nulls last, id desc`. */
const afterKey = (k: ListKey): RawBuilder<boolean> => k.at === null
  ? sql<boolean>`(rank > ${k.rank} or (rank = ${k.rank} and at_us is null and id < ${k.id}::uuid))`
  : sql<boolean>`(rank > ${k.rank} or (rank = ${k.rank} and (at_us < ${k.at}::bigint or at_us is null
      or (at_us = ${k.at}::bigint and id < ${k.id}::uuid))))`;

/** Rows BEFORE `k` in the same order. */
const beforeKey = (k: ListKey): RawBuilder<boolean> => k.at === null
  ? sql<boolean>`(rank < ${k.rank} or (rank = ${k.rank} and (at_us is not null or id > ${k.id}::uuid)))`
  : sql<boolean>`(rank < ${k.rank} or (rank = ${k.rank} and (at_us > ${k.at}::bigint
      or (at_us = ${k.at}::bigint and id > ${k.id}::uuid))))`;

export type BuyersPage = {
  /** The page's conversations, in list order. */
  readonly ids: readonly string[];
  /** Every conversation this tab and this search hold — not the page. */
  readonly total: number;
  /** The page's first and last places in that whole list, from 1; both 0 when there is nothing. */
  readonly from: number;
  readonly to: number;
  /** The cursor for the page after this one; null when this page ends the list. */
  readonly next: string | null;
  /**
   * The page before this one: null when this IS the first page; `cursor` null
   * when the page before is the first, so its door is the list's own address.
   */
  readonly prev: { readonly cursor: string | null } | null;
};

/**
 * One page of the list. `after` / `before` are whatever the request carried:
 * a malformed cursor is the first page, and so is a cursor past the end of a
 * list that shrank — never an error, and never an empty page while there is
 * someone to show.
 */
export async function readBuyersPage(tx: Tx, o: {
  readonly filter: BuyersFilter; readonly viewerId?: string; readonly q: string;
  readonly after?: unknown; readonly before?: unknown; readonly size?: number;
}): Promise<BuyersPage> {
  const size = o.size ?? BUYERS_PAGE;
  const after = parseKey(o.after);
  const before = after ? null : parseKey(o.before);
  const read = async (bound: RawBuilder<boolean>, backward: boolean) => (await sql<{
    id: string; rank: number; at_us: string | null; pos: number; total: number;
  }>`
    with listed as (
      select c.id, ${LIST_RANK} as rank,
             (extract(epoch from lm.sent_at) * 1000000)::bigint as at_us
        from conversations c
        left join clients cl on cl.id = c.client_id
        left join conversation_state cs on cs.conversation_id = c.id
        left join products p on p.id = cs.identified_product_id
        left join lateral (select m.direction, m.sent_at from messages m
                            where m.conversation_id = c.id
                            order by m.sent_at desc, m.id desc limit 1) lm on true
       where ${eligibleFor(o.filter, o.viewerId)} and ${matching(o.q)}
    ), placed as (
      select id, rank, at_us,
             (row_number() over (order by rank, at_us desc nulls last, id desc))::int as pos,
             (count(*) over ())::int as total
        from listed
    )
    select id::text as id, rank, at_us::text as at_us, pos, total from placed
     where ${bound}
     order by pos ${backward ? sql`desc` : sql`asc`}
     limit ${size}
  `.execute(tx)).rows;

  let rows = after ? await read(afterKey(after), false)
    : before ? (await read(beforeKey(before), true)).reverse()
    : await read(sql<boolean>`true`, false);
  // A stale cursor — the list shrank under it — is the first page, not an empty one.
  if (rows.length === 0 && (after || before)) rows = await read(sql<boolean>`true`, false);

  const first = rows[0];
  const last = rows.at(-1);
  if (!first || !last) return { ids: [], total: 0, from: 0, to: 0, next: null, prev: null };
  const key = (r: typeof first): string => encodeKey({ rank: r.rank, at: r.at_us, id: r.id });
  return {
    ids: rows.map((r) => r.id),
    total: first.total,
    from: first.pos,
    to: last.pos,
    next: last.pos < last.total ? key(last) : null,
    prev: first.pos <= 1 ? null : { cursor: first.pos - size <= 1 ? null : key(first) },
  };
}

/**
 * A9 — the counts are of EVERYTHING, one pass over the workspace: the four tab
 * counts (with the same fragments the tabs select with, so a count and its
 * tab can never disagree), and how many channels the workspace's
 * conversations are on — one channel named on every row tells the owner
 * nothing (A5's rule for the assistant's name).
 */
export async function readBuyerCounts(tx: Tx, viewerId?: string): Promise<{
  readonly waiting: number; readonly blocked: number; readonly mine: number;
  readonly deletion: number; readonly channels: number;
}> {
  return (await sql<{ waiting: number; blocked: number; mine: number; deletion: number; channels: number }>`
    select count(*) filter (where ${NEEDS_OWNER})::int as waiting,
           count(*) filter (where ${IS_BLOCKED})::int as blocked,
           count(*) filter (where ${eligibleFor('mine', viewerId)})::int as mine,
           count(*) filter (where ${DELETION_WAITING})::int as deletion,
           count(distinct c.channel)::int as channels
      from conversations c`.execute(tx)).rows[0]
    ?? { waiting: 0, blocked: 0, mine: 0, deletion: 0, channels: 0 };
}
