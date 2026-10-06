import { sql, type RawBuilder } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { faceVersions } from './faces.js';
import { SPEND_STATUSES } from './customerValue.js';
import { PRICE_GIVEN } from './quotesGiven.js';
import { ownershipOf } from '../core/conversation/ownership.js';

/**
 * WHAT THE ASSISTANT HANDLED, AND THE DAY'S FIGURES — ONE DEFINITION FOR EVERY PAGE (the advisor batch,
 * 2026-10-06). The owner: "the advisor uses Home's meaning (readHandled). AND fix Results to use the same
 * definition in THIS batch — Home and Results disagreeing in production is a bug." Home, Results, the
 * assistant's "this month" and the advisor all read these functions; none counts "handled" its own way.
 *
 * AND NOTHING THAT IS NOT BUSINESS COUNTS. "Fix Home and Results to also exclude practice and
 * owner_testing conversations … the advisor shouldn't be the only honest page."
 *   · A conversation the owner marked as their own test (`conversations.owner_testing`, 0106) counts for
 *     nothing here (`notOwnerTesting`).
 *   · Practice happens in the practice copy (`businesses.practice_of`, src/db/practice.ts), a business row
 *     of its own: row security keeps its conversations out of the live workspace's every read.
 */

/**
 * The conversation behind `column` is not one the owner marked as their own test. A row with no
 * conversation (an order entered by hand) is business, and counts. `column` is a constant of this
 * codebase (`o.conversation_id`), never input.
 */
export const notOwnerTesting = (column: string): RawBuilder<boolean> =>
  sql.raw<boolean>(`not exists (select 1 from conversations tc where tc.id = ${column} and tc.owner_testing)`);

/** How many faces a row of what was handled draws at most (Home's hero; past it, "+N more"). */
export const HANDLED_FACES = 60;

/** The one word under a face: the strongest thing that happened in that conversation in the period. */
export type HandledWord = 'confirmed' | 'quoted' | 'handed' | 'answered';
export type HandledFace = {
  readonly clientId: string;
  readonly name: string | null;
  readonly photo?: string | null;
  readonly conversationId: string;
  readonly word: HandledWord;
};
export type Handled = { readonly total: number; readonly people: readonly HandledFace[] };
export type Tally = { readonly orders: number; readonly quotes: number; readonly afterHours: number };

/**
 * "After hours", in the workspace's own time. The product keeps the business's working hours as free
 * text only (`businesses.working_hours`), which nothing can read reliably; so, decided for Home: a reply
 * the assistant sent before 08:00 or from 20:00 on, local time, was sent after hours.
 */
export const OPEN_HOUR = 8;
export const CLOSE_HOUR = 20;

/** Midnight today in the workspace's zone, as an instant; midnight six days before (the week's wins); and the hour now there. */
export async function dayStart(tx: Tx, zone: string, now: Date): Promise<{ readonly start: Date; readonly week: Date; readonly hour: number }> {
  const r = (await sql<{ s: Date; w: Date; h: number }>`
    select (date_trunc('day', ${now}::timestamptz at time zone ${zone}) at time zone ${zone}) as s,
           ((date_trunc('day', ${now}::timestamptz at time zone ${zone}) - interval '6 days') at time zone ${zone}) as w,
           extract(hour from ${now}::timestamptz at time zone ${zone})::int as h`.execute(tx)).rows[0]!;
  return { start: r.s, week: r.w, hour: r.h };
}

/**
 * The quiet-day run — the start of the workspace's day on which a reply the assistant wrote last went out
 * (`readHandled`'s own reading), or null: it never has.
 */
export async function lastWinDay(tx: Tx, B: BusinessId, zone: string): Promise<Date | null> {
  const r = (await sql<{ d: Date | null }>`
    select (date_trunc('day', max(o.sent_at) at time zone ${zone}) at time zone ${zone}) as d
      from outbound_messages o
     where o.business_id = ${B} and o.origin = 'employee' and o.status in ('sent', 'delivered', 'read')
       and ${notOwnerTesting('o.conversation_id')}`.execute(tx)).rows[0];
  return r?.d ?? null;
}

/**
 * "Handled" is a conversation in which a reply the assistant wrote went out since `start`: sent alone, or
 * approved or edited by the owner (`outbound_messages.origin = 'employee'`, a sent status). Its word, the
 * strongest first:
 *
 *   confirmed  an order of this conversation that stands (`SPEND_STATUSES`) was confirmed in the period;
 *   quoted     a price was worked out in the period before the assistant's last reply went out;
 *   handed     it was handed over in the period and a person has it now (`ownershipOf`);
 *   answered   otherwise.
 *
 * Ordered by that strength, then the newest first, so the faces drawn of a busy day are the orders and the
 * quotes. `total` counts them all; `people` holds at most `faces`.
 */
