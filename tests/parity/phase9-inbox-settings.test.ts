import { describe, it, expect } from 'vitest';
import { usd } from '../../src/core/types/money.js';
import { renderInboxList, type InboxList, type ConversationSummary } from '../../src/api/web/inbox.js';
import { shell, esc, hubFor } from '../../src/api/web/layout.js';
import { withWorkspace, withAssistantName, t as say } from '../../src/api/web/say.js';
import { withZone } from '../../src/api/web/zone.js';
import type { Person } from '../../src/core/conversation/people.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t, tn, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { linkedCss } from './linked-css.js';
import { withoutIsolates } from './isolates.js';
import { renderCalendar, parseCalendarQuery } from '../../src/api/web/calendar.js';
import { type CalendarEntry, type CalendarView } from '../../src/db/calendar.js';
import { dayKey, dayStart, addDays } from '../../src/core/owner/i18n/format.js';
import { money as showMoney } from '../../src/api/web/values.js';
import { renderAnalytics, type AnalyticsData } from '../../src/api/web/analytics.js';
import { renderOrder, proformaText, proformaFileName, type OrderView } from '../../src/api/web/orders.js';
import { renderAccount } from '../../src/api/web/account.js';
import { renderBilling, type BillingView } from '../../src/api/web/billing.js';
import { renderBusinessKind } from '../../src/api/web/businessKind.js';
import { renderPhoneAlerts } from '../../src/api/web/phoneAlerts.js';
import { renderComponents } from '../../src/api/web/components.js';
import { renderDataRights } from '../../src/api/web/dataRights.js';
import { renderClosures, renderForbidden, FLOOR_BY_LANGUAGE } from '../../src/api/web/settings.js';
import { FORBIDDEN_FLOOR } from '../../src/core/safety/forbiddenWords.js';
import type { Viewer } from '../../src/core/conversation/people.js';

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
    conv('c-new', { buyer: 'Fatima Zahra', lastFrom: 'buyer', unanswered: true, live: true, latestAt: AGO(20), latestMessage: 'Can you do 3 colours per set?' }),
    conv('c-old', { buyer: 'Camila Rocha', lastFrom: 'buyer', unanswered: true, live: true, latestAt: AGO(60 * 24 * 15), latestMessage: 'Thanks, noted.' }),
    conv('c-answered', { buyer: 'Layla Mansour', latestAt: AGO(60) }),
    conv('c-closed', { buyer: 'Lucia Ferreira', lastFrom: 'buyer', unanswered: true, live: false, latestAt: AGO(60 * 24 * 2) }),
  ],
  query: '',
  page: { from: 1, to: 50, total: 71, next: '7_1790000000000000_0b5e7c1a-2f3d-4e8a-9c6b-1d2e3f4a5b6c', prev: null },
};
const list = (l: Locale, over: Partial<InboxList> = {}, people: readonly Person[] = []) =>
  withZone('Asia/Shanghai', () => withoutIsolates(renderInboxList({ ...LIST, ...over }, l, NOW, people)));
