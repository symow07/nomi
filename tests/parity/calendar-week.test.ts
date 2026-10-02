import { describe, it, expect } from 'vitest';
import { renderCalendar, parseCalendarQuery, weekStart } from '../../src/api/web/calendar.js';
import { withZone } from '../../src/api/web/zone.js';
import { readEntry, firstDayOfWeek } from '../../src/db/calendarEntries.js';
import { edgeOf, type CalendarEntry, type CalendarView } from '../../src/db/calendar.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { dayKey, dayStart, addDays } from '../../src/core/owner/i18n/format.js';
import { usd } from '../../src/core/types/money.js';
import { buttonsAndDoors } from './buttons-and-doors.js';

/** TZ — the fixtures' times are written in Shanghai time: the workspace's zone, stated. */
const draw = (...a: Parameters<typeof renderCalendar>) => withZone('Asia/Shanghai', () => renderCalendar(...a));

/**
 * THE CALENDAR WEEK (the design pass, decided 2026-09-29; the plan's §5), and
 * the owner's own dates (0082). Days are columns and hours rows; where a date
 * came from is its edge (solid: a conversation; dashed: the owner); colour is
 * left for state; the week starts on the business's country's first day.
 */

const NOW = new Date('2026-09-29T04:00:00Z');   // Tuesday, 12:00 in the business timezone
const TODAY = dayKey(NOW, 'Asia/Shanghai');
const at = (ymd: string, hhmm: string): Date => new Date(dayStart(ymd, 'Asia/Shanghai').getTime()
  + (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))) * 60_000);
const MAYA = { id: '11111111-1111-4111-8111-111111111111', name: 'Maya Rahman', country: 'GB' };
const CONV = '33333333-3333-4333-8333-333333333333';
const e = (x: Partial<CalendarEntry> & Pick<CalendarEntry, 'category' | 'kind' | 'at' | 'source'>): CalendarEntry => ({
  day: dayKey(x.at, 'Asia/Shanghai'), allDay: false, conversationId: CONV, orderId: null, buyer: MAYA, identity: null, detail: {}, ...x,
});

const MON = weekStart(TODAY, 1);
const ENTRIES: CalendarEntry[] = [
  e({ category: 'samples', kind: 'sample_asked', at: at(MON, '09:12'), source: { table: 'sample_requests', id: 's1', column: 'requested_at' } }),
  e({ category: 'negotiation', kind: 'price_worked_out', at: at(TODAY, '12:40'), detail: { price: usd(34.9), quantity: 10 },
    source: { table: 'quotes', id: 'q1', column: 'created_at' } }),
  e({ category: 'negotiation', kind: 'reply_due', at: at(TODAY, '16:00'), source: { table: 'handoffs', id: 'h1', column: 'sla_deadline_at' } }),
  e({ category: 'yours', kind: 'own', at: at(addDays(TODAY, 1), '11:00'), conversationId: null, buyer: null,
    detail: { title: 'Photo shoot', endsAt: at(addDays(TODAY, 1), '13:00'), entryId: '55555555-5555-4555-8555-555555555555' },
    source: { table: 'calendar_entries', id: '55555555-5555-4555-8555-555555555555', column: 'starts_at' } }),
  e({ category: 'closures', kind: 'closure', at: dayStart(addDays(MON, 5), 'Asia/Shanghai'), day: addDays(MON, 5), allDay: true, conversationId: null, buyer: null,
    detail: { closureLabel: 'Stocktake', closureFrom: addDays(MON, 5), closureTo: addDays(MON, 6) },
    source: { table: 'factory_closures', id: 'c1', column: 'starts_on' } }),
];
const week = (over: Partial<CalendarView> = {}): CalendarView => ({
  from: MON, to: addDays(MON, 7), today: TODAY, category: null, buyer: null, buyers: [MAYA],
  categories: ['samples', 'negotiation', 'yours', 'closures'], entries: ENTRIES, ...over,
});

