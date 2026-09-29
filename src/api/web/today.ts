import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { connectedChannels, BUYER_CHANNELS, type BuyerChannel } from '../../db/connectedChannels.js';
import { loadCalendar, type CalendarEntry } from '../../db/calendar.js';
import { dayKey, addDays } from '../../core/owner/i18n/format.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import { loadInboxList, needsWhy, channelName, type ConversationSummary } from './inbox.js';
import { line as calendarLine } from './calendar.js';
import { t, tn, assistantName } from './say.js';
import { esc, deeper, conversationUrl } from './layout.js';
import * as show from './values.js';

/**
 * TODAY, BY TIME (the design pass, 2026-09-29, §4): who needs you now, the last
 * 24 hours, what is coming up — one heading each, every line a door, figures
 * inside sentences (never tiles), every count through the plural rules.
 *
 * Read from what the other pages already read, never a second copy of a
 * question: the people are the Buyers list's own "Needs you" rows, in its own
 * order (`loadInboxList`); what is coming up is the calendar's (`loadCalendar`);
 * which channels send is the one definition Setup reads (`connectedChannels`).
 * "The last 24 hours", not "since you last looked": nothing records when you
 * last looked (rule 20).
 */

/** How many people the first block names before it points at the whole list. */
export const TODAY_PEOPLE = 5;
/** How many dated things "Coming up" names. */
export const TODAY_COMING = 3;

export type TodayData = {
  readonly now: Date;
  /** The Buyers list's "Needs you": how many in all, and the first few rows. */
  readonly needs: { readonly total: number; readonly rows: readonly ConversationSummary[] };
  /** The last 24 hours, counted. */
  readonly last24: {
    /** Customers the assistant's replies reached. */
    readonly answered: number;
    /** Replies the assistant wrote that the owner sent (as written, or edited). */
    readonly sent: number;
    /** Customers the assistant handed to a person. */
    readonly handed: number;
    /** Customers the owner answered themselves. */
    readonly yourself: number;
  };
  /** The next week's dated things, from now. */
  readonly comingUp: readonly CalendarEntry[];
  /** The channels customers can reach this workspace on. */
  readonly sending: readonly BuyerChannel[];
};

export const NOTHING_TODAY = (now: Date): TodayData => ({
  now, needs: { total: 0, rows: [] }, last24: { answered: 0, sent: 0, handed: 0, yourself: 0 }, comingUp: [], sending: [],
});

export async function loadToday(
  db: Db, businessId: string, viewerId: string | undefined, now: Date, outreach: boolean,
): Promise<TodayData> {
  const bid = parseBusinessId(businessId);
  if (!bid.ok) return NOTHING_TODAY(now);
  const today = dayKey(now);
  const [needs, counts, calendar] = await Promise.all([
    loadInboxList(db, businessId, 'pending', viewerId),
    withTenantTx(db, bid.value, async (tx) => ({
      channels: await connectedChannels(tx, bid.value),
      last: (await sql<{ answered: number; sent: number; handed: number; yourself: number }>`
        select
          (select count(distinct conversation_id)::int from outbound_messages
            where business_id = ${bid.value} and origin = 'employee'
              and status in ('sent', 'delivered', 'read') and sent_at > now() - interval '24 hours') as answered,
          (select count(*)::int from drafts
            where business_id = ${bid.value} and status in ('approved', 'edited')
              and decided_at > now() - interval '24 hours') as sent,
          (select count(distinct e.conversation_id)::int from conversation_events e
             join conversations c on c.id = e.conversation_id
            where c.business_id = ${bid.value} and e.type = 'handoff' and e.created_at > now() - interval '24 hours') as handed,
          (select count(distinct conversation_id)::int from outbound_messages
            where business_id = ${bid.value} and origin = 'owner'
              and status in ('sent', 'delivered', 'read') and sent_at > now() - interval '24 hours') as yourself`
        .execute(tx)).rows[0]!,
    })),
    loadCalendar(db, businessId, { from: today, to: addDays(today, 8), category: null, buyer: null, outreach }, now),
  ]);
  return {
    now,
    needs: { total: needs.waitingCount, rows: needs.conversations.slice(0, TODAY_PEOPLE) },
    last24: counts.last,
    comingUp: calendar.entries.filter((e) => e.at >= now || e.allDay).slice(0, TODAY_COMING),
    sending: BUYER_CHANNELS.filter((c) => counts.channels[c]),
  };
}

