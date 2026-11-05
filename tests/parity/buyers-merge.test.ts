import { renderSplitInbox as renderInboxList } from '../../src/api/web/splitInbox.js';
import { withZone } from '../../src/api/web/zone.js';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { usd } from '../../src/core/types/money.js';
import {
  renderConversationDetail,
  type InboxList, type ConversationSummary, type ConversationDetail,
} from '../../src/api/web/inbox.js';
import { shell, esc, hubFor, CONTEXTUAL_ROUTES, MERGED_INTO_BUYERS } from '../../src/api/web/layout.js';
import { withAssistantName, withWorkspace, t as say } from '../../src/api/web/say.js';
import type { Person } from '../../src/core/conversation/people.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { BANNED_OWNER_TERMS } from '../../src/core/owner/vocabulary.js';
import { withoutIsolates } from './isolates.js';
import { GO } from '../../src/api/web/icons.js';

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
 *
 * The warmth run, phase 4 (2026-10-03) changed the page under these tests on
 * purpose, and each change is marked "phase 4" where it lands: the row is the
 * customer's (face, name, spent, last contact — `inboxRow`, no product, no
 * ○ ● ✦ state column), "All" is the list's own address (no `filter=all` is
 * written), the tabs are the two lenses plus the narrowings that hold
 * something, and "Mine" is gone. The new page as a whole: warmth-inbox.test.ts.
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
  product: { name: 'Vacuum cup', nameZh: '保温杯' }, quantity: 500, unitPrice: usd('2.4'),
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

// TZ — the fixtures' times are written in Shanghai time: the workspace's zone, stated.
const html = (l: Locale, over: Partial<InboxList> = {}, people: readonly Person[] = []) =>
  withZone('Asia/Shanghai', () => withoutIsolates(renderInboxList({ ...PAGE, ...over }, l, NOW, people)));
const shown = (l: Locale, key: string, params?: Record<string, string | number>) => withoutIsolates(esc(say(l, key as MessageKey, params)));

/** Full shared row, including customer-card and conversation doors. */
const rowOf = (h: string, id: string) => new RegExp(`<li id="inbox-${id}">([\\s\\S]*?)</li>`).exec(h)?.[1] ?? '';


