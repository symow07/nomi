import { workspaceZone } from './zone.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { countryName, orderStatusName, type MessageKey } from '../../core/owner/i18n/messages.js';
import { addDays, dayKey, dayStart, formatWeekday } from '../../core/owner/i18n/format.js';
import { t, assistantName, outreachShown } from './say.js';
import { esc, deeper, back, conversationUrl, signalMark } from './layout.js';
import {
  CALENDAR_CATEGORIES, edgeOf, type CalendarCategory, type CalendarEntry, type CalendarView, type CalendarBuyer,
} from '../../db/calendar.js';
import * as show from './values.js';
import { keptValue, keptError, keptInvalid, type Kept } from './rows.js';
import { face, faceLink, type FaceOf } from './faces.js';
import { icon, type DateIconId } from './icons.js';

/**
 * V2 — the calendar page. Pure: a `CalendarView` in, HTML out.
 *
 * THE OWNER'S CORRECTION (2026-10-04): "The owner wants the month grid and the
 * list working TOGETHER on one screen, not a switcher between them … the grid
 * for the glance, the list for what is owed. Selecting a day focuses the list
 * on that day." So there is ONE screen (`/app/calendar`), no List · Week ·
 * Month · Day:
 *
 *   - THE MONTH, a rounded grid: each date a small face (the card's door) and
 *     the name, three whole to a day and then "+N more", owed first. Every day
 *     is a door that SELECTS it (`?month=YYYY-MM&day=YYYY-MM-DD`, a plain link:
 *     no script needed); the chosen day wears a neutral ring, never magenta.
 *   - THE LIST beside it (from 1100 px) or under it (a phone, a narrow window):
 *       · nothing chosen — what is OWED first (a reply due, a sample nobody
 *         dealt with, a quote waiting for the owner's OK, a promise past its
 *         day), the late ones before today included, as far back as the week
 *         before today, as the old list's "Before today" reached; then the
 *         month's other dates, today and forward, the days behind today folded;
 *       · a day chosen — that day, in time order: the hour, the face with its
 *         kind's icon on its corner, one sentence; done greyed, never hidden.
 *   - The old views' addresses (`?view=…`, `?at=`, `?from=`) answer with a
 *     redirect to this screen, on the day they meant (`legacyCalendarAddress`).
 *     The week and the day are not views any more: a week is a row of the grid,
 *     and a day is the list beside it.
 *
 * Kept from the warmth run's phase 6 and phase 9: every date carries the
 * customer's FACE and one SENTENCE ("Reply owed to Pedro"); a date that is
 * nobody's (a closure, the owner's own) has its kind's icon in the face's
 * place. The CHROME folds away (the choice of one kind or one customer, and
 * adding a date, in one quiet fold, the choice drawn only when there is
 * something to choose between). An empty month is one warm panel with one
 * door, beside the empty grid. TODAY is magenta text, in a word as well.
 *
 * Where a date came from is still its EDGE (solid: from a conversation;
 * dashed: put there by the owner), and its state its signal — ○ owed, ✕ owed
 * and late, ✓ done, ✦ the assistant's hand. The week starts on the business's
 * country's first day.
 */

/** The owed list reaches back a week before today, as the old list's "Before today" did. */
const PAST_DAYS = 7;

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const YM = /^(\d{4})-(\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A real calendar day in a sane span, or null. `2026-02-31` is not a day. */
const parseYmd = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const m = YMD.exec(v);
  if (!m) return null;
  const y = Number(m[1]);
  if (y < 2000 || y > 2099) return null;
  return addDays(v, 0) === v ? v : null;
};
/** A month as the address writes it, `2026-10`, as its first day; or null. */
const parseYm = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const m = YM.exec(v);
  if (!m) return null;
  return parseYmd(`${v}-01`);
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
/** The month's grid: whole weeks, from the week holding its first day to the week holding its last. */
function gridOf(month: string, firstDay: number): { readonly from: string; readonly to: string } {
  const from = weekStart(month, firstDay);
  const lastWeek = weekStart(addDays(addMonths(month, 1), -1), firstDay);
  return { from, to: addDays(lastWeek, 7) };
}

export type CalendarAsk = {
  /** The month shown, as its first day. */
  readonly month: string;
  /** The day chosen in the grid, or null: the list then shows what is owed. */
  readonly day: string | null;
  /** The grid's days: whole weeks around the month. */
  readonly gridFrom: string; readonly gridTo: string;
  /** What is read: the grid, and the week before today when the grid holds today. */
  readonly from: string; readonly to: string;
  readonly category: CalendarCategory | null; readonly buyer: string | null;
};

/**
 * The query string, whitelisted. Anything that is not exactly a month, a day,
 * one of the categories, or a buyer id falls back to the default — this month,
 * nothing chosen — never an error page, and never a value passed on to SQL
 * unchecked. A day outside the month asked for shows its own month.
 */