describe('the week, by default', () => {
  it('the page opens on the week holding today, starting on the business\'s first day', () => {
    expect(parseCalendarQuery({}, NOW)).toEqual({ view: 'week', at: TODAY, from: MON, to: addDays(MON, 7), category: null, buyer: null });
    // Sunday-first (the US, Saudi Arabia) and Saturday-first (Egypt)
    expect(new Date(`${parseCalendarQuery({}, NOW, 7).from}T00:00:00Z`).getUTCDay()).toBe(0);
    expect(new Date(`${parseCalendarQuery({}, NOW, 6).from}T00:00:00Z`).getUTCDay()).toBe(6);
    expect(parseCalendarQuery({ view: 'day', at: '2026-10-02' }, NOW)).toMatchObject({ view: 'day', from: '2026-10-02', to: '2026-10-03' });
    const m = parseCalendarQuery({ view: 'month', at: '2026-10-15' }, NOW);
    expect(m.at).toBe('2026-10-01');
    expect(m.from <= '2026-10-01' && m.to > '2026-10-31').toBe(true);
    expect(parseCalendarQuery({ view: 'year' }, NOW).view).toBe('week');
  });

  it('the first day comes from the country the business gave, not the language', () => {
    expect(firstDayOfWeek('CN')).toBe(1);
    expect(firstDayOfWeek('GB')).toBe(1);
    expect(firstDayOfWeek('US')).toBe(7);
    expect(firstDayOfWeek('SA')).toBe(7);
    expect(firstDayOfWeek('EG')).toBe(6);
    expect(firstDayOfWeek(null)).toBe(1);
    expect(firstDayOfWeek('not a country')).toBe(1);
  });

  it('days are columns, hours are rows; today is marked by a line under its date and in words for a reader', () => {
    const html = draw(week(), 'en', { view: 'week', at: TODAY, now: NOW });
    const head = html.slice(html.indexOf('<thead>'), html.indexOf('</thead>'));
    expect(head.match(/<th scope="col"/g)).toHaveLength(8);   // the hours' corner + seven days
    expect(head).toMatch(/<th scope="col" class="today" aria-current="date">/);
    expect(html).toMatch(/<tr><th scope="row">09<\/th>/);
    expect(html).toMatch(/<tr class="wk-all"><th scope="row">All day<\/th>/);
    expect(html).toContain('<a class="tab on" aria-current="page" href="/app/calendar?at=');
  });

  it('where a date came from is its edge: solid from a conversation (and opens there), dashed when the owner put it there', () => {
    const html = draw(week(), 'en', { view: 'week', at: TODAY, now: NOW });
    expect(html).toMatch(new RegExp(`<a class="wk-e solid past" data-src="sample_requests:s1"[^>]*href="/app/inbox/${CONV}#latest">`));
    expect(html).toMatch(/<div class="wk-e dashed" data-src="calendar_entries:55555555-5555-4555-8555-555555555555"/);
    expect(html).toContain('<b><bdi>Photo shoot</bdi></b><span class="wk-t">11:00–13:00</span>');
    // the closure is drawn on each day it covers, dashed
    expect(html.match(/data-src="factory_closures:c1"/g)).toHaveLength(2);
    expect(edgeOf({ kind: 'closure', conversationId: null, orderId: null })).toBe('dashed');
    expect(edgeOf({ kind: 'sample_asked', conversationId: CONV, orderId: null })).toBe('solid');
  });

  it('colour is left for state and the assistant: ○ on a reply that is due, ✦ on a price it worked out', () => {
    const html = draw(week(), 'en', { view: 'week', at: TODAY, now: NOW });
    expect(html).toMatch(/data-src="handoffs:h1"[\s\S]*?<span class="wk-k"><span class="dot warn" aria-hidden="true">○<\/span> Reply due<\/span>/);
    expect(html).toMatch(/data-src="quotes:q1"[\s\S]*?<span class="wk-k"><span class="as" aria-hidden="true">✦<\/span> Price worked out<\/span>/);
  });

  it('an owner\'s date can be taken off: a button in a form, at once — the notice that follows carries Undo (phase 5); every other date is a door or nothing', () => {
    const html = draw(week(), 'en', { view: 'week', at: TODAY, now: NOW });
    expect(html).toContain('action="/app/calendar/entries/55555555-5555-4555-8555-555555555555/remove"');
    expect(html).not.toContain('data-confirm');
    expect(html).toContain('<form method="post" action="/app/calendar/entries" class="pform">');
    expect(buttonsAndDoors(html)).toEqual([]);
  });

  it('‹ Last week · This week · Next week › move a week, in words (phase 9, V1-199); in Arabic the same doors, mirrored by the chevrons', () => {
    const html = draw(week(), 'en', { view: 'week', at: TODAY, now: NOW });
    expect(html).toContain(`<a class="back" href="/app/calendar?at=${addDays(TODAY, -7)}"><span class="go" aria-hidden="true">‹</span>Last week</a>`);
    expect(html).toContain(`<a class="deeper" href="/app/calendar?at=${addDays(TODAY, 7)}">Next week<span class="go" aria-hidden="true">›</span></a>`);
    expect(html).toContain('<a class="tab cal-today" href="/app/calendar">This week</a>');
    // the period's name comes first, as the label of what the doors move
    expect(html.indexOf('<p class="cal-span">')).toBeLessThan(html.indexOf('<nav class="cal-move"'));
    const ar = draw(week(), 'ar', { view: 'week', at: TODAY, now: NOW });
    expect(ar).toContain(t('ar', 'calendar.this.week'));
    expect(ar).toContain('<span class="go" aria-hidden="true">‹</span>');
  });

  it('the month shows its days, up to two dates each, and "+N more" — a door to the rest — instead of a taller row (phase 7)', () => {
    const busy = Array.from({ length: 5 }, (_, i) => e({ category: 'samples', kind: 'sample_asked', at: at(TODAY, `0${i + 1}:00`),
      source: { table: 'sample_requests', id: `m${i}`, column: 'requested_at' } }));
    const q = parseCalendarQuery({ view: 'month', at: TODAY }, NOW);
    const html = draw(week({ from: q.from, to: q.to, entries: busy }), 'en', { view: 'month', at: q.at, now: NOW });
    expect(html).toContain('<table class="mo">');
    expect(html).toContain(`<a class="mo-more" href="/app/calendar?view=day&amp;at=${TODAY}">+3 more</a>`);
    expect(html).toMatch(/<td class=" today" aria-current="date">/);
  });
});

