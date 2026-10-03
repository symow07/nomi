import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { Money } from '../core/types/money.js';
import { needsOwnerFor } from './buyersList.js';
import { customerValues, SPEND_STATUSES, REGULAR_ORDERS } from './customerValue.js';
import { faceVersions } from './faces.js';
import { PRICE_GIVEN } from './quotesGiven.js';

/**
 * THE WARMTH RUN, PHASE 4 (2026-10-03) — THE INBOX'S "NEEDS ATTENTION" BAND.
 *
 * The owner: "went quiet after a quote, waiting on a reply, a regular who has
 * not ordered in a while. Do not duplicate Today's 'waiting right now' — this
 * band is about slipping relationships, not today's urgency."
 *
 * So nobody here is waiting for the reader: anyone with a conversation that
 * needs them (`needsOwnerFor`, the same rule as the list's "Needs you", as
 * this reader sees it) is left out, and so is anyone with a deletion request
 * on record — a customer who asked to be forgotten is not one to follow up.
 * Each customer appears once, under the first kind that applies, in this
 * order:
 *
 *   QUOTE — a price was sent, and they have written nothing since, 3 to 30
 *   days ago. "Sent" is `PRICE_GIVEN` (`quotesGiven.ts`), the rule
 *   `priorQuotesForClient` already uses for "prices he was actually given"
 *   (G7b, `repos.ts`) — a quote whose reply became a draft counts only once
 *   that draft was approved unchanged — plus a line actually left to them
 *   after it was worked out. Today's figure and the calendar read the same. Their NEWEST sent
 *   quote in a conversation still open decides: a fresher price means a
 *   fresher conversation, and a closed one is over, not slipping.
 *
 *   THIS IS THE ONE DEFINITION of "went quiet after a price" (phase 9,
 *   w4-customers-02): Today's line "{buyer} has not answered since they were
 *   given a price" names the first of these (`quietAfterPrice`), so Today
 *   never names someone the band leaves out. Today had its own reading — any
 *   price, given or not, more than two days old — and the band left out
 *   anyone a colleague held, as though they were waiting for the owner; Today
 *   named Omar, the band never did.
 *
 *   REPLY — the last word on every conversation of theirs is ours, it ASKED
 *   them something, and it was sent 3 to 30 days ago. "Asked something" is
 *   read from the words as stored, the one way the rows can say it honestly:
 *   the line holds a question mark — ? ？ or ؟. A last word that asked
 *   nothing ("Thank you, see you soon") is not a reply anyone is owed.
 *
 *   ASKED (phase 9, w4-customers-03) — the other way round: the last word
 *   on every conversation of theirs is THEIRS, it asked something (the same
 *   question mark), and nothing answered it in 3 to 30 days. The Inbox
 *   stamped such rows "No reply yet" and nothing counted them anywhere.
 *
 *   REGULAR — a regular who has not ordered in a while: `customerValues`'s
 *   `quietSince` (three orders that stand or more, the last one older than
 *   twice their usual gap and at least 30 days old). The candidates are found
 *   in SQL with the same SPEND_STATUSES and REGULAR_ORDERS; the verdict is
 *   `customerValue.ts`'s, so the band and the profile card cannot disagree.
 *
 * Three days, so a conversation still in motion is not "slipping"; thirty, so
 * the band names relationships that can still be picked up, not a list of
 * everyone who ever went silent. The order is by what each customer has spent
 * (the most first), then the most recent: the five the band shows are the
 * ones most worth a word.
 */

export type AttentionKind = 'quote' | 'reply' | 'asked' | 'regular';

export type AttentionItem = {
  readonly clientId: string;
  readonly name: string | null;
  readonly photo: string | null;
  /** The conversation a word to them goes into: their newest. */
  readonly conversationId: string;
  readonly kind: AttentionKind;
  /** When the quote or the question went out; for a regular, their last order. */
  readonly since: Date;
  readonly spent: Money | null;
};

export const QUIET_AFTER_DAYS = 3;
export const QUIET_UNTIL_DAYS = 30;
/** A ceiling, not a page: the band shows five and counts the rest. */
const MOST = 200;

/** Nobody already waiting for the reader (as the list counts them), and nobody who asked to be deleted. */
const SLIPPING = (client: ReturnType<typeof sql.ref>, viewerId?: string) => sql<boolean>`(
  not exists (select 1 from conversations c where c.client_id = ${client} and ${needsOwnerFor(viewerId)})
  and not exists (select 1 from deletion_requests dr
                   where dr.client_id = ${client} and dr.scope = 'buyer' and dr.state = 'open'))`;

