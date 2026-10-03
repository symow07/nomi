import { describe, it, expect } from 'vitest';
import { renderCalendar, parseCalendarQuery, MONTH_SHOWN, MONTH_WHOLE } from '../../src/api/web/calendar.js';
import { shell } from '../../src/api/web/layout.js';
import { withZone } from '../../src/api/web/zone.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { dayKey, dayStart, addDays } from '../../src/core/owner/i18n/format.js';
import { usd } from '../../src/core/types/money.js';
import type { CalendarEntry, CalendarView, CalendarKind } from '../../src/db/calendar.js';
import { linkedCss } from './linked-css.js';
import { withoutIsolates } from './isolates.js';

/**
 * THE WARMTH RUN, PHASE 6 (2026-10-03) — THE CALENDAR. The owner:
 *
 *   "Default view becomes List, not Month. List answers 'what do I owe and
 *   when'; Month is the glance. Every dated item carries the customer's face
 *   and context ('Oct 14 - quote owed to Pedro'), never a bare dot. Collapse
 *   the chrome. … An empty month gets a warm empty state … Round the grid's
 *   corners. … A crowded day shows '+N more' rather than stretching the cell.
 *   The day view is a single time-ordered list: the hour, a kind icon, done
 *   items greyed rather than hidden. Also: today's marker is magenta."
 *
 * Every assertion reads the page as it is drawn, in all five languages.
 */

const ZONE = 'Asia/Shanghai';
const NOW = new Date('2026-10-03T04:00:00Z');                 // Saturday, 12:00 in the business's zone
const TODAY = dayKey(NOW, ZONE);
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

const view = (from: string, to: string, over: Partial<CalendarView> = {}): CalendarView => ({
  from, to, today: TODAY, category: null, buyer: null, buyers: [PEDRO, AHMED, CHEN],
  categories: ['promised', 'samples', 'orders', 'negotiation', 'followups', 'yours', 'closures', 'conversations'],
  entries: DATES.filter((x) => x.day >= from && x.day < to), ...over,
});
const draw = (l: Locale, kind: 'list' | 'week' | 'month' | 'day', over: Partial<CalendarView> = {}, page: { at?: string } = {}): string =>
  withZone(ZONE, () => {
    const q = parseCalendarQuery({ view: kind, ...(page.at ? { at: page.at } : {}) }, NOW);
    return renderCalendar(view(q.from, q.to, over), l, { view: q.view, at: q.at, now: NOW });
  });
