import { describe, it, expect } from 'vitest';
import { renderCalendar, parseCalendarQuery, legacyCalendarAddress, MONTH_SHOWN, MONTH_WHOLE } from '../../src/api/web/calendar.js';
import { shell } from '../../src/api/web/layout.js';
import { withZone } from '../../src/api/web/zone.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { dayKey, dayStart, addDays } from '../../src/core/owner/i18n/format.js';
import * as show from '../../src/api/web/values.js';
import { usd } from '../../src/core/types/money.js';
import type { CalendarEntry, CalendarView, CalendarKind } from '../../src/db/calendar.js';
import { linkedCss } from './linked-css.js';
import { withoutIsolates } from './isolates.js';

/**
 * THE CALENDAR, ONE SCREEN (the owner's correction, 2026-10-04):
 *
 *   "Earlier I asked for List as the default view instead of Month. That was
 *   wrong. The owner wants the month grid and the list working TOGETHER on one
 *   screen, not a switcher between them. … the grid for the glance, the list
 *   for what is owed. Selecting a day focuses the list on that day. On desktop
 *   side by side or stacked; on a phone the grid on top with the selected
 *   day's list beneath it. Keep everything else already agreed: faces and
 *   context on every dated item, chrome collapsed, warm empty state, rounded
 *   grid, visible scrolling on phone, no cut names including Latin names
 *   inside Arabic, '+N more' on crowded days, the day list time-ordered with a
 *   kind icon and done items greyed."
 *
 * Phase 6 of the warmth run's agreements are held here too. Every assertion
 * reads the page as it is drawn, in all five languages.
 */

const ZONE = 'Asia/Shanghai';
const NOW = new Date('2026-10-03T04:00:00Z');                 // Saturday, 12:00 in the business's zone
const TODAY = dayKey(NOW, ZONE);                              // 2026-10-03
const at = (ymd: string, hhmm: string): Date => new Date(dayStart(ymd, ZONE).getTime() + (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))) * 60_000);

const PEDRO = { id: '11111111-1111-4111-8111-111111111111', name: 'Pedro Alvarez', country: 'MX', photo: 'a1b2c3d4e5f6' };
const AHMED = { id: '22222222-2222-4222-8222-222222222222', name: 'أحمد الصباغ', country: 'AE', photo: null };
const CHEN = { id: '44444444-4444-4444-8444-444444444444', name: '陈莉', country: 'CN', photo: null };
const CONV = '33333333-3333-4333-8333-333333333333';
const e = (x: Partial<CalendarEntry> & Pick<CalendarEntry, 'category' | 'kind' | 'at' | 'source'>): CalendarEntry => ({
  day: dayKey(x.at, ZONE), allDay: false, conversationId: CONV, orderId: null, buyer: PEDRO, identity: null, detail: {}, ...x,
});

/** One of each kind a customer can have, today and after; one closure; one of the owner's own; one before today, still owed. */
const DATES: CalendarEntry[] = [
  e({ category: 'samples', kind: 'sample_handled', at: at(TODAY, '08:00'), buyer: CHEN, source: { table: 'sample_requests', id: 's0', column: 'handled_at' } }),
  e({ category: 'samples', kind: 'sample_asked', at: at(TODAY, '09:12'), buyer: AHMED, detail: { open: true }, source: { table: 'sample_requests', id: 's1', column: 'requested_at' } }),
  e({ category: 'negotiation', kind: 'price_worked_out', at: at(TODAY, '15:40'), buyer: CHEN, detail: { price: usd(1.95), quantity: 2000 },
    source: { table: 'quotes', id: 'q1', column: 'created_at' } }),
  e({ category: 'negotiation', kind: 'reply_due', at: at(TODAY, '16:00'), source: { table: 'handoffs', id: 'h1', column: 'sla_deadline_at' } }),
  e({ category: 'orders', kind: 'order_state', at: at(addDays(TODAY, 1), '11:00'), orderId: 'o1', buyer: AHMED,
    detail: { orderReference: 'R-1', orderState: 'shipped' }, source: { table: 'order_updates', id: 'u1', column: 'at' } }),
  e({ category: 'followups', kind: 'followup_due', at: at(addDays(TODAY, 2), '10:00'), source: { table: 'sequence_enrollments', id: 'f1', column: 'next_due_at' } }),
  e({ category: 'conversations', kind: 'conversation_closed', at: at(addDays(TODAY, 2), '18:00'), buyer: CHEN, source: { table: 'conversations', id: 'c9', column: 'closed_at' } }),
  e({ category: 'promised', kind: 'promise_follow_up', at: dayStart(addDays(TODAY, 3), ZONE), day: addDays(TODAY, 3), allDay: true,
    detail: { said: 'I will write on Tuesday.', byAssistant: true, kept: false }, source: { table: 'promised_dates', id: 'p1', column: 'due_on' } }),
  e({ category: 'promised', kind: 'promise_price_end', at: dayStart(addDays(TODAY, 3), ZONE), day: addDays(TODAY, 3), allDay: true, buyer: AHMED,
    detail: { said: 'This price holds until Tuesday.', kept: false }, source: { table: 'promised_dates', id: 'p2', column: 'due_on' } }),
  e({ category: 'promised', kind: 'promise_delivery', at: dayStart(addDays(TODAY, 4), ZONE), day: addDays(TODAY, 4), allDay: true, buyer: CHEN,
    detail: { said: 'Delivery on the 7th.', kept: false }, source: { table: 'promised_dates', id: 'p3', column: 'due_on' } }),
  e({ category: 'closures', kind: 'closure', at: dayStart(addDays(TODAY, 5), ZONE), day: addDays(TODAY, 5), allDay: true, conversationId: null, buyer: null,
    detail: { closureLabel: 'Mid-Autumn', closureFrom: addDays(TODAY, 5), closureTo: addDays(TODAY, 6) }, source: { table: 'factory_closures', id: 'cl1', column: 'starts_on' } }),
  e({ category: 'yours', kind: 'own', at: at(addDays(TODAY, 6), '11:00'), conversationId: null, buyer: null,
    detail: { title: 'Photo shoot', entryId: '66666666-6666-4666-8666-666666666666' }, source: { table: 'calendar_entries', id: '66666666-6666-4666-8666-666666666666', column: 'starts_at' } }),
  // before today, and still owed: a reply three days late
  e({ category: 'negotiation', kind: 'reply_due', at: at(addDays(TODAY, -3), '09:00'), buyer: AHMED, detail: { overdue: true },
    source: { table: 'handoffs', id: 'h0', column: 'sla_deadline_at' } }),
];
const CUSTOMER_KINDS: readonly CalendarKind[] = ['sample_asked', 'sample_handled', 'order_state', 'price_worked_out', 'reply_due',
  'followup_due', 'conversation_closed', 'promise_follow_up', 'promise_price_end', 'promise_delivery'];