export function parseCalendarQuery(query: unknown, now: Date, firstDay = 1): CalendarAsk {
  const q = (query && typeof query === 'object' ? query : {}) as Record<string, unknown>;
  const today = dayKey(now, workspaceZone());
  const cat = q['category'];
  const category = typeof cat === 'string' && (CALENDAR_CATEGORIES as readonly string[]).includes(cat)
    ? cat as CalendarCategory : null;
  // The positioning rewrite: ?who= (an old ?buyer= link still works).
  const w = q['who'] ?? q['buyer'];
  const b = typeof w === 'string' ? w.toLowerCase() : '';
  const buyer = UUID.test(b) ? b : null;
  const day = parseYmd(q['day']);
  let month = parseYm(q['month']) ?? monthStart(day ?? today);
  let grid = gridOf(month, firstDay);
  if (day && (day < grid.from || day >= grid.to)) { month = monthStart(day); grid = gridOf(month, firstDay); }
  const holdsToday = today >= grid.from && today < grid.to;
  const back = addDays(today, -PAST_DAYS);
  return {
    month, day, gridFrom: grid.from, gridTo: grid.to,
    from: holdsToday && back < grid.from ? back : grid.from, to: grid.to,
    category, buyer,
  };
}

/**
 * THE OLD ADDRESSES (List · Week · Month · Day, before the owner's correction):
 * the address on this screen that means the same, or null when the query is
 * already this screen's. `?view=day|week&at=X` chooses X (today when there is
 * no X); `?view=month&at=X` shows X's month; the list's `?from=F` shows the
 * month of the day it was drawn around (F + a week); an `?at=X` alone — where
 * adding a date used to land — chooses X. The kind and the customer are kept.
 */
export function legacyCalendarAddress(query: unknown, now: Date): string | null {
  const q = (query && typeof query === 'object' ? query : {}) as Record<string, unknown>;
  if (!('view' in q) && !('at' in q) && !('from' in q)) return null;
  const today = dayKey(now, workspaceZone());
  const asked = parseCalendarQuery(q, now);
  const keep = { category: asked.category, buyer: asked.buyer };
  const day = parseYmd(q['day']);
  const month = parseYm(q['month']);
  // An address that already says where it is keeps that, and only the old words go.
  if (day || month) return href({ month: day ? monthStart(month ?? day) : month === monthStart(today) ? null : month, day, ...keep });
  const view = q['view'];
  const at = parseYmd(q['at']);
  const from = parseYmd(q['from']);
  const own = (m: string): string | null => (m === monthStart(today) ? null : m);
  if (view === 'day' || view === 'week') { const d = at ?? today; return href({ month: monthStart(d), day: d, ...keep }); }
  if (view === 'month') return href({ month: own(monthStart(at ?? today)), ...keep });
  if (at) return href({ month: monthStart(at), day: at, ...keep });
  if (from) return href({ month: own(monthStart(addDays(from, PAST_DAYS))), ...keep });
  return href(keep);
}

/**
 * An address on this screen. Only month and day words, category words and
 * uuids go in, so nothing needs encoding. This month with nothing chosen is
 * the plain address; a chosen day always carries its month.
 */
function href(p: { month?: string | null; day?: string | null; category?: string | null; buyer?: string | null }): string {
  const parts = [
    p.month ? `month=${p.month.slice(0, 7)}` : '',
    p.day ? `day=${p.day}` : '',
    p.category ? `category=${p.category}` : '',
    p.buyer ? `who=${p.buyer}` : '',
  ].filter(Boolean);
  return parts.length ? `/app/calendar?${parts.join('&')}` : '/app/calendar';
}

const buyerLabel = (locale: Locale, b: CalendarBuyer): string =>
  `${b.name ?? t(locale, 'common.buyer')}${b.country && countryName(locale, b.country) ? ` · ${countryName(locale, b.country)}` : ''}`;

/** The whole line, for the pages that show one date alone (Today, the customer panel). */
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
 * what the sentence says: the figure, the state, the span — or nothing, when
 * the sentence says it all. Never an order's record code. The warmth run — a
 * reply owed says only that it is late: the sentence already says it is owed.
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
    case 'reply_due': return d.overdue ? t(locale, 'calendar.detail.late') : '';
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

/** A private-use character: where a value sits in a sentence, found again after the sentence is built. */
const MARK = '';

/**
 * A sentence with one value in it — a name, a label — escaped, and the value
 * isolated (`bdi`) where the sentence put it, so "Pedro" inside Arabic, or
 * «أحمد» inside English, keeps its own direction and is never cut. The
 * catalogue's own joining rules (a Chinese name runs on, a Latin one is set
 * off) are kept: the sentence is built with the real value, and the mark only
 * says where to look for it.
 */
