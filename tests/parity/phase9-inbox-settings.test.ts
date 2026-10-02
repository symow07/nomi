import { describe, it, expect } from 'vitest';
import { usd } from '../../src/core/types/money.js';
import { renderInboxList, type InboxList, type ConversationSummary } from '../../src/api/web/inbox.js';
import { shell, esc, hubFor } from '../../src/api/web/layout.js';
import { withWorkspace, withAssistantName, t as say } from '../../src/api/web/say.js';
import { withZone } from '../../src/api/web/zone.js';
import type { Person } from '../../src/core/conversation/people.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { linkedCss } from './linked-css.js';
import { withoutIsolates } from './isolates.js';
import { renderCalendar } from '../../src/api/web/calendar.js';
import { type CalendarEntry, type CalendarView } from '../../src/db/calendar.js';
import { dayKey, dayStart, addDays } from '../../src/core/owner/i18n/format.js';
import { money as showMoney } from '../../src/api/web/values.js';
import { renderAnalytics, type AnalyticsData } from '../../src/api/web/analytics.js';
import { renderOrder, proformaText, proformaFileName, type OrderView } from '../../src/api/web/orders.js';

/**
 * Phase 9, round two — the Customers list, an order, the calendar, Results and
 * the first settings pages (the inbox-settings-a area). Each block names the
 * findings it holds; every assertion reads the page as it is drawn.
 */

const NOW = new Date('2026-10-02T09:30:00Z');
const AGO = (min: number) => new Date(NOW.getTime() - min * 60_000);
const SCOPE = { name: null, several: false, outreach: true, setup: null, business: 'Atlas Trading', needsYou: 2, zone: 'Asia/Shanghai' };
const CSS = linkedCss(withWorkspace(SCOPE, () => shell({ title: 'T', active: 'inbox', locale: 'en', path: '/app/inbox', bodyHtml: '' })));
const shown = (l: Locale, key: string, params?: Record<string, string | number>) => withoutIsolates(esc(say(l, key as MessageKey, params)));

const conv = (id: string, over: Partial<ConversationSummary> = {}): ConversationSummary => ({
  conversationId: id, buyer: `Buyer ${id}`, country: 'AE', status: 'handled', needsAction: false,
  ownership: 'AI', heldBy: null, awaitingReview: false, handoffReason: null, deletionWaiting: false,
  latestMessage: `last words of ${id}`, latestAt: AGO(30),
  product: { name: 'LED String Lights 10m', nameZh: 'LED灯串' }, quantity: 5000, unitPrice: usd(1.45),
  channel: 'whatsapp', unanswered: false, lastFrom: 'assistant', ...over,
});
const LIST: InboxList = {
  filter: 'all', waitingCount: 2, blockedCount: 0, mineCount: 0, deletionCount: 0, channels: 1,
  conversations: [
    conv('c-wait', { buyer: 'Omar Haddad', ownership: 'WAITING_HUMAN', heldBy: 'unclaimed', handoffReason: 'human_requested', lastFrom: 'buyer', unanswered: true }),
    conv('c-review', { buyer: 'Leila Haddad', awaitingReview: true, status: 'awaiting', needsAction: true, lastFrom: 'buyer', unanswered: true }),
    conv('c-new', { buyer: 'Fatima Zahra', lastFrom: 'buyer', unanswered: true, live: true, latestAt: AGO(20) }),
    conv('c-old', { buyer: 'Camila Rocha', lastFrom: 'buyer', unanswered: true, live: true, latestAt: AGO(60 * 24 * 15) }),
    conv('c-answered', { buyer: 'Layla Mansour', latestAt: AGO(60) }),
    conv('c-closed', { buyer: 'Lucia Ferreira', lastFrom: 'buyer', unanswered: true, live: false, latestAt: AGO(60 * 24 * 2) }),
  ],
  query: '',
  page: { from: 1, to: 50, total: 71, next: '7_1790000000000000_0b5e7c1a-2f3d-4e8a-9c6b-1d2e3f4a5b6c', prev: null },
};
const list = (l: Locale, over: Partial<InboxList> = {}, people: readonly Person[] = []) =>
  withZone('Asia/Shanghai', () => withoutIsolates(renderInboxList({ ...LIST, ...over }, l, NOW, people)));
const rowOf = (h: string, id: string): string => new RegExp(`<a class="crow[^"]*" href="/app/inbox/${id}#latest">([\\s\\S]*?)</a>`).exec(h)?.[1] ?? '';
const heads = (h: string): string[] => [...h.matchAll(/<h2 class="bgroup-h">([^<]+)<\/h2>/g)].map((m) => m[1]!);

