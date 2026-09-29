import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { usd } from '../../src/core/types/money.js';
import {
  renderInboxList, renderConversationDetail,
  type InboxList, type ConversationSummary, type ConversationDetail,
} from '../../src/api/web/inbox.js';
import { shell, esc, hubFor, CONTEXTUAL_ROUTES, MERGED_INTO_BUYERS } from '../../src/api/web/layout.js';
import { withAssistantName, withWorkspace, t as say } from '../../src/api/web/say.js';
import type { Person } from '../../src/core/conversation/people.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { BANNED_OWNER_TERMS } from '../../src/core/owner/vocabulary.js';
import { withoutIsolates } from './isolates.js';

/**
 * A — Buyers and Customers are one list (2026-09-28, `docs/IA-PROPOSAL.md` §A),
 * the name "Buyers" kept. This holds the page: the search box, the paging
 * doors and where a page sits, the read model Customers brought (the channel,
 * who wrote last — "unread", as the messages can say it — and the last
 * contact), the groups and the tabs, in three languages, right to left.
 *
 * Over Postgres — more than a page of buyers, a buyer who needs the owner on
 * the first page whatever the paging, search by name, paging both ways with
 * nobody lost or shown twice, the redirect: tests/integration/buyers-merge.test.ts.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (f: string) => readFileSync(`${ROOT}${f}`, 'utf8');
const NOW = new Date('2026-09-28T06:00:00Z');
const AGO = (min: number) => new Date(NOW.getTime() - min * 60_000);
const NEXT = '6_1790000000000000_0b5e7c1a-2f3d-4e8a-9c6b-1d2e3f4a5b6c';
const PREV = '4_1790000000999000_1c6f8d2b-3a4e-4f9b-8d7c-2e3f4a5b6c7d';

const conv = (id: string, over: Partial<ConversationSummary> = {}): ConversationSummary => ({
  conversationId: id, buyer: `Buyer ${id}`, country: 'AE', status: 'handled', needsAction: false,
  ownership: 'AI', heldBy: null, awaitingReview: false, handoffReason: null, deletionWaiting: false,
  latestMessage: `last words of ${id}`, latestAt: AGO(30),
  product: { name: 'Vacuum cup', nameZh: '保温杯' }, quantity: 500, unitPrice: usd(2.4),
  channel: 'whatsapp', unanswered: false, lastFrom: 'assistant', ...over,
});

/** A page that holds every group, half-way through a long list. */
const PAGE: InboxList = {
  filter: 'all', waitingCount: 3, blockedCount: 0, mineCount: 0, deletionCount: 1, channels: 2,
  conversations: [
    conv('c-del', { deletionWaiting: true, ownership: 'WAITING_HUMAN', heldBy: 'unclaimed', handoffReason: 'deletion_requested', lastFrom: 'buyer', unanswered: true }),
    conv('c-wait', { ownership: 'WAITING_HUMAN', heldBy: 'unclaimed', handoffReason: 'complaint', lastFrom: 'buyer', unanswered: true }),
    conv('c-review', { awaitingReview: true, status: 'awaiting', needsAction: true, lastFrom: 'buyer', unanswered: true, channel: 'instagram' }),
    conv('c-yours', { ownership: 'OWNER_CONTROLLED', heldBy: 'owner', lastFrom: 'person' }),
    conv('c-quiet', { lastFrom: 'buyer', unanswered: true, channel: 'email' }),
    conv('c-hers', { lastFrom: 'assistant' }),
  ],
  query: '',
  page: { from: 51, to: 56, total: 130, next: NEXT, prev: { cursor: PREV } },
};

const html = (l: Locale, over: Partial<InboxList> = {}, people: readonly Person[] = []) =>
  withoutIsolates(renderInboxList({ ...PAGE, ...over }, l, NOW, people));
const shown = (l: Locale, key: string, params?: Record<string, string | number>) => withoutIsolates(esc(say(l, key as MessageKey, params)));

