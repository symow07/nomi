import { workspaceZone } from './zone.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { countryName, orderStatusName, type MessageKey } from '../../core/owner/i18n/messages.js';
import { addDays, dayKey, dayStart, hourIn, formatWeekday } from '../../core/owner/i18n/format.js';
import { t, assistantName, outreachShown } from './say.js';
import { esc, deeper, back, conversationUrl, signalMark } from './layout.js';
import {
  CALENDAR_CATEGORIES, edgeOf, type CalendarCategory, type CalendarEntry, type CalendarView, type CalendarBuyer,
} from '../../db/calendar.js';
import * as show from './values.js';
import { keptValue, keptError, keptInvalid, type Kept } from './rows.js';

/**
 * V2 — the calendar page. Pure: a `CalendarView` in, HTML out.
 *
 * THE DESIGN PASS (2026-09-29; the plan's §5): a WEEK by default — days as
 * columns, hours as rows, ‹ Today › beside the dates, Month · Week · Day ·
 * List — and the owner's own dates (0082), added here. Where a date came from
 * is shown by its EDGE, never its colour: solid when it came from a
 * conversation (and opens there), dashed when the owner put it there. Colour
 * is left for state — a ● on a reply that is due — and ✦ marks a figure the
 * assistant worked out. The week starts on the business's country's first
 * day. The LIST is the three-week agenda this page always was (a phone reads
 * it best, until the phone's own pass).
 *
 * THE KIND OF DATE is the first word of the entry's own line — "Negotiation ·
 * Price worked out: …" — in the line's quiet voice, named on the element
 * (`data-cat`). Not a pill: in V1 a pill before or beside a name is a STATE
 * (Buyers' row tag, decision 5: waiting for you, held by a person), and a kind
 * of date is not one. The name leads, as it leads every row.
 */

export type CalendarViewKind = 'month' | 'week' | 'day' | 'list';
const VIEWS: readonly CalendarViewKind[] = ['month', 'week', 'day', 'list'];

/** The list: three weeks a page — the past week, and the coming two. */
const WINDOW_DAYS = 21;
const PAST_DAYS = 7;

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The list's window that opens by default, for a given day. */
const defaultFrom = (today: string): string => addDays(today, -PAST_DAYS);

/** A real calendar day in a sane span, or null. `2026-02-31` is not a day. */
const parseYmd = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const m = YMD.exec(v);
  if (!m) return null;
  const y = Number(m[1]);
  if (y < 2000 || y > 2099) return null;
  return addDays(v, 0) === v ? v : null;
};