describe('the Customers list (V1-165–V1-183, inbox-calendar-new-02/03/05, missed-06)', () => {
  it('V1-173 · the assistant\'s customers who wrote last are headed apart, each run newest first', () => {
    for (const l of LOCALES) {
      const h = withAssistantName('Noor', () => list(l));
      expect(heads(h), l).toEqual([
        shown(l, 'buyers.group.needsYou'),
        shown(l, 'buyers.group.hersWaiting', { name: 'Noor' }),
        shown(l, 'buyers.group.hers', { name: 'Noor' }),
      ]);
      const at = (id: string) => h.indexOf(`/app/inbox/${id}#latest`);
      const second = h.indexOf(shown(l, 'buyers.group.hers', { name: 'Noor' }) + '</h2>');
      expect(at('c-new'), l).toBeLessThan(at('c-old'));
      expect(at('c-old'), l).toBeLessThan(second);
      // a closed conversation the customer wrote last is not in the open run
      expect(at('c-closed'), l).toBeGreaterThan(second);
    }
  });

  it('V1-174 · an unanswered row says so in words; an answered one carries the assistant\'s mark before its words', () => {
    for (const l of LOCALES) {
      const h = list(l);
      expect(rowOf(h, 'c-new'), l).toContain(`<span class="cr-why"><bdi>${shown(l, 'buyers.row.noReply')}</bdi></span>`);
      expect(rowOf(h, 'c-closed'), l).not.toContain(shown(l, 'buyers.row.noReply'));
      expect(rowOf(h, 'c-answered'), l).toContain('<span class="as" aria-hidden="true">✦</span> <span class="cr-text"');
      expect(rowOf(h, 'c-answered'), l).not.toContain(shown(l, 'buyers.row.noReply'));
      // a screen reader still hears who holds it
      expect(rowOf(h, 'c-new'), l).toContain(`<span class="sr">${shown(l, 'buyers.group.hers')}</span>`);
    }
  });

  it('inbox-calendar-new-03 · the marks are explained under the rows, in the groups\' own words', () => {
    for (const l of LOCALES) {
      const key = /<p class="cr-key caption muted">([\s\S]*?)<\/p>/.exec(list(l))?.[1] ?? '';
      expect(key, l).toContain(`<span class="ck-i is-needs"><span class="cr-mark" aria-hidden="true">○</span> ${shown(l, 'buyers.group.needsYou')}</span>`);
      expect(key, l).toContain(`<span class="cr-mark" aria-hidden="true">●</span> ${shown(l, 'buyers.group.yours')}`);
      expect(key, l).toContain(`<span class="cr-mark" aria-hidden="true">✦</span> ${shown(l, 'buyers.group.hers')}`);
      expect(key, l).toContain(`<span class="cr-mark" aria-hidden="true">✦</span> ${shown(l, 'buyers.key.wrote')}`);
    }
  });

  it('V1-177 · the pages either side are offered above the rows as well as under them', () => {
    const h = list('en');
    const pagers = [...h.matchAll(/<nav class="pager"/g)].map((m) => m.index!);
    expect(pagers).toHaveLength(2);
    expect(pagers[0]).toBeLessThan(h.indexOf('class="bgroup"'));
    expect(pagers[1]).toBeGreaterThan(h.lastIndexOf('class="bgroup"'));
    // one page: no pager at all
    expect(list('en', { page: { from: 1, to: 6, total: 6, next: null, prev: null } })).not.toContain('class="pager"');
  });

  it('V1-181 · inbox-calendar-missed-06 · V1-183 · the search form is the same with or without a search; Clear lives in what was found', () => {
    for (const l of LOCALES) {
      const plain = list(l);
      const found = list(l, { query: 'Haddad', conversations: LIST.conversations.slice(0, 2), page: { from: 1, to: 2, total: 2, next: null, prev: null } });
      const formOf = (h: string) => /<form class="search"[\s\S]*?<\/form>/.exec(h)![0].replace(/value="[^"]*"/, '');
      expect(formOf(found), l).toBe(formOf(plain));
      expect(formOf(found), l).not.toContain('class="clear"');
      expect(found, l).toContain(`${shown(l, 'buyers.search.found', { q: 'Haddad', n: 2 })} · <a class="clear" href="/app/inbox">${shown(l, 'buyers.search.clear')}</a>`);
      // nobody found: one way back, the same link; the panel holds the hint and no second door
      const none = list(l, { query: 'zzz', conversations: [], page: { from: 0, to: 0, total: 0, next: null, prev: null } });
      expect(none, l).toContain(`${shown(l, 'buyers.search.none', { q: 'zzz' })} · <a class="clear" href="/app/inbox">`);
      const panel = /<div class="empty">([\s\S]*?)<\/div>/.exec(none)![1]!;
      expect(panel, l).toBe(shown(l, 'buyers.search.noneBody'));
    }
    // Clear reads as a link, not as greyed-out text
    expect(CSS).toMatch(/\.found \.clear \{[^}]*color:var\(--color-ink\);[^}]*text-decoration:underline/);
  });

  it('V1-182 · the searched word is marked in the name it matched, by weight and a line', () => {
    const h = list('en', { query: 'haddad', conversations: LIST.conversations.slice(0, 2), page: { from: 1, to: 2, total: 2, next: null, prev: null } });
    expect(rowOf(h, 'c-wait')).toContain('<bdi>Omar <mark class="hit">Haddad</mark></bdi>');
    expect(rowOf(h, 'c-review')).toContain('<bdi>Leila <mark class="hit">Haddad</mark></bdi>');
    const byProduct = list('en', { query: 'string', conversations: LIST.conversations.slice(0, 1), page: { from: 1, to: 1, total: 1, next: null, prev: null } });
    expect(byProduct).toContain('<bdi class="cr-prod">LED <mark class="hit">String</mark> Lights 10m</bdi>');
    // no search, no mark; a name with markup in it is escaped before it is marked
    expect(list('en')).not.toContain('<mark');
    const odd = list('en', { query: 'b', conversations: [conv('c-x', { buyer: '<b>Bad</b>' })], page: { from: 1, to: 1, total: 1, next: null, prev: null } });
    expect(odd).toContain('&lt;<mark class="hit">b</mark>&gt;Bad&lt;/b&gt;');
    expect(CSS).toMatch(/mark\.hit \{ background:transparent; color:inherit; font-weight:700; text-decoration:underline;/);
  });

  it('inbox-calendar-new-02 · on a phone the product stays on the first line; only its figures give way', () => {
    const row = rowOf(list('en'), 'c-answered');
    expect(row).toContain('<span class="cr-detail"><bdi class="cr-prod">LED String Lights 10m</bdi><span class="cr-fig"> · <bdi>5,000 pcs</bdi></span><span class="cr-fig"> · <bdi>$1.45</bdi></span></span>');
    const phone = /@media \(max-width: 720px\) \{\s*\.cr-fig \{ display:none; \}\s*\}/.exec(CSS);
    expect(phone).not.toBeNull();
    expect(CSS).not.toMatch(/\.cr-detail \{ display:none; \}/);
  });

  it('V1-179 · inbox-calendar-new-05 · an empty Mine: the panel right under the tabs, with no rule and no door the tab above already is', () => {
    const people: Person[] = [{ id: 'owner', name: 'Owner', isOwner: true }, { id: 'p2', name: '陈莉', isOwner: false }];
    for (const l of LOCALES) {
      const h = list(l, { filter: 'mine', conversations: [], page: { from: 0, to: 0, total: 0, next: null, prev: null } }, people);
      expect(h, l).not.toContain('<div class="block">');
      const panel = /<div class="empty">([\s\S]*?)<\/div>/.exec(h)![1]!;
      expect(panel, l).not.toContain('filter=pending');
      expect(panel, l).toContain(shown(l, 'inbox.empty.mine'));
    }
  });

  it('V1-165 · the area is Customers: its empty Mine speaks of customers, not conversations', () => {
    expect(t('en', 'inbox.empty.mine')).toBe('No customer is in your hands right now.');
    expect(t('en', 'inbox.empty.mine')).not.toMatch(/conversation/i);
    expect(t('en', 'nav.conversations')).toBe('Customer list');
    expect(t('en', 'inbox.empty.seeAll')).toBe('See all customers');
  });

  it('V1-166 · the calendar door is the phone\'s (the rail has it on a wide screen); the list of contacts says what it is for', () => {
    const h = withWorkspace(SCOPE, () => list('en'));
    expect(h).toContain('<a class="deeper on-phone" href="/app/calendar">');
    expect(CSS).toMatch(/@media \(min-width: 721px\) \{ \.deeper\.on-phone \{ display:none; \} \}/);
    expect(h).toContain(`href="/app/contacts">${esc(t('en', 'contacts.door'))}`);
    expect(t('en', 'contacts.door')).toBe('Who you may write to first');
  });

  it('V1-167 · V1-175 · Chinese: the search button is 搜索, the holder runs on without a space, the tab and its group say the same', () => {
    expect(t('zh', 'buyers.search.go')).toBe('搜索');
    const people: Person[] = [{ id: 'owner', name: 'Owner', isOwner: true }, { id: 'p2', name: '陈莉', isOwner: false }];
    const h = list('zh', { conversations: [conv('c-held', { ownership: 'OWNER_CONTROLLED', heldBy: 'p2', lastFrom: 'person' })] }, people);
    expect(h).toContain('陈莉在跟进');
    expect(h).not.toContain('陈莉 在');
    expect(t('zh', 'buyers.group.needsYou')).toBe(t('zh', 'inbox.filter.pending'));
  });

  it('V1-168 · the Spanish and French search hints are no longer than the English one, so they fit the field at 360 px', () => {
    // Measured in a browser at 360 px: en 197 px, es 179, fr 166 in a 186–221 px field (zh and ar draw narrower).
    const en = Array.from(t('en', 'buyers.search.placeholder')).length;
    for (const l of ['es', 'fr'] as const) expect(Array.from(t(l, 'buyers.search.placeholder')).length, l).toBeLessThanOrEqual(en);
  });

  it('V1-169 · Spanish and French: the tab of all customers is plural', () => {
    expect(t('es', 'inbox.filter.all')).toBe('Todos');
    expect(t('fr', 'inbox.filter.all')).toBe('Tous');
  });

  it('V1-171 · the chosen tab stands out; the Find button is as tall as its field', () => {
    expect(CSS).toMatch(/\.tab\.on \{ background:var\(--color-surface\); border-color:var\(--color-ink\); box-shadow:inset 0 0 0 1px var\(--color-ink\);/);
    expect(CSS).toMatch(/\.search \.btn \{ align-self:stretch; \}/);
  });

  it('V1-172 · the rail\'s number says what it counts', () => {
    for (const l of LOCALES) {
      const page = withWorkspace({ ...SCOPE, needsYou: 3 }, () => shell({ title: 'T', active: 'inbox', locale: l, path: '/app/inbox', bodyHtml: '' }));
      expect(withoutIsolates(page), l).toContain(`<span class="navcount" aria-hidden="true">${shown(l, 'nav.waiting', { n: 3 })}</span>`);
    }
  });
});

/* ── The calendar (V1-199–V1-204, inbox-calendar-new-08/10–15, missed-16–20) ── */

const CAL_NOW = new Date('2026-10-02T09:30:00Z');            // Fri 17:30 in the business's zone
const CAL_ZONE = 'Asia/Shanghai';
const calAt = (ymd: string, hhmm: string): Date => new Date(dayStart(ymd, CAL_ZONE).getTime() + (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))) * 60_000);
const CAL_TODAY = dayKey(CAL_NOW, CAL_ZONE);
const MONDAY = addDays(CAL_TODAY, -4);
const NADIA = { id: '11111111-1111-4111-8111-111111111111', name: 'Nadia Rahimi', country: 'AE' };
const ANNA = { id: '22222222-2222-4222-8222-222222222222', name: 'Anna Kowalska', country: 'PL' };
const C1 = '33333333-3333-4333-8333-333333333333';
const ce = (x: Partial<CalendarEntry> & Pick<CalendarEntry, 'category' | 'kind' | 'at' | 'source'>): CalendarEntry => ({
  day: dayKey(x.at, CAL_ZONE), allDay: false, conversationId: C1, orderId: null, buyer: NADIA, identity: null, detail: {}, ...x,
});
const DATES: CalendarEntry[] = [
  ce({ category: 'samples', kind: 'sample_asked', at: calAt(MONDAY, '09:12'), source: { table: 'sample_requests', id: 's1', column: 'requested_at' } }),
  ce({ category: 'negotiation', kind: 'price_worked_out', at: calAt(addDays(MONDAY, 2), '02:19'), detail: { price: usd(1.95), quantity: 2000 },
    source: { table: 'quotes', id: 'q1', column: 'created_at' } }),
  ce({ category: 'orders', kind: 'order_state', at: calAt(addDays(MONDAY, 3), '17:53'), orderId: 'o1', buyer: ANNA,
    detail: { orderReference: 'USAB-de300000-0001', orderState: 'confirmed' }, source: { table: 'order_updates', id: 'u1', column: 'at' } }),
  ce({ category: 'negotiation', kind: 'reply_due', at: calAt(CAL_TODAY, '19:00'), source: { table: 'handoffs', id: 'h1', column: 'sla_deadline_at' } }),
];
const calView = (from: string, to: string, over: Partial<CalendarView> = {}): CalendarView => ({
  from, to, today: CAL_TODAY, category: null, buyer: null, buyers: [NADIA, ANNA],
  categories: ['samples', 'orders', 'negotiation'], entries: DATES.filter((x) => x.day >= from && x.day < to), ...over,
});
const drawCal = (l: Locale, view: 'week' | 'month' | 'day' | 'list', over: Partial<CalendarView> = {}): string => withZone(CAL_ZONE, () => withoutIsolates(
  view === 'week' ? renderCalendar(calView(MONDAY, addDays(MONDAY, 7), over), l, { view, at: CAL_TODAY, now: CAL_NOW })
    : view === 'month' ? renderCalendar(calView('2026-09-28', '2026-11-02', over), l, { view, at: '2026-10-01', now: CAL_NOW })
    : view === 'day' ? renderCalendar(calView(addDays(MONDAY, 2), addDays(MONDAY, 3), over), l, { view, at: addDays(MONDAY, 2), now: CAL_NOW })
    : renderCalendar(calView(addDays(CAL_TODAY, -7), addDays(CAL_TODAY, 14), over), l, { view, now: CAL_NOW })));