describe('A · one list, with a search box', () => {
  it('the box is a GET form on Buyers, in every locale, and keeps what was typed', () => {
    for (const l of LOCALES) {
      const bare = html(l);
      expect(bare, l).toMatch(/<form class="search" method="get" action="\/app\/inbox" role="search">/);
      expect(bare, l).toContain('<input type="search" name="q" value=""');
      expect(bare, l).toContain(`placeholder="${shown(l, 'buyers.search.placeholder')}"`);
      expect(bare, l).toContain(`aria-label="${shown(l, 'buyers.search.label')}"`);
      expect(bare, l).toContain(`<button class="btn" type="submit">${shown(l, 'buyers.search.go')}</button>`);
      expect(bare, `${l}: nothing to clear`).not.toContain('class="clear"');

      const found = html(l, { query: 'Ahmed "Al" <Rashid>', page: { from: 1, to: 6, total: 6, next: null, prev: null } });
      expect(found, l).toContain('value="Ahmed &quot;Al&quot; &lt;Rashid&gt;"');
      expect(found, l).toContain(`<a class="clear" href="/app/inbox">${shown(l, 'buyers.search.clear')}</a>`);
      expect(found, l).toContain(shown(l, 'buyers.search.found', { q: 'Ahmed "Al" <Rashid>', n: 6 }));
      expect(found, l).not.toContain('<Rashid>');
    }
  });

  it('a search that found nobody says so, and offers every buyer — never a dead end, never "no data"', () => {
    for (const l of LOCALES) {
      const none = html(l, { query: '张三', conversations: [], page: { from: 0, to: 0, total: 0, next: null, prev: null } });
      expect(none, l).toContain(shown(l, 'buyers.search.none', { q: '张三' }));
      expect(none, l).toContain(shown(l, 'buyers.search.noneBody'));
      expect(none, l).toContain('href="/app/inbox?filter=all"');
      expect(none.toLowerCase(), l).not.toContain('no data');
      for (const dead of ['暂无', '无数据']) expect(none, l).not.toContain(dead);
      expect(none, l).not.toContain('ok-line');   // finding nobody is not an achievement
    }
  });
});

describe('A · paging — the doors either side keep the tab and the search, and say where the page sits', () => {
  it('Previous and Next are doors (links), with the cursors, in every locale', () => {
    for (const l of LOCALES) {
      const h = html(l);
      const pager = /<nav class="pager" aria-label="([^"]+)">([\s\S]*?)<\/nav>/.exec(h);
      expect(pager, l).not.toBeNull();
      expect(pager![1], l).toBe(shown(l, 'buyers.page.nav'));
      expect(pager![2], l).toContain(`<a class="back" href="/app/inbox?filter=all&amp;before=${PREV}">`);
      expect(pager![2], l).toContain(`<a class="deeper" href="/app/inbox?filter=all&amp;after=${NEXT}">`);
      expect(pager![2], l).toContain(shown(l, 'buyers.page.prev'));
      expect(pager![2], l).toContain(shown(l, 'buyers.page.next'));
      expect(pager![2], l).toContain(shown(l, 'buyers.page.position', { from: '51', to: '56', total: '130' }));
      expect(pager![2], l).not.toMatch(/<button|class="btn/);
      // …and on a page after the first, where it sits is said before the rows too.
      expect(h.indexOf(shown(l, 'buyers.page.position', { from: '51', to: '56', total: '130' })), l)
        .toBeLessThan(h.indexOf('class="bgroup"'));
    }
  });

  it('the page before the first page is the list itself — no cursor', () => {
    const h = html('en', { page: { from: 51, to: 100, total: 130, next: NEXT, prev: { cursor: null } } });
    expect(h).toContain('<a class="back" href="/app/inbox?filter=all">');
    expect(h).not.toContain('before=');
  });

  it('the first page has no Previous; the last has no Next; one page has no pager at all', () => {
    const first = html('en', { page: { from: 1, to: 50, total: 130, next: NEXT, prev: null } });
    expect(first).toContain('after=');
    expect(first).not.toContain('<a class="back"');
    const last = html('en', { page: { from: 101, to: 130, total: 130, next: null, prev: { cursor: PREV } } });
    expect(last).toContain('before=');
    expect(last).not.toContain('after=');
    const one = html('en', { page: { from: 1, to: 6, total: 6, next: null, prev: null } });
    expect(one).not.toContain('class="pager"');
  });

  it('a search rides along every page door — written as typed, so no % reaches the page', () => {
    const h = html('zh', { query: '张 三&co' });
    expect(h).toContain(`href="/app/inbox?filter=all&amp;q=张+三%26co&amp;after=${NEXT}"`);
    const plain = html('ar', { query: 'أحمد' });
    expect(plain).toContain(`href="/app/inbox?filter=all&amp;q=أحمد&amp;before=${PREV}"`);
    expect(plain).not.toContain('%');
    // the tabs are views, the search is a find: a tab leaves the search behind
    for (const m of plain.matchAll(/<a class="tab[^"]*"[^>]*href="([^"]+)"/g)) expect(m[1]).not.toContain('q=');
  });
});