const OWED = ['handoffs:h0', 'sample_requests:s1', 'handoffs:h1'];

const view = (from: string, to: string, over: Partial<CalendarView> = {}): CalendarView => ({
  from, to, today: TODAY, category: null, buyer: null, buyers: [PEDRO, AHMED, CHEN],
  categories: ['promised', 'samples', 'orders', 'negotiation', 'followups', 'yours', 'closures', 'conversations'],
  entries: DATES.filter((x) => x.day >= from && x.day < to), ...over,
});
/** The screen at an address (`{ month, day, … }`), drawn from what the loader would read for it. */
const draw = (l: Locale, query: Record<string, string> = {}, over: Partial<CalendarView> = {}): string =>
  withZone(ZONE, () => {
    const ask = parseCalendarQuery(query, NOW);
    return renderCalendar(view(ask.from, ask.to, over), l, { ask, now: NOW });
  });
const plain = (html: string): string => withoutIsolates(html).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
const nameOf = (x: CalendarEntry): string => x.kind === 'closure' ? x.detail.closureLabel! : x.kind === 'own' ? x.detail.title! : x.buyer?.name ?? x.identity ?? '';
const rowsOf = (html: string) => [...html.matchAll(/<li class="dl-row (solid|dashed)( done)?" data-src="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)]
  .map((m) => ({ src: m[3]!, done: m[2] === ' done', html: m[4]! }));
/** The list column, and the grid, of a drawn screen. */
const listOf = (html: string): string => html.slice(html.indexOf('<div class="cal-list"'));
const gridOf = (html: string): string => html.slice(html.indexOf('<div class="cal-grid">'), html.indexOf('<div class="cal-list"'));
const cellOf = (html: string, day: string): string =>
  new RegExp(`<td[^>]*>\\s*<a class="mo-d" href="/app/calendar\\?month=${day.slice(0, 7)}&amp;day=${day}"[\\s\\S]*?</td>`).exec(html)?.[0] ?? '';
const CSS = linkedCss(shell({ title: 'T', active: 'calendar', locale: 'en', path: '/app/calendar', bodyHtml: '' })).replace(/\/\*[\s\S]*?\*\//g, '');
/** A rule's body, by its whole selector: the selector starts its line, so `.cal-list > .empty.cal-empty` is not `.empty.cal-empty`. */
const rule = (sel: string) => new RegExp(`(?:^|\\n)\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`).exec(CSS)?.[1] ?? '';

describe('one screen: the month grid and the list together', () => {
  it('the plain address is this month with nothing chosen; it reads the grid\'s weeks and the week before today', () => {
    expect(parseCalendarQuery({}, NOW)).toEqual({
      month: '2026-10-01', day: null, gridFrom: '2026-09-28', gridTo: '2026-11-02',
      from: addDays(TODAY, -7), to: '2026-11-02', category: null, buyer: null,
    });
    // a month that does not hold today reads its grid alone
    expect(parseCalendarQuery({ month: '2026-12' }, NOW)).toMatchObject({ month: '2026-12-01', from: '2026-11-30', to: '2027-01-04' });
    // the week starts on the business's country's first day
    expect(new Date(`${parseCalendarQuery({}, NOW, 7).gridFrom}T00:00:00Z`).getUTCDay()).toBe(0);
  });

  it('no List · Week · Month · Day switch: the grid and the list are both drawn, the grid FIRST, so a phone shows it on top', () => {
    for (const l of LOCALES) {
      for (const html of [draw(l), draw(l, { month: '2026-10', day: TODAY }), draw(l, { month: '2026-11' }, { entries: [], buyers: [], categories: [] })]) {
        expect(html, l).not.toContain('cal-views');
        expect(html, l).not.toMatch(/<nav class="tabs/);
        for (const w of ['list', 'week', 'day'] as const) expect(html, l).not.toContain(`>${t(l, `calendar.view.${w}`)}</a>`);
        const grid = html.indexOf('<div class="cal-grid"><div class="wk-scroll"><table class="mo">');
        const list = html.indexOf('<div class="cal-list" id="cal-list">');
        expect(grid, l).toBeGreaterThan(0);
        expect(list, l).toBeGreaterThan(grid);
        expect(html.indexOf('<div class="cal-screen">'), l).toBeLessThan(grid);
      }
    }
  });

  it('side by side from 1200px, the grid the wider; under it on a phone and in a narrow window', () => {
    expect(rule('.cal-screen')).toContain('display:grid');
    expect(rule('.cal-screen')).not.toContain('grid-template-columns');
    const wide = CSS.slice(CSS.indexOf('@media (min-width: 1200px)'));
    expect(wide).toMatch(/^@media \(min-width: 1200px\) \{\s*\.cal-screen \{ grid-template-columns:minmax\(0, 3fr\) minmax\(0, 2fr\);/);
  });
});

describe('nothing chosen: the list is what is owed, then the month\'s other dates', () => {
  it('what is owed first — the late reply before today included — each under its day; then today and forward; every date once', () => {
    for (const l of LOCALES) {
      const html = draw(l);
      const list = listOf(html);
      const owedAt = list.indexOf(`<h2 class="cal-lh"><span class="dot warn" aria-hidden="true">●</span> ${t(l, 'calendar.legend.owed')}</h2>`);
      const otherAt = withoutIsolates(list).indexOf(`<h2 class="cal-lh">${withoutIsolates(t(l, 'calendar.list.other', { month: withZone(ZONE, () => show.month(l, '2026-10-01')) }))}</h2>`);
      expect(owedAt, l).toBeGreaterThan(-1);
      expect(otherAt, l).toBeGreaterThan(owedAt);
      const rows = rowsOf(list);
      const owed = rows.slice(0, OWED.length);
      expect(owed.map((r) => r.src), l).toEqual(OWED);
      // the late one stands under its day, the others under "Today" in magenta
      expect(withoutIsolates(owed[0]!.html), l).toContain(`<span class="dl-hour"><span class="dl-on">${withoutIsolates(withZone(ZONE, () => show.dayMonth(l, addDays(TODAY, -3))))}</span>`);
      expect(owed[1]!.html, l).toContain(`<span class="dl-hour"><span class="dl-on"><span class="cal-now">${t(l, 'calendar.this.day')}</span></span>`);
      // the rest: today's other dates, then forward, in time order; each date exactly once in the list
      expect(rows.slice(OWED.length).map((r) => r.src), l).toEqual(['sample_requests:s0', 'quotes:q1', 'order_updates:u1', 'sequence_enrollments:f1',
        'conversations:c9', 'promised_dates:p1', 'promised_dates:p2', 'promised_dates:p3', 'factory_closures:cl1',
        'calendar_entries:66666666-6666-4666-8666-666666666666']);
      expect(rows.map((r) => r.src).sort(), l).toEqual(DATES.map((x) => `${x.source.table}:${x.source.id}`).sort());
      // the month's own days have their headings; today's in magenta
      expect(list, l).toContain(`<h3 class="cal-day" aria-current="date"><span class="cal-now">${t(l, 'calendar.this.day')}</span> `);
    }
  });

  it('the days of the month behind today are folded under "Before today", greyed where done; a month wholly behind is drawn as it is', () => {
    const done = e({ category: 'samples', kind: 'sample_handled', at: at('2026-10-01', '10:00'), source: { table: 'sample_requests', id: 'old', column: 'handled_at' } });
    for (const l of LOCALES) {
      const html = listOf(draw(l, {}, { entries: [...DATES, done] }));
      const fold = html.indexOf(`<details class="cal-earlier"><summary>${t(l, 'calendar.earlier.fold')}</summary>`);
      expect(fold, l).toBeGreaterThan(html.indexOf('<h3 class="cal-day" aria-current="date">'));
      expect(html.indexOf('data-src="sample_requests:old"'), l).toBeGreaterThan(fold);
      expect(rowsOf(html).find((r) => r.src === 'sample_requests:old')!.done, l).toBe(true);
      // September, all behind today: no fold
      const sept = draw(l, { month: '2026-09' }, { entries: [e({ ...done, at: at('2026-09-10', '10:00'), day: '2026-09-10' })] });
      expect(sept, l).not.toContain('cal-earlier');
      expect(sept, l).toContain('data-src="sample_requests:old"');
    }
  });

  it('nothing owed is said in a line, and the month\'s dates follow; where the dates stop before the month does, it says so', () => {
    for (const l of LOCALES) {
      const html = draw(l, {}, { entries: DATES.filter((x) => !OWED.includes(`${x.source.table}:${x.source.id}`)) });
      expect(withoutIsolates(html), l).toContain(`<p class="muted cal-none">${withoutIsolates(t(l, 'calendar.owed.none', { month: withZone(ZONE, () => show.month(l, '2026-10-01')) }))}</p>`);
      expect(html, l).toContain('<p class="muted cal-rest">');
    }
  });
});

describe('selecting a day: a real link, and the list focuses on that day', () => {
  it('every day of the grid is a plain link carrying the month and the day; "+N more" chooses its day too', () => {
    const html = draw('en');
    const links = [...gridOf(html).matchAll(/<a class="mo-d" href="([^"]+)"/g)].map((m) => m[1]);
    expect(links).toHaveLength(35);
    expect(links[0]).toBe('/app/calendar?month=2026-10&amp;day=2026-09-28');
    expect(links).toContain(`/app/calendar?month=2026-10&amp;day=${TODAY}`);
    // a chosen kind and customer travel with the day
    expect(draw('en', { category: 'samples', who: AHMED.id }, { category: 'samples', buyer: AHMED })).toContain(
      `<a class="mo-d" href="/app/calendar?month=2026-10&amp;day=${TODAY}&amp;category=samples&amp;who=${AHMED.id}"`);
  });

  it('the address chooses the day: the list shows that day, in time order, the hour and the kind\'s icon, done greyed and ticked', () => {
    for (const l of LOCALES) {
      const html = draw(l, { month: '2026-10', day: TODAY });
      const list = listOf(html);
      const rows = rowsOf(list);
      expect(rows.map((r) => r.src), l).toEqual(['sample_requests:s0', 'sample_requests:s1', 'quotes:q1', 'handoffs:h1']);
      // 08:00 dealt with: done. 09:12 asked, not dealt with: owed. 15:40 and 16:00 are still to come.
      expect(rows.map((r) => r.done), l).toEqual([true, false, false, false]);
      expect(rows[0]!.html, l).toContain('<span class="dot ok" aria-hidden="true">✓</span>');
      expect(rows[1]!.html, l).toContain('<span class="dot warn" aria-hidden="true">●</span>');
      for (const r of rows) expect(r.html, l).toMatch(/^\s*<span class="dl-hour">[^<]+<\/span><span class="dl-who[\s\S]*<svg class="kind-icon"/);
      // the day's name heads it, today in magenta; the way back is to the whole month, a door
      expect(list, l).toContain(`<h2 class="cal-day cal-lh" aria-current="date"><span class="cal-now">${t(l, 'calendar.this.day')}</span> `);
      expect(withoutIsolates(list), l).toContain(`<a class="back" href="/app/calendar"><span class="go" aria-hidden="true">‹</span>${withoutIsolates(t(l, 'calendar.day.month', { month: withZone(ZONE, () => show.month(l, '2026-10-01')) }))}</a>`);
      // nothing owed elsewhere is in a chosen day's list
      expect(list, l).not.toContain('handoffs:h0');
      expect(list, l).not.toContain('cal-earlier');
    }
  });

  it('the chosen day is marked in the grid with a neutral ring — never magenta, the meaning colour; today keeps its magenta number', () => {
    const html = draw('en', { month: '2026-10', day: '2026-10-07' });
    const cell = cellOf(html, '2026-10-07');
    expect(cell).toMatch(/^<td class="sel">\s*<a class="mo-d" href="[^"]+" aria-label="[^"]+" aria-current="true">7<\/a>/);
    expect(gridOf(html).match(/class="[^"]*\bsel\b/g)).toHaveLength(1);
    expect(cellOf(html, TODAY)).toMatch(/^<td class="today" aria-current="date">/);
    expect(cellOf(draw('en', { month: '2026-10', day: TODAY }), TODAY)).toMatch(/^<td class="today sel" aria-current="date">/);
    // nothing chosen: no ring
    expect(gridOf(draw('en'))).not.toMatch(/class="[^"]*\bsel\b/);
    const ring = rule('.mo td.sel .mo-d::after');
    expect(ring).toContain('var(--color-ink)');
    expect(ring).not.toMatch(/assistant|waiting/);
    // the whole cell is the day's door; the faces (their cards) and "+N more" stand above it
    expect(rule('.mo-d::after')).toContain('position:absolute');
    expect(rule('.mo-e .face-link, .mo-more')).toContain('z-index:1');
  });

  it('a day outside the month asked for shows its own month; a grey day of the grid keeps the month it was chosen in', () => {
    expect(parseCalendarQuery({ month: '2026-10', day: '2026-12-05' }, NOW)).toMatchObject({ month: '2026-12-01', day: '2026-12-05' });
    expect(parseCalendarQuery({ month: '2026-10', day: '2026-09-29' }, NOW)).toMatchObject({ month: '2026-10-01', day: '2026-09-29' });
    expect(parseCalendarQuery({ day: '2027-02-14' }, NOW)).toMatchObject({ month: '2027-02-01', day: '2027-02-14' });
  });

  it('a day with nothing on it is one warm panel, its one door adding a date on that very day', () => {
    for (const l of LOCALES) {
      const list = listOf(draw(l, { month: '2026-10', day: '2026-10-20' }));
      expect(list, l).toContain(`<p class="cal-empty-t">${t(l, 'calendar.empty.day')}</p>`);
      expect(list, l).toContain(`<details class="cal-add"><summary>${t(l, 'calendar.add')}</summary>`);
      expect(list, l).toContain('name="day" required value="2026-10-20"');
    }
  });

  it('the query is whitelisted: anything that is not a month, a day, a kind or a customer is this month, nothing chosen', () => {
    const def = parseCalendarQuery({}, NOW);
    for (const q of [{ month: '2026-13' }, { month: '2026-1' }, { month: '1999-10' }, { day: '2026-02-31' }, { day: "2026-10-01' or 1=1" },
      { day: ['2026-10-01'] }, { month: { a: 1 } }, { category: 'everything' }, { who: 'ahmed' }, null, 'day=2026-10-01']) {
      expect(parseCalendarQuery(q, NOW), JSON.stringify(q)).toEqual(def);
    }
  });
});

describe('the old addresses (List · Week · Month · Day) answer with the same place on the one screen', () => {
  const old = (q: Record<string, string>) => withZone(ZONE, () => legacyCalendarAddress(q, NOW));
  it('a week or a day chooses its day; a month shows its month; the list shows the month it was drawn around; ?at= alone chooses its day', () => {
    expect(old({ view: 'week' })).toBe(`/app/calendar?month=2026-10&day=${TODAY}`);
    expect(old({ view: 'day' })).toBe(`/app/calendar?month=2026-10&day=${TODAY}`);
    expect(old({ view: 'day', at: '2026-10-07' })).toBe('/app/calendar?month=2026-10&day=2026-10-07');
    expect(old({ view: 'week', at: '2026-11-20', category: 'samples', buyer: PEDRO.id })).toBe(`/app/calendar?month=2026-11&day=2026-11-20&category=samples&who=${PEDRO.id}`);
    expect(old({ view: 'month' })).toBe('/app/calendar');
    expect(old({ view: 'month', at: '2026-12-15' })).toBe('/app/calendar?month=2026-12');
    expect(old({ view: 'month', at: '2026-10-15', who: PEDRO.id })).toBe(`/app/calendar?who=${PEDRO.id}`);
    expect(old({ view: 'list' })).toBe('/app/calendar');
    expect(old({ view: 'list', from: '2026-11-13', category: 'orders' })).toBe('/app/calendar?month=2026-11&category=orders');
    expect(old({ from: addDays(TODAY, -7) })).toBe('/app/calendar');
    expect(old({ at: '2026-10-09' })).toBe('/app/calendar?month=2026-10&day=2026-10-09');
    // an address already on this screen keeps its place, and only the old words go
    expect(old({ month: '2026-11', day: '2026-11-03', view: 'week' })).toBe('/app/calendar?month=2026-11&day=2026-11-03');
  });

  it('this screen\'s own addresses are not redirected; nonsense in an old one lands on today, never an error', () => {
    for (const q of [{}, { month: '2026-10' }, { day: TODAY }, { month: '2026-10', day: TODAY, category: 'samples' }, { who: PEDRO.id }, { buyer: PEDRO.id }]) {
      expect(old(q), JSON.stringify(q)).toBeNull();
    }
    expect(old({ view: 'year' })).toBe('/app/calendar');
    expect(old({ view: 'day', at: '2026-02-31' })).toBe(`/app/calendar?month=2026-10&day=${TODAY}`);
    expect(old({ view: 'day', at: "x' or 1=1", category: 'bad', buyer: 'nobody' })).toBe(`/app/calendar?month=2026-10&day=${TODAY}`);
  });
});

describe('every date carries a face and a sentence, never a bare dot', () => {
  for (const l of LOCALES) {
    it(`${l}: in the owed list and a chosen day — a face that opens the card, the kind's icon, one sentence naming the customer`, () => {
      for (const html of [draw(l), draw(l, { month: '2026-10', day: TODAY }), draw(l, { month: '2026-10', day: addDays(TODAY, 5) })]) {
        const rows = rowsOf(listOf(html));
        expect(rows.length, l).toBeGreaterThan(0);
        for (const r of rows) {
          const x = DATES.find((d) => `${d.source.table}:${d.source.id}` === r.src)!;
          const said = x.kind === 'own' ? x.detail.title! : t(l, `calendar.say.${x.kind}` as MessageKey, { who: nameOf(x) });
          const sentence = /<span class="dl-say">([\s\S]*?)<\/span>(?:<span class="small">|<\/span>)/.exec(r.html)?.[1] ?? '';
          expect(plain(sentence), `${l}/${x.kind}`).toContain(said);
          // the name isolated where the sentence puts it: a Latin name inside Arabic keeps its direction, whole
          expect(sentence, `${l}/${x.kind}`).toContain(`<bdi>${nameOf(x)}</bdi>`);
          expect(r.html, `${l}/${x.kind}`).toContain('<svg class="kind-icon"');
          if (x.buyer) {
            expect(r.html, `${l}/${x.kind}`).toContain(`<a class="face-link" href="/app/customers/${x.buyer.id}" data-card aria-label="${x.buyer.name}"><span class="face face-s `);
          } else {
            // a closure, the owner's own: nobody's — no face, the kind's icon alone in its place
            expect(r.html, `${l}/${x.kind}`).toMatch(/<span class="dl-who dl-only"><svg class="kind-icon"/);
            expect(r.html, `${l}/${x.kind}`).not.toContain('class="face');
          }
        }
      }
    });

    it(`${l}: in the grid — a small face (the card's door) and the name, isolated; a closure has its icon and its name`, () => {
      const html = draw(l);
      const items = [...gridOf(html).matchAll(/<span class="mo-e [^"]*" data-src="([^"]+)"[^>]*>([\s\S]*?)<\/span>(?=<span class="mo-e|\s*<a class="mo-more"|\s*<\/td>)/g)];
      expect(items.length, l).toBeGreaterThan(0);
      for (const [, src, body] of items) {
        const x = DATES.find((d) => `${d.source.table}:${d.source.id}` === src)!;
        expect(body, `${l}/${x.kind}`).toContain(`<span class="mo-n"><bdi>${nameOf(x)}</bdi></span>`);
        if (x.buyer) expect(body, `${l}/${x.kind}`).toMatch(new RegExp(`^<a class="face-link" href="/app/customers/${x.buyer.id}" data-card aria-label="[^"]+"><span class="face face-xs `));
        else expect(body, `${l}/${x.kind}`).toMatch(/^<svg class="kind-icon"/);
      }
      expect(html).not.toMatch(/class="[^"]*\b(?:dot|chip)\b[^"]*"[^>]*><\/span>/);
    });
  }

  it('every customer kind has its sentence in all five languages, naming the customer; the names are the customer\'s, never a pronoun\'s', () => {
    for (const l of LOCALES) for (const k of CUSTOMER_KINDS) {
      const s = t(l, `calendar.say.${k}` as MessageKey, { who: 'Pedro' });
      expect(s, `${l}/${k}`).toContain('Pedro');
      expect(s, `${l}/${k}`).not.toContain('{');
    }
    expect(t('en', 'calendar.say.reply_due', { who: 'Pedro' })).toBe('Reply owed to Pedro');
    expect(t('zh', 'calendar.say.price_worked_out', { who: '陈莉' })).toBe('给陈莉发了报价');
    expect(t('zh', 'calendar.say.price_worked_out', { who: 'Pedro' })).toBe('给 Pedro 发了报价');
    for (const l of LOCALES) for (const k of ['calendar.say.price_review', 'calendar.say.price_unsent'] as const) {
      expect(t(l, k, { who: 'Pedro' }), `${l}/${k}`).toContain('Pedro');
    }
  });

  it('a kept photo is drawn from what the page already knows; nobody\'s photo is fetched to draw it', () => {
    const html = draw('en');
    expect(html).toContain(`<img class="face-p" src="/app/faces/${PEDRO.id}?v=${PEDRO.photo}"`);
    expect(html).toMatch(new RegExp(`href="/app/customers/${CHEN.id}" data-card aria-label="陈莉"><span class="face face-s t\\d" aria-hidden="true"><span class="face-i">陈</span></span>`));
  });
});

describe('a crowded day says "+N more" instead of stretching', () => {
  const crowd = (n: number) => Array.from({ length: n }, (_, i) => e({ category: 'samples', kind: 'sample_asked', at: at(addDays(TODAY, 9), `1${i}:00`),
    buyer: [PEDRO, AHMED, CHEN][i % 3]!, source: { table: 'sample_requests', id: `m${i}`, column: 'requested_at' } }));
  const day = addDays(TODAY, 9);
  it('more than three: two, then "+N more", which chooses that day; three: all three', () => {
    for (const l of LOCALES) {
      const cell = withoutIsolates(cellOf(draw(l, {}, { entries: crowd(6) }), day));
      expect(cell.match(/<span class="mo-e /g), l).toHaveLength(MONTH_SHOWN);
      // the sign and its figure are one isolated run: in Arabic "+4" never turns into "4+" when the cell wraps it
      expect(cell, l).toContain(`<a class="mo-more" href="/app/calendar?month=2026-10&amp;day=${day}"><span>${withoutIsolates(t(l, 'calendar.more', { n: 6 - MONTH_SHOWN })).replace('+4', '<bdi>+4</bdi>')}</span></a>`);
      const three = cellOf(draw(l, {}, { entries: crowd(MONTH_WHOLE) }), day);
      expect(three.match(/<span class="mo-e /g), l).toHaveLength(MONTH_WHOLE);
      expect(three, l).not.toContain('mo-more');
      // chosen, the crowded day's list holds all six
      expect(rowsOf(listOf(draw(l, { month: '2026-10', day }, { entries: crowd(6) }))), l).toHaveLength(6);
    }
    expect(rule('.mo-n')).toContain('overflow-wrap:break-word');
  });

  it('what is owed shows first in a crowded day: the glance says what the owner owes', () => {
    const owed = e({ category: 'negotiation', kind: 'reply_due', at: at(day, '23:00'), source: { table: 'handoffs', id: 'late', column: 'sla_deadline_at' } });
    const cell = cellOf(draw('en', {}, { entries: [...crowd(4), owed] }), day);
    expect(/<span class="mo-e [^"]*" data-src="([^"]+)"/.exec(cell)![1]).toBe('handoffs:late');
  });
});

describe('the chrome folds away', () => {
  it('choosing one kind or one customer, and adding a date are in ONE closed fold under the month\'s name; what the marks mean is under the list', () => {
    for (const l of LOCALES) for (const q of [{}, { month: '2026-10', day: TODAY }]) {
      const html = draw(l, q);
      const open = html.indexOf('<details class="cal-tools">');
      const close = html.indexOf('</details>', open);
      expect(open, l).toBeGreaterThan(html.indexOf('<div class="cal-period">'));
      expect(open, l).toBeLessThan(html.indexOf('<div class="cal-screen">'));
      expect(html.match(/<details class="cal-tools"/g), l).toHaveLength(1);
      expect(html.indexOf('<p class="cal-legend small">'), l).toBeGreaterThan(html.indexOf('<div class="cal-list"'));
      for (const part of ['<form method="get" action="/app/calendar" class="pform cal-filter">',
        '<form method="post" action="/app/calendar/entries" class="pform">', '<p class="muted cal-lede">']) {
        const i = html.indexOf(part);
        expect(i > open && i < close, `${l}: ${part}`).toBe(true);
      }
      expect(html.slice(open, html.indexOf('</summary>', open)), l).toContain(t(l, 'calendar.tools'));
    }
  });

  it('the filter keeps the place: the month and the chosen day go with it; adding a date offers the chosen day', () => {
    const html = draw('en', { month: '2026-10', day: '2026-10-09' });
    const form = /<form method="get" action="\/app\/calendar" class="pform cal-filter">[\s\S]*?<\/form>/.exec(html)![0];
    expect(form).toContain('<input type="hidden" name="month" value="2026-10" />');
    expect(form).toContain('<input type="hidden" name="day" value="2026-10-09" />');
    expect(/<form method="post" action="\/app\/calendar\/entries"[\s\S]*?<\/form>/.exec(html)![0]).toContain('name="day" required value="2026-10-09"');
    // nothing chosen in this month: no hidden place at all, and today is offered
    const plainForm = /<form method="get" action="\/app\/calendar" class="pform cal-filter">[\s\S]*?<\/form>/.exec(draw('en'))![0];
    expect(plainForm).not.toContain('type="hidden"');
    expect(draw('en')).toContain(`name="day" required value="${TODAY}"`);
  });

  it('with nothing to choose between — one kind, one customer — there is no choice to make: the fold only adds a date', () => {
    for (const l of LOCALES) {
      const one = DATES.filter((x) => x.source.id === 'h1');
      const html = draw(l, {}, { entries: one, buyers: [PEDRO], categories: ['negotiation'] });
      expect(html, l).not.toContain('cal-filter');
      expect(html, l).toContain(`<details class="cal-tools">\n      <summary>${t(l, 'calendar.add')}</summary>`);
      expect(draw(l, {}, { entries: one, buyers: [PEDRO], categories: ['negotiation'], buyer: PEDRO }), l).toContain('cal-filter');
    }
  });

  it('a chosen kind or customer is said above the screen, with the way back to everything, the place kept', () => {
    for (const l of LOCALES) {
      const html = draw(l, { month: '2026-10', day: TODAY }, { buyer: AHMED, entries: DATES.filter((x) => x.buyer?.id === AHMED.id) });
      expect(html, l).toMatch(new RegExp(`<p class="cal-chosen small">[^<]*<bdi>${AHMED.name}[^<]*</bdi> <a href="/app/calendar\\?month=2026-10&amp;day=${TODAY}">${t(l, 'calendar.empty.clear')}</a></p>`));
    }
  });
});

describe('a month with nothing: the empty grid, and one warm panel in the list\'s place', () => {
  it('the grid still shows; beside it the panel says what will fill it and has one door; no fold, no legend, no filter', () => {
    for (const l of LOCALES) {
      const html = draw(l, { month: '2026-11' }, { entries: [], buyers: [], categories: [] });
      expect(html, l).toContain('<table class="mo">');
      expect(gridOf(html), l).not.toContain('mo-e');
      expect(html, l).not.toContain('cal-tools');
      expect(html, l).not.toContain('cal-legend');
      expect(html, l).not.toContain('cal-filter');
      const list = listOf(html);
      const panel = /<div class="empty cal-empty">([\s\S]*)<\/div>/.exec(list)?.[1] ?? '';
      expect(panel, l).toContain(`<p class="cal-empty-t">${t(l, 'calendar.empty.month')}</p>`);
      expect(panel, l).toContain(`<p class="muted">${t(l, 'calendar.empty.how')}</p>`);
      expect(panel, l).toContain(`<details class="cal-add"><summary>${t(l, 'calendar.add')}</summary>`);
      expect(panel.match(/<a /g), l).toBeNull();
      // a future month offers its first day
      expect(panel, l).toContain('name="day" required value="2026-11-01"');
    }
    expect(rule('.empty.cal-empty')).toContain('border:0');
    expect(rule('.empty.cal-empty')).toContain('border-radius:var(--radius-card)');
  });

  it('narrowed to nothing, the way out is to widen, not to leave', () => {
    for (const l of LOCALES) {
      const html = draw(l, { month: '2026-11' }, { entries: [], categories: [], category: 'orders' });
      expect(html, l).toContain(t(l, 'calendar.empty.filtered'));
      expect(html, l).toContain('<a class="deeper" href="/app/calendar?month=2026-11">');
    }
  });
});

describe('today is magenta, and the month is rounded; it moves in words', () => {
  // The identity system (2026-10-04) — today's marker is the BRAND magenta (an accent, not a meaning): the
  // light shade now says only "the assistant did this".
  it('today\'s marker — its word, its number in the grid — is the brand magenta, as text', () => {
    expect(rule('.cal-now')).toContain('color:var(--color-brand)');
    expect(rule('.mo td.today .mo-d')).toContain('color:var(--color-brand)');
    for (const l of LOCALES) {
      expect(withoutIsolates(cellOf(draw(l), TODAY)), l).toMatch(new RegExp(`^<td class="today" aria-current="date">\\s*<a class="mo-d" [^>]*>3</a><span class="cal-now">${t(l, 'calendar.this.day')}</span>`));
    }
  });

  it('the grid has round corners, and scrolls inside its own frame with a shade at an edge that has more', () => {
    expect(rule('.wk-scroll')).toContain('border-radius:var(--radius-panel)');
    expect(rule('.wk-scroll')).toContain('overflow-x:auto');
    expect(rule('.mo')).toContain('border-collapse:separate');
    expect(draw('en')).toContain('<div class="wk-scroll"><table class="mo">');
  });

  it('‹ Last month · This month · Next month ›, under the month\'s name, keeping the kind and the customer', () => {
    for (const l of LOCALES) {
      const html = draw(l, { month: '2026-10', day: TODAY, category: 'samples' }, { category: 'samples' });
      const move = /<nav class="cal-move"[^>]*>([\s\S]*?)<\/nav>/.exec(html)![1]!;
      expect(move, l).toContain(`<a class="back" href="/app/calendar?month=2026-09&amp;category=samples"><span class="go" aria-hidden="true">‹</span>${t(l, 'calendar.prev.month')}</a>`);
      expect(move, l).toContain(`<a class="tab cal-today" href="/app/calendar?category=samples">${t(l, 'calendar.this.month')}</a>`);
      expect(move, l).toContain(`<a class="deeper" href="/app/calendar?month=2026-11&amp;category=samples">${t(l, 'calendar.next.month')}`);
      expect(html.indexOf('<p class="cal-span">'), l).toBeLessThan(html.indexOf('<nav class="cal-move"'));
    }
  });
});