const VIEWS4 = ['week', 'month', 'day', 'list'] as const;
const UNIT = { week: 'week', month: 'month', day: 'day', list: 'list' } as const;

describe('the calendar', () => {
  it('V1-199 · inbox-calendar-missed-16 · every view moves the same way, in words, under the name of the period', () => {
    for (const l of LOCALES) for (const v of VIEWS4) {
      const h = drawCal(l, v);
      const move = /<nav class="cal-move"[^>]*>([\s\S]*?)<\/nav>/.exec(h)?.[1] ?? '';
      expect(move, `${l}/${v}`).toContain(`<span class="go" aria-hidden="true">‹</span>${esc(t(l, `calendar.prev.${UNIT[v]}` as MessageKey))}</a>`);
      expect(move, `${l}/${v}`).toContain(`${esc(t(l, `calendar.next.${UNIT[v]}` as MessageKey))}<span class="go" aria-hidden="true">›</span></a>`);
      expect(move, `${l}/${v}`).toContain(`<a class="tab cal-today" href=`);
      expect(h.indexOf('<p class="cal-span">'), `${l}/${v}`).toBeLessThan(h.indexOf('<nav class="cal-move"'));
      expect(h.indexOf('<nav class="cal-move"'), `${l}/${v}: at the top`).toBeLessThan(h.indexOf('cal-legend'));
      // the same lede and legend on every view; no second way of moving at the foot of the list
      expect(h, `${l}/${v}`).toContain(`<p class="muted cal-lede">${esc(t(l, 'calendar.lede'))}</p>`);
      expect(h, `${l}/${v}`).toContain('<p class="cal-legend small">');
      expect(h, `${l}/${v}`).not.toContain('<nav class="pager"');
    }
  });

  it('V1-200 · inbox-calendar-new-14 · the legend draws each mark it explains — ✦, owed, done — and its edges are swatches, not pills', () => {
    for (const l of LOCALES) {
      const legend = /<p class="cal-legend small">([\s\S]*?)<\/p>/.exec(drawCal(l, 'day'))![1]!;
      expect(legend, l).toContain(`<span class="as" aria-hidden="true">✦</span> ${shown(l, 'calendar.legend.assistant')}`);
      expect(legend, l).toContain(`<span class="dot warn" aria-hidden="true">○</span> ${shown(l, 'calendar.legend.owed')}`);
      expect(legend, l).toContain(`<span class="dot ok" aria-hidden="true">✓</span> ${shown(l, 'calendar.legend.done')}`);
      expect(legend, l).toContain('<span class="cal-sw solid" aria-hidden="true"></span>');
      expect(legend, l).not.toContain('wk-e');
    }
    expect(CSS).toMatch(/\.cal-sw \{[^}]*border-radius:2px; \}/);
    // the lists' rows carry the solid edge the legend names, as dashed ones carry theirs
    expect(CSS).toMatch(/\.dl-row\.solid \.dl-go \{ border-inline-start:2px solid/);
    expect(CSS).toMatch(/\.row\.solid \.grow \{ border-inline-start:2px solid/);
  });

  it('V1-201 · inbox-calendar-new-13 · done is a ✓ as well as grey, in every view; in Arabic an order is not "a request"', () => {
    for (const l of LOCALES) {
      const day = drawCal(l, 'day');
      expect(day, l).toMatch(/<li class="dl-row solid done"[\s\S]*?<span class="dot ok" aria-hidden="true">✓<\/span><span class="sr">/);
      expect(drawCal(l, 'week'), l).toMatch(/<a class="wk-e solid past" data-src="quotes:q1"[\s\S]*?<span class="dot ok" aria-hidden="true">✓<\/span>/);
      // a reply still owed is never greyed or ticked, whatever the hour
      expect(drawCal(l, 'week'), l).toMatch(/<a class="wk-e solid" data-src="handoffs:h1"[^>]*>[\s\S]*?<span class="dot warn" aria-hidden="true">○<\/span>/);
    }
    expect(t('ar', 'calendar.kind.order_state')).toBe('طلب شراء');
    expect(t('ar', 'calendar.kind.order_state')).not.toBe(t('ar', 'calendar.kind.sample_asked').split(' ')[0]);
  });

  it('V1-202 · inbox-calendar-new-15 · one fold chooses a kind or a customer, offering the same kinds in every view', () => {
    const options = (h: string) => [...(/<select name="category">([\s\S]*?)<\/select>/.exec(h)?.[1] ?? '').matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
    for (const l of LOCALES) {
      const all = VIEWS4.map((v) => drawCal(l, v));
      for (const h of all) {
        expect(h, l).not.toContain('cal-tabs');
        expect(h, l).toContain(`<details class="cal-filter">\n      <summary>${shown(l, 'calendar.filter.choose')}</summary>`);
        expect(options(h), l).toEqual(['', 'promised', 'samples', 'orders', 'negotiation', 'yours', 'closures', 'conversations']);
      }
      // the views' tabs are the only row of pills
      expect([...all[0]!.matchAll(/<nav class="tabs/g)], l).toHaveLength(1);
    }
    const chosen = drawCal('en', 'week', { category: 'samples', buyer: NADIA });
    expect(chosen).toContain('<summary>Showing: Samples · Nadia Rahimi · UAE</summary>');
  });

  it('V1-203 · adding a date is near the top of every view, above the dates', () => {
    for (const v of VIEWS4) {
      const h = drawCal('en', v);
      const body = Math.min(...['<table', '<ol class="dl"', '<h2 class="cal-day"'].map((s) => h.indexOf(s)).filter((i) => i >= 0));
      expect(h.indexOf('<details class="cal-add"'), v).toBeGreaterThan(0);
      expect(h.indexOf('<details class="cal-add"'), v).toBeLessThan(body);
    }
  });

  it('inbox-calendar-new-08 · a card\'s kind breaks into even lines, never leaving one word alone', () => {
    expect(CSS).toMatch(/\.wk-k, \.wk-t \{ overflow-wrap:break-word; text-wrap:balance; \}/);
    expect(CSS).toMatch(/\.wk-e b \{[^}]*text-wrap:balance;/);
  });

  it('inbox-calendar-new-11 · inbox-calendar-new-12 · a row says its kind once, and a quantity never leaves its number', () => {
    for (const l of LOCALES) {
      const row = /<li class="dl-row[^"]*" data-src="quotes:q1"[\s\S]*?<\/li>/.exec(drawCal(l, 'day'))![0];
      const kind = t(l, 'calendar.kind.price_worked_out');
      expect(row.split(kind).length - 1, l).toBe(1);
      expect(row, l).toContain(`${esc(kind)} · <bdi>${esc(t(l, 'calendar.detail.price', { price: withZone(CAL_ZONE, () => withoutIsolates(showMoney(l, usd(1.95)))), qty: l === 'zh' ? '2000' : '2,000' }))}</bdi>`);
      expect(t(l, 'calendar.detail.price'), l).toMatch(/ \{qty\}$/);
    }
  });

  it('inbox-calendar-missed-17 · inbox-calendar-missed-18 · the list names a date as the other views do, with no record code', () => {
    for (const l of LOCALES) {
      const h = drawCal(l, 'list');
      const order = /<li class="row[^"]*" data-src="order_updates:u1"[\s\S]*?<\/li>/.exec(h)![0];
      expect(order, l).not.toContain('USAB-de300000-0001');
      expect(order, l).toContain(`${esc(t(l, 'calendar.kind.order_state'))} · <bdi>${esc(t(l, 'order.status.confirmed' as MessageKey))}</bdi>`);
      const price = /<li class="row[^"]*" data-src="quotes:q1"[\s\S]*?<\/li>/.exec(h)![0];
      expect(price, l).toContain(`<span class="as" aria-hidden="true">✦</span> ${esc(t(l, 'calendar.kind.price_worked_out'))}`);
      expect(price, l).not.toContain(`>${esc(t(l, 'calendar.cat.negotiation'))} · `);
    }
  });

  it('inbox-calendar-missed-19 · no flag beside some customers and not others, in the rows or the customer choice', () => {
    for (const l of LOCALES) for (const v of VIEWS4) expect(drawCal(l, v), `${l}/${v}`).not.toMatch(/[\u{1F1E6}-\u{1F1FF}]/u);
  });

  it('inbox-calendar-missed-20 · the list keeps the prose measure, its head included', () => {
    const h = drawCal('en', 'list');
    expect(h.startsWith('<div class="measure-prose"><div class="cal-top">')).toBe(true);
    expect(drawCal('en', 'week').startsWith('<div class="measure-prose">')).toBe(false);
  });

  it('V1-204 · inbox-calendar-new-10 · the week has a row only for an hour that holds a date; today is said in a word', () => {
    const h = drawCal('en', 'week');
    const hours = [...h.matchAll(/<tr><th scope="row">(\d\d)<\/th>/g)].map((m) => m[1]);
    expect(hours).toEqual(['02', '09', '17', '19']);
    expect(h).toMatch(/<th scope="col" class="today" aria-current="date"><a [^>]*>[^<]*<b>2<\/b><\/a><span class="cal-now">Today<\/span><\/th>/);
    // nothing dated this week: the panel, and no table of empty hours
    const none = drawCal('en', 'week', { entries: [], categories: [] });
    expect(none).toContain(`<div class="empty">${t('en', 'calendar.empty.week')}</div>`);
    expect(none).not.toContain('<table class="wk">');
    const month = drawCal('en', 'month');
    expect(month).toMatch(/<td class=" today" aria-current="date">\s*<a class="mo-d" [^>]*>2<\/a><span class="cal-now">Today<\/span>/);
    expect(CSS).toMatch(/\.mo td\.today \.mo-d \{ border:1\.5px solid var\(--color-ink\);/);
  });
});

/* ── Results (V1-206–V1-212) ── */

const RESULTS: AnalyticsData = {
  range: 'week', hasActivity: true,
  summary: { newClients: 6, activeConvos: 5, quotes: 12, orders: 1 },
  activity: { inbound: 6, replied: 3, waiting: 1 },
  commerce: { quotes: 12, orders: 1, deals: [{ status: 'confirmed', n: 1 }], totals: [usd(11750)] },
  employee: { handled: 1, waiting: 1, edits: 0 },
};
const results = (l: Locale, over: Partial<AnalyticsData> = {}) => withoutIsolates(renderAnalytics({ ...RESULTS, ...over }, l));
const statsOf = (h: string) => [...h.matchAll(/<div class="stat"><div class="v">([^<]+)<\/div><div class="l">([^<]+)<\/div><\/div>/g)].map((m) => `${m[1]} ${m[2]}`);

describe('Results', () => {
  it('V1-206 · the period inside a sentence is lower case', () => {
    expect(results('en')).toContain('<p class="sub">This covers this week.</p>');
    expect(results('es')).toContain('<p class="sub">Esto abarca esta semana.</p>');
    expect(results('en', { range: 'today' })).toContain('This covers today so far.');
    const empty = withoutIsolates(renderAnalytics({ ...RESULTS, hasActivity: false, range: 'month' }, 'en'));
    expect(empty).toContain('Not enough activity for this month yet.');
  });

  it('V1-207 · Results is Today\'s page and says so; its period chip is not a second "Today"', () => {
    for (const l of LOCALES) {
      const h = results(l);
      expect(h, l).toContain(`<a class="back" href="/app"><span class="go" aria-hidden="true">‹</span>${shown(l, 'nav.home')}</a>`);
      expect(t(l, 'analytics.range.today'), l).not.toBe(t(l, 'nav.home'));
    }
  });

  it('V1-208 · each count is said once: prices and orders under their own heading only', () => {
    for (const l of LOCALES) {
      const rows = statsOf(results(l));
      expect(rows.filter((r) => r.startsWith('12 ')), l).toHaveLength(1);
      const overview = results(l).split(shown(l, 'analytics.section.activity'))[0]!;
      expect(statsOf(overview), l).toHaveLength(2);
    }
    // "Quotes sent" counted every price worked out, sent or not: it says what it counts
    expect(statsOf(results('en'))).toContain('12 prices worked out');
  });

  it('V1-209 · a count\'s words agree with it, in each language\'s own forms', () => {
    const en = statsOf(results('en'));
    expect(en).toEqual(expect.arrayContaining(['1 order placed', '1 reply waiting for your OK', '0 replies you changed before they went', '6 new customers']));
    expect(statsOf(results('es'))).toEqual(expect.arrayContaining(['1 pedido realizado', '1 respuesta que espera tu visto bueno']));
    expect(statsOf(results('ar', { summary: { ...RESULTS.summary, newClients: 12 } }))).toContain('12 عميلًا جديدًا');
    expect(statsOf(results('ar', { summary: { ...RESULTS.summary, newClients: 2 } }))).toContain('2 عميلان جديدان');
    for (const l of LOCALES) for (const r of statsOf(results(l))) expect(r, l).not.toMatch(/^1 (Orders|Pedidos|الطلبات)/);
  });

  it('V1-210 · the sales are a figure and its words, to the cent, like every other row — not a pill', () => {
    for (const l of LOCALES) {
      const h = results(l);
      expect(h, l).not.toContain('class="chip"');
      expect(h, l).toContain(`<div class="v">${withoutIsolates(esc(showMoney(l, usd(11750))))}</div><div class="l">${shown(l, 'analytics.commerce.value')}</div>`);
      expect(h, l).toContain(`${esc(t(l, `analytics.n.order.${new Intl.PluralRules(l).select(1)}` as MessageKey))} · ${esc(t(l, 'order.status.confirmed' as MessageKey))}`);
    }
  });

  it('V1-211 · the page keeps the prose measure, so its rules end where its rows do', () => {
    expect(results('en').startsWith('<div class="measure-prose">')).toBe(true);
  });

  it('V1-212 · Chinese: no double 的 in the heading, and the corrections line is a whole phrase', () => {
    const h = results('zh');
    expect(h).not.toContain('的工作总结');
    expect(h).toContain(`${esc(t('zh', 'analytics.section.employee'))}`);
    expect(statsOf(h)).toContain('0 条你改过再发的回复');
  });
});

/* ── An order (V1-188–V1-194, inbox-calendar-missed-07) ── */

const ORDER_VIEW: OrderView = {
  orderId: '44444444-4444-4444-8444-444444444444', reference: 'USAB-de300000-0001', conversationId: C1,
  buyer: 'Nadia Rahimi', productName: 'Stainless Steel Thermos 500ml', productNameZh: '保温杯', productSku: 'ZX-200',
  quantity: 5000, unit: 'pcs', unitPriceAmount: 2.35, totalAmount: 11750,
  currency: 'USD', email: 'n@example.com', paymentTerms: '30 days', incoterm: 'FOB',
  sellerName: 'Atlas Trading', confirmedAt: new Date('2026-09-30T06:00:00Z'), history: [],
};
const orderPage = (l: Locale, over: Partial<OrderView> = {}) => withZone(CAL_ZONE, () => withoutIsolates(renderOrder({ ...ORDER_VIEW, ...over }, l, null)));

describe('an order', () => {
  it('V1-188 · the proforma can be taken away: a download of the same text the page shows', () => {
    for (const l of LOCALES) {
      const h = orderPage(l);
      expect(h, l).toContain(`<a class="deeper" href="/app/orders/${ORDER_VIEW.orderId}/proforma.txt" download>${shown(l, 'order.invoice.download')}`);
      expect(h, l).toContain(`<pre class="doc" dir="ltr">${esc(proformaText(ORDER_VIEW)!)}</pre>`);
    }
    expect(proformaFileName({ ...ORDER_VIEW, reference: 'PI/2026 "x"' })).toBe('proforma-PI-2026-x-.txt');
    expect(proformaText({ ...ORDER_VIEW, paymentTerms: null })).toBeNull();
  });

  it('V1-189 · a confirmed order with nothing recorded since says when it was confirmed, and its menu starts there', () => {
    for (const l of LOCALES) {
      const h = orderPage(l);
      expect(h, l).not.toContain(shown(l, 'order.history.empty'));
      expect(h, l).toContain(shown(l, 'order.history.confirmed'));
      expect(h, l).toContain(`<option value="confirmed" selected>`);
      expect(h, l).toContain(`<p class="stated-now">${shown(l, 'order.state.confirmed')} `);
    }
  });

  it('V1-190 · inbox-calendar-missed-07 · the form says what it records, once, in plain sentences', () => {
    expect(t('en', 'order.update.intro')).toBe('When a customer asks where their order is, your assistant tells them the stage you recorded here and the day you recorded it. Your assistant never works out a delivery date from it.');
    for (const l of LOCALES) {
      expect(t(l, 'order.update.title'), l).not.toBe(t(l, 'order.update.state'));
      expect(t(l, 'order.update.save'), l).not.toBe(t(l, 'order.update.title'));
    }
    expect(t('en', 'order.update.save')).toBe('Record this stage');
  });

  it('V1-191 · an order lights the Customers list, and leads back to the customer', () => {
    expect(hubFor('/app/orders/44444444-4444-4444-8444-444444444444', 'inbox')).toBe('inbox');
    for (const l of LOCALES) {
      const page = withWorkspace(SCOPE, () => shell({ title: 'T', active: 'inbox', locale: l, path: '/app/orders/o1', bodyHtml: orderPage(l) }));
      expect(page, l).toMatch(/<a href="\/app\/inbox" class="subnav active" aria-current="page"/);
      expect(orderPage(l), l).toContain(`${shown(l, 'order.back')}</a>`);
    }
    expect(t('en', 'order.back')).toBe('Back to the customer');
  });

  it('V1-192 · Chinese: the product as the Customers list names it, the figures said to be below, no stray space', () => {
    const zh = orderPage('zh');
    expect(zh).toContain('<span class="fval"><bdi>保温杯</bdi></span>');
    expect(t('zh', 'order.invoice.intro').startsWith('下面')).toBe(true);
    expect(zh).not.toContain('你的助手 ');
  });

  it('V1-193 · the confirmation date has its year; the proforma keeps the prose measure', () => {
    expect(orderPage('en')).toContain('<span class="fval"><bdi>Wed, Sep 30, 2026</bdi></span>');
    expect(orderPage('es')).toMatch(/2026<\/bdi><\/span>/);
    expect(CSS).toMatch(/pre\.doc \{ white-space:pre-wrap; overflow-wrap:anywhere; text-align:start; max-width:var\(--measure-prose\); \}/);
  });

  it('V1-194 · Spanish reads as Spanish, not a word-for-word copy', () => {
    expect(t('es', 'order.update.tracking.placeholder')).toBe('El número que te dio la empresa de envíos');
    expect(t('es', 'order.invoice.intro')).not.toContain('Cópiala a tus propios documentos');
  });
});