describe('A · the read model Customers brought, in the row as it is (decision 5)', () => {
  it('the row keeps its fields — who and the tag, what they asked about, the last message, the time', () => {
    const h = html('en');
    const row = /<a class="buyer[^"]*" href="\/app\/inbox\/c-hers#latest">([\s\S]*?)<\/a>/.exec(h)?.[1] ?? '';
    expect(row).toMatch(/<div class="buyer-top"><span class="who">🇦🇪 <b><bdi>Buyer c-hers<\/bdi><\/b><span class="muted"> · /);
    // each part isolated, so Arabic cannot run a Latin name, a quantity and a price together
    // CC-13 — a figure and its unit are two words in English (a no-break space between them).
    expect(row).toContain('<div class="buyer-d muted"><bdi>Vacuum cup</bdi> · <bdi>500\u00a0pcs</bdi> · <bdi>$2.40</bdi></div>');
    expect(row).toContain('<div class="buyer-m voice" dir="auto"><bdi>last words of c-hers</bdi></div>');
    expect(row).toMatch(/<div class="buyer-t muted">Today 13:30 · /);
  });

  it('the channel is named on the row once the workspace talks on more than one — and not before', () => {
    const several = html('en');
    expect(several).toContain(`· ${t('en', 'conv.channel.instagram')}`);
    expect(several).toContain(`· ${t('en', 'conv.channel.email')}`);
    expect(several).toContain(`· ${t('en', 'conv.channel.whatsapp')}`);
    const one = html('en', { channels: 1 });
    for (const c of ['whatsapp', 'instagram', 'email']) expect(one).not.toContain(`· ${t('en', `conv.channel.${c}` as MessageKey)}`);
  });

  it('who wrote last is said in the transcript\'s words, and a buyer still waiting reads in full ink', () => {
    for (const l of LOCALES) {
      const h = withAssistantName('Noor', () => html(l));
      const rowOf = (id: string) => new RegExp(`<a class="buyer( unanswered)?" href="/app/inbox/${id}#latest">([\\s\\S]*?)</a>`).exec(h);
      const quiet = rowOf('c-quiet')!;
      expect(quiet[1], `${l}: the buyer spoke last`).toBe(' unanswered');
      // The design pass (UI-PASS 5): the row is already the customer's name;
      // a role word standing alone is not said.
      expect(quiet[2], l).not.toContain(`<bdi>${esc(t(l, 'common.buyer'))}</bdi>`);
      const hers = rowOf('c-hers')!;
      expect(hers[1], `${l}: answered`).toBeUndefined();
      expect(hers[2], l).toContain('<bdi>Noor</bdi>');
      const yours = rowOf('c-yours')!;
      expect(yours[2], l).toContain(`<bdi>${esc(t(l, 'conv.by.you'))}</bdi>`);
    }
    const css = read('src/api/web/layout.ts');
    expect(css).toMatch(/\.buyer\.unanswered \.buyer-m \{ color:var\(--color-ink\); \}/);
  });

  it('with several assistants, the row names the one answering once, not twice', () => {
    const h = html('en', { conversations: [conv('c-a', { answeredBy: 'Noor', lastFrom: 'assistant' }), conv('c-b', { answeredBy: 'Noor', lastFrom: 'buyer', unanswered: true })] });
    const a = /href="\/app\/inbox\/c-a#latest">([\s\S]*?)<\/a>/.exec(h)![1]!;
    expect(a.match(/Noor/g)?.length).toBe(1);
    const b = /href="\/app\/inbox\/c-b#latest">([\s\S]*?)<\/a>/.exec(h)![1]!;
    expect(b).toContain(esc(t('en', 'conv.answeredBy', { who: 'Noor' })));
  });

  it('the glimpse of a long message is cut by characters — never through an emoji', () => {
    const long = `${'a'.repeat(89)}😀 and the rest`;
    const h = html('en', { conversations: [conv('c-long', { latestMessage: long })] });
    expect(h).toContain(`<bdi>${'a'.repeat(89)}😀</bdi>`);
    expect(h).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('a row with no message yet shows no speaker and no empty line', () => {
    const { lastFrom: _none, ...fresh } = conv('c-new', { latestMessage: null, latestAt: null });
    const h = html('en', { conversations: [fresh], channels: 1 });
    expect(h).not.toContain('class="buyer-m voice"');
    expect(h).not.toContain('class="buyer-t muted"');
  });
});

describe('A · the groups and the tabs', () => {
  it('on All, the groups lead in the order the list is ranked in, each headed', () => {
    const h = withAssistantName('Noor', () => html('en'));
    const heads = [...h.matchAll(/<h2 class="bgroup-h">([^<]+)<\/h2>/g)].map((m) => m[1]);
    expect(heads).toEqual([
      esc(t('en', 'buyers.group.deletion')), esc(t('en', 'buyers.group.needsYou')),
      esc(t('en', 'buyers.group.yours')), esc(t('en', 'buyers.group.hers', { name: 'Noor' })),
    ]);
    const at = (id: string) => h.indexOf(`/app/inbox/${id}#latest`);
    expect(at('c-del')).toBeLessThan(at('c-wait'));
    expect(at('c-wait')).toBeLessThan(at('c-review'));
    expect(at('c-review')).toBeLessThan(at('c-yours'));
    expect(at('c-yours')).toBeLessThan(at('c-quiet'));
    // each conversation exactly once
    for (const c of PAGE.conversations) expect(h.split(`/app/inbox/${c.conversationId}#latest`).length - 1).toBe(1);
  });

  it('with a team, the group a person here holds is the team\'s — not "you are handling" above a colleague\'s buyer', () => {
    const owner: Person = { id: 'p-owner', name: 'Mrs Wang', isOwner: true };
    const chen: Person = { id: 'p-chen', name: 'Xiao Chen', isOwner: false };
    for (const l of LOCALES) {
      const team = html(l, {}, [owner, chen]);
      expect(team, l).toContain(`<h2 class="bgroup-h">${shown(l, 'buyers.group.team')}</h2>`);
      expect(team, l).not.toContain(`<h2 class="bgroup-h">${shown(l, 'buyers.group.yours')}</h2>`);
      expect(html(l), l).toContain(`<h2 class="bgroup-h">${shown(l, 'buyers.group.yours')}</h2>`);
    }
  });

  it('on the other tabs only the deletion group is headed', () => {
    const h = html('en', { filter: 'pending' });
    expect([...h.matchAll(/<h2 class="bgroup-h">/g)]).toHaveLength(1);
  });

  it('the tabs: counts of everything, the active one marked for a screen reader, Mine only with a team', () => {
    const owner: Person = { id: 'p-owner', name: 'Mrs Wang', isOwner: true };
    const chen: Person = { id: 'p-chen', name: 'Xiao Chen', isOwner: false };
    for (const l of LOCALES) {
      const h = html(l, { mineCount: 2, blockedCount: 4 }, [owner, chen]);
      const nav = /<nav class="tabs" aria-label="([^"]+)">([\s\S]*?)<\/nav>/.exec(h)!;
      expect(nav[1], l).toBe(shown(l, 'buyers.tabs'));
      const tabs = [...nav[2]!.matchAll(/<a class="tab( on)?"( aria-current="page")? href="([^"]+)">([^<]+)<\/a>/g)];
      expect(tabs.map((m) => m[3]), l).toEqual([
        '/app/inbox?filter=pending', '/app/inbox?filter=all', '/app/inbox?filter=mine',
        '/app/inbox?filter=blocked', '/app/inbox?filter=deletion',
      ]);
      const on = tabs.filter((m) => m[1]);
      expect(on.map((m) => m[3]), l).toEqual(['/app/inbox?filter=all']);
      expect(on[0]![2], l).toBe(' aria-current="page"');
      expect(tabs[0]![4], l).toBe(`${shown(l, 'inbox.filter.pending')} (3)`);
      expect(tabs[2]![4], l).toBe(`${shown(l, 'inbox.filter.mine')} (2)`);
      expect(tabs[3]![4], l).toBe(`${shown(l, 'inbox.filter.blocked')} (4)`);
      expect(tabs[4]![4], l).toBe(`${shown(l, 'inbox.filter.deletion')} (1)`);
    }
    // alone, there is no Mine; nothing blocked and nothing to delete, no such tabs
    const alone = html('en', { deletionCount: 0 });
    expect(alone).not.toContain('filter=mine');
    expect(alone).not.toContain('filter=blocked');
    expect(alone).not.toContain('filter=deletion"');
  });
});