// The warmth run, phase 4 — the Inbox's own row: `irow`, the conversation behind its `ir-main` link.
const rowOf = (h: string, id: string): string => new RegExp(`<a class="ir-main" href="/app/inbox/${id}#latest">([\\s\\S]*?)</a></div>`).exec(h)?.[1] ?? '';
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
      expect(rowOf(h, 'c-new'), l).toContain(`<span class="ir-hold"><bdi>${shown(l, 'buyers.row.noReply')}</bdi></span>`);
      expect(rowOf(h, 'c-closed'), l).not.toContain(shown(l, 'buyers.row.noReply'));
      // the warmth run's phase 9 (w4-customers-03) — words that asked nothing are not owed a reply
      expect(rowOf(h, 'c-old'), l).not.toContain(shown(l, 'buyers.row.noReply'));
      // the mark, then who wrote it for a screen reader (the conversation batch), then the words
      expect(rowOf(h, 'c-answered'), l).toMatch(/<span class="ir-by"><span class="shape s-assistant as" aria-hidden="true"><\/span><span class="sr">[^<]+<\/span><\/span><span class="ir-text"/);
      expect(rowOf(h, 'c-answered'), l).not.toContain(shown(l, 'buyers.row.noReply'));
      // a screen reader still hears who holds it
      expect(rowOf(h, 'c-new'), l).toContain(`<span class="sr">${shown(l, 'buyers.group.hers')}</span>`);
    }
  });

  // The warmth run, phase 4 — the ○ ● ✦ column gave its place to the face; ○ is written with its
  // words on the row itself. What still needs a key is the ✦ before a message, and the regular's mark.
  it('inbox-calendar-new-03 · the marks are explained under the rows — only the marks the page shows', () => {
    for (const l of LOCALES) {
      const key = /<p class="cr-key caption muted">([\s\S]*?)<\/p>/.exec(list(l))?.[1] ?? '';
      expect(key, l).toContain(`<span class="ck-i"><span class="shape s-assistant as" aria-hidden="true"></span> ${shown(l, 'buyers.key.wrote')}</span>`);
      expect(key, l).not.toContain('cr-mark');
      expect(key, l).not.toContain('ir-reg');   // nobody on this page is a regular
      const regular = /<p class="cr-key caption muted">([\s\S]*?)<\/p>/.exec(list(l, { conversations: [conv('c-r', { regular: true })] }))?.[1] ?? '';
      expect(regular, l).toContain(shown(l, 'buyers.key.regular', { n: 3 }));
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
    // phase 4 — the row shows no product; found BY it, the product stands where the message would
    expect(byProduct).toContain('<bdi class="ir-text">LED <mark class="hit">String</mark> Lights 10m</bdi>');
    // no search, no mark; a name with markup in it is escaped before it is marked
    expect(list('en')).not.toContain('<mark');
    const odd = list('en', { query: 'b', conversations: [conv('c-x', { buyer: '<b>Bad</b>' })], page: { from: 1, to: 1, total: 1, next: null, prev: null } });
    expect(odd).toContain('&lt;<mark class="hit">b</mark>&gt;Bad&lt;/b&gt;');
    expect(CSS).toMatch(/mark\.hit \{ background:transparent; color:inherit; font-weight:700; text-decoration:underline;/);
  });

  // The warmth run, phase 4 — the row is the customer's: no product and no figures on it (what they
  // spent is its one number); on a phone the name keeps the room, and the channel gives way.
  it('inbox-calendar-new-02 · the row carries no product or figures; on a phone the channel gives way, not the name', () => {
    const row = rowOf(list('en'), 'c-answered');
    expect(row).not.toContain('LED String Lights 10m');
    expect(row).not.toContain('5,000');
    expect(row).not.toContain('$1.45');
    const phone = CSS.slice(CSS.indexOf('.ir-reg-w { position:absolute'));
    expect(CSS).toMatch(/@media \(max-width: 720px\) \{\s*\.ir-reg-w \{[^}]+\}\s*\.ir-chan \{ display:none; \}/);
    expect(phone).not.toBe('');
  });

  // The warmth run, phase 4 — "Mine" is gone (team machinery the owner ruled out); its old address
  // leads to the whole list. What V1-179 asked of an empty view still holds for the narrowings left.
  it('V1-179 · inbox-calendar-new-05 · an empty narrowing: the panel right under the tabs, with no rule', () => {
    for (const l of LOCALES) {
      const h = list(l, { filter: 'deletion', conversations: [], page: { from: 0, to: 0, total: 0, next: null, prev: null } });
      expect(h, l).not.toContain('<div class="block">');
      const panel = /<div class="empty">([\s\S]*?)<\/div>/.exec(h)![1]!;
      expect(panel, l).toContain(shown(l, 'inbox.empty.deletion'));
      expect(h, l).not.toContain(shown(l, 'inbox.empty.mine'));
    }
  });

  it('V1-165 · the area is Customers: its empty Mine speaks of customers, not conversations', () => {
    expect(t('en', 'inbox.empty.mine')).toBe('No customer is in your hands right now.');
    expect(t('en', 'inbox.empty.mine')).not.toMatch(/conversation/i);
    // The warmth run: the list's rail entry is "Inbox" (the owner renamed it), under Customers.
    expect(t('en', 'nav.conversations')).toBe('Inbox');
    expect(t('en', 'inbox.empty.seeAll')).toBe('See all customers');
  });

  it('V1-166 · no calendar door (the rail has Calendar on every width, and on a phone it repeated the tile); the list of contacts says what it is', () => {
    const h = withWorkspace(SCOPE, () => list('en'));
    expect(h).not.toContain('href="/app/calendar"');
    expect(CSS).not.toContain('.deeper.on-phone');
    // the door says the page's own name (V1-548, settings-b's fix)
    expect(h).toContain(`href="/app/contacts">${esc(t('en', 'contacts.title'))}`);
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
    // The identity system (2026-10-04) — the edge of the tab you are on is the brand's.
    expect(CSS).toMatch(/\.tab\.on \{ background:var\(--color-surface\); border-color:var\(--color-brand\); box-shadow:inset 0 0 0 1px var\(--color-brand\);/);
    expect(CSS).toMatch(/\.search \.btn \{ align-self:stretch; \}/);
  });

  it('V1-172 · the rail\'s number says what it counts', () => {
    for (const l of LOCALES) {
      const page = withWorkspace({ ...SCOPE, needsYou: 3 }, () => shell({ title: 'T', active: 'inbox', locale: l, path: '/app/inbox', bodyHtml: '' }));
      // The warmth run: on a wide screen the words; on a phone's tile the figure alone, at the icon's corner.
      expect(withoutIsolates(page), l).toContain(`<span class="navcount" aria-hidden="true"><span class="nl-long">${shown(l, 'nav.waiting', { n: 3 })}</span>`);
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
/**
 * The owner's correction (2026-10-04) — ONE screen, the month and the list together. What were four views are
 * now three places on it: this month with nothing chosen ('screen'), September — the month holding the week's
 * dates, all behind today ('sept') — and a day chosen in the grid ('day', Wednesday).
 */
const CAL_PLACES = { screen: {}, sept: { month: '2026-09' }, day: { month: '2026-09', day: addDays(MONDAY, 2) } } as const;
type CalPlace = keyof typeof CAL_PLACES;
const drawCal = (l: Locale, place: CalPlace, over: Partial<CalendarView> = {}): string => withZone(CAL_ZONE, () => {
  const ask = parseCalendarQuery(CAL_PLACES[place], CAL_NOW);
  return withoutIsolates(renderCalendar(calView(ask.from, ask.to, over), l, { ask, now: CAL_NOW }));
});
const PLACES = ['screen', 'sept', 'day'] as const;

describe('the calendar', () => {
  it('V1-199 · inbox-calendar-missed-16 · the screen moves a month at a time, in words, under the name of the month', () => {
    for (const l of LOCALES) for (const v of PLACES) {
      const h = drawCal(l, v);
      const move = /<nav class="cal-move"[^>]*>([\s\S]*?)<\/nav>/.exec(h)?.[1] ?? '';
      expect(move, `${l}/${v}`).toContain(`<span class="go" aria-hidden="true">‹</span>${esc(t(l, 'calendar.prev.month'))}</a>`);
      expect(move, `${l}/${v}`).toContain(`${esc(t(l, 'calendar.next.month'))}<span class="go" aria-hidden="true">›</span></a>`);
      expect(move, `${l}/${v}`).toContain(`<a class="tab cal-today" href=`);
      expect(h.indexOf('<p class="cal-span">'), `${l}/${v}`).toBeLessThan(h.indexOf('<nav class="cal-move"'));
      expect(h.indexOf('<nav class="cal-move"'), `${l}/${v}: at the top`).toBeLessThan(h.indexOf('cal-legend'));
      // the same lede in the page's one fold, and the legend under the dates (phase 9 of the warmth run); no second way of moving at the foot of the list
      expect(h, `${l}/${v}`).toContain(`<div class="cal-key"><p class="muted cal-lede">${esc(t(l, 'calendar.lede'))}</p>`);
      expect(h, `${l}/${v}`).toContain('<p class="cal-legend small">');
      expect(h, `${l}/${v}`).not.toContain('<nav class="pager"');
    }
  });

  it('V1-200 · inbox-calendar-new-14 · the legend draws each mark it explains — ✦, owed, done — and its edges are swatches, not pills', () => {
    for (const l of LOCALES) {
      // September holds a mark of each kind (phase 9 of the warmth run, w4-customers-14: the legend explains only the marks its list shows)
      const legend = /<p class="cal-legend small">([\s\S]*?)<\/p>/.exec(drawCal(l, 'sept'))![1]!;
      expect(legend, l).toContain(`<span class="shape s-assistant as" aria-hidden="true"></span> ${shown(l, 'calendar.legend.assistant')}`);
      expect(legend, l).toContain(`<span class="dot warn shape s-waiting" aria-hidden="true"></span> ${shown(l, 'calendar.legend.owed')}`);
      expect(legend, l).toContain(`<span class="dot ok shape s-ok" aria-hidden="true"></span> ${shown(l, 'calendar.legend.done')}`);
      expect(legend, l).toContain('<span class="cal-sw solid" aria-hidden="true"></span>');
      expect(legend, l).not.toContain('wk-e');
    }
    expect(CSS).toMatch(/\.cal-sw \{[^}]*border-radius:2px; \}/);
    // the list's rows (what is owed, the month's other dates, a chosen day: one row since the warmth run) carry the solid edge the legend names
    expect(CSS).toMatch(/\.dl-row\.solid \.dl-go \{ border-inline-start:2px solid/);
    expect(CSS).toMatch(/\.dl-row\.dashed \.dl-go \{ border-inline-start:2px dashed/);
  });

  it('V1-201 · inbox-calendar-new-13 · done is a ✓ as well as grey, in the list and in the grid; in Arabic an order is not "a request"', () => {
    for (const l of LOCALES) {
      const day = drawCal(l, 'day');
      expect(day, l).toMatch(/<li class="dl-row solid done"[\s\S]*?<span class="dot ok shape s-ok" aria-hidden="true"><\/span><span class="sr">/);
      expect(drawCal(l, 'sept'), l).toMatch(/<li class="dl-row solid done" data-src="quotes:q1"[\s\S]*?<span class="dot ok shape s-ok" aria-hidden="true"><\/span>/);
      // a reply still owed is never greyed or ticked, whatever the hour
      expect(drawCal(l, 'screen'), l).toMatch(/<li class="dl-row solid" data-src="handoffs:h1"[^>]*>[\s\S]*?<span class="dot warn shape s-waiting" aria-hidden="true"><\/span>/);
      // the grid, too: done greyed, owed marked
      expect(drawCal(l, 'screen'), l).toMatch(/<span class="mo-e solid done" data-src="quotes:q1"/);
      expect(drawCal(l, 'screen'), l).toMatch(/<span class="mo-e solid" data-src="handoffs:h1"[\s\S]*?<span class="dot warn shape s-waiting" aria-hidden="true"><\/span>/);
    }
    expect(t('ar', 'calendar.kind.order_state')).toBe('طلب شراء');
    expect(t('ar', 'calendar.kind.order_state')).not.toBe(t('ar', 'calendar.kind.sample_asked').split(' ')[0]);
  });

  it('V1-202 · inbox-calendar-new-15 · one form chooses a kind or a customer, offering the same kinds wherever the screen is', () => {
    const options = (h: string) => [...(/<select name="category">([\s\S]*?)<\/select>/.exec(h)?.[1] ?? '').matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
    for (const l of LOCALES) {
      for (const h of PLACES.map((v) => drawCal(l, v))) {
        expect(h, l).not.toContain('cal-tabs');
        expect(h, l).toContain(`<form method="get" action="/app/calendar" class="pform cal-filter">\n        <p class="cal-sub">${shown(l, 'calendar.filter.choose')}</p>`);
        expect(options(h), l).toEqual(['', 'promised', 'samples', 'orders', 'negotiation', 'yours', 'closures', 'conversations']);
        // the owner's correction — no row of view pills at all
        expect(h, l).not.toMatch(/<nav class="tabs/);
      }
    }
    const chosen = drawCal('en', 'screen', { category: 'samples', buyer: NADIA });
    expect(chosen).toContain('<p class="cal-chosen small">Showing: Samples · <bdi>Nadia Rahimi · UAE</bdi>');
  });

  it('V1-203 · adding a date is near the top of the screen, above the dates', () => {
    for (const v of PLACES) {
      const h = drawCal('en', v);
      const body = Math.min(...['<table', '<ol class="dl"', '<h3 class="cal-day"'].map((s) => h.indexOf(s)).filter((i) => i >= 0));
      expect(h.indexOf('<div class="cal-add">'), v).toBeGreaterThan(0);
      expect(h.indexOf('<div class="cal-add">'), v).toBeLessThan(body);
    }
  });

  it('inbox-calendar-new-08 · a date\'s sentence breaks into even lines, never leaving one word alone', () => {
    expect(CSS).toMatch(/\.dl-say \{ color:var\(--color-ink\); overflow-wrap:break-word; text-wrap:pretty; \}/);
  });

  it('inbox-calendar-new-11 · inbox-calendar-new-12 · a row says its kind once, and a quantity never leaves its number', () => {
    for (const l of LOCALES) {
      const row = /<li class="dl-row[^"]*" data-src="quotes:q1"[\s\S]*?<\/li>/.exec(drawCal(l, 'day'))![0];
      // the warmth run — the kind is said once, in the date's own sentence
      const said = t(l, 'calendar.say.price_worked_out', { who: NADIA.name });
      expect(row.replace(/<[^>]+>/g, '').split(said).length - 1, l).toBe(1);
      expect(row, l).toContain(`</span><span class="small"><bdi>${esc(t(l, 'calendar.detail.price', { price: withZone(CAL_ZONE, () => withoutIsolates(showMoney(l, usd(1.95)))), qty: l === 'zh' ? '2000' : '2,000' }))}</bdi></span>`);
      expect(t(l, 'calendar.detail.price'), l).toMatch(/ \{qty\}$/);
    }
  });

  it('inbox-calendar-missed-17 · inbox-calendar-missed-18 · the list names a date as a chosen day does, with no record code', () => {
    for (const l of LOCALES) {
      const order = /<li class="dl-row[^"]*" data-src="order_updates:u1"[\s\S]*?<\/li>/.exec(drawCal(l, 'screen'))![0];
      expect(order, l).not.toContain('USAB-de300000-0001');
      expect(order.replace(/<[^>]+>/g, ''), l).toContain(t(l, 'calendar.say.order_state', { who: ANNA.name }));
      expect(order, l).toContain(`<span class="small"><bdi>${esc(t(l, 'order.status.confirmed' as MessageKey))}</bdi></span>`);
      const price = /<li class="dl-row[^"]*" data-src="quotes:q1"[\s\S]*?<\/li>/.exec(drawCal(l, 'sept'))![0];
      expect(price, l).toMatch(/<span class="dl-say">(?:<span class="dot ok shape s-ok" aria-hidden="true"><\/span><span class="sr">[^<]*<\/span> )?<span class="shape s-assistant as" aria-hidden="true"><\/span> /);
      expect(price, l).not.toContain(`>${esc(t(l, 'calendar.cat.negotiation'))} · `);
    }
  });

  it('inbox-calendar-missed-19 · no flag beside some customers and not others, in the rows or the customer choice', () => {
    for (const l of LOCALES) for (const v of PLACES) expect(drawCal(l, v), `${l}/${v}`).not.toMatch(/[\u{1F1E6}-\u{1F1FF}]/u);
  });

  it('inbox-calendar-missed-20 · the list keeps the prose measure; the head and the grid take the column', () => {
    for (const v of PLACES) expect(drawCal('en', v).startsWith('<h1 class="page">'), v).toBe(true);
    expect(CSS).toMatch(/\.cal-list \{ max-width:var\(--measure-prose\); \}/);
    expect(CSS).not.toMatch(/\.cal-grid \{[^}]*max-width/);
  });

  it('V1-204 · inbox-calendar-new-10 · the month\'s list has a day only where a date is; today is said in a word, in magenta', () => {
    const h = drawCal('en', 'sept');
    const days = [...h.matchAll(/<h3 class="cal-day"[^>]*>([\s\S]*?)<\/h3>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, '').trim());
    expect(days).toEqual(['Mon, Sep 28', 'Wed, Sep 30']);     // what is owed (today's reply) stands under its own heading
    // nothing dated this month: the warm panel, and nothing drawn for the days
    const none = drawCal('en', 'screen', { entries: [], categories: [] });
    expect(none).toContain(`<p class="cal-empty-t">${t('en', 'calendar.empty.month')}</p>`);
    expect(none).not.toContain('<h3 class="cal-day"');
    const month = drawCal('en', 'screen');
    expect(month).toMatch(/<td class="today" aria-current="date">\s*<a class="mo-d" [^>]*>2<\/a><span class="cal-now">Today<\/span>/);
    // The identity system (2026-10-04) — today is the brand, an accent; the light shade is the assistant's alone.
    expect(CSS).toMatch(/\.mo td\.today \.mo-d \{ color:var\(--color-brand\); font-weight:700; \}/);
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
    // The warmth run's phase 9 (w4-customers-20) — Today's figure, in Today's words: quotes GIVEN, orders confirmed
    expect(statsOf(results('en'))).toContain('12 quotes sent');
  });

  it('V1-209 · a count\'s words agree with it, in each language\'s own forms', () => {
    const en = statsOf(results('en'));
    expect(en).toEqual(expect.arrayContaining(['1 order confirmed', '1 reply waiting for your OK', '0 replies you changed before they went', '6 new customers']));
    expect(statsOf(results('es'))).toEqual(expect.arrayContaining(['1 pedido confirmado', '1 respuesta que espera tu visto bueno']));
    expect(statsOf(results('ar', { summary: { ...RESULTS.summary, newClients: 12 } }))).toContain('12 عميلًا جديدًا');
    expect(statsOf(results('ar', { summary: { ...RESULTS.summary, newClients: 2 } }))).toContain('2 عميلان جديدان');
    for (const l of LOCALES) for (const r of statsOf(results(l))) expect(r, l).not.toMatch(/^1 (Orders|Pedidos|الطلبات)/);
  });

  it('V1-210 · the sales are a figure and its words, to the cent, like every other row — not a pill', () => {
    for (const l of LOCALES) {
      const h = results(l);
      expect(h, l).not.toContain('class="chip"');
      // the warmth run's phase 9 (w4-customers-22) — the Sales section's headline line, under its own heading
      expect(h, l).toContain(`<p class="an-total"><span class="v">${withoutIsolates(esc(showMoney(l, usd(11750))))}</span> <span class="l">${shown(l, 'analytics.commerce.value')}</span></p>`);
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
      // the same text the file holds; the warmth run's phase 9 (w4-customers-09) — the article number held whole
      expect(h.replace(/<span class="doc-code">([^<]*)<\/span>/g, '$1'), l).toContain(`<pre class="doc" dir="ltr">${esc(proformaText(ORDER_VIEW)!)}</pre>`);
      expect(h, l).toContain('<span class="doc-code">(ZX-200)</span>');
      // w4-customers-12 — it says it saves a file, with a file's mark, not a door's chevron
      expect(h, l).toContain(`${shown(l, 'order.invoice.download')}<span class="go" aria-hidden="true">↓</span></a>`);
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
      expect(page, l).toMatch(/<a href="\/app\/inbox" class="navlink sub active" data-nav="inbox" aria-current="page"/);
      expect(orderPage(l), l).toContain(`${shown(l, 'order.back')}</a>`);
    }
    // the fix wave (w4-whole-13) — it opens the conversation, and says so
    expect(t('en', 'order.back')).toBe('Back to the conversation');
  });

  it('V1-192 · Chinese: the product as the Customers list names it, the figures said to be below, no stray space', () => {
    const zh = orderPage('zh');
    expect(zh).toContain('<span class="fval"><bdi>保温杯</bdi></span>');
    expect(t('zh', 'order.invoice.intro').startsWith('下面')).toBe(true);
    expect(zh).not.toContain('你的助手 ');
  });

  it('V1-193 · the confirmation date has its year; the proforma keeps the prose measure', () => {
    // the warmth run's phase 9 (w4-customers-11) — said once, with its year, by the line that says where it stands;
    // a "Confirmed on" row only once something has happened since
    expect(orderPage('en')).toContain('since Wed, Sep 30, 2026');
    expect(orderPage('en')).not.toContain(shown('en', 'order.field.confirmed'));
    const shipped = orderPage('en', { history: [{ state: 'shipped', at: new Date('2026-10-02T06:00:00Z'), note: null, trackingReference: null, by: 'owner' }] });
    expect(shipped).toContain('<span class="fval"><bdi>Wed, Sep 30, 2026</bdi></span>');
    expect(orderPage('es')).toMatch(/2026<\/span><\/p>/);
    expect(CSS).toMatch(/pre\.doc \{ white-space:pre-wrap; overflow-wrap:anywhere; text-align:start; max-width:var\(--measure-prose\); \}/);
  });

  it('V1-194 · Spanish reads as Spanish, not a word-for-word copy', () => {
    expect(t('es', 'order.update.tracking.placeholder')).toBe('El número que te dio la empresa de envíos');
    expect(t('es', 'order.invoice.intro')).not.toContain('Cópiala a tus propios documentos');
  });
});

/* ── The settings pages (settings-a) ── */

const OWNER: Viewer = { id: 'owner', isOwner: true };
const DATA = { businessName: 'Atlas Trading', requests: [] };
const PAGES: Record<string, (l: Locale) => string> = {
  account: (l) => renderAccount({ email: null, passwordMin: 10 }, l, null, t(l, 'nav.settings')),
  alerts: (l) => renderPhoneAlerts({ publicKey: 'BPk', phones: [] }, l, null),
  billing: (l) => renderBilling({ configured: false, state: { billed: false } as BillingView['state'], plans: [], people: 1, assistants: 1, returned: null }, l, null, t(l, 'nav.settings')),
  business: (l) => renderBusinessKind({ kind: 'manufacturer', country: 'CN', website: null }, l, null, t(l, 'nav.settings')),
  closures: (l) => renderClosures({ closures: [] }, l, null),
  components: (l) => renderComponents(l),
  data: (l) => renderDataRights(DATA, l, null, OWNER, t(l, 'nav.settings')),
  forbidden: (l) => renderForbidden({ own: [], floor: FORBIDDEN_FLOOR }, l, null),
};
const draw = (page: string, l: Locale): string => withoutIsolates(PAGES[page]!(l));
const textOf = (h: string) => h.replace(/<[^>]+>/g, ' ');

describe('the settings pages', () => {
  it('V1-465 · V1-470 · V1-476 · V1-478 · V1-499 · V1-506 · each tab names its page by its heading, not "Setup"', () => {
    for (const l of LOCALES) for (const p of ['account', 'billing', 'business', 'closures', 'data', 'forbidden']) {
      const body = PAGES[p]!(l);
      const h1 = /<h1 class="page">([\s\S]*?)<\/h1>/.exec(body)![1]!.replace(/<[^>]+>/g, '');
      const page = withWorkspace(SCOPE, () => shell({ title: t(l, 'nav.settings'), active: 'settings', locale: l, path: `/app/settings/${p}`, bodyHtml: body }));
      expect(page, `${l}/${p}`).toContain(`<title>${h1} · Atlas Trading</title>`);
    }
  });

  it('V1-478 · V1-506 · V1-491 · V1-468 · each page leads back to where it is reached from, drawn the same way, the heading under it', () => {
    // Phase 7 — closures are reached from My business › How you sell; the gallery and the alerts are Setup's (/app/settings/setup).
    const backs: Record<string, string> = { closures: '/app/business/how-you-sell', forbidden: '/app/employee', components: '/app/settings/setup', alerts: '/app/settings/setup' };
    for (const l of LOCALES) for (const [p, href] of Object.entries(backs)) {
      expect(draw(p, l).trimStart().startsWith(`<a class="back" href="${href}">`), `${l}/${p}`).toBe(true);
    }
    expect(draw('alerts', 'en')).not.toContain('<div class="dhead">');
  });

  it('settings-a-new-09 · one intro style: the lede, under the heading', () => {
    for (const p of ['alerts', 'billing', 'business', 'closures', 'forbidden']) {
      const h = draw(p, 'en');
      expect(h, p).toMatch(/<\/h1>\s*<p class="lede">/);
    }
  });

  it('settings-a-new-10 · an empty panel spans the column, as the cards above it do', () => {
    for (const p of ['alerts', 'closures', 'forbidden', 'data']) expect(draw(p, 'en'), p).toContain('<div class="empty whole">');
    expect(CSS).toMatch(/\.empty\.whole \{ max-width:100%; \}/);
  });

  it('V1-464 · V1-466 · settings-a-new-01 · settings-a-new-02 · your sign-in: the row names what it holds, in each language\'s own word for the code', () => {
    for (const l of LOCALES) {
      const h = draw('account', l);
      expect(h, l).toContain(`<span class="fr-name">${shown(l, 'account.row.password')}</span>`);
      expect(t(l, 'account.row.password'), l).not.toBe(t(l, 'account.title'));
    }
    // The warmth run, phase 9 — the door's word for the code (访问码 / رمز الوصول), on Setup's row and this page alike.
    expect(t('zh', 'account.codeOnly')).toBe('没有：你用访问码登录。');
    expect(t('zh', 'setup.value.accessCode')).toBe(t('zh', 'login.passwordLabel'));
    expect(t('ar', 'setup.value.accessCode')).toBe('رمز الوصول');
    expect(t('ar', 'account.codeOnly')).toContain('رمز الوصول');
    expect(t('zh', 'account.codeOnly')).toContain(t('zh', 'setup.value.accessCode'));
    expect(t('zh', 'account.codeOnly')).not.toContain('进入密码');
    expect(t('ar', 'account.codeOnly').split('دخول').length - 1).toBe(1);
  });

  it('V1-467 · settings-a-new-04 · settings-a-new-06 · alerts: why the day-long window matters, where to turn a phone on, the phones as rows', () => {
    expect(t('en', 'alerts.phone.lede')).toContain('so you can answer in time: Instagram, Messenger and WhatsApp let you answer only within a day');
    for (const l of LOCALES) expect(draw('alerts', l), l).toContain(shown(l, 'alerts.phone.none'));
    expect(t('en', 'alerts.phone.none')).toBe('None yet. Open this page on your phone and turn notifications on there.');  // the warmth run, phase 9 (w4-settings-a-06): one name, notifications
    const one = withoutIsolates(renderPhoneAlerts({ publicKey: 'BPk', phones: [{ id: '66666666-6666-4666-8666-666666666666', personId: null, endpoint: 'https://push.example/x', p256dh: 'k', auth: 'a', device: 'iPhone', createdAt: NOW }] }, 'en', null));
    expect(one).toContain('<div class="scard"><div class="setrow"><div class="fr-l"><span class="fr-name">iPhone</span>');
  });

  it('V1-469 · V1-471 · settings-a-new-05 · settings-a-new-06 · billing: the plan and what is charged, as rows; no software word', () => {
    const installation: Record<Locale, string> = { en: 'installation', zh: '安装', ar: 'التثبيت', es: 'instalación', fr: 'installation' };
    for (const l of LOCALES) {
      const h = draw('billing', l);
      expect(h, l).not.toContain(installation[l]);
      expect(h, l).toContain(`<span class="fr-name">${shown(l, 'billing.row.plan')}</span>`);
      expect(h, l).toContain(`<span class="fr-name">${shown(l, 'billing.row.charged')}</span>`);
      expect(withoutIsolates(renderBilling({ configured: true, state: { billed: false } as BillingView['state'], plans: [], people: 1, assistants: 1, returned: null }, l, null, 'x')), l)
        .toContain(`<span class="fr-value">${shown(l, 'billing.value.nothing')}</span>`);
    }
    expect(t('zh', 'billing.title')).toBe('账单');
  });

  it('V1-472 · V1-473 · V1-474 · V1-475 · settings-a-new-07 · kind of business: what the page holds, what it is for, the country not asked twice', () => {
    for (const l of LOCALES) {
      const h = draw('business', l);
      expect(/<h1 class="page">([^<]*)<\/h1>/.exec(h)![1], l).toBe(shown(l, 'business.kind.title'));
      expect(t(l, 'business.kind.title'), l).toBe(t(l, 'setup.desc.kind'));
      expect(t(l, 'business.kind.title'), l).not.toBe(t(l, 'signup.kind'));
      expect(h, l).toContain(`<p class="lede">${shown(l, 'business.kind.lede')}</p>`);
      expect(h, l).toContain(esc(t(l, 'settings.field.location')));
      expect(h, l).toContain(esc(t(l, 'settings.profile.title')));
    }
    const zh = draw('business', 'zh');
    const options = [...(/<select id="bk-country"[^>]*>([\s\S]*?)<\/select>/.exec(zh)![1]!).matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
    expect(options.slice(0, 2)).toEqual(['', 'CN']);
  });

  it('V1-480 · V1-482 · V1-484 · closures: the label asks what is meant, the page shows what a customer is told, Arabic in sentences', () => {
    for (const l of LOCALES) {
      expect(t(l, 'closures.add.label'), l).toMatch(/[?？؟]$/);
      // the warmth run, phase 9 (w4-settings-a-13) — with no closure yet, the sample as it reads mid-sentence
      expect(draw('closures', l), l).toContain(shown(l, 'closures.example', { label: t(l, 'closures.example.sample') }));
    }
    expect(t('en', 'closures.example')).toContain('“We are closed for {label}, so no delivery date can be promised for this order yet.”');
    expect(t('en', 'closures.example', { label: t('en', 'closures.example.sample') })).toContain('“We are closed for the annual holiday,');
    for (const l of ['es', 'fr'] as const) expect(t(l, 'closures.example.sample'), l).toMatch(/^\p{Ll}/u);
    // (w4-settings-a-14) the Chinese notices: no space before a Chinese name, and the page's own word for the days
    expect(t('zh', 'closures.flash.added', { label: '春节' })).toContain('，你的助手不会承诺。');
    expect(t('zh', 'closures.flash.restored')).toContain('休息的日子');
    expect(t('ar', 'closures.empty')).toContain('مدة التسليم');
    expect(t('ar', 'closures.intro')).not.toMatch(/لا وعد|لا اختلاق/);
  });

  it('V1-483 · in Arabic a date or a time sits on the reading side of its field', () => {
    expect(CSS).toMatch(/\[dir="rtl"\] input\[type="date"\], \[dir="rtl"\] input\[type="time"\] \{ text-align:end; \}/);
  });

  it('V1-488 · V1-489 · V1-491 · settings-a-new-11 · the component gallery: says its controls are samples, plain words, the neutral pill on a card', () => {
    const h = draw('components', 'en');
    expect(h).toContain('<div class="tabs"><span class="tab on">');
    expect(t('en', 'components.lead')).toContain('pressing one does nothing');
    expect(h).toMatch(/<div class="card"><p><span class="pill ok">[\s\S]*?<span class="pill owner">[\s\S]*?<span class="as"><span class="shape s-assistant" aria-hidden="true"><\/span> /);
    expect(t('ar', 'components.chips')).not.toBe('الرقائق');
    expect(t('ar', 'components.doors')).not.toBe('الأبواب');
    for (const w of ['常态', '悬停', '聚焦']) expect([t('zh', 'components.state.rest'), t('zh', 'components.state.hover'), t('zh', 'components.state.focus')]).not.toContain(w);
    expect(t('zh', 'components.lead')).not.toContain('什么手机都行');
  });

  it('V1-492 · V1-497 · V1-500 · your data: each file a row with its own Download, two sections, the limit\'s figure written out', () => {
    for (const l of LOCALES) {
      const h = draw('data', l);
      expect(h, l).not.toContain('<ul class="chips">');
      // the warmth run, phase 9 (w4-settings-a-18) — Download saves a file: its own mark, not a door's chevron
      const files = [...h.matchAll(/<li class="row">\s*<span>([^<]+)<\/span>\s*<a class="dl-get" href="\/app\/settings\/data\/[a-z-]+\.csv" download><svg class="ni"/g)];
      expect(files, l).toHaveLength(9);
      // "What you set up" opens its own section, with the space sections have (it touched the rows above)
      expect(h, l).toMatch(new RegExp(`</section>\\s*<section class="block">\\s*<h2>${esc(t(l, 'data.export.configTitle'))}</h2>`));
    }
    expect(draw('data', 'en')).toContain('up to 20,000 rows');
  });

  it('V1-493 · settings-a-new-13 · settings-a-missed-15 · closing the workspace (0126): a card of rows, a red button, words that agree with it', () => {
    const h = draw('data', 'en');
    expect(h).toMatch(/<form method="post" action="\/app\/settings\/data\/close">\s*<input type="hidden" name="asked" value="0" \/>\s*<section class="sgroup"><div class="scard"><div class="setrow"><div class="fr-l"><label class="fr-name" for="dr-name">/);
    expect(h).toContain('<button class="btn danger" type="submit"');
    for (const l of LOCALES) {
      expect(t(l, 'data.deletion.now'), l).not.toMatch(/not a button|不是一个按|ليس زرًّا|no es un botón|n’est pas un bouton/i);
    }
  });

  it('V1-494 · V1-495 · V1-496 · V1-498 · V1-501 · settings-a-missed-16 · one name for the list, the team not the operator, an address for "us", Arabic kept together', () => {
    for (const l of LOCALES) expect(t(l, 'data.export.subject.contacts'), l).toBe(t(l, 'contacts.title'));
    // 0126 — the owner deletes now; nobody else carries it out, so nobody else is named.
    expect(t('en', 'data.buyers.lead')).toContain('you delete it');
    for (const w of ['operator', '运营方', 'مشغّل', 'opérateur']) for (const l of LOCALES) expect(t(l, 'data.buyers.lead'), l).not.toContain(w);
    const withAddress = withoutIsolates(renderDataRights({ ...DATA, contact: 'privacy@nomi.example' }, 'en', null, OWNER, 'x'));
    expect(withAddress).toContain('write to privacy@nomi.example and we will send the rest');
    expect(draw('data', 'en')).not.toMatch(/write to us/);
    expect(t('en', 'data.deletion.why')).toBe('Anything the Nomi team should know (optional)');
    expect(t('ar', 'data.buyers.lead')).not.toContain('30 يومًا');
    expect(t('ar', 'data.buyers.lead')).not.toContain('فـNomi');
    expect(t('ar', 'data.export.configTitle')).not.toMatch(/إعداد/);
    expect(t('en', 'data.buyers.fromChat')).not.toContain('usually');
    expect(t('en', 'data.buyers.fromChat')).toContain('is not listed: delete their data yourself');
  });

  it('settings-a-new-14 · settings-a-missed-17 · nobody asked yet is a state; a heading that wraps does so evenly', () => {
    expect(draw('data', 'en')).toContain(`<div class="empty whole">${esc(t('en', 'data.buyers.none'))}</div>`);
    expect(t('es', 'data.buyers.title')).toBe('Clientes que pidieron borrar sus datos');
    expect(CSS).toMatch(/main h2 \{[^}]*text-wrap:balance; \}/);
    expect(CSS).toMatch(/h1\.page \{[^}]*text-wrap:balance; \}/);
  });

  it('V1-502 · settings-a-new-18 · the fixed words: what they are and how many on the fold, one line a language inside', () => {
    expect(FLOOR_BY_LANGUAGE.flatMap((g) => g.words)).toEqual([...FORBIDDEN_FLOOR]);
    for (const l of LOCALES) {
      const h = draw('forbidden', l);
      expect(h, l).toContain(`<h2>${shown(l, 'forbidden.floor.title')}</h2>`);
      expect(h, l).toContain(`<summary>${withoutIsolates(esc(tn(l, 'forbidden.floor.count', FORBIDDEN_FLOOR.length)))}</summary>`);
      // why it is there is said before the fold, not inside it
      expect(h.indexOf(shown(l, 'forbidden.floor.body')), l).toBeLessThan(h.indexOf('<details class="floor-fold">'));
      expect([...h.matchAll(/<dt>/g)], l).toHaveLength(FLOOR_BY_LANGUAGE.length);
    }
    expect(draw('forbidden', 'en')).toContain('<dt>English</dt><dd><bdi>fuck</bdi>, <bdi>fucks</bdi>');   // V1-504: each form listed
  });

  it('V1-503 · V1-508 · the hints fit at 360 px, and the note reads as one', () => {
    // Measured in a browser at 360 px: es 243 px, fr 226 px in a 264 px field.
    for (const l of ['es', 'fr'] as const) expect(Array.from(t(l, 'forbidden.add.placeholder')).length, l).toBeLessThanOrEqual(31);
    expect(t('en', 'forbidden.add.note')).toBe('A note for yourself (optional)');
    expect(t('zh', 'forbidden.add.note')).toBe(t('zh', 'order.update.note') + '（可不填）');
  });
});
