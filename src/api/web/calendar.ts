import { type Locale } from '../../core/owner/i18n/locale.js';
import { countryName, orderStatusName, type MessageKey } from '../../core/owner/i18n/messages.js';
import {
  addDays, dayKey, dayStart, formatDate, formatMoney, formatQty, formatTime, hourIn, formatMonth, formatWeekday,
} from '../../core/owner/i18n/format.js';
import { t } from './say.js';
import { esc, deeper, back, conversationUrl } from './layout.js';
import { flag } from './inbox.js';
import {
  CALENDAR_CATEGORIES, edgeOf, type CalendarCategory, type CalendarEntry, type CalendarView, type CalendarBuyer,
} from '../../db/calendar.js';

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
  const today = dayKey(now);
  const view = VIEWS.find((v) => v === q['view']) ?? 'week';
  const cat = q['category'];
  const category = typeof cat === 'string' && (CALENDAR_CATEGORIES as readonly string[]).includes(cat)
    ? cat as CalendarCategory : null;
  const b = typeof q['buyer'] === 'string' ? q['buyer'].toLowerCase() : '';
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
    p.buyer ? `buyer=${p.buyer}` : '',
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
        price: d.price ? formatMoney(d.price) : '', qty: formatQty(locale, d.quantity ?? 0),
      });
    case 'reply_due': return t(locale, d.overdue ? 'calendar.line.replyOverdue' : 'calendar.line.replyDue');
    case 'followup_due': return t(locale, 'calendar.line.followup', { sequence: d.sequenceName ?? '' });
    case 'closure':
      return t(locale, 'calendar.line.closure', {
        label: d.closureLabel ?? '',
        from: formatDate(locale, dayStart(d.closureFrom ?? e.day)),
        to: formatDate(locale, dayStart(d.closureTo ?? e.day)),
      });
    case 'conversation_closed': return t(locale, 'calendar.line.closed');
    case 'own': return d.title ?? '';
    case 'promise_follow_up': case 'promise_price_end': case 'promise_delivery':
      return t(locale, 'calendar.line.promise', { said: d.said ?? '' });
  }
}

function who(locale: Locale, e: CalendarEntry): string {
  if (e.buyer) {
    const cn = countryName(locale, e.buyer.country);
    const f = flag(e.buyer.country);
    // One inline run, so the country stays beside the name instead of wrapping under the chip.
    return `<span>${f ? `${f} ` : ''}<b><bdi>${esc(e.buyer.name ?? t(locale, 'common.buyer'))}</bdi></b>${cn ? `<span class="muted"> · ${esc(cn)}</span>` : ''}</span>`;
  }
  if (e.identity) return `<b><bdi>${esc(e.identity)}</bdi></b>`;
  return '';
}

/** Where an entry opens: its order, else its conversation (at the newest message, CC-25), else nowhere. */
const doorOf = (e: CalendarEntry): string | null => e.orderId ? `/app/orders/${encodeURIComponent(e.orderId)}`
  : e.conversationId ? conversationUrl(e.conversationId) : null;

/** An owner's own date is taken off here: a button — it changes something — and it asks first (CC-29). */
const removeForm = (locale: Locale, e: CalendarEntry): string => e.kind === 'own' && e.detail.entryId
  ? `<form method="post" action="/app/calendar/entries/${esc(e.detail.entryId)}/remove" class="cal-rm">
      <button class="btn ghost" type="submit" onclick="return confirm(this.dataset.confirm)"
        data-confirm="${esc(t(locale, 'calendar.remove.confirm', { title: e.detail.title ?? '' }))}">${esc(t(locale, 'calendar.remove'))}</button></form>`
  : '';

function entry(locale: Locale, e: CalendarEntry, showKind: boolean): string {
  const when = e.allDay ? t(locale, 'calendar.allDay') : formatTime(locale, e.at);
  // The kind leads the event's own line, in its words — not a pill before the
  // name (a pill is a state here, and the name leads a row).
  const kind = showKind
    ? `<span class="cal-kind" data-cat="${esc(e.category)}">${esc(t(locale, `calendar.cat.${e.category}` as MessageKey))}</span> · `
    : '';
  const body = `<span class="person">
        <span class="cal-head">${who(locale, e)}</span>
        <span class="small">${kind}${esc(line(locale, e))}</span></span>`;
  const to = doorOf(e);
  return `<li class="row ${edgeOf(e)}" data-src="${esc(`${e.source.table}:${e.source.id}`)}" data-col="${esc(e.source.column)}">
      <span class="cal-when">${esc(when)}</span>
      ${to
        ? `<a class="grow cal-go" href="${to}">${body}<span class="go" aria-hidden="true">›</span></a>`
        : `<div class="grow">${body}${removeForm(locale, e)}</div>`}
    </li>`;
}