describe('A · three languages, right to left', () => {
  it('every new sentence is its own in each language — nothing falls back to English', () => {
    const keys = ['buyers.tabs', 'buyers.group.team', 'buyers.search.label', 'buyers.search.placeholder', 'buyers.search.go',
      'buyers.search.clear', 'buyers.search.found', 'buyers.search.none', 'buyers.search.noneBody',
      'buyers.page.nav', 'buyers.page.prev', 'buyers.page.next', 'buyers.page.position', 'conv.file.title', 'conv.notFound'];
    for (const k of keys) {
      const en = t('en', k as MessageKey);
      for (const l of ['zh', 'ar'] as const) {
        expect(t(l, k as MessageKey), `${l}/${k}`).not.toBe(en);
        expect(t(l, k as MessageKey).replace(/\{\w+\}/g, ''), `${l}/${k}`).not.toMatch(/[A-Za-z]{3,}/);
      }
      for (const l of LOCALES) {
        const s = t(l, k as MessageKey).toLowerCase();
        for (const banned of BANNED_OWNER_TERMS) {
          const b = banned.toLowerCase();
          const hit = /^[a-z ]+$/.test(b) ? new RegExp(`\\b${b}\\b`).test(s) : s.includes(b);
          expect(hit, `${l}/${k}: "${banned}"`).toBe(false);
        }
      }
    }
  });

  it('Arabic: the page is right to left, a buyer\'s words keep their own direction, a Latin name keeps its order', () => {
    const page = shell({ title: 'T', active: 'inbox', locale: 'ar', path: '/app/inbox', bodyHtml: html('ar') });
    expect(page).toContain('<html lang="ar" dir="rtl"');
    expect(html('ar')).toContain('<div class="buyer-m voice" dir="auto">');
    expect(html('ar')).toContain('<b><bdi>Buyer c-hers</bdi></b>');
    // the position says "to", not a dash two numbers would reorder around
    expect(t('ar', 'buyers.page.position')).not.toMatch(/[–-]/);
    expect(html('ar')).toContain(esc(t('ar', 'buyers.page.position', { from: '51', to: '56', total: '130' })));
  });

  it('no locale prints a percent sign, software talk or a stylesheet of its own', () => {
    for (const l of LOCALES) {
      const h = html(l, { query: 'Ahmed Ali' });
      expect(h, l).not.toContain('%');
      expect(h, l).not.toContain('<style');
      const text = h.replace(/<[^>]+>/g, ' ').toLowerCase();
      for (const banned of ['ai', 'llm', 'model', 'token', 'database', 'webhook', '模型', '人工智能']) {
        const hit = /^[a-z]+$/.test(banned) ? new RegExp(`\\b${banned}\\b`).test(text) : text.includes(banned);
        expect(hit, `${l}: ${banned}`).toBe(false);
      }
    }
  });
});