describe('A · one list, with a search box', () => {
  it('the box is a GET form on Buyers, in every locale, and keeps what was typed', () => {
    for (const l of LOCALES) {
      const bare = html(l);
      expect(bare, l).toMatch(/<form class="si-search" method="get" action="\/app\/inbox" role="search">/);
      expect(bare, l).toContain('<input type="search" name="q" value=""');
      expect(bare, l).toContain(`placeholder="${shown(l, 'buyers.search.placeholder')}"`);
      expect(bare, l).toContain(`aria-label="${shown(l, 'buyers.search.label')}"`);
      expect(bare, l).toContain(`<button class="sp-btn" type="submit">${shown(l, 'buyers.search.go')}</button>`);
      expect(bare, `${l}: nothing to clear`).not.toContain('class="clear"');

      const found = html(l, { query: 'Ahmed "Al" <Rashid>', page: { from: 1, to: 6, total: 6, next: null, prev: null } });
      expect(found, l).toContain('value="Ahmed &quot;Al&quot; &lt;Rashid&gt;"');
      expect(found, l).toContain(`<a class="clear" href="/app/inbox?filter=all">${shown(l, 'buyers.search.clear')}</a>`);
      expect(found, l).toContain(shown(l, 'buyers.search.found', { q: 'Ahmed "Al" <Rashid>', n: 6 }));
      expect(found, l).not.toContain('<Rashid>');
    }
  });

  it('a search that found nobody says so, and offers every buyer — never a dead end, never "no data"', () => {
    for (const l of LOCALES) {
      const none = html(l, { query: '张三', conversations: [], page: { from: 0, to: 0, total: 0, next: null, prev: null } });
      expect(none, l).toContain(shown(l, 'buyers.search.none', { q: '张三' }));
      expect(none, l).toContain(shown(l, 'buyers.search.noneBody'));
      // phase 4 — every customer is the list's own address now
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
      const pager = /<nav class="pager si-pager" aria-label="([^"]+)">([\s\S]*?)<\/nav>/.exec(h);
      expect(pager, l).not.toBeNull();
      expect(pager![1], l).toBe(shown(l, 'buyers.page.nav'));
      // phase 4 — the whole list writes no `filter=all`
      expect(pager![2], l).toContain(`<a class="back" href="/app/inbox?filter=all&amp;before=${PREV}">`);
      expect(pager![2], l).toContain(`<a class="deeper" href="/app/inbox?filter=all&amp;after=${NEXT}">`);
      expect(pager![2], l).toContain(shown(l, 'buyers.page.prev'));
      expect(pager![2], l).toContain(shown(l, 'buyers.page.next'));
      expect(pager![2], l).toContain(shown(l, 'buyers.page.position', { from: '51', to: '56', total: '130' }));
      expect(pager![2], l).not.toMatch(/<button|class="btn/);
      // …and on a page after the first, where it sits is said before the rows too.
      expect(h.indexOf(shown(l, 'buyers.page.position', { from: '51', to: '56', total: '130' })), l)
        .toBeLessThan(h.indexOf('class="si-group"'));
    }
  });

  it('the page before the first page is the list itself — no cursor', () => {
    const h = html('en', { page: { from: 51, to: 100, total: 130, next: NEXT, prev: { cursor: null } } });
    expect(h).toContain('<a class="back" href="/app/inbox?filter=all">');   // phase 4: the list's own address
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
    expect(one).not.toContain('class="pager si-pager"');
  });

  it('search scope survives paging, ordering and view changes without altering typed words', () => {
    const h = html('zh', { query: '张 三&co' });
    expect(h).toContain(`href="/app/inbox?filter=all&amp;q=张+三%26co&amp;after=${NEXT}"`);
    const plain = html('ar', { query: 'أحمد', blockedCount: 2 });
    expect(plain).toContain(`href="/app/inbox?filter=all&amp;q=أحمد&amp;before=${PREV}"`);
    const order = /<nav class="si-fils si-order"[^>]*>([\s\S]*?)<\/nav>/.exec(plain)![1]!;
    for (const m of order.matchAll(/href="([^"]+)"/g)) expect(m[1]).toContain('q=أحمد');
    const views = /<nav class="si-tabs"[^>]*>([\s\S]*?)<\/nav>/.exec(plain)![1]!;
    for (const m of views.matchAll(/href="([^"]+)"/g)) expect(m[1]).toContain('q=أحمد');
    expect(plain.replace(/<[^>]+>/g, ' ')).not.toContain('%');
  });
});