/**
 * One date on the grid: the name first, then the kind of date and its time.
 * Its edge says where it came from; a ● says a reply is due; ✦ marks a price
 * the assistant worked out. A date from a conversation opens there; the
 * owner's own can be taken off.
 */
function chip(locale: Locale, e: CalendarEntry, now: Date, compact = false): string {
  const past = e.allDay ? e.day < dayKey(now) : e.at.getTime() < now.getTime();
  const name = e.kind === 'own' ? e.detail.title ?? ''
    : e.kind === 'closure' ? e.detail.closureLabel ?? ''
    : e.buyer?.name ?? e.identity ?? t(locale, 'common.buyer');
  // A state: a reply owed; a promise not yet kept whose day has come.
  const promise = e.kind.startsWith('promise_');
  const due = e.kind === 'reply_due' || (promise && !e.detail.kept && e.day <= dayKey(now));
  const state = due ? `<span class="dot ${e.detail.overdue ? 'bad' : 'warn'}" aria-hidden="true">●</span> ` : '';
  // The assistant's hand: a price it worked out, a promise it made.
  const mark = e.kind === 'price_worked_out' || (promise && e.detail.byAssistant)
    ? '<span class="as" aria-hidden="true">✦</span> ' : '';
  const kind = e.kind === 'own' ? '' : `<span class="wk-k">${state}${mark}${esc(t(locale, `calendar.kind.${e.kind}` as MessageKey))}</span>`;
  const time = e.allDay || compact ? ''
    : `<span class="wk-t">${esc(formatTime(locale, e.at))}${e.detail.endsAt ? `–${esc(formatTime(locale, e.detail.endsAt))}` : ''}</span>`;
  const body = `<b><bdi>${esc(name)}</bdi></b>${kind}${time}`;
  const attrs = `class="wk-e ${edgeOf(e)}${past ? ' past' : ''}" data-src="${esc(`${e.source.table}:${e.source.id}`)}" data-col="${esc(e.source.column)}" title="${esc(line(locale, e))}"`;
  const to = doorOf(e);
  return to ? `<a ${attrs} href="${to}">${body}</a>` : `<div ${attrs}>${body}${compact ? '' : removeForm(locale, e)}</div>`;
}

/** Does this all-day entry cover the day? A closure covers its whole span. */
const covers = (e: CalendarEntry, day: string): boolean => e.kind === 'closure'
  ? (e.detail.closureFrom ?? e.day) <= day && day <= (e.detail.closureTo ?? e.day)
  : e.day === day;

/** Days as columns, hours as rows: the week, or one day. */
function grid(locale: Locale, v: CalendarView, days: readonly string[], now: Date): string {
  const allDay = v.entries.filter((e) => e.allDay);
  const timed = v.entries.filter((e) => !e.allDay);
  const hours = timed.map((e) => hourIn(e.at));
  const first = Math.min(8, ...hours);
  const last = Math.max(18, ...hours);
  const head = `<tr><th scope="col" class="wk-corner"><span class="sr">${esc(t(locale, 'calendar.allDay'))}</span></th>${days.map((d) => {
    const today = d === v.today;
    return `<th scope="col"${today ? ' class="today" aria-current="date"' : ''}><a href="${esc(href({ view: 'day', at: d, category: v.category, buyer: v.buyer?.id ?? null }))}">${
      esc(formatWeekday(locale, d))} <b>${esc(String(Number(d.slice(8))))}</b></a></th>`;
  }).join('')}</tr>`;
  const allRow = allDay.length
    ? `<tr class="wk-all"><th scope="row">${esc(t(locale, 'calendar.allDay'))}</th>${days.map((d) =>
        `<td>${allDay.filter((e) => covers(e, d)).map((e) => chip(locale, e, now)).join('')}</td>`).join('')}</tr>`
    : '';
  const rows: string[] = [];
  for (let h = first; h <= last; h++) {
    rows.push(`<tr><th scope="row">${String(h).padStart(2, '0')}</th>${days.map((d) =>
      `<td>${timed.filter((e) => e.day === d && hourIn(e.at) === h).map((e) => chip(locale, e, now)).join('')}</td>`).join('')}</tr>`);
  }
  return `<div class="wk-scroll"><table class="wk"><thead>${head}</thead><tbody>${allRow}${rows.join('')}</tbody></table></div>`;
}

