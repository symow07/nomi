import { type Locale } from '../../core/owner/i18n/locale.js';
import { countryName, orderStatusName, type MessageKey } from '../../core/owner/i18n/messages.js';
import { addDays, dayKey, dayStart, formatDate, formatMoney, formatQty, formatTime } from '../../core/owner/i18n/format.js';
import { t } from './say.js';
import { esc, deeper, back } from './layout.js';
import { flag } from './inbox.js';
import {
  CALENDAR_CATEGORIES, type CalendarCategory, type CalendarEntry, type CalendarView, type CalendarBuyer,
} from '../../db/calendar.js';

/**
 * V2 — the calendar page. Pure: a `CalendarView` in, HTML out.
 *
 * One list of days, each entry a time (or "all day"), a category, the buyer,
 * one line, and a door to the conversation — or to the order, for an order.
 * Read-only: there is no form here that writes anything; the one form is a
 * GET that narrows the list to a buyer.
 *
 * The category is drawn with the shell's neutral `.chip`, never a state
 * colour: a category is not a state. Decision 5 (the row, and the inbox's
 * tags) is still open with the designer; when it lands, this chip swaps to
 * V1's row tag, and the inbox's `.tag` is not borrowed in the meantime.
 */

/** Three weeks a page: the past week, and the coming two. */
const WINDOW_DAYS = 21;
const PAST_DAYS = 7;

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The window that opens by default, for a given day. */
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

/**
 * The query string, whitelisted. Anything that is not exactly a day, one of
 * the categories, or a buyer id falls back to the default — never an error
 * page, and never a value passed on to SQL unchecked.
 */
export function parseCalendarQuery(query: unknown, now: Date): {
  from: string; to: string; category: CalendarCategory | null; buyer: string | null;
} {
  const q = (query && typeof query === 'object' ? query : {}) as Record<string, unknown>;
  const from = parseYmd(q['from']) ?? defaultFrom(dayKey(now));
  const cat = q['category'];
  const category = typeof cat === 'string' && (CALENDAR_CATEGORIES as readonly string[]).includes(cat)
    ? cat as CalendarCategory : null;
  const b = typeof q['buyer'] === 'string' ? q['buyer'].toLowerCase() : '';
  return { from, to: addDays(from, WINDOW_DAYS), category, buyer: UUID.test(b) ? b : null };
}

/** An address on this page. Only days, category words and uuids go in, so nothing needs encoding. */
const href = (p: { from?: string | null; category?: string | null; buyer?: string | null }): string => {
  const parts = [
    p.from ? `from=${p.from}` : '',
    p.category ? `category=${p.category}` : '',
    p.buyer ? `buyer=${p.buyer}` : '',
  ].filter(Boolean);
  return parts.length ? `/app/calendar?${parts.join('&')}` : '/app/calendar';
};

const buyerLabel = (locale: Locale, b: CalendarBuyer): string =>
  `${b.name ?? t(locale, 'common.buyer')}${b.country && countryName(locale, b.country) ? ` · ${countryName(locale, b.country)}` : ''}`;