describe('an owner\'s own date, as the form sends it', () => {
  it('a name, a day, and times — or the whole day', () => {
    const whole = readEntry({ title: ' Stocktake ', day: '2026-10-03', from: '', to: '' }, 'Asia/Shanghai');
    expect(whole).toEqual({ ok: true, entry: { title: 'Stocktake', startsAt: dayStart('2026-10-03', 'Asia/Shanghai'), endsAt: null, allDay: true } });
    const timed = readEntry({ title: 'Photo shoot', day: '2026-09-30', from: '11:00', to: '13:00' }, 'Asia/Shanghai');
    expect(timed.ok && timed.entry.startsAt.getTime() - dayStart('2026-09-30', 'Asia/Shanghai').getTime()).toBe(11 * 3_600_000);
    expect(timed.ok && timed.entry.endsAt!.getTime() - dayStart('2026-09-30', 'Asia/Shanghai').getTime()).toBe(13 * 3_600_000);
    expect(readEntry({ title: 'Call', day: '2026-09-30', from: '09:30' }, 'Asia/Shanghai')).toMatchObject({ ok: true, entry: { allDay: false, endsAt: null } });
  });

  it('refuses what it cannot keep honestly, and says which', () => {
    expect(readEntry({ title: '', day: '2026-09-30' }, 'Asia/Shanghai')).toEqual({ ok: false, problem: 'title' });
    expect(readEntry({ title: 'x'.repeat(81), day: '2026-09-30' }, 'Asia/Shanghai')).toEqual({ ok: false, problem: 'title' });
    expect(readEntry({ title: 'Fair', day: '2026-02-30' }, 'Asia/Shanghai')).toEqual({ ok: false, problem: 'day' });
    expect(readEntry({ title: 'Fair', day: '30/09/2026' }, 'Asia/Shanghai')).toEqual({ ok: false, problem: 'day' });
    expect(readEntry({ title: 'Fair', day: '2026-09-30', from: '9am' }, 'Asia/Shanghai')).toEqual({ ok: false, problem: 'time' });
    expect(readEntry({ title: 'Fair', day: '2026-09-30', to: '10:00' }, 'Asia/Shanghai')).toEqual({ ok: false, problem: 'time' });
    expect(readEntry({ title: 'Fair', day: '2026-09-30', from: '14:00', to: '10:00' }, 'Asia/Shanghai')).toEqual({ ok: false, problem: 'order' });
  });
});

/* ── PHASE 7 OF THE UI REBUILD (2026-10-02) — the calendar on a phone ─────── */