function withValue(locale: Locale, key: MessageKey, param: string, value: string, more: Record<string, string> = {}): string {
  const plain = t(locale, key, { ...more, [param]: value });
  const at = t(locale, key, { ...more, [param]: MARK }).indexOf(MARK);
  const i = at < 0 || value === '' ? -1 : plain.indexOf(value, Math.max(0, at - 1));
  return i < 0 ? esc(plain) : `${esc(plain.slice(0, i))}<bdi>${esc(value)}</bdi>${esc(plain.slice(i + value.length))}`;
}

/**
 * THE SENTENCE (the warmth run): one line of context per date, in the reader's
 * language, the customer named in it — "Reply owed to Pedro", "Order from
 * Anna", "Closed: Mid-Autumn". The day heads the group, so the line carries no
 * date. The owner's own date is its own title.
 */
function sentence(locale: Locale, e: CalendarEntry): string {
  if (e.kind === 'own') return `<bdi>${esc(e.detail.title ?? '')}</bdi>`;
  return withValue(locale, sayKey(e), 'who', nameOf(locale, e));
}
/** The same sentence as plain text: a title, a screen reader's words. */
const sentenceText = (locale: Locale, e: CalendarEntry): string =>
  e.kind === 'own' ? e.detail.title ?? '' : t(locale, sayKey(e), { who: nameOf(locale, e) });

/**
 * Phase 9 (w4-customers-13, V1-201) — a price is said as far as it got, in
 * Today's word for it (a quote): "Quote sent to Carlos", "Quote for Aisha
 * waits for your OK", "Quote for Layla, not sent". It was "Price worked out
 * for …", and "✓ done" while the reply that carried it waited for review.
 */
const sayKey = (e: CalendarEntry): MessageKey => e.kind !== 'price_worked_out' ? `calendar.say.${e.kind}` as MessageKey
  : e.detail.priceState === 'review' ? 'calendar.say.price_review'
  : e.detail.priceState === 'unsent' ? 'calendar.say.price_unsent'
  : 'calendar.say.price_worked_out';

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

/** Still owed, however old: a reply due, a sample nobody has dealt with, a promise not kept by its day. */
function isOwed(e: CalendarEntry, now: Date): boolean {
  if (isDone(e, now)) return false;
  return e.kind === 'reply_due' || (e.kind === 'sample_asked' && e.detail.open === true)
    || (e.kind === 'price_worked_out' && e.detail.priceState === 'review')
    || (e.kind.startsWith('promise_') && e.day <= dayKey(now, workspaceZone()));
}

/**
 * A date's STATE, as a shape and a colour (phase 4): ○ owed, ✕ owed and late,
 * ✓ done (phase 9, inbox-calendar-new-13 — done was grey text alone, the word
 * only for a screen reader). ✦ is the assistant's hand: a price it worked out,
 * a promise it made.
 */
function marksOf(locale: Locale, e: CalendarEntry, now: Date): { readonly done: boolean; readonly marks: string } {
  const done = isDone(e, now);
  const state = isOwed(e, now) ? `${signalMark(e.detail.overdue ? 'failed' : 'waiting')} `
    : done ? `${signalMark('ok')}<span class="sr">${esc(t(locale, 'calendar.done'))}</span> ` : '';
  const hand = byHand(e) ? '<span class="as" aria-hidden="true">✦</span> ' : '';
  return { done, marks: `${state}${hand}` };
}

/** The assistant's hand: a price it worked out, a promise it made. */
const byHand = (e: CalendarEntry): boolean => e.kind === 'price_worked_out' || (e.kind.startsWith('promise_') && e.detail.byAssistant === true);

/**
 * The KIND of a date as a small drawn icon (phase 7; the warmth run moved the
 * drawings into `icons.ts`, one per kind). Drawn in the line's own colour,
 * never a colour of its own — state stays the four signals'. Hidden from a
 * screen reader: the sentence says the kind.
 */
const DATE_ICON: Readonly<Record<CalendarEntry['kind'], DateIconId>> = {
  sample_asked: 'date-sample', sample_handled: 'date-sample', order_state: 'date-order', price_worked_out: 'date-price',
  reply_due: 'date-reply', followup_due: 'date-followup', closure: 'date-closure', conversation_closed: 'date-closed',
  own: 'date-own', promise_follow_up: 'date-promise', promise_price_end: 'date-promise', promise_delivery: 'date-promise',
};
export const kindIcon = (e: CalendarEntry): string => icon(DATE_ICON[e.kind], 'kind-icon');

/**
 * Phase 7 — is this date DONE: handled, kept, closed, or simply past? A reply
 * owed, a sample nobody has dealt with, a promise not kept, a price whose reply
 * waits for review are never done however old: they are what the owner still
 * has to do. Done dates are greyed, never hidden.
 */