function line(locale: Locale, e: CalendarEntry): string {
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

function entry(locale: Locale, e: CalendarEntry): string {
  const when = e.allDay ? t(locale, 'calendar.allDay') : formatTime(locale, e.at);
  const body = `<span class="person">
        <span class="cal-head"><span class="chip">${esc(t(locale, `calendar.cat.${e.category}` as MessageKey))}</span>${who(locale, e)}</span>
        <span class="small">${esc(line(locale, e))}</span></span>`;
  const to = e.orderId ? `/app/orders/${encodeURIComponent(e.orderId)}`
    : e.conversationId ? `/app/inbox/${encodeURIComponent(e.conversationId)}` : null;
  return `<li class="row" data-src="${esc(`${e.source.table}:${e.source.id}`)}" data-col="${esc(e.source.column)}">
      <span class="cal-when">${esc(when)}</span>
      ${to
        ? `<a class="grow cal-go" href="${to}">${body}<span class="go" aria-hidden="true">›</span></a>`
        : `<div class="grow">${body}</div>`}
    </li>`;
}

export function renderCalendar(v: CalendarView, locale: Locale): string {
  const isDefault = v.from === defaultFrom(v.today);
  const last = addDays(v.to, -1);
  const buyerId = v.buyer?.id ?? null;

  // Category: All, and each kind this window holds for this buyer. The chosen
  // one stays offered even when it holds nothing, so it can be seen to be on.
  const shown = CALENDAR_CATEGORIES.filter((c) => v.categories.includes(c) || c === v.category);
  const tab = (c: CalendarCategory | null) => {
    const on = v.category === c;
    return `<a class="tab${on ? ' on' : ''}"${on ? ' aria-current="page"' : ''} href="${esc(href({ from: isDefault ? null : v.from, category: c, buyer: buyerId }))}">${
      esc(t(locale, c === null ? 'calendar.cat.all' : `calendar.cat.${c}` as MessageKey))}</a>`;
  };
  const tabs = shown.length || v.category !== null
    ? `<nav class="tabs cal-tabs" aria-label="${esc(t(locale, 'calendar.filter.category'))}">${tab(null)}${shown.map(tab).join('')}</nav>` : '';

  // Buyer: a GET form, folded away until it is in use.
  const buyerForm = v.buyers.length || v.buyer ? `<details class="cal-buyer"${v.buyer ? ' open' : ''}>
      <summary>${esc(v.buyer ? t(locale, 'calendar.buyer.chosen', { buyer: buyerLabel(locale, v.buyer) }) : t(locale, 'calendar.buyer.choose'))}</summary>
      <form method="get" action="/app/calendar" class="pform">
        ${isDefault ? '' : `<input type="hidden" name="from" value="${esc(v.from)}" />`}
        ${v.category ? `<input type="hidden" name="category" value="${esc(v.category)}" />` : ''}
        <label class="fld"><span class="muted">${esc(t(locale, 'calendar.buyer.label'))}</span>
          <select name="buyer">
            <option value="">${esc(t(locale, 'calendar.buyer.all'))}</option>
            ${[...v.buyers, ...(v.buyer && !v.buyers.some((b) => b.id === v.buyer!.id) ? [v.buyer] : [])].map((b) =>
              `<option value="${esc(b.id)}"${b.id === buyerId ? ' selected' : ''}>${esc(`${flag(b.country) ? `${flag(b.country)} ` : ''}${buyerLabel(locale, b)}`)}</option>`).join('')}
          </select></label>
        <button class="btn" type="submit">${esc(t(locale, 'calendar.buyer.show'))}</button>
      </form>
    </details>` : '';

  // The window, and the doors either side of it.
  const range = `<p class="small cal-span">${esc(t(locale, 'calendar.range', {
    from: formatDate(locale, dayStart(v.from)), to: formatDate(locale, dayStart(last)),
  }))}</p>`;
  const earlier = addDays(v.from, -WINDOW_DAYS);
  const later = addDays(v.from, WINDOW_DAYS);
  const pager = `<nav class="cal-range" aria-label="${esc(t(locale, 'calendar.filter.window'))}">
      ${back(esc(href({ from: earlier === defaultFrom(v.today) ? null : earlier, category: v.category, buyer: buyerId })), t(locale, 'calendar.earlier'))}
      ${isDefault ? '' : deeper(esc(href({ category: v.category, buyer: buyerId })), t(locale, 'calendar.now'))}
      ${deeper(esc(href({ from: later === defaultFrom(v.today) ? null : later, category: v.category, buyer: buyerId })), t(locale, 'calendar.later'))}
    </nav>`;

  const head = `<h1 class="page">${esc(t(locale, 'nav.calendar'))}</h1>
    <p class="muted">${esc(t(locale, 'calendar.lede'))}</p>
    ${tabs}${buyerForm}${range}`;

  if (v.entries.length === 0) {
    const narrowed = v.category !== null || v.buyer !== null;
    return `${head}
      <div class="empty">${esc(t(locale, narrowed ? 'calendar.empty.filtered' : 'calendar.empty'))}
        <div>${narrowed
          ? deeper(esc(href({ from: isDefault ? null : v.from })), t(locale, 'calendar.empty.clear'))
          : deeper('/app/inbox', t(locale, 'calendar.empty.door'))}</div></div>
      ${pager}`;
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
        ? `<ul class="rows">${items.map((e) => entry(locale, e)).join('')}</ul>`
        : `<p class="muted">${esc(t(locale, 'calendar.todayNothing'))}</p>`}
    </section>`;
  }).join('');

  return `${head}${sections}${pager}`;
}