/** One line that is a door: what it says, and an arrow. */
const door = (href: string, inner: string): string =>
  `<li><a class="tline" href="${href}">${inner}<span class="go" aria-hidden="true">→</span></a></li>`;

/** The first block's people: who, why, since when — each opens on the newest message. */
export function renderNeedsLines(d: TodayData, locale: Locale): string {
  return d.needs.rows.map((c) => door(conversationUrl(c.conversationId),
    `<span class="tl-who"><bdi>${esc(c.buyer ?? t(locale, 'common.buyer'))}</bdi></span>
     <span class="tl-why">${esc(needsWhy(locale, c))}${c.latestAt ? ` · ${esc(show.shortWhen(locale, c.latestAt, d.now))}` : ''}</span>`)).join('');
}

/** The last 24 hours: the assistant's lines marked with its ✦, the owner's plain. Zeros are not said. */
export function renderLastDay(d: TodayData, locale: Locale): string {
  const name = assistantName(locale);
  const hand = `<span class="as" aria-hidden="true">✦</span> `;
  const l = d.last24;
  const lines = [
    l.answered > 0 ? door('/app/inbox?filter=all', `${hand}${esc(tn(locale, 'today.last.answered', l.answered, { name }))}`) : '',
    l.sent > 0 ? door('/app/inbox?filter=all', `${hand}${esc(tn(locale, 'today.last.sent', l.sent, { name }))}`) : '',
    l.handed > 0 ? door('/app/inbox?filter=pending', `${hand}${esc(tn(locale, 'today.last.handed', l.handed, { name }))}`) : '',
    l.yourself > 0 ? door('/app/inbox?filter=mine', esc(tn(locale, 'today.last.yourself', l.yourself))) : '',
  ].filter(Boolean);
  return lines.length ? `<ul class="tlines">${lines.join('')}</ul>` : `<p class="muted">${esc(t(locale, 'today.last.none'))}</p>`;
}

/** Coming up: when, what, and whose — each to the conversation or order it came from. */
export function renderComingUp(d: TodayData, locale: Locale): string {
  if (d.comingUp.length === 0) return `<p class="muted">${esc(t(locale, 'today.coming.none'))}</p>`;
  return `<ul class="tlines">${d.comingUp.map((e) => {
    const when = e.allDay ? show.date(locale, e.at)
      : dayKey(e.at) === dayKey(d.now) ? show.time(locale, e.at) : `${show.date(locale, e.at)} ${show.time(locale, e.at)}`;
    const whose = e.buyer?.name ?? e.identity;
    const href = e.orderId ? `/app/orders/${encodeURIComponent(e.orderId)}`
      : e.conversationId ? conversationUrl(e.conversationId) : '/app/calendar';
    return door(href, `<span class="tl-when">${esc(when)}</span>
      <span class="tl-what"><bdi>${esc(calendarLine(locale, e))}</bdi>${whose ? ` · <bdi>${esc(whose)}</bdi>` : ''}</span>`);
  }).join('')}</ul>`;
}

/** Which channels send, or that sending is paused — one line, the channels named. */
export function renderSending(d: TodayData, locale: Locale, paused: boolean): string {
  if (d.sending.length === 0) return '';
  const state = t(locale, paused ? 'today.sending.paused' : 'today.sending.on');
  const each = d.sending.map((c) => `${esc(channelName(locale, c))} <span class="dot${paused ? ' warn' : ' ok'}" aria-hidden="true">●</span> ${esc(state)}`);
  return `<p class="today-foot"><span class="muted">${esc(t(locale, 'today.sending'))}</span> ${each.join(' · ')}</p>`;
}

export const toCalendar = (locale: Locale): string => deeper('/app/calendar', t(locale, 'today.coming.all'));