export function isDone(e: CalendarEntry, now: Date): boolean {
  if (e.kind === 'reply_due') return false;
  // Phase 9 (w4-customers-13) — a price is done once it was given: one waiting for review is owed, one never sent is neither.
  if (e.kind === 'price_worked_out' && (e.detail.priceState === 'review' || e.detail.priceState === 'unsent')) return false;
  if (e.kind === 'sample_asked' && e.detail.open) return false;
  if (e.kind.startsWith('promise_')) return e.detail.kept === true;
  if (e.kind === 'sample_handled' || e.kind === 'conversation_closed') return true;
  const today = dayKey(now, workspaceZone());
  if (e.kind === 'closure') return (e.detail.closureTo ?? e.day) < today;
  return e.allDay ? e.day < today : (e.detail.endsAt ?? e.at).getTime() < now.getTime();
}

/** The face a customer's date is drawn with; a follow-up to an address nobody has answered from yet has a face but no card. */
const faceOf = (b: CalendarBuyer): FaceOf => ({ clientId: b.id, name: b.name, photo: b.photo ?? null });
const addressFace = (e: CalendarEntry): FaceOf => ({ clientId: `address:${e.identity ?? ''}`, name: e.identity });

/**
 * WHO A DATE IS ABOUT, as a face (the warmth run): the customer's, opening
 * their card, with the kind's icon on its corner. A date that is nobody's —
 * a closure, the owner's own — has the kind's icon alone, in the face's place.
 */
function whoOf(locale: Locale, e: CalendarEntry): string {
  const kind = kindIcon(e);
  if (e.buyer) return `<span class="dl-who">${faceLink(faceOf(e.buyer), { size: 's', label: nameOf(locale, e) })}${kind}</span>`;
  if (e.identity) return `<span class="dl-who">${face(addressFace(e), 's')}${kind}</span>`;
  return `<span class="dl-who dl-only">${kind}</span>`;
}

/**
 * ONE DATE in the list: the hour, who it is about, the sentence and what it
 * is past that; a door where it came from a conversation or an order. Done is
 * greyed and ✓; what is owed carries its signal however old. In the owed list,
 * whose rows come from many days, the hour stands under its day ("Oct 2",
 * or "Today" in magenta).
 */
function dateRow(locale: Locale, e: CalendarEntry, now: Date, today: string | null = null): string {
  const { done, marks } = marksOf(locale, e, now);
  const hour = e.allDay ? t(locale, 'calendar.allDay')
    : `${show.time(locale, e.at)}${e.detail.endsAt ? `–${show.time(locale, e.detail.endsAt)}` : ''}`;
  const on = today === null ? ''
    : e.day === today ? `<span class="dl-on">${todayWord(locale)}</span>` : `<span class="dl-on">${esc(show.dayMonth(locale, e.day))}</span>`;
  const more = detailOf(locale, e);
  const body = `<span class="dl-body"><span class="dl-say">${marks}${sentence(locale, e)}</span>${
    more ? `<span class="small"><bdi>${esc(more)}</bdi></span>` : ''}</span>`;
  const to = doorOf(e);
  return `<li class="dl-row ${edgeOf(e)}${done ? ' done' : ''}" data-src="${esc(`${e.source.table}:${e.source.id}`)}" data-col="${esc(e.source.column)}" data-cat="${esc(e.category)}">
        <span class="dl-hour">${on}${esc(hour)}</span>${whoOf(locale, e)}
        ${to ? `<a class="dl-go" href="${to}">${body}<span class="go" aria-hidden="true">›</span></a>` : `<div class="dl-go">${body}${removeForm(locale, e)}</div>`}
      </li>`;
}

/** A day's dates in time order: the all-day ones first. */
const inOrder = (xs: readonly CalendarEntry[]): CalendarEntry[] =>
  xs.slice().sort((a, b) => (a.allDay === b.allDay ? a.at.getTime() - b.at.getTime() : a.allDay ? -1 : 1));

/** Does this entry belong on the day? A closure covers its whole span. */
const covers = (e: CalendarEntry, day: string): boolean => e.kind === 'closure'
  ? (e.detail.closureFrom ?? e.day) <= day && day <= (e.detail.closureTo ?? e.day)
  : e.day === day;

/** Today, in a word, in magenta — one of magenta's three jobs (the warmth run): beside its date in a heading, under its number in the month. */
const todayWord = (locale: Locale): string => `<span class="cal-now">${esc(t(locale, 'calendar.this.day'))}</span>`;

/** A day's name as a heading says it: "Today Sun, Oct 4", or the date. */
const dayName = (locale: Locale, v: CalendarView, day: string): string =>
  `${day === v.today ? `${todayWord(locale)} ` : ''}<span>${esc(show.date(locale, dayStart(day, workspaceZone())))}</span>`;

/** One day of the month's other dates: its date (today says so), then its dates in time order. */
function daySection(locale: Locale, v: CalendarView, day: string, items: readonly CalendarEntry[], now: Date): string {
  return `<section class="cal-dayblock">
      <h3 class="cal-day"${day === v.today ? ' aria-current="date"' : ''}>${dayName(locale, v, day)}</h3>
      <ol class="dl">${inOrder(items).map((e) => dateRow(locale, e, now)).join('')}</ol>
    </section>`;
}

