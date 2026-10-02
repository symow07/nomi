import { describe, it, expect } from 'vitest';
import { usd } from '../../src/core/types/money.js';
import { renderInboxList, type InboxList, type ConversationSummary } from '../../src/api/web/inbox.js';
import { shell, esc } from '../../src/api/web/layout.js';
import { withWorkspace, withAssistantName, t as say } from '../../src/api/web/say.js';
import { withZone } from '../../src/api/web/zone.js';
import type { Person } from '../../src/core/conversation/people.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { linkedCss } from './linked-css.js';
import { withoutIsolates } from './isolates.js';

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
