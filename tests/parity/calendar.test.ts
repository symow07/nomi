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
 * page's shape in every locale: tabs, chips, rows, day headings, the empty
 * state, and the rules every owner page keeps (no `%`, no software talk, no
 * stylesheet of its own).
 */

const NOW = new Date('2026-09-27T04:00:00Z');           // 12:00 in the business timezone
const TODAY = dayKey(NOW);
const FROM = addDays(TODAY, -7);
const TO = addDays(FROM, 21);
const at = (ymd: string, hhmm: string): Date => new Date(dayStart(ymd).getTime()
  + (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))) * 60_000);

const AHMED = { id: '11111111-1111-4111-8111-111111111111', name: 'Ahmed', country: 'AE' };
const OLGA = { id: '22222222-2222-4222-8222-222222222222', name: 'Olga', country: 'RU' };
const CONV = '33333333-3333-4333-8333-333333333333';
const ORDER = '44444444-4444-4444-8444-444444444444';

const e = (x: Partial<CalendarEntry> & Pick<CalendarEntry, 'category' | 'kind' | 'at' | 'source'>): CalendarEntry => ({
  day: dayKey(x.at), allDay: false, conversationId: CONV, orderId: null, buyer: AHMED, identity: null, detail: {}, ...x,
});

const ENTRIES: CalendarEntry[] = [
  e({ category: 'closures', kind: 'closure', at: dayStart(addDays(TODAY, 3)), day: addDays(TODAY, 3), allDay: true,
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
  e({ category: 'followups', kind: 'followup_due', at: at(addDays(TODAY, 4), '08:00'), conversationId: null,
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

describe('V2 · the calendar page, by structure', () => {
  for (const locale of LOCALES) {
    it(`${locale}: title, tabs, chips, rows and day headings`, () => {
      const html = renderCalendar(view(), locale);
      expect(html).toContain(`<h1 class="page">`);
      expect(html).toContain(t(locale, 'nav.calendar'));
      // All + the six categories present, All on.
      const tabs = [...html.matchAll(/<a class="tab( on)?"/g)];
      expect(tabs).toHaveLength(7);
      expect(html).toMatch(/<a class="tab on" aria-current="page" href="\/app\/calendar">/);
      // One row per entry, each naming its source row; one neutral chip each.
      const rows = [...html.matchAll(/<li class="row" data-src="([^"]+)" data-col="([^"]+)"/g)];
      expect(rows.map((r) => `${r[1]}#${r[2]}`).sort()).toEqual(
        ENTRIES.map((x) => `${x.source.table}:${x.source.id}#${x.source.column}`).sort());
      const chips = [...html.matchAll(/<span class="([^"]*\bchip\b[^"]*)"/g)].map((m) => m[1]);
      expect(chips).toHaveLength(ENTRIES.length);
      for (const c of chips) expect(c, 'a category is not a state').toBe('chip');
      // A heading per day that holds something; today named in words.
      const days = new Set(ENTRIES.map((x) => x.day));
      expect([...html.matchAll(/<h2 class="cal-day"/g)]).toHaveLength(days.size);
      expect(html).toContain('aria-current="date"');
      expect(html).toContain(t(locale, 'calendar.today', { date: '' }).replace(/\s*·\s*$/, ''));
    });

    it(`${locale}: doors go to the conversation, or the order; a closure has none`, () => {
      const html = renderCalendar(view(), locale);
      expect(html).toContain(`href="/app/orders/${ORDER}"`);
      expect(html).toContain(`href="/app/inbox/${CONV}"`);
      const closure = /<li class="row" data-src="factory_closures:c1"[\s\S]*?<\/li>/.exec(html)?.[0] ?? '';
      expect(closure).not.toBe('');
      expect(closure).not.toContain('href=');
      expect(closure).toContain(t(locale, 'calendar.allDay'));
      const follow = /<li class="row" data-src="sequence_enrollments:f1"[\s\S]*?<\/li>/.exec(html)?.[0] ?? '';
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

    it(`${locale}: the empty state says so and leads somewhere`, () => {
      const html = renderCalendar(view({ entries: [], categories: [], buyers: [] }), locale);
      expect(html).toContain('<div class="empty">');
      expect(html).toContain(t(locale, 'calendar.empty'));
      expect(html).toContain('href="/app/inbox"');
      expect(html).not.toContain('<li class="row"');
      for (const bad of ['error', 'failed', 'null', 'undefined', 'N/A']) expect(html.toLowerCase()).not.toContain(bad.toLowerCase());
      // Narrowed and empty: the way out is to widen, not to leave.
      const narrowed = renderCalendar(view({ entries: [], categories: [], category: 'orders' }), locale);
      expect(narrowed).toContain(t(locale, 'calendar.empty.filtered'));
      expect(narrowed).toContain(`href="/app/calendar"`);
    });
  }

  it('ar: the page sits in a right-to-left document', () => {
    const page = shell({ title: 'x', active: 'calendar', locale: 'ar', path: '/app/calendar', bodyHtml: renderCalendar(view(), 'ar') });
    expect(page).toContain('dir="rtl"');
    // Buyers is lit: the calendar is reached from it.
    expect(page).toMatch(/<a href="\/app\/inbox" class="navlink active" aria-current="page"/);
  });

  it('a chosen category keeps its tab and carries through the doors', () => {
    const html = renderCalendar(view({ category: 'orders', categories: ['orders'], entries: ENTRIES.filter((x) => x.category === 'orders') }), 'en');
    expect(html).toMatch(/<a class="tab on" aria-current="page" href="\/app\/calendar\?category=orders">/);
    expect(html).toContain(`href="/app/calendar?from=${addDays(FROM, 21)}&amp;category=orders"`);
    expect(html).toContain(`href="/app/calendar?from=${addDays(FROM, -21)}&amp;category=orders"`);
    // the default window is the plain address, and "this week" is not offered on it
    expect(html).not.toContain(t('en', 'calendar.now'));
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
      expect(html).toContain(t(locale, 'calendar.line.replyOverdue'));
      expect(html).not.toContain(t(locale, 'calendar.line.replyDue'));
    }
  });

  it('a chosen buyer opens the filter and is selected', () => {
    const html = renderCalendar(view({ buyer: OLGA }), 'en');
    expect(html).toContain('<details class="cal-buyer" open>');
    expect(html).toContain(`<option value="${OLGA.id}" selected>`);
    expect(html).toContain(`buyer=${OLGA.id}`);
  });
});

describe('V2 · the query string is whitelisted', () => {
  const def = parseCalendarQuery({}, NOW);

  it('defaults to the past week and the coming two', () => {
    expect(def).toEqual({ from: addDays(TODAY, -7), to: addDays(TODAY, 14), category: null, buyer: null });
  });

  it('accepts exactly a day, a category, a buyer id', () => {
    expect(parseCalendarQuery({ from: '2026-01-05', category: 'samples', buyer: AHMED.id.toUpperCase() }, NOW))
      .toEqual({ from: '2026-01-05', to: '2026-01-26', category: 'samples', buyer: AHMED.id });
  });

  it('anything else falls back to the default, never an error', () => {
    const cases: unknown[] = [
      { from: '2026-02-31' }, { from: '2026-9-1' }, { from: '1999-01-01' }, { from: "2026-01-01' or 1=1" },
      { from: ['2026-01-01'] }, { category: 'everything' }, { category: 'Samples' }, { buyer: 'ahmed' },
      { buyer: `${AHMED.id};drop` }, null, 'from=2026-01-01',
    ];
    for (const q of cases) expect(parseCalendarQuery(q, NOW), JSON.stringify(q)).toEqual(def);
  });

  it('a day and its start agree in the business timezone', () => {
    for (const d of ['2026-01-01', '2026-03-29', '2026-09-27', '2026-12-31']) {
      expect(dayKey(dayStart(d))).toBe(d);
      expect(dayKey(new Date(dayStart(d).getTime() - 1))).toBe(addDays(d, -1));
    }
  });
});