/**
 * The month: its weeks, each day a door that CHOOSES it (the list beside it
 * shows that day). Each date is a small face (the card's door) and the name,
 * or the kind's icon and its name when it is nobody's. A day with more than
 * three shows two and "+N more" (choosing that day) instead of a taller row;
 * three are shown whole, never "+1 more" in place of the one it hides. What is
 * still owed is shown first. The chosen day wears a neutral ring; today keeps
 * its magenta number and word.
 */
export const MONTH_SHOWN = 2;
export const MONTH_WHOLE = 3;
function monthItem(locale: Locale, e: CalendarEntry, now: Date): string {
  const done = isDone(e, now);
  const owed = isOwed(e, now) ? ` ${signalMark(e.detail.overdue ? 'failed' : 'waiting')}` : '';
  // The mark beside the name, not inside it: on a phone the name folds away (the face says who) and the mark stays.
  const name = `<span class="mo-n"><bdi>${esc(nameOf(locale, e))}</bdi></span>${owed}`;
  const kind = `<span class="sr"> · ${esc(t(locale, `calendar.kind.${e.kind}` as MessageKey))}</span>`;
  const attrs = `class="mo-e ${edgeOf(e)}${done ? ' done' : ''}" data-src="${esc(`${e.source.table}:${e.source.id}`)}" data-col="${esc(e.source.column)}"`;
  // The face opens the card; the name, like the rest of the day, chooses the day.
  if (e.buyer) return `<span ${attrs}>${faceLink(faceOf(e.buyer), { size: 'xs', label: nameOf(locale, e) })}${name}${kind}</span>`;
  const mark = e.identity ? face(addressFace(e), 'xs') : kindIcon(e);
  return `<span ${attrs} title="${esc(sentenceText(locale, e))}">${mark}${name}${kind}</span>`;
}