export async function readHandled(tx: Tx, B: BusinessId, start: Date, faces = HANDLED_FACES): Promise<Handled> {
  const rows = (await sql<{
    conversation_id: string; client_id: string | null; name: string | null; assigned_to: string | null;
    confirmed: boolean; quoted: boolean; handed: boolean; total: number;
  }>`
    with sent as (
      select o.conversation_id, max(o.sent_at) as last_at
        from outbound_messages o
       where o.business_id = ${B} and o.origin = 'employee'
         and o.status in ('sent', 'delivered', 'read') and o.sent_at >= ${start}
         and ${notOwnerTesting('o.conversation_id')}
       group by o.conversation_id
    ), handled as (
      select s.conversation_id, s.last_at, c.client_id, c.assigned_to, cl.display_name as name,
             exists (select 1 from orders r where r.conversation_id = s.conversation_id
                      and r.status = any(${[...SPEND_STATUSES]}::text[])
                      and coalesce(r.confirmed_at, r.created_at) >= ${start}) as confirmed,
             exists (select 1 from quotes q where q.conversation_id = s.conversation_id
                      and q.created_at >= ${start} and q.created_at <= s.last_at) as quoted,
             exists (select 1 from conversation_events e where e.conversation_id = s.conversation_id
                      and e.type = 'handoff' and e.created_at >= ${start}) as handed
        from sent s
        join conversations c on c.id = s.conversation_id
        left join clients cl on cl.id = c.client_id
    )
    select conversation_id::text as conversation_id, client_id::text as client_id, name, assigned_to,
           confirmed, quoted, handed, (count(*) over ())::int as total
      from handled
     order by (case when confirmed then 0 when quoted then 1 else 2 end), last_at desc, conversation_id desc
     limit ${faces}`.execute(tx)).rows;
  const photos = await faceVersions(tx, rows.flatMap((r) => (r.client_id ? [r.client_id] : [])));
  return {
    total: rows[0]?.total ?? 0,
    people: rows.map((r): HandledFace => ({
      conversationId: r.conversation_id,
      // A conversation with no customer row is drawn by its own id, and opens no card.
      clientId: r.client_id ?? r.conversation_id,
      name: r.name,
      photo: r.client_id ? photos.get(r.client_id) ?? null : null,
      word: r.confirmed ? 'confirmed' : r.quoted ? 'quoted'
        : r.handed && ownershipOf(r.assigned_to) !== 'AI' ? 'handed' : 'answered',
    })),
  };
}

/** `readHandled`'s count alone: the conversations in which a reply the assistant wrote went out since `start`. */
export async function handledCount(tx: Tx, B: BusinessId, start: Date): Promise<number> {
  return (await sql<{ n: number }>`
    select count(distinct o.conversation_id)::int as n from outbound_messages o
     where o.business_id = ${B} and o.origin = 'employee'
       and o.status in ('sent', 'delivered', 'read') and o.sent_at >= ${start}
       and ${notOwnerTesting('o.conversation_id')}`.execute(tx)).rows[0]!.n;
}

/**
 * The period's three figures, in the workspace's day.
 *   orders      orders that stand (`SPEND_STATUSES`) confirmed since `start`;
 *   quotes      prices worked out since `start` that were GIVEN (`PRICE_GIVEN`): a price nobody sent is not "sent";
 *   afterHours  conversations the assistant answered outside 08:00–20:00 local time (`OPEN_HOUR`, `CLOSE_HOUR`).
 */
export async function readTally(tx: Tx, B: BusinessId, zone: string, start: Date): Promise<Tally> {
  const r = (await sql<{ orders: number; quotes: number; after_hours: number }>`
    select
      (select count(*)::int from orders r
        where r.business_id = ${B} and r.status = any(${[...SPEND_STATUSES]}::text[])
          and coalesce(r.confirmed_at, r.created_at) >= ${start} and ${notOwnerTesting('r.conversation_id')}) as orders,
      (select count(*)::int from quotes q
        where q.business_id = ${B} and q.created_at >= ${start} and ${PRICE_GIVEN} and ${notOwnerTesting('q.conversation_id')}) as quotes,
      (select count(distinct o.conversation_id)::int from outbound_messages o
        where o.business_id = ${B} and o.origin = 'employee'
          and o.status in ('sent', 'delivered', 'read') and o.sent_at >= ${start}
          and ${notOwnerTesting('o.conversation_id')}
          and (extract(hour from (o.sent_at at time zone ${zone})) < ${OPEN_HOUR}::int
            or extract(hour from (o.sent_at at time zone ${zone})) >= ${CLOSE_HOUR}::int)) as after_hours`
    .execute(tx)).rows[0]!;
  return { orders: r.orders, quotes: r.quotes, afterHours: r.after_hours };
}
