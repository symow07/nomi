import { describe, it, expect } from 'vitest';
import { renderCalendar, parseCalendarQuery } from '../../src/api/web/calendar.js';
import { shell } from '../../src/api/web/layout.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { BANNED_OWNER_TERMS } from '../../src/core/owner/vocabulary.js';
import { dayKey, dayStart, addDays } from '../../src/core/owner/i18n/format.js';
import { usd } from '../../src/core/types/money.js';
import type { CalendarEntry, CalendarView } from '../../src/db/calendar.js';

/**
 * V2 — the calendar renderer, by structure. The loader's truth (which rows,
 * which tenant) is tests/integration/calendar.test.ts; this file holds the
 * page's shape in every locale: the one screen (the owner's correction,
 * 2026-10-04: the month and the list together), rows, day headings, the empty
 * state, and the rules every owner page keeps (no `%`, no software talk, no
 * stylesheet of its own). The screen itself is warmth-calendar.test.ts.
 */

const NOW = new Date('2026-09-27T04:00:00Z');           // 12:00 in the business timezone
const TODAY = dayKey(NOW, 'Asia/Shanghai');
const FROM = addDays(TODAY, -7);
const TO = addDays(FROM, 21);
const at = (ymd: string, hhmm: string): Date => new Date(dayStart(ymd, 'Asia/Shanghai').getTime()
  + (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))) * 60_000);

const AHMED = { id: '11111111-1111-4111-8111-111111111111', name: 'Ahmed', country: 'AE' };
const OLGA = { id: '22222222-2222-4222-8222-222222222222', name: 'Olga', country: 'RU' };
const CONV = '33333333-3333-4333-8333-333333333333';
const ORDER = '44444444-4444-4444-8444-444444444444';

const e = (x: Partial<CalendarEntry> & Pick<CalendarEntry, 'category' | 'kind' | 'at' | 'source'>): CalendarEntry => ({
  day: dayKey(x.at, 'Asia/Shanghai'), allDay: false, conversationId: CONV, orderId: null, buyer: AHMED, identity: null, detail: {}, ...x,
});

const ENTRIES: CalendarEntry[] = [
  e({ category: 'closures', kind: 'closure', at: dayStart(addDays(TODAY, 3), 'Asia/Shanghai'), day: addDays(TODAY, 3), allDay: true,
    conversationId: null, buyer: null,
    detail: { closureLabel: 'Mid-Autumn', closureFrom: addDays(TODAY, 3), closureTo: addDays(TODAY, 5) },
    source: { table: 'factory_closures', id: 'c1', column: 'starts_on' } }),
  e({ category: 'samples', kind: 'sample_asked', at: at(addDays(TODAY, -2), '09:15'),
    source: { table: 'sample_requests', id: 's1', column: 'requested_at' } }),
  e({ category: 'samples', kind: 'sample_handled', at: at(TODAY, '10:00'),
    source: { table: 'sample_requests', id: 's1', column: 'handled_at' } }),
  e({ category: 'orders', kind: 'order_state', at: at(addDays(TODAY, -1), '16:40'), orderId: ORDER, buyer: OLGA,
    detail: { orderReference: 'YW-2026-09-0001', orderState: 'shipped', trackingReference: 'SF123' },
    source: { table: 'order_updates', id: 'u1', column: 'at' } }),
  e({ category: 'negotiation', kind: 'price_worked_out', at: at(addDays(TODAY, -3), '11:00'),
    detail: { price: usd(0.38), quantity: 20000 }, source: { table: 'quotes', id: 'q1', column: 'created_at' } }),
  e({ category: 'negotiation', kind: 'reply_due', at: at(addDays(TODAY, 1), '09:00'),
    source: { table: 'handoffs', id: 'h1', column: 'sla_deadline_at' } }),
  e({ category: 'followups', kind: 'followup_due', at: at(addDays(TODAY, 1), '08:00'), conversationId: null,
    buyer: null, identity: 'buyer@example.com', detail: { sequenceName: 'Autumn letters' },
    source: { table: 'sequence_enrollments', id: 'f1', column: 'next_due_at' } }),
  e({ category: 'conversations', kind: 'conversation_closed', at: at(addDays(TODAY, -5), '18:00'),
    source: { table: 'conversations', id: CONV, column: 'closed_at' } }),
];