/** The month: its weeks, each day a door to that day, up to three dates in it. */
function month(locale: Locale, v: CalendarView, at: string, now: Date): string {
  const days: string[] = [];
  for (let d = v.from; d < v.to; d = addDays(d, 1)) days.push(d);
  const weeks: string[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  const inMonth = (d: string) => d.slice(0, 7) === at.slice(0, 7);
  const head = `<tr>${weeks[0]!.map((d) => `<th scope="col">${esc(formatWeekday(locale, d))}</th>`).join('')}</tr>`;
  const body = weeks.map((w) => `<tr>${w.map((d) => {
    const here = v.entries.filter((e) => (e.allDay ? covers(e, d) : e.day === d));
    const shown = here.slice(0, 3);
    const more = here.length - shown.length;
    const today = d === v.today;
    return `<td class="${inMonth(d) ? '' : 'other'}${today ? ' today' : ''}"${today ? ' aria-current="date"' : ''}>
        <a class="mo-d" href="${esc(href({ view: 'day', at: d, category: v.category, buyer: v.buyer?.id ?? null }))}">${esc(String(Number(d.slice(8))))}</a>
        ${shown.map((e) => chip(locale, e, now, true)).join('')}
        ${more > 0 ? `<a class="mo-more" href="${esc(href({ view: 'day', at: d, category: v.category, buyer: v.buyer?.id ?? null }))}">${esc(t(locale, 'calendar.more', { n: more }))}</a>` : ''}
      </td>`;
  }).join('')}</tr>`).join('');
  return `<div class="wk-scroll"><table class="mo"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

/** Add one of the owner's own dates: folded away until it is wanted. */
const addForm = (locale: Locale, day: string): string => `<details class="cal-add">
    <summary>${esc(t(locale, 'calendar.add'))}</summary>
    <form method="post" action="/app/calendar/entries" class="pform">
      <label class="fld"><span class="muted">${esc(t(locale, 'calendar.add.what'))}</span>
        <input type="text" name="title" required maxlength="80" dir="auto" /></label>
      <label class="fld"><span class="muted">${esc(t(locale, 'calendar.add.day'))}</span>
        <input type="date" name="day" required value="${esc(day)}" /></label>
      <div class="cal-times">
        <label class="fld"><span class="muted">${esc(t(locale, 'calendar.add.from'))}</span><input type="time" name="from" /></label>
        <label class="fld"><span class="muted">${esc(t(locale, 'calendar.add.to'))}</span><input type="time" name="to" /></label>
      </div>
      <p class="muted">${esc(t(locale, 'calendar.add.hint'))}</p>
      <button class="btn" type="submit">${esc(t(locale, 'calendar.add.save'))}</button>
    </form>
  </details>`;

export type CalendarPage = { readonly view?: CalendarViewKind; readonly at?: string; readonly now?: Date };

export function renderCalendar(v: CalendarView, locale: Locale, page: CalendarPage = {}): string {
  const view = page.view ?? 'list';
  return view === 'list' ? renderList(v, locale) : renderGrid(v, locale, view, page.at ?? v.from, page.now ?? dayStart(v.today));
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

/** Category: All, and each kind this window holds for this buyer — the chosen one stays, so it can be seen to be on. */
function categoryTabs(locale: Locale, v: CalendarView, keep: (c: CalendarCategory | null) => string): string {
  const shown = CALENDAR_CATEGORIES.filter((c) => v.categories.includes(c) || c === v.category);
  const tab = (c: CalendarCategory | null) => {
    const on = v.category === c;
    return `<a class="tab${on ? ' on' : ''}"${on ? ' aria-current="page"' : ''} href="${esc(keep(c))}">${
      esc(t(locale, c === null ? 'calendar.cat.all' : `calendar.cat.${c}` as MessageKey))}</a>`;
  };
  return shown.length || v.category !== null
    ? `<nav class="tabs cal-tabs" aria-label="${esc(t(locale, 'calendar.filter.category'))}">${tab(null)}${shown.map(tab).join('')}</nav>` : '';
}

/** Buyer: a GET form, folded away until it is in use. */
function buyerForm(locale: Locale, v: CalendarView, hidden: Record<string, string | null>): string {
  const buyerId = v.buyer?.id ?? null;
  return v.buyers.length || v.buyer ? `<details class="cal-buyer"${v.buyer ? ' open' : ''}>
      <summary>${esc(v.buyer ? t(locale, 'calendar.buyer.chosen', { buyer: buyerLabel(locale, v.buyer) }) : t(locale, 'calendar.buyer.choose'))}</summary>
      <form method="get" action="/app/calendar" class="pform">
        ${Object.entries(hidden).filter(([, val]) => val).map(([k, val]) => `<input type="hidden" name="${k}" value="${esc(val!)}" />`).join('')}
        <label class="fld"><span class="muted">${esc(t(locale, 'calendar.buyer.label'))}</span>
          <select name="buyer">
            <option value="">${esc(t(locale, 'calendar.buyer.all'))}</option>
            ${[...v.buyers, ...(v.buyer && !v.buyers.some((b) => b.id === v.buyer!.id) ? [v.buyer] : [])].map((b) =>
              `<option value="${esc(b.id)}"${b.id === buyerId ? ' selected' : ''}>${esc(`${flag(b.country) ? `${flag(b.country)} ` : ''}${buyerLabel(locale, b)}`)}</option>`).join('')}
          </select></label>
        <button class="btn" type="submit">${esc(t(locale, 'calendar.buyer.show'))}</button>
      </form>
    </details>` : '';
}

/** Where a date came from, drawn with the edges themselves. */
const legend = (locale: Locale): string => `<p class="cal-legend small">
    <span class="wk-e solid" aria-hidden="true"></span> ${esc(t(locale, 'calendar.legend.solid'))}
    <span class="wk-e dashed" aria-hidden="true"></span> ${esc(t(locale, 'calendar.legend.dashed'))}</p>`;

function renderGrid(v: CalendarView, locale: Locale, view: Exclude<CalendarViewKind, 'list'>, at: string, now: Date): string {
  const buyer = v.buyer?.id ?? null;
  const step = (n: number) => view === 'month' ? addMonths(at, n) : addDays(at, view === 'week' ? 7 * n : n);
  const span = view === 'month' ? formatMonth(locale, at)
    : view === 'day' ? formatDate(locale, dayStart(at))
    : t(locale, 'calendar.range', { from: formatDate(locale, dayStart(v.from)), to: formatDate(locale, dayStart(addDays(v.to, -1))) });
  // ‹ Today › beside the dates: the arrows are doors, mirrored in Arabic by `.go`.
  const move = `<nav class="cal-move" aria-label="${esc(t(locale, 'calendar.move'))}">
      <a class="back" href="${esc(href({ view, at: step(-1), category: v.category, buyer }))}" aria-label="${esc(t(locale, 'calendar.prev'))}"><span class="go" aria-hidden="true">‹</span></a>
      <a class="cal-today" href="${esc(href({ view, category: v.category, buyer }))}">${esc(t(locale, 'calendar.todayDoor'))}</a>
      <a class="deeper" href="${esc(href({ view, at: step(1), category: v.category, buyer }))}" aria-label="${esc(t(locale, 'calendar.next'))}"><span class="go" aria-hidden="true">›</span></a>
      <span class="cal-span">${esc(span)}</span>
    </nav>`;
  const days: string[] = [];
  if (view !== 'month') for (let d = v.from; d < v.to; d = addDays(d, 1)) days.push(d);
  const empty = v.entries.length === 0
    ? `<p class="muted">${esc(t(locale, view === 'week' ? 'calendar.empty.week' : view === 'day' ? 'calendar.empty.day' : 'calendar.empty.month'))}</p>` : '';
  return `<div class="cal-top"><h1 class="page">${esc(t(locale, 'nav.calendar'))}</h1>${viewTabs(locale, v, view, at)}</div>
    ${move}
    ${categoryTabs(locale, v, (c) => href({ view, at, category: c, buyer }))}
    ${buyerForm(locale, v, { view: view === 'week' ? null : view, at, category: v.category })}
    ${legend(locale)}
    ${empty}
    ${view === 'month' ? month(locale, v, at, now) : grid(locale, v, days, now)}
    ${addForm(locale, view === 'month' ? (v.today.slice(0, 7) === at.slice(0, 7) ? v.today : at) : view === 'day' ? at : (v.today >= v.from && v.today < v.to ? v.today : v.from))}`;
}

/** The list: the three-week agenda, day by day. */
function renderList(v: CalendarView, locale: Locale): string {
  const isDefault = v.from === defaultFrom(v.today);
  const last = addDays(v.to, -1);
  const buyerId = v.buyer?.id ?? null;
  const tabs = categoryTabs(locale, v, (c) => href({ view: 'list', from: isDefault ? null : v.from, category: c, buyer: buyerId }));

  // The window, and the doors either side of it.
  const range = `<p class="small cal-span">${esc(t(locale, 'calendar.range', {
    from: formatDate(locale, dayStart(v.from)), to: formatDate(locale, dayStart(last)),
  }))}</p>`;
  const earlier = addDays(v.from, -WINDOW_DAYS);
  const later = addDays(v.from, WINDOW_DAYS);
  const pager = `<nav class="pager" aria-label="${esc(t(locale, 'calendar.filter.window'))}">
      ${back(esc(href({ view: 'list', from: earlier === defaultFrom(v.today) ? null : earlier, category: v.category, buyer: buyerId })), t(locale, 'calendar.earlier'))}
      ${isDefault ? '' : deeper(esc(href({ view: 'list', category: v.category, buyer: buyerId })), t(locale, 'calendar.now'))}
      ${deeper(esc(href({ view: 'list', from: later === defaultFrom(v.today) ? null : later, category: v.category, buyer: buyerId })), t(locale, 'calendar.later'))}
    </nav>`;

  const head = `<div class="cal-top"><h1 class="page">${esc(t(locale, 'nav.calendar'))}</h1>${viewTabs(locale, v, 'list', v.today)}</div>
    <p class="muted">${esc(t(locale, 'calendar.lede'))}</p>
    ${tabs}${buyerForm(locale, v, { view: 'list', from: isDefault ? null : v.from, category: v.category })}${range}`;

  if (v.entries.length === 0) {
    const narrowed = v.category !== null || v.buyer !== null;
    return `${head}
      <div class="empty">${esc(t(locale, narrowed ? 'calendar.empty.filtered' : 'calendar.empty'))}
        <div>${narrowed
          ? deeper(esc(href({ view: 'list', from: isDefault ? null : v.from })), t(locale, 'calendar.empty.clear'))
          : deeper('/app/inbox', t(locale, 'calendar.empty.door'))}</div></div>
      ${pager}${addForm(locale, v.today)}`;
  }

  // One heading per day that holds something — and today always, in words,
  // so "now" can be found on the page without a colour to find it by.
  const days = new Map<string, CalendarEntry[]>();
  for (const e of v.entries) days.set(e.day, [...(days.get(e.day) ?? []), e]);
  const todayIn = v.today >= v.from && v.today < v.to;
  if (todayIn && !days.has(v.today)) days.set(v.today, []);
  const sections = [...days.keys()].sort().map((day) => {
    const items = days.get(day) ?? [];
    const date = formatDate(locale, dayStart(day));
    const title = day === v.today ? t(locale, 'calendar.today', { date }) : date;
    return `<section>
      <h2 class="cal-day"${day === v.today ? ' aria-current="date"' : ''}>${esc(title)}</h2>
      ${items.length
        ? `<ul class="rows">${items.map((e) => entry(locale, e, v.category === null)).join('')}</ul>`
        : `<p class="muted">${esc(t(locale, 'calendar.todayNothing'))}</p>`}
    </section>`;
  }).join('');

  return `${head}${sections}${pager}${addForm(locale, v.today)}`;
}