describe('A · Customers is Buyers now — the doors, the map, the redirect', () => {
  it('no page links the old list; its door on Buyers is gone, the contacts door moved here', () => {
    for (const l of LOCALES) {
      for (const h of [html(l), html(l, { conversations: [] }), html(l, { filter: 'pending', conversations: [] })]) {
        expect(h, l).not.toContain('href="/app/conversations"');
      }
    }
    const off = withWorkspace({ name: null, several: false, outreach: false, setup: null }, () => html('en'));
    const on = withWorkspace({ name: null, several: false, outreach: true, setup: null }, () => html('en'));
    expect(off).not.toContain('href="/app/contacts"');
    expect(on).toContain('href="/app/contacts"');
    expect(on).toContain('href="/app/calendar"');
  });

  it('the buyer\'s own page stays where it was, one door from the conversation', () => {
    const detail: ConversationDetail = {
      conversationId: 'c-1', buyer: 'Ahmed', country: 'AE', status: 'handled',
      product: { name: 'Vacuum cup', nameZh: '保温杯' }, quantity: 500, quote: null, order: null,
      messages: [{ direction: 'inbound', text: 'Price?', at: NOW }], pendingDraft: null,
      ownership: 'AI', refusals: [], uncertainSends: [], handoffReasons: [], unheardReason: null,
      lastHumanAction: null, knowledgeUsed: [], rate: null, leadTimeBlocked: null, sampleAsked: null,
      proof: { quoteId: null, token: null },
    };
    for (const l of LOCALES) {
      const h = withoutIsolates(renderConversationDetail(detail, l, NOW, null));
      // `file-door`: where the customer panel stands beside the conversation, it carries this door instead (the design pass)
      expect(h, l).toContain(`<a class="deeper file-door" href="/app/conversations/c-1">${shown(l, 'conv.file.title')}<span class="go" aria-hidden="true">›</span></a>`);
      expect(h, l).not.toContain('<style');
    }
  });

  it('the map: the old address is Buyers\', and so is every buyer\'s page under it', () => {
    expect(MERGED_INTO_BUYERS).toBe('/app/conversations');
    expect(CONTEXTUAL_ROUTES).not.toContain('/app/conversations');
    expect(hubFor('/app/conversations/0b5e7c1a-2f3d-4e8a-9c6b-1d2e3f4a5b6c', 'x')).toBe('inbox');
    const app = read('src/api/web/app.ts');
    // the list route is a redirect now, guarded like every other address
    const at = app.indexOf('app.get(MERGED_INTO_BUYERS');
    expect(at).toBeGreaterThan(0);
    const handler = app.slice(at, app.indexOf('\n  });', at));
    expect(handler).toContain("if (!sessionOf(req)) return reply.redirect('/login');");
    expect(handler).toMatch(/reply\.redirect\([^;]*'\/app\/inbox\?filter=all'\)/);
    expect(app).not.toContain('renderCustomerList');
    expect(app).toContain("app.get('/app/conversations/:conversationId'");
  });
});