const view = (over: Partial<CalendarView> = {}): CalendarView => ({
  from: FROM, to: TO, today: TODAY, category: null, buyer: null,
  buyers: [AHMED, OLGA],
  categories: ['samples', 'orders', 'negotiation', 'followups', 'closures', 'conversations'],
  entries: ENTRIES, ...over,
});

const text = (html: string): string => html.replace(/<[^>]+>/g, ' ');
const containsBanned = (s: string, banned: string): boolean => {
  const needle = banned.toLowerCase();
  const lower = s.toLowerCase();
  return /^[a-z ]+$/.test(needle) ? new RegExp(`\\b${needle}\\b`).test(lower) : lower.includes(needle);
};

const plain = (html: string): string => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
const nameIn = (x: CalendarEntry): string => x.kind === 'closure' ? x.detail.closureLabel ?? '' : x.buyer?.name ?? x.identity ?? '';

describe('V2 · the calendar page, by structure', () => {
  for (const locale of LOCALES) {
    it(`${locale}: title, tabs, rows and day headings — every date a face and a sentence (the warmth run)`, () => {
      const html = renderCalendar(view(), locale);
      expect(html).toContain(`<h1 class="page">`);
      expect(html).toContain(t(locale, 'nav.calendar'));
      // Phase 9 (V1-202, inbox-calendar-new-15) — one kind or one customer: every kind is offered, whatever the range holds.
      const kinds0 = /<select name="category">([\s\S]*?)<\/select>/.exec(html)?.[1] ?? '';
      expect([...kinds0.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1])).toEqual(
        ['', 'promised', 'samples', 'orders', 'negotiation', 'followups', 'yours', 'closures', 'conversations']);
      expect(html).not.toContain('cal-tabs');
      // the owner's correction — one screen: no views to switch between
      expect(html).not.toMatch(/<a class="tab on"/);
      // One row per entry in the list (what is owed, then the month's other dates), each naming its source row and its kind.
      const rows = [...html.matchAll(/<li class="dl-row (?:solid|dashed)(?: done)?" data-src="([^"]+)" data-col="([^"]+)" data-cat="([^"]+)">[\s\S]*?<\/li>/g)];
      expect(rows.map((r) => `${r[1]}#${r[2]}`).sort()).toEqual(
        ENTRIES.map((x) => `${x.source.table}:${x.source.id}#${x.source.column}`).sort());
      expect(rows.map((r) => r[3]).sort()).toEqual(ENTRIES.map((x) => x.category).sort());
      for (const x of ENTRIES) {
        const row = rows.find((r) => r[1] === `${x.source.table}:${x.source.id}` && r[2] === x.source.column)![0];
        // one sentence of context, the customer named in it and isolated
        const say = /<span class="dl-say">([\s\S]*?)<\/span>(?:<span class="small">|<\/span>)/.exec(row)?.[1] ?? '';
        expect(plain(say), `${locale}: ${x.kind}`).toContain(t(locale, `calendar.say.${x.kind}` as never, { who: nameIn(x) }));
        expect(say, `${locale}: ${x.kind}`).toContain(`<bdi>${nameIn(x)}</bdi>`);
        // the customer's face opens their card; a date that is nobody's has its kind's icon alone
        if (x.buyer) expect(row).toContain(`<a class="face-link" href="/app/customers/${x.buyer.id}" data-card aria-label="${x.buyer.name}"><span class="face face-s`);
        else if (x.kind === 'closure') expect(row).toMatch(/<span class="dl-who dl-only"><svg class="kind-icon"/);
        else expect(row).toMatch(/<span class="dl-who"><span class="face face-s[^"]*" aria-hidden="true">/);
        expect(row).toContain('<svg class="kind-icon');
        expect(row, 'never a pill: a pill is a state').not.toMatch(/class="(?:tag|chip|pill)\b/);
      }
      // A heading per day of the month's other dates (what is owed has its own); today named in words.
      const days = new Set(ENTRIES.filter((x) => x.kind !== 'reply_due').map((x) => x.day));
      expect([...html.matchAll(/<h3 class="cal-day"/g)]).toHaveLength(days.size);
      expect(html).toContain(`<h3 class="cal-day" aria-current="date"><span class="cal-now">${t(locale, 'calendar.this.day')}</span> `);
    });

    it(`${locale}: under one kind every entry still says what it is, and the page says what is shown`, () => {
      const html = renderCalendar({ ...view(), category: 'samples', entries: ENTRIES.filter((x) => x.category === 'samples') }, locale);
      expect(html).toMatch(/<li class="dl-row (?:solid|dashed)/);
      expect(plain(html)).toContain(t(locale, 'calendar.say.sample_asked', { who: 'Ahmed' }));
      // what is shown, said above the dates, with the way back to everything
      expect(html).toContain(`<p class="cal-chosen small">${t(locale, 'calendar.filter.chosen', { what: t(locale, 'calendar.cat.samples') })} <a href="/app/calendar">`);
    });

    it(`${locale}: doors go to the conversation, or the order; a closure has none`, () => {
      const html = renderCalendar(view(), locale);
      expect(html).toContain(`href="/app/orders/${ORDER}"`);
      // CC-25 — a conversation opens on its newest message, not at the top of its transcript.
      expect(html).toContain(`href="/app/inbox/${CONV}#latest"`);
      expect(html).not.toContain(`href="/app/inbox/${CONV}"`);
      // a closure is the owner's: its edge is dashed (the design pass)
      const closure = /<li class="dl-row dashed" data-src="factory_closures:c1"[\s\S]*?<\/li>/.exec(html)?.[0] ?? '';
      expect(closure).not.toBe('');
      expect(closure).not.toContain('href=');
      expect(closure).toContain(t(locale, 'calendar.allDay'));
      // a follow-up to an address nobody has answered from: a face, but no card and no door
      const follow = /<li class="dl-row dashed" data-src="sequence_enrollments:f1"[\s\S]*?<\/li>/.exec(html)?.[0] ?? '';
      expect(follow).toContain('buyer@example.com');
      expect(follow).not.toContain('href=');
    });

    it(`${locale}: no percent sign, no software talk, no stylesheet of its own`, () => {
      for (const html of [renderCalendar(view(), locale), renderCalendar(view({ entries: [], categories: [] }), locale),
        renderCalendar(view({ from: addDays(FROM, 21), to: addDays(TO, 21), category: 'samples', buyer: AHMED }), locale)]) {
        expect(html).not.toContain('%');
        expect(html).not.toMatch(/<style/i);
        for (const banned of BANNED_OWNER_TERMS) {
          expect(containsBanned(text(html), banned), `"${banned}" in ${locale}`).toBe(false);
        }
      }
    });

    it(`${locale}: the empty state is warm, says so and has one door: adding a date`, () => {
      const html = renderCalendar(view({ entries: [], categories: [], buyers: [] }), locale);
      expect(html).toContain('<div class="empty cal-empty">');
      expect(html).toContain(t(locale, 'calendar.empty.month'));
      expect(html).toContain(t(locale, 'calendar.empty.how'));
      expect(html).toContain('<details class="cal-add">');
      expect(html).not.toContain('<li class="dl-row');
      for (const bad of ['error', 'failed', 'null', 'undefined', 'N/A']) expect(html.toLowerCase()).not.toContain(bad.toLowerCase());
      // Narrowed and empty: the way out is to widen, not to leave.
      const narrowed = renderCalendar(view({ entries: [], categories: [], category: 'orders' }), locale);
      expect(narrowed).toContain(t(locale, 'calendar.empty.filtered'));
      expect(narrowed).toContain(`<a class="deeper" href="/app/calendar">`);
    });
  }

  it('ar: the page sits in a right-to-left document', () => {
    const page = shell({ title: 'x', active: 'calendar', locale: 'ar', path: '/app/calendar', bodyHtml: renderCalendar(view(), 'ar') });
    expect(page).toContain('dir="rtl"');
    // The warmth run: the calendar is its own entry under Customers, and it is lit.
    expect(page).toMatch(/<a href="\/app\/calendar" class="navlink sub active" data-nav="calendar" aria-current="page"/);
  });

  it('a chosen category carries through the doors: the months either side, this month, and every day of the grid', () => {
    const html = renderCalendar(view({ category: 'orders', categories: ['orders'], entries: ENTRIES.filter((x) => x.category === 'orders') }), 'en');
    expect(html).toContain('href="/app/calendar?month=2026-10&amp;category=orders"');
    expect(html).toContain('href="/app/calendar?month=2026-08&amp;category=orders"');
    expect(html).toContain('<a class="tab cal-today" href="/app/calendar?category=orders">');
    expect(html).toContain(`<a class="mo-d" href="/app/calendar?month=2026-09&amp;day=${TODAY}&amp;category=orders"`);
  });

  it('an open request and a reply past its time say so in words', () => {
    for (const locale of LOCALES) {
      const html = renderCalendar(view({ entries: [
        e({ category: 'samples', kind: 'sample_asked', at: at(TODAY, '09:00'), detail: { open: true },
          source: { table: 'sample_requests', id: 's9', column: 'requested_at' } }),
        e({ category: 'negotiation', kind: 'reply_due', at: at(addDays(TODAY, -1), '09:00'), detail: { overdue: true },
          source: { table: 'handoffs', id: 'h9', column: 'sla_deadline_at' } }),
      ] }), locale);
      expect(html).toContain(t(locale, 'calendar.line.sampleOpen'));
      expect(html).toContain(t(locale, 'calendar.detail.late'));
      expect(plain(html)).toContain(t(locale, 'calendar.say.reply_due', { who: 'Ahmed' }));
    }
  });

  it('a chosen buyer is said above the dates, isolated, and selected in the fold', () => {
    const html = renderCalendar(view({ buyer: OLGA }), 'en');
    expect(html).toContain('<p class="cal-chosen small">Showing: <bdi>Olga · Russia</bdi> <a href="/app/calendar">Show everything</a></p>');
    expect(html).toContain(`<option value="${OLGA.id}" selected>`);
    // The positioning rewrite: the calendar asks ?who= (an old ?buyer= link still works).
    expect(html).toContain(`who=${OLGA.id}`);
  });
});

describe('V2 · the query string is whitelisted', () => {
  // The owner's correction — the screen opens on this month, nothing chosen.
  const def = parseCalendarQuery({}, NOW);

  it('this month, its whole weeks; the week before today is read as well when the grid does not reach it', () => {
    expect(def).toEqual({ month: '2026-09-01', day: null, gridFrom: '2026-08-31', gridTo: '2026-10-05', from: '2026-08-31', to: '2026-10-05', category: null, buyer: null });
    // on the 2nd of a month whose grid starts that Monday, the week before still counts what is owed
    expect(parseCalendarQuery({}, new Date('2026-11-02T04:00:00Z'))).toMatchObject({ gridFrom: '2026-10-26', from: '2026-10-26' });
    expect(parseCalendarQuery({}, new Date('2027-02-02T04:00:00Z'))).toMatchObject({ gridFrom: '2027-02-01', from: '2027-01-26' });
  });

  it('accepts exactly a month, a day, a category, a buyer id', () => {
    expect(parseCalendarQuery({ month: '2026-01', day: '2026-01-05', category: 'samples', buyer: AHMED.id.toUpperCase() }, NOW))
      .toEqual({ month: '2026-01-01', day: '2026-01-05', gridFrom: '2025-12-29', gridTo: '2026-02-02', from: '2025-12-29', to: '2026-02-02', category: 'samples', buyer: AHMED.id });
    expect(parseCalendarQuery({ who: OLGA.id }, NOW).buyer).toBe(OLGA.id);
  });

  it('anything else falls back to the default, never an error', () => {
    const cases: unknown[] = [
      { day: '2026-02-31' }, { day: '2026-9-1' }, { day: '1999-01-01' }, { day: "2026-01-01' or 1=1" },
      { day: ['2026-01-01'] }, { month: '2026-00' }, { month: '2026-9' }, { month: "2026-09' --" },
      { category: 'everything' }, { category: 'Samples' }, { buyer: 'ahmed' },
      { buyer: `${AHMED.id};drop` }, null, 'day=2026-01-01',
    ];
    for (const q of cases) expect(parseCalendarQuery(q, NOW), JSON.stringify(q)).toEqual(def);
  });

  it('a day and its start agree in the business timezone', () => {
    for (const d of ['2026-01-01', '2026-03-29', '2026-09-27', '2026-12-31']) {
      expect(dayKey(dayStart(d, 'Asia/Shanghai'), 'Asia/Shanghai')).toBe(d);
      expect(dayKey(new Date(dayStart(d, 'Asia/Shanghai').getTime() - 1), 'Asia/Shanghai')).toBe(addDays(d, -1));
    }
  });
});