/** The first day of the week holding `ymd`; `firstDay` is 1 = Monday … 7 = Sunday. */
export function weekStart(ymd: string, firstDay: number): string {
  const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return addDays(ymd, -((dow - (firstDay % 7) + 7) % 7));
}
const monthStart = (ymd: string): string => `${ymd.slice(0, 7)}-01`;
const addMonths = (ymd: string, n: number): string => {
  const d = new Date(`${monthStart(ymd)}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)).toISOString().slice(0, 10);
};

export type CalendarAsk = {
  readonly view: CalendarViewKind;
  /** The day the view is anchored on (the week or month holding it). */
  readonly at: string;
  readonly from: string; readonly to: string;
  readonly category: CalendarCategory | null; readonly buyer: string | null;
};

/**
 * The query string, whitelisted. Anything that is not exactly a view, a day,
 * one of the categories, or a buyer id falls back to the default — never an
 * error page, and never a value passed on to SQL unchecked.
 */
export function parseCalendarQuery(query: unknown, now: Date, firstDay = 1): CalendarAsk {
  const q = (query && typeof query === 'object' ? query : {}) as Record<string, unknown>;
  const today = dayKey(now, workspaceZone());
  const view = VIEWS.find((v) => v === q['view']) ?? 'week';
  const cat = q['category'];
  const category = typeof cat === 'string' && (CALENDAR_CATEGORIES as readonly string[]).includes(cat)
    ? cat as CalendarCategory : null;
  // The positioning rewrite: ?who= (an old ?buyer= link still works).
  const w = q['who'] ?? q['buyer'];
  const b = typeof w === 'string' ? w.toLowerCase() : '';
  const buyer = UUID.test(b) ? b : null;
  const at = parseYmd(q['at']) ?? today;
  if (view === 'list') {
    const from = parseYmd(q['from']) ?? defaultFrom(today);
    return { view, at, from, to: addDays(from, WINDOW_DAYS), category, buyer };
  }
  if (view === 'day') return { view, at, from: at, to: addDays(at, 1), category, buyer };
  if (view === 'week') {
    const from = weekStart(at, firstDay);
    return { view, at, from, to: addDays(from, 7), category, buyer };
  }
  const first = monthStart(at);
  const from = weekStart(first, firstDay);
  const lastWeek = weekStart(addDays(addMonths(first, 1), -1), firstDay);
  return { view, at: first, from, to: addDays(lastWeek, 7), category, buyer };
}

/** An address on this page. Only view words, days, category words and uuids go in, so nothing needs encoding. */
const href = (p: {
  view?: CalendarViewKind; at?: string | null; from?: string | null; category?: string | null; buyer?: string | null;
}): string => {
  const parts = [
    p.view && p.view !== 'week' ? `view=${p.view}` : '',
    p.at ? `at=${p.at}` : '',
    p.from ? `from=${p.from}` : '',
    p.category ? `category=${p.category}` : '',
    p.buyer ? `who=${p.buyer}` : '',
  ].filter(Boolean);
  return parts.length ? `/app/calendar?${parts.join('&')}` : '/app/calendar';
};

const buyerLabel = (locale: Locale, b: CalendarBuyer): string =>
  `${b.name ?? t(locale, 'common.buyer')}${b.country && countryName(locale, b.country) ? ` · ${countryName(locale, b.country)}` : ''}`;

export function line(locale: Locale, e: CalendarEntry): string {
  const d = e.detail;
  switch (e.kind) {
    case 'sample_asked': return d.open
      ? `${t(locale, 'calendar.line.sampleAsked')} · ${t(locale, 'calendar.line.sampleOpen')}`
      : t(locale, 'calendar.line.sampleAsked');
    case 'sample_handled': return t(locale, 'calendar.line.sampleHandled');
    case 'order_state': {
      const said = t(locale, 'calendar.line.order', {
        ref: d.orderReference ?? '', state: orderStatusName(locale, d.orderState ?? ''),
      });
      return d.trackingReference ? `${said} · ${t(locale, 'calendar.line.tracking', { ref: d.trackingReference })}` : said;
    }
    case 'price_worked_out':
      return t(locale, 'calendar.line.price', {
        price: d.price ? show.money(locale, d.price) : '', qty: show.quantity(locale, d.quantity ?? 0),
      });
    case 'reply_due': return t(locale, d.overdue ? 'calendar.line.replyOverdue' : 'calendar.line.replyDue');
    case 'followup_due': return t(locale, 'calendar.line.followup', { sequence: d.sequenceName ?? '' });
    case 'closure':
      return t(locale, 'calendar.line.closure', {
        label: d.closureLabel ?? '',
        from: show.date(locale, dayStart(d.closureFrom ?? e.day, workspaceZone())),
        to: show.date(locale, dayStart(d.closureTo ?? e.day, workspaceZone())),
      });
    case 'conversation_closed': return t(locale, 'calendar.line.closed');
    case 'own': return d.title ?? '';
    case 'promise_follow_up': case 'promise_price_end': case 'promise_delivery':
      return t(locale, 'calendar.line.promise', { said: d.said ?? '' });
  }
}


/**
 * Phase 9 (inbox-calendar-new-11, missed-17, missed-18) — WHAT A DATE IS, past
 * its kind: the figure, the state, the span — or nothing, when the kind says it
 * all. Every view says the kind once, in the same words (`calendar.kind.*`),
 * and this after it: "✦ Price worked out · $1.95 each, quantity 2,000" — never
 * "Price worked out · Price worked out: …", and never an order's record code.
 * `line` above stays the whole sentence, for the pages that show one line alone.
 */
export function detailOf(locale: Locale, e: CalendarEntry): string {
  const d = e.detail;
  switch (e.kind) {
    case 'sample_asked': return d.open ? t(locale, 'calendar.line.sampleOpen') : '';
    case 'sample_handled': return '';
    case 'order_state': {
      const state = orderStatusName(locale, d.orderState ?? '');
      return d.trackingReference ? `${state} · ${t(locale, 'calendar.line.tracking', { ref: d.trackingReference })}` : state;
    }
    case 'price_worked_out':
      return t(locale, 'calendar.detail.price', { price: d.price ? show.money(locale, d.price) : '', qty: show.quantity(locale, d.quantity ?? 0) });
    case 'reply_due': return t(locale, d.overdue ? 'calendar.line.replyOverdue' : 'calendar.line.replyDue');
    case 'followup_due': return d.sequenceName ?? '';
    case 'closure':
      return t(locale, 'calendar.range', {
        from: show.date(locale, dayStart(d.closureFrom ?? e.day, workspaceZone())),
        to: show.date(locale, dayStart(d.closureTo ?? e.day, workspaceZone())),
      });
    case 'conversation_closed': case 'own': return '';
    case 'promise_follow_up': case 'promise_price_end': case 'promise_delivery':
      return t(locale, 'calendar.line.promise', { said: d.said ?? '' });
  }
}

/** Who or what a date is about: the customer, the owner's own title, a closure's name, an address. */
const nameOf = (locale: Locale, e: CalendarEntry): string => e.kind === 'own' ? e.detail.title ?? ''
  : e.kind === 'closure' ? e.detail.closureLabel ?? ''
  : e.buyer?.name ?? e.identity ?? t(locale, 'common.buyer');

/**
 * The name, and the customer's country after it. Phase 9 (missed-19) — no
 * flag: only some countries had one and nothing said what one meant (phase 1
 * took them off the Customers row for the same reason).
 */
function who(locale: Locale, e: CalendarEntry): string {
  const cn = e.buyer ? countryName(locale, e.buyer.country) : null;
  return `<span><b><bdi>${esc(nameOf(locale, e))}</bdi></b>${cn ? `<span class="muted"> · ${esc(cn)}</span>` : ''}</span>`;
}

/** Where an entry opens: its order, else its conversation (at the newest message, CC-25), else nowhere. */
const doorOf = (e: CalendarEntry): string | null => e.orderId ? `/app/orders/${encodeURIComponent(e.orderId)}`
  : e.conversationId ? conversationUrl(e.conversationId) : null;

/**
 * An owner's own date is taken off here: a button — it changes something. It
 * does not ask first: the notice that follows carries Undo (phase 5).
 */
const removeForm = (locale: Locale, e: CalendarEntry): string => e.kind === 'own' && e.detail.entryId
  ? `<form method="post" action="/app/calendar/entries/${esc(e.detail.entryId)}/remove" class="cal-rm">
      <button class="btn ghost" type="submit">${esc(t(locale, 'calendar.remove'))}</button></form>`
  : '';

/**
 * A date's STATE, as a shape and a colour (phase 4): ○ owed, ✕ owed and late,
 * ✓ done (phase 9, inbox-calendar-new-13 — done was grey text alone, the word
 * only for a screen reader). ✦ is the assistant's hand: a price it worked out,
 * a promise it made.
 */
function marksOf(locale: Locale, e: CalendarEntry, now: Date): { readonly done: boolean; readonly marks: string } {
  const done = isDone(e, now);
  const promise = e.kind.startsWith('promise_');
  const owed = !done && (e.kind === 'reply_due' || (e.kind === 'sample_asked' && e.detail.open === true)
    || (promise && e.day <= dayKey(now, workspaceZone())));
  const state = owed ? `${signalMark(e.detail.overdue ? 'failed' : 'waiting')} `
    : done ? `${signalMark('ok')}<span class="sr">${esc(t(locale, 'calendar.done'))}</span> ` : '';
  const hand = e.kind === 'price_worked_out' || (promise && e.detail.byAssistant) ? '<span class="as" aria-hidden="true">✦</span> ' : '';
  return { done, marks: `${state}${hand}` };
}

/** The kind once, in every view's own words, and what it is after it. */
const kindAndDetail = (locale: Locale, e: CalendarEntry): string => {
  const more = detailOf(locale, e);
  return `${esc(t(locale, `calendar.kind.${e.kind}` as MessageKey))}${more ? ` · <bdi>${esc(more)}</bdi>` : ''}`;
};

/** The list view's row: when, who, the kind and what it is; a door where it came from a conversation. */
function entry(locale: Locale, e: CalendarEntry, now: Date): string {
  const when = e.allDay ? t(locale, 'calendar.allDay') : show.time(locale, e.at);
  const { done, marks } = marksOf(locale, e, now);
  const body = `<span class="person">
        <span class="cal-head">${who(locale, e)}</span>
        <span class="small"><span class="cal-kind" data-cat="${esc(e.category)}">${marks}${kindAndDetail(locale, e)}</span></span></span>`;
  const to = doorOf(e);
  return `<li class="row ${edgeOf(e)}${done ? ' done' : ''}" data-src="${esc(`${e.source.table}:${e.source.id}`)}" data-col="${esc(e.source.column)}">
      <span class="cal-when">${esc(when)}</span>
      ${to
        ? `<a class="grow cal-go" href="${to}">${body}<span class="go" aria-hidden="true">›</span></a>`
        : `<div class="grow">${body}${removeForm(locale, e)}</div>`}
    </li>`;
}

/**
 * One date on the grid: the name first, then the kind of date and its time.
 * Its edge says where it came from; its marks say its state and the
 * assistant's hand. A date from a conversation opens there; the owner's own
 * can be taken off.
 */
function chip(locale: Locale, e: CalendarEntry, now: Date, compact = false): string {
  // Phase 9 — greyed when DONE, the day list's rule: a reply still owed is not grey because its hour has passed.
  const { done, marks } = marksOf(locale, e, now);
  const kind = e.kind === 'own' ? '' : `<span class="wk-k">${marks}${esc(t(locale, `calendar.kind.${e.kind}` as MessageKey))}</span>`;
  const time = e.allDay || compact ? ''
    : `<span class="wk-t">${esc(show.time(locale, e.at))}${e.detail.endsAt ? `–${esc(show.time(locale, e.detail.endsAt))}` : ''}</span>`;
  const body = `<b><bdi>${esc(nameOf(locale, e))}</bdi></b>${kind}${time}`;
  const attrs = `class="wk-e ${edgeOf(e)}${done ? ' past' : ''}" data-src="${esc(`${e.source.table}:${e.source.id}`)}" data-col="${esc(e.source.column)}" title="${esc(line(locale, e))}"`;
  const to = doorOf(e);
  return to ? `<a ${attrs} href="${to}">${body}</a>` : `<div ${attrs}>${body}${compact ? '' : removeForm(locale, e)}</div>`;
}

/**
 * PHASE 7 OF THE UI REBUILD (2026-10-02) — the KIND of a date as a small drawn
 * icon (the day view's list): a sample, an order, a price, a reply, a
 * follow-up, a closure, a closed conversation, the owner's own date, a promise.
 * Drawn in the line's own colour, never a colour of its own — state stays the
 * four signals' (✓ ○ ✕ ✦). Hidden from a screen reader: the line says the kind.
 */
const ICON_PATH: Readonly<Record<string, string>> = {
  sample: '<path d="M2.5 5.5 8 2.5l5.5 3v5L8 13.5l-5.5-3zM2.5 5.5 8 8.5l5.5-3M8 8.5v5"/>',
  order: '<path d="M1.5 4.5h8v6h-8zM9.5 6.5h3l2 2v2h-5z"/><circle cx="4.5" cy="11.5" r="1.25"/><circle cx="11.5" cy="11.5" r="1.25"/>',
  price: '<path d="M8.5 2.5h5v5l-6 6-5-5z"/><circle cx="11" cy="5" r=".75"/>',
  reply: '<path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/>',
  followup: '<path d="M12.5 7.5a4.5 4.5 0 1 1-1.3-3.2M12.5 2.5v2.5H10"/>',
  closure: '<path d="M2.5 3.5h11v10h-11zM2.5 6.5h11M5.5 2v3M10.5 2v3M6 8.5l4 3.5M10 8.5l-4 3.5"/>',
  closed: '<path d="M2 3.5h12v3H2zM3 6.5v7h10v-7M6.5 9h3"/>',
  own: '<circle cx="8" cy="8" r="2.5"/>',
  promise: '<path d="M3 9.5c0-2.5 1-4 3-5M3 9.5h2.5v3H3zM9 9.5c0-2.5 1-4 3-5M9 9.5h2.5v3H9z"/>',
};
const ICON_OF: Readonly<Record<CalendarEntry['kind'], string>> = {
  sample_asked: 'sample', sample_handled: 'sample', order_state: 'order', price_worked_out: 'price', reply_due: 'reply',
  followup_due: 'followup', closure: 'closure', conversation_closed: 'closed', own: 'own',
  promise_follow_up: 'promise', promise_price_end: 'promise', promise_delivery: 'promise',
};
export const kindIcon = (e: CalendarEntry): string =>
  `<svg class="kind-icon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_PATH[ICON_OF[e.kind]]}</svg>`;

/**
 * Phase 7 — is this date DONE: handled, kept, closed, or simply past? A reply
 * owed, a sample nobody has dealt with, a promise not kept are never done
 * however old: they are what the owner still has to do. Done dates are greyed
 * in the day's list, never hidden.
 */
export function isDone(e: CalendarEntry, now: Date): boolean {
  if (e.kind === 'reply_due') return false;
  if (e.kind === 'sample_asked' && e.detail.open) return false;
  if (e.kind.startsWith('promise_')) return e.detail.kept === true;
  if (e.kind === 'sample_handled' || e.kind === 'conversation_closed') return true;
  const today = dayKey(now, workspaceZone());
  if (e.kind === 'closure') return (e.detail.closureTo ?? e.day) < today;
  return e.allDay ? e.day < today : (e.detail.endsAt ?? e.at).getTime() < now.getTime();
}

/**
 * Phase 7 — THE DAY, AS ONE LIST in time order (the all-day dates first): the
 * hour, the kind's icon, the name — whole, never cut, a Latin name inside
 * Arabic isolated — and what it is. What is done is greyed and marked ✓; what
 * is owed carries its signal. It was a grid of empty hours with the day's few
 * dates somewhere in it.
 */
function dayList(locale: Locale, v: CalendarView, day: string, now: Date): string {
  const here = v.entries.filter((e) => (e.allDay ? covers(e, day) : e.day === day))
    .slice().sort((a, b) => (a.allDay === b.allDay ? a.at.getTime() - b.at.getTime() : a.allDay ? -1 : 1));
  if (here.length === 0) return '';
  return `<ol class="dl">${here.map((e) => {
    const { done, marks } = marksOf(locale, e, now);
    const hour = e.allDay ? t(locale, 'calendar.allDay')
      : `${show.time(locale, e.at)}${e.detail.endsAt ? `–${show.time(locale, e.detail.endsAt)}` : ''}`;
    const body = `<span class="dl-body"><b><bdi>${esc(nameOf(locale, e))}</bdi></b><span class="small">${marks}${kindAndDetail(locale, e)}</span></span>`;
    const to = doorOf(e);
    return `<li class="dl-row ${edgeOf(e)}${done ? ' done' : ''}" data-src="${esc(`${e.source.table}:${e.source.id}`)}" data-col="${esc(e.source.column)}">
        <span class="dl-hour">${esc(hour)}</span>${kindIcon(e)}
        ${to ? `<a class="dl-go" href="${to}">${body}<span class="go" aria-hidden="true">›</span></a>` : `<div class="dl-go">${body}${removeForm(locale, e)}</div>`}
      </li>`;
  }).join('')}</ol>`;
}

/** Does this all-day entry cover the day? A closure covers its whole span. */
const covers = (e: CalendarEntry, day: string): boolean => e.kind === 'closure'
  ? (e.detail.closureFrom ?? e.day) <= day && day <= (e.detail.closureTo ?? e.day)
  : e.day === day;

/** Phase 9 (V1-204, inbox-calendar-new-10) — today, in a word as well as a line, on the week's head and in the month's cell. */
const todayWord = (locale: Locale): string => `<span class="cal-now">${esc(t(locale, 'calendar.this.day'))}</span>`;

/**
 * Days as columns, hours as rows: the week. Phase 9 (V1-204) — only the hours
 * that hold a date get a row, each named by its hour: seventeen rows for six
 * dates ran a phone page to 2,000 px of empty hours.
 */
function grid(locale: Locale, v: CalendarView, days: readonly string[], now: Date): string {
  const allDay = v.entries.filter((e) => e.allDay);
  const timed = v.entries.filter((e) => !e.allDay);
  const hours = [...new Set(timed.map((e) => hourIn(e.at, workspaceZone())))].sort((a, b) => a - b);
  const head = `<tr><th scope="col" class="wk-corner"><span class="sr">${esc(t(locale, 'calendar.allDay'))}</span></th>${days.map((d) => {
    const today = d === v.today;
    return `<th scope="col"${today ? ' class="today" aria-current="date"' : ''}><a href="${esc(href({ view: 'day', at: d, category: v.category, buyer: v.buyer?.id ?? null }))}">${
      esc(formatWeekday(locale, d))} <b>${esc(show.count(locale, Number(d.slice(8))))}</b></a>${today ? todayWord(locale) : ''}</th>`;
  }).join('')}</tr>`;
  const allRow = allDay.length
    ? `<tr class="wk-all"><th scope="row">${esc(t(locale, 'calendar.allDay'))}</th>${days.map((d) =>
        `<td>${allDay.filter((e) => covers(e, d)).map((e) => chip(locale, e, now)).join('')}</td>`).join('')}</tr>`
    : '';
  const rows = hours.map((h) => `<tr><th scope="row">${esc(show.isolate(locale, String(h).padStart(2, '0')))}</th>${days.map((d) =>
    `<td>${timed.filter((e) => e.day === d && hourIn(e.at, workspaceZone()) === h).map((e) => chip(locale, e, now)).join('')}</td>`).join('')}</tr>`);
  return `<div class="wk-scroll"><table class="wk"><thead>${head}</thead><tbody>${allRow}${rows.join('')}</tbody></table></div>`;
}

/**
 * The month: its weeks, each day a door to that day, up to TWO dates in it.
 * Phase 7 — a crowded day says "+N more" (a door to that day's list) instead
 * of stretching its row: every week of the month stays the same height.
 */
export const MONTH_SHOWN = 2;
function month(locale: Locale, v: CalendarView, at: string, now: Date): string {
  const days: string[] = [];
  for (let d = v.from; d < v.to; d = addDays(d, 1)) days.push(d);
  const weeks: string[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  const inMonth = (d: string) => d.slice(0, 7) === at.slice(0, 7);
  const head = `<tr>${weeks[0]!.map((d) => `<th scope="col">${esc(formatWeekday(locale, d))}</th>`).join('')}</tr>`;
  const body = weeks.map((w) => `<tr>${w.map((d) => {
    const here = v.entries.filter((e) => (e.allDay ? covers(e, d) : e.day === d));
    const shown = here.slice(0, MONTH_SHOWN);
    const more = here.length - shown.length;
    const today = d === v.today;
    return `<td class="${inMonth(d) ? '' : 'other'}${today ? ' today' : ''}"${today ? ' aria-current="date"' : ''}>
        <a class="mo-d" href="${esc(href({ view: 'day', at: d, category: v.category, buyer: v.buyer?.id ?? null }))}">${esc(show.count(locale, Number(d.slice(8))))}</a>${today ? todayWord(locale) : ''}
        ${shown.map((e) => chip(locale, e, now, true)).join('')}
        ${more > 0 ? `<a class="mo-more" href="${esc(href({ view: 'day', at: d, category: v.category, buyer: v.buyer?.id ?? null }))}">${esc(t(locale, 'calendar.more', { n: more }))}</a>` : ''}
      </td>`;
  }).join('')}</tr>`).join('');
  return `<div class="wk-scroll"><table class="mo"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

/**
 * Add one of the owner's own dates: folded away until it is wanted. Phase 6/7
 * — sent back (`kept`), it is open, the field that was wrong says why under
 * it, and what was typed is still there. Phase 9 (V1-203) — near the top of
 * every view, above the dates: it was a small fold under the whole grid.
 */
const addForm = (locale: Locale, day: string, kept: Kept | null = null): string => `<details class="cal-add"${kept ? ' open' : ''}>
    <summary>${esc(t(locale, 'calendar.add'))}</summary>
    <form method="post" action="/app/calendar/entries" class="pform">
      <label class="fld"><span class="muted">${esc(t(locale, 'calendar.add.what'))}</span>
        <input type="text" name="title" required maxlength="80" dir="auto" value="${keptValue(kept, 'title')}"${keptInvalid(kept, 'title', 'ca-title-err')} /></label>
      ${keptError(kept, 'title', 'ca-title-err') ?? ''}
      <label class="fld"><span class="muted">${esc(t(locale, 'calendar.add.day'))}</span>
        <input type="date" name="day" required value="${kept ? keptValue(kept, 'day') : esc(day)}"${keptInvalid(kept, 'day', 'ca-day-err')} /></label>
      ${keptError(kept, 'day', 'ca-day-err') ?? ''}
      <div class="cal-times">
        <label class="fld"><span class="muted">${esc(t(locale, 'calendar.add.from'))}</span><input type="time" name="from" value="${keptValue(kept, 'from')}"${keptInvalid(kept, 'from', 'ca-from-err')} /></label>
        <label class="fld"><span class="muted">${esc(t(locale, 'calendar.add.to'))}</span><input type="time" name="to" value="${keptValue(kept, 'to')}"${keptInvalid(kept, 'to', 'ca-to-err')} /></label>
      </div>
      ${keptError(kept, 'from', 'ca-from-err') ?? ''}${keptError(kept, 'to', 'ca-to-err') ?? ''}
      <p class="muted">${esc(t(locale, 'calendar.add.hint'))}</p>
      <button class="btn" type="submit">${esc(t(locale, 'calendar.add.save'))}</button>
    </form>
  </details>`;

export type CalendarPage = { readonly view?: CalendarViewKind; readonly at?: string; readonly now?: Date; readonly kept?: Kept | null };

export function renderCalendar(v: CalendarView, locale: Locale, page: CalendarPage = {}): string {
  const view = page.view ?? 'list';
  const now = page.now ?? dayStart(v.today, workspaceZone());
  return view === 'list' ? renderList(v, locale, now, page.kept ?? null)
    : renderGrid(v, locale, view, page.at ?? v.from, now, page.kept ?? null);
}

/** Month · Week · Day · List, keeping the category and the buyer. */
function viewTabs(locale: Locale, v: CalendarView, view: CalendarViewKind, at: string): string {
  const buyer = v.buyer?.id ?? null;
  return `<nav class="tabs cal-views" aria-label="${esc(t(locale, 'calendar.views'))}">${VIEWS.map((w) => {
    const on = w === view;
    return `<a class="tab${on ? ' on' : ''}"${on ? ' aria-current="page"' : ''} href="${esc(href({ view: w, at: w === 'list' ? null : at, category: v.category, buyer }))}">${
      esc(t(locale, `calendar.view.${w}` as MessageKey))}</a>`;
  }).join('')}</nav>`;
}

/**
 * Phase 9 (V1-202, inbox-calendar-new-15) — ONE kind or ONE customer, chosen
 * in one fold: a second row of pills the shape of the views' (wrapping on a
 * phone) became a line that says what is shown. Every kind is offered in every
 * view — "Orders" no longer comes and goes with the range — except follow-ups,
 * which exist only where the outreach area is on (rule 8).
 */
function filterForm(locale: Locale, v: CalendarView, hidden: Record<string, string | null>, clear: string): string {
  const kinds = CALENDAR_CATEGORIES.filter((c) => c !== 'followups' || outreachShown() || v.categories.includes(c) || v.category === c);
  const buyers = [...v.buyers, ...(v.buyer && !v.buyers.some((b) => b.id === v.buyer!.id) ? [v.buyer] : [])];
  const chosen = [v.category ? t(locale, `calendar.cat.${v.category}` as MessageKey) : '', v.buyer ? buyerLabel(locale, v.buyer) : ''].filter(Boolean).join(' · ');
  return `<details class="cal-filter">
      <summary>${esc(chosen ? t(locale, 'calendar.filter.chosen', { what: chosen }) : t(locale, 'calendar.filter.choose'))}</summary>
      <form method="get" action="/app/calendar" class="pform">
        ${Object.entries(hidden).filter(([, val]) => val).map(([k, val]) => `<input type="hidden" name="${k}" value="${esc(val!)}" />`).join('')}
        <label class="fld"><span class="muted">${esc(t(locale, 'calendar.filter.kind'))}</span>
          <select name="category">
            <option value="">${esc(t(locale, 'calendar.cat.allKinds'))}</option>
            ${kinds.map((c) => `<option value="${c}"${c === v.category ? ' selected' : ''}>${esc(t(locale, `calendar.cat.${c}` as MessageKey))}</option>`).join('')}
          </select></label>
        ${buyers.length ? `<label class="fld"><span class="muted">${esc(t(locale, 'calendar.buyer.label'))}</span>
          <select name="who">
            <option value="">${esc(t(locale, 'calendar.buyer.all'))}</option>
            ${buyers.map((b) => `<option value="${esc(b.id)}"${b.id === v.buyer?.id ? ' selected' : ''}>${esc(buyerLabel(locale, b))}</option>`).join('')}
          </select></label>` : ''}
        <button class="btn" type="submit">${esc(t(locale, 'calendar.buyer.show'))}</button>
        ${chosen ? deeper(esc(clear), t(locale, 'calendar.empty.clear')) : ''}
      </form>
    </details>`;
}

/**
 * What the page's marks mean, drawn with the marks themselves: where a date
 * came from (its edge), the assistant's hand (✦), owed (○) and done (✓).
 * Phase 9 (V1-200, inbox-calendar-new-14, missed-16) — on every view, and the
 * edge drawn as a small square-cornered swatch, not a pill that read as a switch.
 */
const legend = (locale: Locale): string => `<p class="cal-legend small">
    <span class="cal-li"><span class="cal-sw solid" aria-hidden="true"></span> ${esc(t(locale, 'calendar.legend.solid'))}</span>
    <span class="cal-li"><span class="cal-sw dashed" aria-hidden="true"></span> ${esc(t(locale, 'calendar.legend.dashed'))}</span>
    <span class="cal-li"><span class="as" aria-hidden="true">✦</span> ${esc(t(locale, 'calendar.legend.assistant', { name: assistantName(locale) }))}</span>
    <span class="cal-li">${signalMark('waiting')} ${esc(t(locale, 'calendar.legend.owed'))}</span>
    <span class="cal-li">${signalMark('ok')} ${esc(t(locale, 'calendar.legend.done'))}</span></p>`;

/**
 * Phase 9 (V1-199, missed-16) — how every view moves, the same way and in
 * words: the period's name first, then "‹ Last week · This week · Next week ›".
 * The arrows were bare, and the bold "Today" between them read as the label.
 */
function periodMove(locale: Locale, unit: CalendarViewKind, span: string, prev: string, here: string, next: string): string {
  return `<div class="cal-period">
      <p class="cal-span">${esc(span)}</p>
      <nav class="cal-move" aria-label="${esc(t(locale, 'calendar.move'))}">
        ${back(esc(prev), t(locale, `calendar.prev.${unit}` as MessageKey))}
        <a class="tab cal-today" href="${esc(here)}">${esc(t(locale, `calendar.this.${unit}` as MessageKey))}</a>
        ${deeper(esc(next), t(locale, `calendar.next.${unit}` as MessageKey))}
      </nav>
    </div>`;
}

/** The page's head, the same on every view: the title and the views, what it holds, how to move, what to show, what to add, what the marks mean. */
const pageHead = (locale: Locale, v: CalendarView, view: CalendarViewKind, at: string, move: string, filter: string, add: string): string =>
  `<div class="cal-top"><h1 class="page">${esc(t(locale, 'nav.calendar'))}</h1>${viewTabs(locale, v, view, at)}</div>
    <p class="muted cal-lede">${esc(t(locale, 'calendar.lede'))}</p>
    ${move}
    ${filter}
    ${add}
    ${legend(locale)}`;

function renderGrid(v: CalendarView, locale: Locale, view: Exclude<CalendarViewKind, 'list'>, at: string, now: Date, kept: Kept | null = null): string {
  const buyer = v.buyer?.id ?? null;
  const step = (n: number) => view === 'month' ? addMonths(at, n) : addDays(at, view === 'week' ? 7 * n : n);
  const span = view === 'month' ? show.month(locale, at)
    : view === 'day' ? show.date(locale, dayStart(at, workspaceZone()))
    : t(locale, 'calendar.range', { from: show.date(locale, dayStart(v.from, workspaceZone())), to: show.date(locale, dayStart(addDays(v.to, -1), workspaceZone())) });
  const move = periodMove(locale, view, span,
    href({ view, at: step(-1), category: v.category, buyer }), href({ view, category: v.category, buyer }), href({ view, at: step(1), category: v.category, buyer }));
  const days: string[] = [];
  if (view !== 'month') for (let d = v.from; d < v.to; d = addDays(d, 1)) days.push(d);
  const empty = v.entries.length === 0
    // Phase 9 — an empty state is a panel everywhere (phase 6 missed these five).
    ? `<div class="empty">${esc(t(locale, view === 'week' ? 'calendar.empty.week' : view === 'day' ? 'calendar.empty.day' : 'calendar.empty.month'))}</div>` : '';
  const filter = filterForm(locale, v, { view: view === 'week' ? null : view, at }, href({ view, at }));
  const add = addForm(locale, view === 'month' ? (v.today.slice(0, 7) === at.slice(0, 7) ? v.today : at) : view === 'day' ? at : (v.today >= v.from && v.today < v.to ? v.today : v.from), kept);
  // Phase 9 (V1-204) — a week with nothing dated says so, without a table of empty hours under it.
  const body = view === 'month' ? month(locale, v, at, now) : view === 'day' ? dayList(locale, v, at, now) : empty ? '' : grid(locale, v, days, now);
  return `${pageHead(locale, v, view, at, move, filter, add)}
    ${empty}
    ${body}`;
}

/**
 * The list: the three-week agenda, day by day. Phase 9 (inbox-calendar-missed-20)
 * — at the prose measure, its head included, so the views' tabs end where its
 * rows do.
 */
function renderList(v: CalendarView, locale: Locale, now: Date, kept: Kept | null = null): string {
  const isDefault = v.from === defaultFrom(v.today);
  const last = addDays(v.to, -1);
  const buyerId = v.buyer?.id ?? null;
  const span = t(locale, 'calendar.range', {
    from: show.date(locale, dayStart(v.from, workspaceZone())), to: show.date(locale, dayStart(last, workspaceZone())),
  });
  const earlier = addDays(v.from, -WINDOW_DAYS);
  const later = addDays(v.from, WINDOW_DAYS);
  const move = periodMove(locale, 'list', span,
    href({ view: 'list', from: earlier === defaultFrom(v.today) ? null : earlier, category: v.category, buyer: buyerId }),
    href({ view: 'list', category: v.category, buyer: buyerId }),
    href({ view: 'list', from: later === defaultFrom(v.today) ? null : later, category: v.category, buyer: buyerId }));
  const filter = filterForm(locale, v, { view: 'list', from: isDefault ? null : v.from }, href({ view: 'list', from: isDefault ? null : v.from }));
  const head = pageHead(locale, v, 'list', v.today, move, filter, addForm(locale, v.today, kept));

  if (v.entries.length === 0) {
    const narrowed = v.category !== null || v.buyer !== null;
    return `<div class="measure-prose">${head}
      <div class="empty">${esc(t(locale, narrowed ? 'calendar.empty.filtered' : 'calendar.empty'))}
        <div>${narrowed
          ? deeper(esc(href({ view: 'list', from: isDefault ? null : v.from })), t(locale, 'calendar.empty.clear'))
          : deeper('/app/inbox', t(locale, 'calendar.empty.door'))}</div></div></div>`;
  }

  // One heading per day that holds something — and today always, in words,
  // so "now" can be found on the page without a colour to find it by.
  const days = new Map<string, CalendarEntry[]>();
  for (const e of v.entries) days.set(e.day, [...(days.get(e.day) ?? []), e]);
  const todayIn = v.today >= v.from && v.today < v.to;
  if (todayIn && !days.has(v.today)) days.set(v.today, []);
  const sections = [...days.keys()].sort().map((day) => {
    const items = days.get(day) ?? [];
    const date = show.date(locale, dayStart(day, workspaceZone()));
    const title = day === v.today ? t(locale, 'calendar.today', { date }) : date;
    return `<section>
      <h2 class="cal-day"${day === v.today ? ' aria-current="date"' : ''}>${esc(title)}</h2>
      ${items.length
        ? `<ul class="rows">${items.map((e) => entry(locale, e, now)).join('')}</ul>`
        : `<div class="empty">${esc(t(locale, 'calendar.todayNothing'))}</div>`}
    </section>`;
  }).join('');

  return `<div class="measure-prose">${head}${sections}</div>`;
}