describe('A · the read model Customers brought, in the customer\'s row (phase 4 of the warmth run)', () => {

  it('each row keeps its customer face, value, preview, stage and time with separate doors', () => {
    const h = html('en', { lens: 'value', conversations: [conv('c-hers', { clientId: '0b5e7c1a-2f3d-4e8a-9c6b-1d2e3f4a5b01', spent: usd('1240'), regular: true })] });
    const row = rowOf(h, 'c-hers');
    expect(row).toContain('href="/app/customers/0b5e7c1a-2f3d-4e8a-9c6b-1d2e3f4a5b01" data-card');
    expect(row).toContain('class="si-door" href="/app/inbox/c-hers?from=');
    expect(row).toContain('<bdi class="sp-rname">Buyer c-hers</bdi>');
    expect(row).toContain('<span class="sp-rval">$1,240</span>');
    expect(row).toContain('<bdi class="si-last">last words of c-hers</bdi>');
    expect(row).toContain('<span class="sp-chip">Asked</span>');
    expect(row).toContain('<span class="sp-rday">');
    expect(row).not.toContain('500');
    expect(row).not.toContain('$2.40');
  });

  it('needs rows state the stored reason and the sender is named in words', () => {
    const h = html('en');
    expect(rowOf(h, 'c-del')).toContain(shown('en', 'buyers.badge.deletion'));
    expect(rowOf(h, 'c-wait')).toContain(shown('en', 'takeover.reason.complaint'));
    expect(rowOf(h, 'c-review')).toContain(shown('en', 'buyers.badge.reviewShort'));
    for (const id of ['c-del', 'c-wait', 'c-review']) expect(rowOf(h, id), id).toContain('class="row-dot"');
    for (const id of ['c-yours', 'c-hers']) expect(rowOf(h, id), id).not.toContain('class="row-dot"');
    expect(rowOf(withAssistantName('Noor', () => html('en')), 'c-hers')).toContain('<span class="si-by"><bdi>Noor</bdi>:');
    expect(h).toContain(`<span class="sr">${esc(t('en', 'buyers.group.needsYou'))}</span>`);
  });

  it('channel changes do not remove the customer name, stage or message from the compact row', () => {
    for (const channels of [1, 2]) {
      const h = html('en', { channels });
      for (const c of PAGE.conversations) {
        const row = rowOf(h, c.conversationId);
        expect(row).toContain(esc(c.buyer!));
        expect(row).toContain(esc(c.latestMessage!));
        expect(row).toContain('class="sp-chip"');
      }
    }
  });

  it('speaker words distinguish assistant, owner and customer without changing opened-state semantics', () => {
    for (const l of LOCALES) {
      const h = withAssistantName('Noor', () => html(l));
      expect(rowOf(h, 'c-quiet'), l).not.toContain('class="si-by"');
      expect(rowOf(h, 'c-hers'), l).toContain('<span class="si-by"><bdi>Noor</bdi>');
      expect(rowOf(h, 'c-yours'), l).toContain(`<span class="si-by"><bdi>${shown(l, 'conv.by.you')}</bdi>`);
      const unopened = html(l, { conversations: [conv('c-new', { awaitingReview: true, unopened: true })] });
      expect(rowOf(unopened, 'c-new'), l).toContain('is-new');
    }
    expect(read('src/api/web/splitStyle.ts')).toContain('.si-row.is-new .sp-rname { font-weight:700; }');
  });

  it('multiple assistants are attributed once as speaker, or once as holder when the customer spoke last', () => {
    const h = html('en', { conversations: [conv('c-a', { answeredBy: 'Noor', lastFrom: 'assistant' }), conv('c-b', { answeredBy: 'Noor', lastFrom: 'buyer', unanswered: true })] });
    expect(rowOf(h, 'c-a').match(/Noor/g)).toHaveLength(1);
    expect(rowOf(h, 'c-b')).toContain(shown('en', 'buyers.group.hers', { name: 'Noor' }));
    expect(rowOf(h, 'c-b').match(/Noor/g)).toHaveLength(1);
  });

  it('the glimpse of a long message is cut by characters — never through an emoji', () => {
    // The warmth run's phase 9 (V1-164) — 200 characters: the row's own width cuts the rest.
    const long = `${'a'.repeat(199)}😀 and the rest`;
    const h = html('en', { conversations: [conv('c-long', { latestMessage: long })] });
    // Phase 9 (V1-164) — and says it was cut.
    expect(h).toContain(`<bdi class="si-last">${'a'.repeat(199)}😀…</bdi>`);
    expect(h).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('phase 9 (V1-164) · a long preview is cut where a word ends, and says so', () => {
    const long = 'For 500 pcs the price is $1.05/pc and for 2,000 pcs it is $0.92/pc, lead time 25 days from the deposit. '.repeat(3);
    const h = html('en', { conversations: [conv('c-cut', { latestMessage: long })] });
    const text = /<bdi class="si-last">([^<]*)<\/bdi>/.exec(h)![1]!;
    expect(text.endsWith('…')).toBe(true);
    expect(long.startsWith(text.slice(0, -1))).toBe(true);
    expect(long[text.length - 1]).toBe(' ');   // the cut falls where a word ended
  });

  it('a row with no message yet shows no speaker and no empty line', () => {
    const { lastFrom: _none, ...fresh } = conv('c-new', { latestMessage: null, latestAt: null });
    const h = html('en', { conversations: [fresh], channels: 1 });
    expect(h).not.toContain('class="si-said"');
    expect(h).not.toContain('class="si-by"');
    expect(h).toContain('<span class="sp-rday"></span>');
  });
});

describe('A · the groups and the tabs', () => {
  it('flat list preserves the reader order while deletion requests lead under their heading', () => {
    const h = withAssistantName('Noor', () => html('en'));
    expect([...h.matchAll(/<h2 class="sp-cap">([^<]+)<\/h2>/g)].map((m) => m[1])).toEqual([shown('en', 'buyers.group.deletion')]);
    const at = (id: string) => h.indexOf(`id="inbox-${id}"`);
    for (let i = 1; i < PAGE.conversations.length; i++) expect(at(PAGE.conversations[i - 1]!.conversationId)).toBeLessThan(at(PAGE.conversations[i]!.conversationId));
    for (const c of PAGE.conversations) expect(h.split(`class="si-door" href="/app/inbox/${c.conversationId}?from=`).length - 1).toBe(1);
  });

  it('a colleague is named as holder instead of falsely attributing their customer to the owner', () => {
    const owner: Person = { id: 'p-owner', name: 'Mrs Wang', isOwner: true };
    const chen: Person = { id: 'p-chen', name: 'Xiao Chen', isOwner: false };
    for (const l of LOCALES) {
      const team = html(l, { conversations: [conv('c-held', { ownership: 'OWNER_CONTROLLED', heldBy: chen.id })] }, [owner, chen]);
      expect(rowOf(team, 'c-held'), l).toContain(shown(l, 'people.holding', { who: 'Xiao Chen' }));
      expect(rowOf(team, 'c-held'), l).not.toContain(shown(l, 'people.holding', { who: say(l, 'people.held.owner') }));
    }
  });

  it('on the other tabs only the deletion group is headed', () => {
    const h = html('en', { filter: 'pending' });
    expect([...h.matchAll(/<h2 class="sp-cap">/g)]).toHaveLength(1);
  });

  it('views show actual conditional counts and retain separate lens controls', () => {
    for (const l of LOCALES) {
      const h = html(l, { mineCount: 2, blockedCount: 4 });
      const views = /<nav class="si-tabs"[^>]*>([\s\S]*?)<\/nav>/.exec(h)![1]!;
      for (const f of ['pending', 'quiet', 'assistant', 'all', 'blocked', 'deletion']) expect(views, l).toContain(`filter=${f}`);
      expect(views, l).toContain(`<span class="si-tabn">${4}</span>`);
      expect(h, l).not.toContain('filter=mine');
      const order = /<nav class="si-fils si-order"[^>]*>([\s\S]*?)<\/nav>/.exec(h)![1]!;
      expect(order, l).toContain('aria-current="true" href="/app/inbox?filter=all"');
      expect(order, l).toContain('href="/app/inbox?filter=all&amp;lens=value"');
    }
    const alone = html('en', { deletionCount: 0 });
    expect(alone).not.toContain('filter=blocked');
    expect(alone).not.toContain('filter=deletion');
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
    // the name and the message each take their own direction, so an English message is cut at its end
    expect(html('ar')).toContain('<bdi class="si-last">');
    expect(html('ar')).toContain('<bdi class="sp-rname">Buyer c-hers</bdi>');
    // the position says "to", not a dash two numbers would reorder around
    expect(t('ar', 'buyers.page.position')).not.toMatch(/[–-]/);
    expect(html('ar')).toContain(esc(t('ar', 'buyers.page.position', { from: '51', to: '56', total: '130' })));
  });

  it('no locale prints a percent sign, software talk or a stylesheet of its own', () => {
    for (const l of LOCALES) {
      const h = html(l, { query: 'Ahmed Ali' });
      expect(h.replace(/<[^>]+>/g, ' '), l).not.toContain('%');
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
    // phase 9 of the warmth run (V1-166) — no calendar door: the rail has Calendar on every width
    expect(on).not.toContain('class="deeper on-phone"');
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
      expect(h, l).toContain('href="/app/conversations/c-1"');
      expect(h, l).toContain(shown(l, 'panel.open'));
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

describe('Phase 9 (inbox-calendar-new-04) · a Latin preview in Arabic sits under the name, cut at its own end', () => {
  it('its direction is its own (dir=auto), and on a right-to-left page it aligns to the end of its own line', async () => {
    const { linkedCss } = await import('./linked-css.js');
    const { shell } = await import('../../src/api/web/layout.js');
    const css = linkedCss(shell({ title: 'T', active: 'inbox', locale: 'ar', path: '/app/inbox', bodyHtml: '' }));
    expect(css).toContain('[dir="rtl"] .cr-text:dir(ltr) { text-align:end; }');
  });
});