function monthGrid(locale: Locale, v: CalendarView, ask: CalendarAsk, now: Date): string {
  const days: string[] = [];
  for (let d = ask.gridFrom; d < ask.gridTo; d = addDays(d, 1)) days.push(d);
  const weeks: string[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  const inMonth = (d: string) => d.slice(0, 7) === ask.month.slice(0, 7);
  const choose = (d: string) => esc(href({ month: ask.month, day: d, category: v.category, buyer: v.buyer?.id ?? null }));
  const head = `<tr>${weeks[0]!.map((d) => `<th scope="col">${esc(formatWeekday(locale, d))}</th>`).join('')}</tr>`;
  // What is still owed first, then what is not done yet, then what is done: the glance shows what the owner owes.
  const rank = (e: CalendarEntry) => (isOwed(e, now) ? 0 : isDone(e, now) ? 2 : 1);
  const body = weeks.map((w) => `<tr>${w.map((d) => {
    const here = inOrder(v.entries.filter((e) => covers(e, d))).sort((a, b) => rank(a) - rank(b));
    const shown = here.length <= MONTH_WHOLE ? here : here.slice(0, MONTH_SHOWN);
    const more = here.length - shown.length;
    const today = d === v.today;
    const chosen = d === ask.day;
    const cls = [inMonth(d) ? '' : 'other', today ? 'today' : '', chosen ? 'sel' : ''].filter(Boolean).join(' ');
    return `<td${cls ? ` class="${cls}"` : ''}${today ? ' aria-current="date"' : ''}>
        <a class="mo-d" href="${choose(d)}" aria-label="${esc(show.date(locale, dayStart(d, workspaceZone())))}"${chosen ? ' aria-current="true"' : ''}>${esc(show.count(locale, Number(d.slice(8))))}</a>${today ? todayWord(locale) : ''}
        ${shown.map((e) => monthItem(locale, e, now)).join('')}
        ${more > 0 ? `<a class="mo-more" href="${choose(d)}">${esc(t(locale, 'calendar.more', { n: more }))}</a>` : ''}
      </td>`;
  }).join('')}</tr>`).join('');
  return `<div class="wk-scroll"><table class="mo"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

/** The form that adds one of the owner's own dates. Phase 6/7 — sent back (`kept`), the field that was wrong says why under it, and what was typed is still there. */
const addFields = (locale: Locale, day: string, kept: Kept | null): string => `<form method="post" action="/app/calendar/entries" class="pform">
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
    </form>`;

export type CalendarPage = {
  /** Where the screen is: the month and the day chosen (`parseCalendarQuery`). Without it, this month, nothing chosen. */
  readonly ask?: CalendarAsk;
  readonly now?: Date;
  readonly kept?: Kept | null;
};

/** Something to choose between: more than one kind or more than one customer in the period — or a choice already made, to change or let go. */
const filterable = (v: CalendarView): boolean => v.category !== null || v.buyer !== null || v.categories.length > 1 || v.buyers.length > 1;

/** What is shown, said, when one kind or one customer is chosen. */
function chosenWhat(locale: Locale, v: CalendarView): string {
  const kind = v.category ? esc(t(locale, `calendar.cat.${v.category}` as MessageKey)) : '';
  const who = v.buyer ? `<bdi>${esc(buyerLabel(locale, v.buyer))}</bdi>` : '';
  return [kind, who].filter(Boolean).join(' · ');
}

/**
 * Phase 9 (V1-202, inbox-calendar-new-15) — ONE kind or ONE customer, chosen
 * together. Every kind is offered — "Orders" no longer comes and goes with the
 * range — except follow-ups, which exist only where the outreach area is on
 * (rule 8). The warmth run — inside the page's one fold, and drawn only when
 * there is something to choose between. It keeps the month and the day.
 */
function filterForm(locale: Locale, v: CalendarView, hidden: Record<string, string | null>): string {
  const kinds = CALENDAR_CATEGORIES.filter((c) => c !== 'followups' || outreachShown() || v.categories.includes(c) || v.category === c);
  const buyers = [...v.buyers, ...(v.buyer && !v.buyers.some((b) => b.id === v.buyer!.id) ? [v.buyer] : [])];
  return `<form method="get" action="/app/calendar" class="pform cal-filter">
        <p class="cal-sub">${esc(t(locale, 'calendar.filter.choose'))}</p>
        ${Object.entries(hidden).filter(([, val]) => val).map(([k, val]) => `<input type="hidden" name="${k}" value="${esc(val!)}" />`).join('')}
        <label class="fld"><span class="muted">${esc(t(locale, 'calendar.filter.kind'))}</span>
          <select name="category">
            <option value="">${esc(t(locale, 'calendar.cat.allKinds'))}</option>
            ${kinds.map((c) => {
              // Phase 9 (w4-customers-18) — the same list everywhere, but a kind this period does not hold cannot be chosen: five of eight led to an empty list.
              const none = c !== v.category && !v.categories.includes(c);
              const word = t(locale, `calendar.cat.${c}` as MessageKey);
              return `<option value="${c}"${c === v.category ? ' selected' : ''}${none ? ' disabled' : ''}>${esc(none ? t(locale, 'calendar.cat.none', { kind: word }) : word)}</option>`;
            }).join('')}
          </select></label>
        ${buyers.length ? `<label class="fld"><span class="muted">${esc(t(locale, 'calendar.buyer.label'))}</span>
          <select name="who">
            <option value="">${esc(t(locale, 'calendar.buyer.all'))}</option>
            ${buyers.map((b) => `<option value="${esc(b.id)}"${b.id === v.buyer?.id ? ' selected' : ''}>${esc(buyerLabel(locale, b))}</option>`).join('')}
          </select></label>` : ''}
        <button class="btn" type="submit">${esc(t(locale, 'calendar.buyer.show'))}</button>
      </form>`;
}

/**
 * What the page's marks mean, drawn with the marks themselves: where a date
 * came from (its edge), the assistant's hand (✦), owed (○) and done (✓).
 * Phase 9 (V1-200, inbox-calendar-new-14, missed-16) — the edge drawn as a
 * small square-cornered swatch, not a pill that read as a switch. Phase 9 of
 * the warmth run (w4-customers-14) — under the dates it explains, and only the
 * marks the screen shows.
 */
function legend(locale: Locale, entries: readonly CalendarEntry[], now: Date): string {
  const item = (mark: string, key: MessageKey, params: Record<string, string> = {}): string =>
    `<span class="cal-li">${mark} ${esc(t(locale, key, params))}</span>`;
  const items = [
    entries.some((e) => edgeOf(e) === 'solid') ? item('<span class="cal-sw solid" aria-hidden="true"></span>', 'calendar.legend.solid') : '',
    entries.some((e) => edgeOf(e) === 'dashed') ? item('<span class="cal-sw dashed" aria-hidden="true"></span>', 'calendar.legend.dashed') : '',
    entries.some(byHand) ? item('<span class="as" aria-hidden="true">✦</span>', 'calendar.legend.assistant', { name: assistantName(locale) }) : '',
    entries.some((e) => isOwed(e, now)) ? item(signalMark('waiting'), 'calendar.legend.owed') : '',
    entries.some((e) => isDone(e, now)) ? item(signalMark('ok'), 'calendar.legend.done') : '',
  ].filter(Boolean);
  return items.length ? `<p class="cal-legend small">${items.join('')}</p>` : '';
}

/**
 * THE PAGE'S ONE FOLD (the warmth run): the choice of one kind or one
 * customer (only when there is something to choose between), adding a date,
 * and — at its foot — what the page holds. Closed until reached for; open
 * when the add form came back with a reason.
 */
function toolsFold(locale: Locale, v: CalendarView, hidden: Record<string, string | null>, day: string, kept: Kept | null): string {
  const choose = filterable(v);
  return `<details class="cal-tools"${kept ? ' open' : ''}>
      <summary>${esc(t(locale, choose ? 'calendar.tools' : 'calendar.add'))}</summary>
      <div class="cal-tools-in">
        ${choose ? filterForm(locale, v, hidden) : ''}
        <div class="cal-add">${choose ? `<p class="cal-sub">${esc(t(locale, 'calendar.add'))}</p>` : ''}${addFields(locale, day, kept)}</div>
        <div class="cal-key"><p class="muted cal-lede">${esc(t(locale, 'calendar.lede'))}</p></div>
      </div>
    </details>`;
}

/**
 * Phase 9 (V1-199, missed-16) — how the month moves, in words: its name, then
 * "‹ Last month · This month · Next month ›", on one compact line where the
 * screen allows.
 */
function periodMove(locale: Locale, span: string, prev: string, here: string, next: string): string {
  return `<div class="cal-period">
      <p class="cal-span">${esc(span)}</p>
      <nav class="cal-move" aria-label="${esc(t(locale, 'calendar.move'))}">
        ${back(esc(prev), t(locale, 'calendar.prev.month'))}
        <a class="tab cal-today" href="${esc(here)}">${esc(t(locale, 'calendar.this.month'))}</a>
        ${deeper(esc(next), t(locale, 'calendar.next.month'))}
      </nav>
    </div>`;
}

/**
 * A WARM PANEL (the warmth run): what is clear, said plainly, and one door —
 * adding a date (on the chosen day, or the month's), or, when one kind or one
 * customer is chosen, showing everything. The month's grid stays beside it.
 */
function emptyPanel(locale: Locale, v: CalendarView, title: MessageKey, clear: string, day: string, kept: Kept | null, how = true): string {
  const narrowed = v.category !== null || v.buyer !== null;
  return `<div class="empty cal-empty">
      <span class="cal-empty-i">${icon('calendar', 'cal-empty-ic')}</span>
      <p class="cal-empty-t">${esc(t(locale, narrowed ? 'calendar.empty.filtered' : title))}</p>
      ${narrowed ? deeper(esc(clear), t(locale, 'calendar.empty.clear'))
        : `${how ? `<p class="muted">${esc(t(locale, 'calendar.empty.how'))}</p>` : ''}
      <details class="cal-add"${kept ? ' open' : ''}><summary>${esc(t(locale, 'calendar.add'))}</summary>${addFields(locale, day, kept)}</details>`}
    </div>`;
}

/** "Showing: {what}", where what is already escaped (a kind's word, a customer isolated). */
const withChosen = (locale: Locale, what: string): string => {
  const plain = esc(t(locale, 'calendar.filter.chosen', { what: MARK }));
  return plain.replace(MARK, () => what);
};

/**
 * THE LIST, NOTHING CHOSEN: what is owed first, then the month's other dates.
 *
 *   1. "Still owed" — every date read that is still owed, the late ones before
 *      today included (as far back as the week before today), each under its
 *      day. Nothing owed is said in a line.
 *   2. The month's other dates by day: today and forward first; the days of
 *      the month behind today below, folded under "Before today" (greyed
 *      where done). A month wholly behind or ahead of today is drawn as it is.
 *      Where the dates stop before the month does, the list says so.
 */
function owedList(locale: Locale, v: CalendarView, ask: CalendarAsk, now: Date): string {
  const monthName = show.month(locale, ask.month);
  const owed = inOrder(v.entries.filter((e) => isOwed(e, now)))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const owedPart = `<section class="cal-part">
      <h2 class="cal-lh">${signalMark('waiting')} ${esc(t(locale, 'calendar.legend.owed'))}</h2>
      ${owed.length ? `<ol class="dl">${owed.map((e) => dateRow(locale, e, now, v.today)).join('')}</ol>`
        : `<p class="muted cal-none">${esc(t(locale, 'calendar.owed.none', { month: monthName }))}</p>`}
    </section>`;

  const inMonth = (d: string) => d.slice(0, 7) === ask.month.slice(0, 7);
  const days = new Map<string, CalendarEntry[]>();
  for (const e of v.entries) if (inMonth(e.day) && !isOwed(e, now)) days.set(e.day, [...(days.get(e.day) ?? []), e]);
  const keys = [...days.keys()].sort();
  const last = addDays(addMonths(ask.month, 1), -1);
  const todayIn = inMonth(v.today);
  const ahead = todayIn ? keys.filter((d) => d >= v.today) : keys;
  const before = todayIn ? keys.filter((d) => d < v.today) : [];
  const section = (d: string) => daySection(locale, v, d, days.get(d) ?? [], now);
  const fold = before.length
    ? `<details class="cal-earlier"><summary>${esc(t(locale, 'calendar.earlier.fold'))}</summary>${before.map(section).join('')}</details>`
    : '';
  // Phase 9 (w4-customers-15) — the list says where its dates stop, once the month is not all behind today.
  const lastHeld = ahead.at(-1) ?? (todayIn ? addDays(v.today, -1) : null);
  const rest = last >= v.today && lastHeld !== null && lastHeld < last
    ? `<p class="muted cal-rest">${esc(t(locale, 'calendar.rest', { date: show.date(locale, dayStart(last, workspaceZone())) }))}</p>` : '';
  const otherPart = keys.length || rest
    ? `<section class="cal-part">
      <h2 class="cal-lh">${esc(t(locale, 'calendar.list.other', { month: monthName }))}</h2>
      ${ahead.map(section).join('')}${rest}${fold}
    </section>`
    : '';
  return `${owedPart}${otherPart}`;
}

/**
 * THE LIST, A DAY CHOSEN: the way back to the month's list, the day's name,
 * then its dates in time order — or a warm panel when it holds none, its one
 * door adding a date on it.
 */
function dayList(locale: Locale, v: CalendarView, ask: CalendarAsk, day: string, now: Date, kept: Kept | null, clear: string): string {
  const here = inOrder(v.entries.filter((e) => covers(e, day)));
  const toMonth = href({ month: ask.month.slice(0, 7) === v.today.slice(0, 7) ? null : ask.month, category: v.category, buyer: v.buyer?.id ?? null });
  return `<div class="cal-lhead">${back(esc(toMonth), t(locale, 'calendar.day.month', { month: show.month(locale, ask.month) }))}
      <h2 class="cal-day cal-lh"${day === v.today ? ' aria-current="date"' : ''}>${dayName(locale, v, day)}</h2></div>
    ${here.length ? `<ol class="dl">${here.map((e) => dateRow(locale, e, now)).join('')}</ol>`
      : emptyPanel(locale, v, 'calendar.empty.day', clear, day, kept, false)}`;
}

/**
 * THE SCREEN: the title; the month's name and how to move from it; what is
 * shown when one thing is chosen; the one fold (only when the month holds
 * something); then the month's grid and the list together — the grid first
 * in the page, so a phone shows it on top with the list beneath.
 */
export function renderCalendar(v: CalendarView, locale: Locale, page: CalendarPage = {}): string {
  const now = page.now ?? dayStart(v.today, workspaceZone());
  const ask = page.ask ?? parseCalendarQuery({ month: v.today.slice(0, 7) }, now);
  const kept = page.kept ?? null;
  const buyer = v.buyer?.id ?? null;
  const thisMonth = monthStart(v.today);
  const own = (m: string): string | null => (m === thisMonth ? null : m);
  const move = periodMove(locale, show.month(locale, ask.month),
    href({ month: own(addMonths(ask.month, -1)), category: v.category, buyer }),
    href({ category: v.category, buyer }),
    href({ month: own(addMonths(ask.month, 1)), category: v.category, buyer }));
  // Where the screen is, without the choice of kind or customer: the way back to everything.
  const place = { month: ask.day ? ask.month : own(ask.month), day: ask.day };
  const clear = href(place);
  const day = ask.day ?? (thisMonth === ask.month ? v.today : ask.month);
  const what = chosenWhat(locale, v);
  const inGrid = v.entries.filter((e) => e.day >= ask.gridFrom && e.day < ask.gridTo);
  const held = inGrid.length > 0 || v.entries.some((e) => isOwed(e, now));
  const shownLine = what
    ? `<p class="cal-chosen small">${withChosen(locale, what)}${held ? ` <a href="${esc(clear)}">${esc(t(locale, 'calendar.empty.clear'))}</a>` : ''}</p>`
    : '';
  const fold = held ? toolsFold(locale, v, { month: place.month ? place.month.slice(0, 7) : null, day: ask.day }, day, kept) : '';
  // A form sent back opens in one place only: the fold, when it is drawn (one form, one set of field ids).
  const list = ask.day ? dayList(locale, v, ask, ask.day, now, held ? null : kept, clear)
    : held ? owedList(locale, v, ask, now)
    : emptyPanel(locale, v, 'calendar.empty.month', clear, day, kept);
  // The legend explains the marks the list shows: the chosen day's, or what is owed and the month's other dates.
  const shown = ask.day ? v.entries.filter((e) => covers(e, ask.day!))
    : v.entries.filter((e) => isOwed(e, now) || e.day.slice(0, 7) === ask.month.slice(0, 7));
  return `<h1 class="page">${esc(t(locale, 'nav.calendar'))}</h1>
    ${move}
    ${shownLine}
    ${fold}
    <div class="cal-screen">
      <div class="cal-grid">${monthGrid(locale, v, ask, now)}</div>
      <div class="cal-list" id="cal-list">${list}${held ? legend(locale, shown, now) : ''}</div>
    </div>`;
}