const plain = (html: string): string => withoutIsolates(html).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
const nameOf = (x: CalendarEntry): string => x.kind === 'closure' ? x.detail.closureLabel! : x.kind === 'own' ? x.detail.title! : x.buyer?.name ?? x.identity ?? '';
const rowsOf = (html: string) => [...html.matchAll(/<li class="dl-row (solid|dashed)( done)?" data-src="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)]
  .map((m) => ({ src: m[3]!, done: m[2] === ' done', html: m[4]! }));
const CSS = linkedCss(shell({ title: 'T', active: 'calendar', locale: 'en', path: '/app/calendar', bodyHtml: '' })).replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (sel: string) => new RegExp(`(?:^|\\s)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`).exec(CSS)?.[1] ?? '';

describe('the warmth run · the calendar opens on the list', () => {
  it('the plain address is the list; its tab is lit; Week, Month and Day keep their own addresses', () => {
    expect(parseCalendarQuery({}, NOW).view).toBe('list');
    expect(parseCalendarQuery({ view: 'month' }, NOW).view).toBe('month');
    for (const l of LOCALES) {
      const html = withZone(ZONE, () => renderCalendar(view(addDays(TODAY, -7), addDays(TODAY, 14)), l, { now: NOW }));
      expect(html, l).toMatch(new RegExp(`<a class="tab on" aria-current="page" href="/app/calendar">${t(l, 'calendar.view.list')}</a>`));
      // the list is the first of the four
      const tabs = [...html.matchAll(/<a class="tab(?: on)?"[^>]*href="([^"]+)">/g)].map((m) => m[1]).slice(0, 4);
      expect(tabs, l).toEqual(['/app/calendar', `/app/calendar?view=week&amp;at=${TODAY}`, `/app/calendar?view=month&amp;at=${TODAY}`, `/app/calendar?view=day&amp;at=${TODAY}`]);
    }
  });

  it('today first and forward; the days behind today below, folded under "Before today", open by themselves when something there is still owed', () => {
    for (const l of LOCALES) {
      const html = draw(l, 'list');
      const fold = html.indexOf('<details class="cal-earlier" open>');
      expect(fold, l).toBeGreaterThan(html.indexOf('<h2 class="cal-day" aria-current="date">'));
      expect(html.indexOf('data-src="handoffs:h0"'), l).toBeGreaterThan(fold);
      expect(html.slice(fold), l).toContain(`<summary>${t(l, 'calendar.earlier.fold')} <span class="cal-owed">`);
      // nothing owed behind today: the fold stays closed
      const kept = draw(l, 'list', { entries: DATES.filter((x) => x.source.id !== 'h0').concat(e({ category: 'samples', kind: 'sample_handled',
        at: at(addDays(TODAY, -2), '10:00'), source: { table: 'sample_requests', id: 'old', column: 'handled_at' } })) });
      expect(kept, l).toContain(`<details class="cal-earlier">\n      <summary>${t(l, 'calendar.earlier.fold')}</summary>`);
    }
  });
});

describe('the warmth run · every date carries a face and a sentence, never a bare dot', () => {
  for (const l of LOCALES) {
    it(`${l}: in the list, the week and the day — a face that opens the card, the kind's icon, one sentence naming the customer`, () => {
      for (const kind of ['list', 'week', 'day'] as const) {
        const html = draw(l, kind);
        const rows = rowsOf(html);
        expect(rows.length, `${l}/${kind}`).toBeGreaterThan(0);
        for (const r of rows) {
          const x = DATES.find((d) => `${d.source.table}:${d.source.id}` === r.src)!;
          const said = x.kind === 'own' ? x.detail.title! : t(l, `calendar.say.${x.kind}` as MessageKey, { who: nameOf(x) });
          const sentence = /<span class="dl-say">([\s\S]*?)<\/span>(?:<span class="small">|<\/span>)/.exec(r.html)?.[1] ?? '';
          expect(plain(sentence), `${l}/${kind}/${x.kind}`).toContain(said);
          // the name isolated where the sentence puts it: a Latin name inside Arabic keeps its direction, whole
          expect(sentence, `${l}/${kind}/${x.kind}`).toContain(`<bdi>${nameOf(x)}</bdi>`);
          expect(r.html, `${l}/${kind}/${x.kind}`).toContain('<svg class="kind-icon"');
          if (x.buyer) {
            expect(r.html, `${l}/${kind}/${x.kind}`).toContain(`<a class="face-link" href="/app/customers/${x.buyer.id}" data-card aria-label="${x.buyer.name}"><span class="face face-s `);
          } else {
            // a closure, the owner's own: nobody's — no face, the kind's icon alone in its place
            expect(r.html, `${l}/${kind}/${x.kind}`).toMatch(/<span class="dl-who dl-only"><svg class="kind-icon"/);
            expect(r.html, `${l}/${kind}/${x.kind}`).not.toContain('class="face');
          }
        }
      }
    });

    it(`${l}: in the month — a small face and the name, the card's door; a closure has its icon and its name`, () => {
      const html = draw(l, 'month');
      const items = [...html.matchAll(/<span class="mo-e [^"]*" data-src="([^"]+)"[^>]*>([\s\S]*?)<\/span>(?=<span class="mo-e|\s*<a class="mo-more"|\s*<\/td>)/g)];
      expect(items.length, l).toBeGreaterThan(0);
      for (const [, src, body] of items) {
        const x = DATES.find((d) => `${d.source.table}:${d.source.id}` === src)!;
        expect(body, `${l}/${x.kind}`).toContain(`<bdi>${nameOf(x)}</bdi>`);
        if (x.buyer) expect(body, `${l}/${x.kind}`).toMatch(new RegExp(`^<a class="face-link" href="/app/customers/${x.buyer.id}" data-card><span class="face face-xs `));
        else expect(body, `${l}/${x.kind}`).toMatch(/^<svg class="kind-icon"/);
      }
      // nothing drawn as a dot standing for a date
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
    // Chinese runs a Chinese name on and sets a Latin one off
    expect(t('zh', 'calendar.say.price_worked_out', { who: '陈莉' })).toBe('给陈莉算出的报价');
    expect(t('zh', 'calendar.say.price_worked_out', { who: 'Pedro' })).toBe('给 Pedro 算出的报价');
  });

  it('a kept photo is drawn from what the page already knows; nobody\'s photo is fetched to draw it', () => {
    const html = draw('en', 'list');
    expect(html).toContain(`<img class="face-p" src="/app/faces/${PEDRO.id}?v=${PEDRO.photo}"`);
    // the others are their coloured initials
    expect(html).toMatch(new RegExp(`href="/app/customers/${CHEN.id}" data-card aria-label="陈莉"><span class="face face-s t\\d" aria-hidden="true"><span class="face-i">陈</span></span>`));
  });
});

describe('the warmth run · a crowded day says "+N more" instead of stretching', () => {
  const crowd = (n: number) => Array.from({ length: n }, (_, i) => e({ category: 'samples', kind: 'sample_asked', at: at(addDays(TODAY, 9), `1${i}:00`),
    buyer: [PEDRO, AHMED, CHEN][i % 3]!, source: { table: 'sample_requests', id: `m${i}`, column: 'requested_at' } }));
  it('more than three: two, then "+N more", a door to that day; three: all three', () => {
    for (const l of LOCALES) {
      const html = withoutIsolates(draw(l, 'month', { entries: crowd(6) }));
      const cell = new RegExp(`<a class="mo-d" href="/app/calendar\\?view=day&amp;at=${addDays(TODAY, 9)}">[\\s\\S]*?</td>`).exec(html)![0];
      expect(cell.match(/<span class="mo-e /g), l).toHaveLength(MONTH_SHOWN);
      expect(cell, l).toContain(`<a class="mo-more" href="/app/calendar?view=day&amp;at=${addDays(TODAY, 9)}">${withoutIsolates(t(l, 'calendar.more', { n: 6 - MONTH_SHOWN }))}</a>`);
      const three = new RegExp(`<a class="mo-d" href="/app/calendar\\?view=day&amp;at=${addDays(TODAY, 9)}">[\\s\\S]*?</td>`).exec(draw(l, 'month', { entries: crowd(MONTH_WHOLE) }))![0];
      expect(three.match(/<span class="mo-e /g), l).toHaveLength(MONTH_WHOLE);
      expect(three, l).not.toContain('mo-more');
    }
    // every week the same height: the cell has a fixed height and nothing in it is cut
    expect(CSS).toContain('.mo td { height:7.5em; }');
    expect(rule('.mo-n')).toContain('overflow-wrap:break-word');
  });

  it('what is owed shows first in a crowded day: the glance says what the owner owes', () => {
    const owed = e({ category: 'negotiation', kind: 'reply_due', at: at(addDays(TODAY, 9), '23:00'), source: { table: 'handoffs', id: 'late', column: 'sla_deadline_at' } });
    const html = draw('en', 'month', { entries: [...crowd(4), owed] });
    const cell = new RegExp(`<a class="mo-d" href="/app/calendar\\?view=day&amp;at=${addDays(TODAY, 9)}">[\\s\\S]*?</td>`).exec(html)![0];
    expect(/<span class="mo-e [^"]*" data-src="([^"]+)"/.exec(cell)![1]).toBe('handoffs:late');
  });
});

describe('the warmth run · the day is one list in time order, done greyed', () => {
  it('the hour, the kind\'s icon, the face, the sentence — all day first, then by time; what is done is greyed and ticked, never hidden', () => {
    for (const l of LOCALES) {
      const html = draw(l, 'day');
      expect(html.match(/<ol class="dl">/g), l).toHaveLength(1);
      expect(html, l).not.toContain('<table');
      const rows = rowsOf(html);
      expect(rows.map((r) => r.src), l).toEqual(['sample_requests:s0', 'sample_requests:s1', 'quotes:q1', 'handoffs:h1']);
      // 08:00 dealt with: done. 09:12 asked, not dealt with: owed. 15:40 and 16:00 are still to come.
      expect(rows.map((r) => r.done), l).toEqual([true, false, false, false]);
      expect(rows[0]!.html, l).toContain('<span class="dot ok" aria-hidden="true">✓</span>');
      expect(rows[1]!.html, l).toContain('<span class="dot warn" aria-hidden="true">○</span>');
      for (const r of rows) expect(r.html, l).toMatch(/^\s*<span class="dl-hour">[^<]+<\/span><span class="dl-who/);
      // the day of today says so, in magenta
      expect(html, l).toContain(`<p class="cal-span"><span class="cal-now">${t(l, 'calendar.this.day')}</span> `);
    }
    expect(rule('.dl-row.done, .dl-row.done .dl-say')).toContain('color:var(--color-ink-secondary)');
    expect(rule('.dl-row.done .face, .mo-e.done .face')).toContain('filter:grayscale(1)');
  });
});

describe('the warmth run · the chrome folds away', () => {
  it('what the marks mean, choosing one kind or one customer, and adding a date are in ONE closed fold, under the period', () => {
    for (const l of LOCALES) for (const kind of ['list', 'week', 'month', 'day'] as const) {
      const html = draw(l, kind);
      const open = html.indexOf('<details class="cal-tools">');
      const close = html.indexOf('</details>', open);
      expect(open, `${l}/${kind}`).toBeGreaterThan(html.indexOf('<div class="cal-period">'));
      expect(html.match(/<details class="cal-tools"/g), `${l}/${kind}`).toHaveLength(1);
      for (const part of ['<p class="cal-legend small">', '<form method="get" action="/app/calendar" class="pform cal-filter">',
        '<form method="post" action="/app/calendar/entries" class="pform">', '<p class="muted cal-lede">']) {
        const i = html.indexOf(part);
        expect(i > open && i < close, `${l}/${kind}: ${part}`).toBe(true);
      }
      expect(html.slice(open, html.indexOf('</summary>', open)), `${l}/${kind}`).toContain(t(l, 'calendar.tools'));
    }
  });

  it('with nothing to choose between — one kind, one customer — there is no choice to make: the fold only adds a date', () => {
    for (const l of LOCALES) {
      const one = DATES.filter((x) => x.source.id === 'h1');
      const html = draw(l, 'list', { entries: one, buyers: [PEDRO], categories: ['negotiation'] });
      expect(html, l).not.toContain('cal-filter');
      expect(html, l).toContain(`<details class="cal-tools">\n      <summary>${t(l, 'calendar.add')}</summary>`);
      // a choice already made can always be changed or let go
      expect(draw(l, 'list', { entries: one, buyers: [PEDRO], categories: ['negotiation'], buyer: PEDRO }), l).toContain('cal-filter');
    }
  });

  it('a chosen kind or customer is said above the dates, with the way back to everything', () => {
    for (const l of LOCALES) {
      const html = draw(l, 'week', { buyer: AHMED, entries: DATES.filter((x) => x.buyer?.id === AHMED.id) });
      expect(html, l).toMatch(new RegExp(`<p class="cal-chosen small">[^<]*<bdi>${AHMED.name}[^<]*</bdi> <a href="/app/calendar\\?view=week&amp;at=${TODAY}">${t(l, 'calendar.empty.clear')}</a></p>`));
    }
  });
});

describe('the warmth run · an empty period is one warm panel with one door', () => {
  it('no fold, no legend, no filter above it — only the title, the views and the period; it says what will fill it, and offers adding a date', () => {
    for (const l of LOCALES) for (const [kind, key] of [['list', 'calendar.empty'], ['week', 'calendar.empty.week'], ['month', 'calendar.empty.month'], ['day', 'calendar.empty.day']] as const) {
      const html = draw(l, kind, { entries: [], buyers: [], categories: [] });
      expect(html, `${l}/${kind}`).not.toContain('cal-tools');
      expect(html, `${l}/${kind}`).not.toContain('cal-legend');
      expect(html, `${l}/${kind}`).not.toContain('cal-filter');
      expect(html, `${l}/${kind}`).not.toContain('<table');
      const panel = /<div class="empty cal-empty">([\s\S]*)<\/div>/.exec(html)?.[1] ?? '';
      expect(panel, `${l}/${kind}`).toContain(`<p class="cal-empty-t">${t(l, key)}</p>`);
      expect(panel, `${l}/${kind}`).toContain(`<p class="muted">${t(l, 'calendar.empty.how')}</p>`);
      expect(panel, `${l}/${kind}`).toContain(`<details class="cal-add"><summary>${t(l, 'calendar.add')}</summary>`);
      // one door: nothing else to follow
      expect(panel.match(/<a /g), `${l}/${kind}`).toBeNull();
      // what sits above it: the head and the period, nothing else
      const above = html.slice(0, html.indexOf('<div class="empty cal-empty">'));
      expect(above.replace(/<div class="cal-top">[\s\S]*?<\/nav><\/div>/, '').replace(/<div class="cal-period">[\s\S]*?<\/nav>\s*<\/div>/, '').replace(/<[^>]+>|\s/g, ''), `${l}/${kind}`).toBe('');
    }
    // warm: a rounded panel, no dashed grey box
    expect(rule('.empty.cal-empty')).toContain('border:0');
    expect(rule('.empty.cal-empty')).toContain('border-radius:var(--radius-card)');   // w4-whole-17: a panel of words is a card; the grid is the panel
  });
});

describe('the warmth run · today is magenta, and the month is rounded', () => {
  it('today\'s marker — its word in every view, its number in the month — is the magenta token, as text', () => {
    expect(rule('.cal-now')).toContain('color:var(--color-assistant)');
    expect(rule('.mo td.today .mo-d')).toContain('color:var(--color-assistant)');
    for (const l of LOCALES) {
      expect(withoutIsolates(draw(l, 'month')), l).toMatch(new RegExp(`<td class=" today" aria-current="date">\\s*<a class="mo-d" [^>]*>3</a><span class="cal-now">${t(l, 'calendar.this.day')}</span>`));
      expect(draw(l, 'list'), l).toContain(`<h2 class="cal-day" aria-current="date"><span class="cal-now">${t(l, 'calendar.this.day')}</span>`);
    }
  });

  it('the month\'s grid has round corners, and scrolls inside its own frame with a shade at an edge that has more', () => {
    expect(rule('.wk-scroll')).toContain('border-radius:var(--radius-panel)');
    expect(rule('.wk-scroll')).toContain('overflow-x:auto');
    expect(rule('.mo')).toContain('border-collapse:separate');
    expect(draw('en', 'month')).toContain('<div class="wk-scroll"><table class="mo">');
  });
});
