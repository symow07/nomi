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

  it('colour is left for state and the assistant: ● on a reply that is due, ✦ on a price it worked out', () => {
    const html = draw(week(), 'en', { view: 'week', at: TODAY, now: NOW });
    expect(html).toMatch(/data-src="handoffs:h1"[\s\S]*?<span class="wk-k"><span class="dot warn" aria-hidden="true">●<\/span> Reply due<\/span>/);
    expect(html).toMatch(/data-src="quotes:q1"[\s\S]*?<span class="wk-k"><span class="as" aria-hidden="true">✦<\/span> Price worked out<\/span>/);
  });

  it('an owner\'s date can be taken off: a button in a form that asks first; every other date is a door or nothing', () => {
    const html = draw(week(), 'en', { view: 'week', at: TODAY, now: NOW });
    expect(html).toContain('action="/app/calendar/entries/55555555-5555-4555-8555-555555555555/remove"');
    expect(html).toMatch(/onclick="return confirm\(this\.dataset\.confirm\)"\s+data-confirm="Take “Photo shoot” off the calendar\?"/);
    expect(html).toContain('<form method="post" action="/app/calendar/entries" class="pform">');
    expect(buttonsAndDoors(html)).toEqual([]);
  });

  it('‹ Today › move a week; in Arabic the same doors, mirrored by the chevrons', () => {
    const html = draw(week(), 'en', { view: 'week', at: TODAY, now: NOW });
    expect(html).toContain(`href="/app/calendar?at=${addDays(TODAY, -7)}" aria-label="Earlier"`);
    expect(html).toContain(`href="/app/calendar?at=${addDays(TODAY, 7)}" aria-label="Later"`);
    expect(html).toContain('<a class="cal-today" href="/app/calendar">Today</a>');
    const ar = draw(week(), 'ar', { view: 'week', at: TODAY, now: NOW });
    expect(ar).toContain(t('ar', 'calendar.todayDoor'));
    expect(ar).toContain('<span class="go" aria-hidden="true">‹</span>');
  });

  it('the month shows its days, up to three dates each, and a door to the rest', () => {
    const busy = Array.from({ length: 5 }, (_, i) => e({ category: 'samples', kind: 'sample_asked', at: at(TODAY, `0${i + 1}:00`),
      source: { table: 'sample_requests', id: `m${i}`, column: 'requested_at' } }));
    const q = parseCalendarQuery({ view: 'month', at: TODAY }, NOW);
    const html = draw(week({ from: q.from, to: q.to, entries: busy }), 'en', { view: 'month', at: q.at, now: NOW });
    expect(html).toContain('<table class="mo">');
    expect(html).toContain(`<a class="mo-more" href="/app/calendar?view=day&amp;at=${TODAY}">2 more</a>`);
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