describe('phase 7 · the day as one list in time order', () => {
  const day = (ymd: string, entries: CalendarEntry[] = ENTRIES) =>
    draw(week({ from: ymd, to: addDays(ymd, 1), entries }), 'en', { view: 'day', at: ymd, now: NOW });

  it('the hour, a kind icon, the name whole, what it is — all-day dates first, then by time; no grid of empty hours', () => {
    const late = e({ category: 'negotiation', kind: 'price_worked_out', at: at(TODAY, '18:05'), detail: { price: usd(2), quantity: 5 },
      source: { table: 'quotes', id: 'q2', column: 'created_at' } });
    const html = day(TODAY, [late, ...ENTRIES]);
    expect(html).toContain('<ol class="dl">');
    expect(html).not.toContain('<table class="wk">');
    const rows = [...html.matchAll(/<li class="dl-row[^"]*" data-src="([^"]+)"/g)].map((m) => m[1]);
    expect(rows).toEqual(['quotes:q1', 'handoffs:h1', 'quotes:q2']);      // 12:40, 16:00, 18:05
    expect(html).toContain('<svg class="kind-icon"');
    expect(html).toContain('<b><bdi>Maya Rahman</bdi></b>');
  });

  it('done is greyed, never hidden; what is owed carries its signal however old', () => {
    // "Now" is 12:00 on TODAY.
    const mine = [
      e({ category: 'negotiation', kind: 'price_worked_out', at: at(TODAY, '09:00'), detail: { price: usd(1), quantity: 1 },
        source: { table: 'quotes', id: 'past', column: 'created_at' } }),
      e({ category: 'negotiation', kind: 'price_worked_out', at: at(TODAY, '15:00'), detail: { price: usd(1), quantity: 1 },
        source: { table: 'quotes', id: 'later', column: 'created_at' } }),
      e({ category: 'negotiation', kind: 'reply_due', at: at(TODAY, '08:00'), detail: { overdue: true },
        source: { table: 'handoffs', id: 'owed', column: 'sla_deadline_at' } }),
      e({ category: 'samples', kind: 'sample_handled', at: at(TODAY, '10:00'), source: { table: 'sample_requests', id: 'sent', column: 'handled_at' } }),
    ];
    const html = day(TODAY, mine);
    const cls = (id: string) => new RegExp(`<li class="([^"]+)" data-src="[a-z_]+:${id}"`).exec(html)?.[1];
    expect(cls('past')).toBe('dl-row solid done');
    expect(cls('sent')).toBe('dl-row solid done');
    expect(cls('later')).toBe('dl-row solid');
    expect(cls('owed')).toBe('dl-row solid');                     // four hours late, and still owed
    expect(html).toMatch(/data-src="handoffs:owed"[\s\S]*?<span class="dot bad" aria-hidden="true">✕<\/span>/);
    expect(html).toMatch(/data-src="quotes:past"[\s\S]*?<span class="sr">Done:<\/span>/);
  });
});

describe('phase 7 · on a phone the grids scroll visibly, and no name is cut', () => {
  it('a chip\'s name wraps — never an ellipsis — and the hours stay in view', async () => {
    expect(draw(week(), 'en', { view: 'week', at: TODAY, now: NOW })).toContain('<div class="wk-scroll"><table class="wk">');
    const { shell } = await import('../../src/api/web/layout.js');
    const { linkedCss } = await import('./linked-css.js');
    const css = linkedCss(shell({ title: 'T', active: 'home', locale: 'en', path: '/app', bodyHtml: '' })).replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = (sel: string) => new RegExp(`(?:^|\\s)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
    expect(rule('.wk-e b')).not.toMatch(/ellipsis|nowrap/);
    expect(rule('.wk-k, .wk-t')).not.toMatch(/ellipsis|nowrap/);
    expect(rule('.wk-e')).not.toContain('overflow:hidden');
    expect(rule('.wk-scroll')).toContain('background-attachment:local, local, scroll, scroll');
    expect(rule('.wk tbody th, .wk .wk-corner')).toContain('position:sticky');
  });

  it('the add form comes back open, the reason under its field, what was typed kept', () => {
    const html = draw(week(), 'en', { view: 'week', at: TODAY, now: NOW,
      kept: { values: { title: 'Kiln', day: TODAY, from: '15:00', to: '14:00' }, field: 'to', text: t('en', 'calendar.flash.order') } });
    expect(html).toContain('<details class="cal-add" open>');
    expect(html).toContain('value="Kiln"');
    expect(html).toContain('name="to" value="14:00" aria-invalid="true" aria-describedby="ca-to-err" autofocus');
    expect(html).toContain(`<span class="fielderr" role="alert" id="ca-to-err">${t('en', 'calendar.flash.order')}</span>`);
  });
});