export async function readAttention(tx: Tx, now: Date, viewerId?: string): Promise<readonly AttentionItem[]> {
  const from = new Date(now.getTime() - QUIET_UNTIL_DAYS * 86_400_000);
  const to = new Date(now.getTime() - QUIET_AFTER_DAYS * 86_400_000);

  const quotes = (await sql<{ client_id: string; since: Date }>`
    with sent as (
      select distinct on (c.client_id) c.client_id, q.created_at as since
        from quotes q
        join conversations c on c.id = q.conversation_id and c.is_active
       where ${PRICE_GIVEN}
       order by c.client_id, q.created_at desc
    )
    select s.client_id::text as client_id, s.since from sent s
     where s.since >= ${from}::timestamptz and s.since <= ${to}::timestamptz
       and not exists (select 1 from messages m join conversations c on c.id = m.conversation_id
                        where c.client_id = s.client_id and m.direction = 'inbound' and m.sent_at > s.since)
       and ${SLIPPING(sql.ref('s.client_id'), viewerId)}
     limit ${MOST}`.execute(tx)).rows;

  // Our question unanswered (REPLY), or theirs (ASKED): the newest message of all their conversations, either way.
  const replies = (await sql<{ client_id: string; since: Date; direction?: string }>`
    select cl.id::text as client_id, lw.sent_at as since, lw.direction
      from clients cl
      cross join lateral (select m.direction, m.sent_at, m.text_content
                            from messages m join conversations c on c.id = m.conversation_id
                           where c.client_id = cl.id
                           order by m.sent_at desc, m.id desc limit 1) lw
     where lw.sent_at >= ${from}::timestamptz and lw.sent_at <= ${to}::timestamptz
       and lw.text_content ~ '[?？؟]'
       and ${SLIPPING(sql.ref('cl.id'), viewerId)}
     limit ${MOST}`.execute(tx)).rows;

  // Regulars: found by the same rule customerValue.ts counts by; judged by it.
  const regulars = (await sql<{ client_id: string }>`
    select o.client_id::text as client_id from orders o
     where o.status = any(${[...SPEND_STATUSES]}::text[])
       and ${SLIPPING(sql.ref('o.client_id'), viewerId)}
     group by o.client_id having count(*) >= ${REGULAR_ORDERS}
     limit ${MOST}`.execute(tx)).rows;

  const kindOf = new Map<string, { kind: AttentionKind; since: Date }>();
  for (const r of quotes) kindOf.set(r.client_id, { kind: 'quote', since: r.since });
  for (const r of replies) if (!kindOf.has(r.client_id)) kindOf.set(r.client_id, { kind: r.direction === 'inbound' ? 'asked' : 'reply', since: r.since });
  const values = await customerValues(tx, [...new Set([...kindOf.keys(), ...regulars.map((r) => r.client_id)])], now);
  for (const r of regulars) {
    const quiet = values.get(r.client_id)?.quietSince ?? null;
    if (quiet && !kindOf.has(r.client_id)) kindOf.set(r.client_id, { kind: 'regular', since: quiet });
  }
  const ids = [...kindOf.keys()];
  if (ids.length === 0) return [];

  // Who they are, and the conversation a word to them goes into: the one with the newest message.
  const who = new Map((await sql<{ id: string; name: string | null; conversation_id: string | null }>`
    select cl.id::text as id, cl.display_name as name,
           (select c.id::text from conversations c where c.client_id = cl.id
             order by (select max(m.sent_at) from messages m where m.conversation_id = c.id) desc nulls last,
                      c.created_at desc, c.id desc
             limit 1) as conversation_id
      from clients cl where cl.id = any(${ids}::uuid[])`.execute(tx)).rows.map((r) => [r.id, r]));
  const photos = await faceVersions(tx, ids);

  return ids.flatMap((id): AttentionItem[] => {
    const w = who.get(id);
    const k = kindOf.get(id)!;
    if (!w?.conversation_id) return [];
    return [{
      clientId: id, name: w.name, photo: photos.get(id) ?? null, conversationId: w.conversation_id,
      kind: k.kind, since: k.since, spent: values.get(id)?.spent ?? null,
    }];
  }).sort((a, b) => (b.spent?.amount ?? 0) - (a.spent?.amount ?? 0)
    || b.since.getTime() - a.since.getTime() || (a.clientId < b.clientId ? -1 : 1));
}

/**
 * Today's "went quiet after a price" (phase 9, w4-customers-02): the band's
 * first customer of the QUOTE kind, in the band's own order — read by the
 * band's own function, so the two cannot name different people. Null when
 * the band holds none.
 */
export async function quietAfterPrice(tx: Tx, now: Date, viewerId?: string): Promise<AttentionItem | null> {
  return (await readAttention(tx, now, viewerId)).find((a) => a.kind === 'quote') ?? null;
}
