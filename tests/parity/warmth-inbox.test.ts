import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, type CompiledQuery } from 'kysely';
import { usd } from '../../src/core/types/money.js';
import {
  renderInboxList, inboxRow, attentionBand, buyersHref, ATTENTION_SHOWN,
  type InboxList, type ConversationSummary,
} from '../../src/api/web/inbox.js';
import { renderListPane } from '../../src/api/web/panes.js';
import { shell, esc } from '../../src/api/web/layout.js';
import { withAssistantName, t as say } from '../../src/api/web/say.js';
import { withZone } from '../../src/api/web/zone.js';
import * as show from '../../src/api/web/values.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { encodeListKey, parseListKey, lensOf, readBuyersPage, readBuyerCounts } from '../../src/db/buyersList.js';
import { readAttention, QUIET_AFTER_DAYS, QUIET_UNTIL_DAYS, type AttentionItem } from '../../src/db/inboxAttention.js';
import { REGULAR_ORDERS } from '../../src/db/customerValue.js';
import type { Tx } from '../../src/db/client.js';
import { withoutIsolates, unisolatedFigures } from './isolates.js';
import { linkedCss } from './linked-css.js';

/**
 * THE WARMTH RUN, PHASE 4 (2026-10-03) — THE INBOX. The owner: "The customer
 * list and the inbox are one page. One customer, one conversation, one row.
 * Two lenses on the same list, switchable: 'waiting now' and 'matters most'.
 * Each row: face, name, total spent as the headline number, last contact, and
 * an automatic mark on regulars. Order count does not go on the row. A 'needs
 * attention' band at the top… not today's urgency. Searchable."
 *
 * Held here, by structure, in all five languages and both lenses: one row per
 * customer, spend as the headline, no order count, the regular's mark, the
 * band's three kinds (and, in the SQL it runs, nobody waiting for the owner),
 * the lens carried by every address the page writes, and the two cursors.
 * Over Postgres: tests/integration/buyers-merge.test.ts and warmth-inbox.test.ts.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const NOW = new Date('2026-10-03T06:00:00Z');
const AGO = (min: number) => new Date(NOW.getTime() - min * 60_000);
const DAYS = (d: number) => AGO(d * 24 * 60);
const ID = (n: number) => `0b5e7c1a-2f3d-4e8a-9c6b-1d2e3f4a5b${String(n).padStart(2, '0')}`;
const CLIENT = (n: number) => `1c6f8d2b-3a4e-4f9b-8d7c-2e3f4a5b6c${String(n).padStart(2, '0')}`;
const NEXT = '6_1790000000000000_0b5e7c1a-2f3d-4e8a-9c6b-1d2e3f4a5b6c';
const PREV = 'v1240.00_1790000000999000_1c6f8d2b-3a4e-4f9b-8d7c-2e3f4a5b6c7d';

const conv = (n: number, buyer: string, over: Partial<ConversationSummary> = {}): ConversationSummary => ({
  conversationId: ID(n), clientId: CLIENT(n), buyer, country: 'AE', status: 'handled', needsAction: false,
  ownership: 'AI', heldBy: null, awaitingReview: false, handoffReason: null, deletionWaiting: false,
  latestMessage: 'Do you have it in navy', latestAt: AGO(30 + n), product: { name: 'Canvas tote', nameZh: '帆布袋' },
  quantity: 500, unitPrice: usd(2.4), channel: 'whatsapp', unanswered: false, lastFrom: 'assistant',
  photo: null, spent: null, regular: false, ...over,
});

/** Five customers: one waiting with a deletion request, one waiting for a person, a regular, a big one-off buyer, a new one. */
const LIST: InboxList = {
  filter: 'all', lens: 'waiting', waitingCount: 2, blockedCount: 0, deletionCount: 1, channels: 1, query: '',
  conversations: [
    conv(1, 'Fatima Al-Zahra', { deletionWaiting: true, ownership: 'WAITING_HUMAN', handoffReason: 'deletion_requested', lastFrom: 'buyer', unanswered: true }),
    conv(2, 'Alexandre Dupont', { ownership: 'WAITING_HUMAN', handoffReason: 'human_requested', lastFrom: 'buyer', unanswered: true, spent: usd(830) }),
    conv(3, 'Zhang Wei', { spent: usd(1240), regular: true }),
    conv(4, 'أحمد الراشد', { spent: usd(48250.5) }),
    conv(5, 'Lena Brandt', { lastFrom: 'buyer', unanswered: true }),
  ],
  page: { from: 1, to: 5, total: 5, next: null, prev: null },
};

const BAND: AttentionItem[] = [
  { clientId: CLIENT(80), name: 'Carlos Mendes', photo: null, conversationId: ID(80), kind: 'quote', since: DAYS(5), spent: usd(9000) },
  { clientId: CLIENT(81), name: 'Aisha Bello', photo: 'a1b2c3d4e5f6', conversationId: ID(81), kind: 'reply', since: DAYS(9), spent: null },
  { clientId: CLIENT(82), name: '陈莉', photo: null, conversationId: ID(82), kind: 'regular', since: DAYS(70), spent: usd(31000) },
];

const html = (l: Locale, over: Partial<InboxList> = {}) =>
  withZone('Asia/Shanghai', () => withAssistantName('Lily', () => renderInboxList({ ...LIST, ...over }, l, NOW)));
const shown = (l: Locale, key: string, params?: Record<string, string | number>) => esc(say(l, key as MessageKey, params));
const rows = (h: string) => [...h.matchAll(/<div class="irow[^"]*">([\s\S]*?)<\/a><\/div>/g)].map((m) => m[1]!);
const rowOf = (h: string, n: number) => rows(h).find((r) => r.includes(`href="/app/inbox/${ID(n)}#latest"`)) ?? '';
const CSS = linkedCss(shell({ title: 'T', active: 'inbox', locale: 'en', path: '/app/inbox', bodyHtml: '' }));
const rule = (sel: string) => new RegExp(`(?:^|\\n)\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`).exec(CSS)?.[1] ?? '';

describe('phase 4 · one customer, one row', () => {
  it('in both lenses and five languages: a row per customer, each with their face (their card) and their conversation', () => {
    for (const l of LOCALES) {
      for (const lens of ['waiting', 'value'] as const) {
        const h = html(l, { lens });
        expect(rows(h), `${l} ${lens}`).toHaveLength(LIST.conversations.length);
        for (const c of LIST.conversations) {
          expect(h.split(`href="/app/customers/${c.clientId}" data-card`).length - 1, `${l} ${lens} ${c.buyer}`).toBe(1);
          expect(h.split(`href="/app/inbox/${c.conversationId}#latest"`).length - 1, `${l} ${lens} ${c.buyer}`).toBe(1);
        }
        // the face is the shared one: drawn by faces.ts, a 40 px face on a 64 px row
        expect(h, l).toContain('<span class="face face-m t');
      }
    }
    expect(rule('.irow')).toContain('min-height:64px');
  });

  it('the list is read a customer at a time: one conversation each, the one that needs the owner most, else their newest', async () => {
    const r = recorder(() => []);
    await readBuyersPage(r.tx, { filter: 'all', q: '' });
    const page = r.seen[0]!.sql;
    expect(page).toContain('select distinct on (client_id) client_id, id as conversation_id, rank');
    expect(page).toContain('order by client_id, rank, at_us desc nulls last, id desc');
    // the last contact is the customer's, on any of their conversations
    expect(page).toMatch(/max\(m\.sent_at\)\)[\s\S]*where c2\.client_id = ch\.client_id/);
    // and every count is of customers
    await readBuyerCounts(r.tx);
    expect(r.seen[1]!.sql.match(/count\(distinct c\.client_id\)/g)).toHaveLength(4);
  });
});

describe('phase 4 · the row: spend is the headline, no order count, the regular\'s mark', () => {
  it('what they spent stands on the first line at its end, written as the order pages write money — and nothing when nothing was spent', () => {
    for (const l of LOCALES) {
      const h = html(l);
      for (const c of LIST.conversations) {
        const row = rowOf(h, Number(c.conversationId.slice(-2)));
        const spent = /<span class="ir-spent">([\s\S]*?)<\/span>\s*<span class="ir-l2">/.exec(row)?.[1];
        expect(spent, `${l} ${c.buyer}`).toBeDefined();
        if (c.spent) {
          expect(spent, l).toContain(`<bdi aria-hidden="true">${esc(show.money(l, c.spent))}</bdi>`);
          expect(spent, l).toContain(`<span class="sr">${shown(l, 'buyers.row.spent', { amount: show.money(l, c.spent) })}</span>`);
        } else {
          expect(spent, `${l}: nothing spent shows nothing`).toBe('');
        }
        // the order the eye reads it in: the name, what they spent, then the message, then when
        expect(row.indexOf('ir-name'), l).toBeLessThan(row.indexOf('ir-spent'));
        expect(row.indexOf('ir-spent'), l).toBeLessThan(row.indexOf('ir-l2'));
        expect(row.indexOf('ir-l2'), l).toBeLessThan(row.indexOf('ir-when'));
      }
      expect(h, l).not.toContain('%');
    }
    // the headline: the base size and weight, a step above the name's
    expect(rule('.ir-spent')).toContain('font-size:var(--font-size-base)');
    expect(rule('.ir-spent')).toContain('font-weight:600');
    expect(rule('.ir-l1')).toContain('font-size:var(--font-size-small)');
  });

  it('no order count on the row (it lives in the card): no figure on it but what they spent and when', () => {
    for (const l of LOCALES) {
      const h = withoutIsolates(html(l));
      for (const row of rows(h)) {
        const rest = row
          .replace(/<span class="ir-spent">[\s\S]*?<\/span>\s*<span class="ir-l2">/, '<span class="ir-l2">')
          .replace(/<span class="ir-when">[\s\S]*?<\/span>/, '')
          .replace(/<[^>]+>/g, ' ');
        expect(rest, l).not.toMatch(/[0-9٠-٩]/);
      }
    }
  });

  it('a regular carries Nomi\'s mark — a shape and its word, in secondary ink, never magenta; nobody else does', () => {
    for (const l of LOCALES) {
      const h = html(l);
      const regular = rowOf(h, 3);
      expect(regular, l).toMatch(new RegExp(`<span class="ir-reg"><svg class="ni"[^>]*aria-hidden="true"[^>]*>[\\s\\S]*?</svg><span class="ir-reg-w">${shown(l, 'buyers.row.regular')}</span></span>`));
      for (const n of [1, 2, 4, 5]) expect(rowOf(h, n), `${l} ${n}`).not.toContain('ir-reg');
      // and the mark is explained under the rows, with the rule Nomi follows
      expect(h, l).toContain(shown(l, 'buyers.key.regular', { n: show.quantity(l, REGULAR_ORDERS) }));
    }
    expect(rule('.ir-reg')).toContain('color:var(--color-ink-secondary)');
    expect(CSS).not.toMatch(/\.ir-reg[^{]*\{[^}]*--color-(assistant|waiting)/);
    // On a phone its word is still said, but the shape stands alone so the name keeps its room.
    expect(CSS).toMatch(/@media \(max-width: 720px\) \{\s*\.ir-reg-w \{ position:absolute;/);
  });

  it('a customer waiting for the owner keeps the waiting signal — magenta ○ and its words; a deletion request its own', () => {
    for (const l of LOCALES) {
      const h = html(l);
      const wait = /<span class="ir-wait"><span class="dot warn" aria-hidden="true">○<\/span><bdi>([^<]+)<\/bdi><\/span>/;
      expect(wait.exec(rowOf(h, 2))?.[1], l).toBe(shown(l, 'takeover.reason.human_requested'));
      expect(wait.exec(rowOf(h, 1))?.[1], l).toBe(shown(l, 'buyers.badge.deletion'));
      for (const n of [3, 4, 5]) expect(rowOf(h, n), `${l} ${n}`).not.toContain('ir-wait');
    }
    expect(rule('.ir-wait')).toContain('color:var(--color-waiting)');
  });
});

describe('phase 4 · two lenses, both whole', () => {
  it('"waiting now" is the default: the needs first under their headings, the switch saying so', () => {
    for (const l of LOCALES) {
      const h = html(l);
      const lens = /<nav class="tabs lens" aria-label="([^"]+)">([\s\S]*?)<\/nav>/.exec(h)!;
      expect(lens[1], l).toBe(shown(l, 'buyers.lens.label'));
      expect(lens[2], l).toBe(`<a class="tab on" aria-current="true" href="/app/inbox">${shown(l, 'buyers.lens.waiting')}</a><a class="tab" href="/app/inbox?lens=value">${shown(l, 'buyers.lens.value')}</a>`);
      expect(h, l).toContain(`<p class="caption muted lens-says">${shown(l, 'buyers.lens.waitingSays')}</p>`);
      expect(h.indexOf(ID(1)), l).toBeLessThan(h.indexOf(ID(3)));
      expect(h, l).toContain(`<h2 class="bgroup-h">${shown(l, 'buyers.group.deletion')}</h2>`);
      expect(h, l).toContain(`<h2 class="bgroup-h">${shown(l, 'buyers.group.needsYou')}</h2>`);
    }
  });

  it('"matters most": who spent most first; nothing spent after, headed apart; the needs keep their signal, not their place', () => {
    const byValue = [...LIST.conversations].sort((a, b) => (b.spent?.amount ?? 0) - (a.spent?.amount ?? 0));
    for (const l of LOCALES) {
      const h = html(l, { lens: 'value', conversations: byValue });
      expect(/<nav class="tabs lens"[^>]*>([\s\S]*?)<\/nav>/.exec(h)![1], l)
        .toBe(`<a class="tab" href="/app/inbox">${shown(l, 'buyers.lens.waiting')}</a><a class="tab on" aria-current="true" href="/app/inbox?lens=value">${shown(l, 'buyers.lens.value')}</a>`);
      expect(h, l).toContain(`<p class="caption muted lens-says">${shown(l, 'buyers.lens.valueSays')}</p>`);
      const heads = [...h.matchAll(/<h2 class="bgroup-h">([^<]+)<\/h2>/g)].map((m) => m[1]);
      expect(heads, l).toEqual([shown(l, 'buyers.lens.noSpend')]);
      const at = (n: number) => h.indexOf(`/app/inbox/${ID(n)}#latest`);
      expect(at(4), l).toBeLessThan(at(3));
      expect(at(3), l).toBeLessThan(at(2));
      expect(at(2), l).toBeLessThan(h.indexOf(shown(l, 'buyers.lens.noSpend')));
      expect(h.indexOf(shown(l, 'buyers.lens.noSpend')), l).toBeLessThan(at(1));
      expect(rowOf(h, 2), l).toContain('<span class="ir-wait">');
    }
  });

  it('the lens rides along every address the page writes: the search, the pages, the narrowings, the way back', () => {
    for (const l of LOCALES) {
      const h = html(l, { lens: 'value', blockedCount: 2, query: 'Zh', page: { from: 51, to: 55, total: 130, next: NEXT, prev: { cursor: PREV } } });
      expect(h, l).toContain('<input type="hidden" name="lens" value="value" />');
      expect(h, l).toContain(`<a class="deeper" href="/app/inbox?lens=value&amp;q=Zh&amp;after=${NEXT}">`);
      expect(h, l).toContain(`<a class="back" href="/app/inbox?lens=value&amp;q=Zh&amp;before=${PREV}">`);
      expect(h, l).toContain('href="/app/inbox?filter=blocked&amp;lens=value"');
      expect(h, l).toContain('<a class="clear" href="/app/inbox?lens=value">');
      // the lenses keep the search, both ways
      expect(h, l).toContain('href="/app/inbox?q=Zh"');
      expect(h, l).toContain('href="/app/inbox?lens=value&amp;q=Zh"');
      // "waiting now" writes no lens at all
      const plain = html(l, { page: { from: 51, to: 55, total: 130, next: NEXT, prev: null } });
      expect(plain, l).not.toContain('<input type="hidden" name="lens"');
      expect(plain, l).toContain(`<a class="deeper" href="/app/inbox?after=${NEXT}">`);
    }
    expect(buyersHref({ filter: 'deletion', lens: 'value', q: 'a b' })).toBe('/app/inbox?filter=deletion&lens=value&q=a+b');
    expect(buyersHref({ filter: 'all', lens: 'waiting' })).toBe('/app/inbox');
  });

  it('a deletion request and a reply that did not send stay findable; Mine is gone; Needs you shows only where Today led', () => {
    for (const l of LOCALES) {
      const h = html(l, { blockedCount: 3, deletionCount: 1 });
      const chips = /<nav class="tabs filters" aria-label="[^"]+">([\s\S]*?)<\/nav>/.exec(h)![1]!;
      expect(chips, l).toContain(`<a class="tab" href="/app/inbox?filter=blocked">${shown(l, 'inbox.filter.blocked')} (${show.quantity(l, 3)})</a>`);
      expect(chips, l).toContain(`<a class="tab" href="/app/inbox?filter=deletion">${shown(l, 'inbox.filter.deletion')} (${show.quantity(l, 1)})</a>`);
      expect(chips, l).not.toContain('filter=pending');
      expect(h, l).not.toContain('filter=mine');
      const led = html(l, { filter: 'pending' });
      expect(led, l).toContain(`<a class="tab on" aria-current="true" href="/app/inbox?filter=pending">${shown(l, 'inbox.filter.pending')} (${show.quantity(l, 2)})</a>`);
      expect(led, l).toContain(`<a class="clear" href="/app/inbox">${shown(l, 'inbox.empty.seeAll')}</a>`);
    }
  });
});

describe('phase 4 · the "needs attention" band', () => {
  it('its three kinds, each with a face, a name and one line, in five languages', () => {
    for (const l of LOCALES) {
      const h = withZone('Asia/Shanghai', () => attentionBand(BAND, l, NOW));
      expect(h, l).toContain(`<h2 class="attn-h" id="attn-h">${shown(l, 'buyers.attention.title')}</h2>`);
      for (const a of BAND) {
        const at = h.indexOf(`href="/app/customers/${a.clientId}" data-card`);
        expect(at, `${l} ${a.kind}`).toBeGreaterThan(-1);
        expect(h, l).toContain(`<a class="ar-main" href="/app/inbox/${a.conversationId}#latest"><span class="ar-name" dir="auto"><bdi>${esc(a.name!)}</bdi></span>`);
        expect(h, l).toContain(`<span class="ar-line">${shown(l, `buyers.attention.${a.kind}`, { date: show.shortWhen(l, a.since, NOW) })}</span>`);
      }
      expect(h, l).toContain('<span class="face face-s');
      expect(h, l).toContain('src="/app/faces/'); // a kept photo is drawn from its version, never fetched
    }
  });

  it('five, then the rest folded under "N more"; no band when nobody is slipping', () => {
    const many = Array.from({ length: 8 }, (_, i): AttentionItem => ({ ...BAND[i % 3]!, clientId: CLIENT(60 + i), conversationId: ID(60 + i) }));
    for (const l of LOCALES) {
      const h = attentionBand(many, l, NOW);
      const [first, more] = h.split('<details class="attn-more">');
      expect(first!.match(/class="arow"/g), l).toHaveLength(ATTENTION_SHOWN);
      expect(more, l).toContain(`<summary>${shown(l, 'buyers.attention.more', { n: show.quantity(l, 3) })}</summary>`);
      expect(more!.match(/class="arow"/g), l).toHaveLength(3);
      expect(attentionBand(many.slice(0, 5), l, NOW), l).not.toContain('<details');
      expect(attentionBand([], l, NOW), l).toBe('');
      // on the page: above the switch, in both lenses
      for (const lens of ['waiting', 'value'] as const) {
        const page = html(l, { lens, attention: BAND });
        expect(page.indexOf('class="attn"'), `${l} ${lens}`).toBeGreaterThan(-1);
        expect(page.indexOf('class="attn"'), `${l} ${lens}`).toBeLessThan(page.indexOf('class="tabs lens"'));
        expect(html(l, { lens, attention: [] }), `${l} ${lens}`).not.toContain('class="attn"');
      }
    }
  });

  it('who it holds is decided in one place: slipping, never waiting — nobody who needs the owner, nobody who asked to be deleted', async () => {
    const C = (n: number) => `2d7a9e3c-4b5f-4a0c-9e8d-3f4a5b6c7d${String(n).padStart(2, '0')}`;
    const r = recorder((q) => {
      if (q.includes('with sent as')) return [{ client_id: C(1), since: DAYS(6) }];
      if (q.includes('cross join lateral')) return [{ client_id: C(1), since: DAYS(4) }, { client_id: C(2), since: DAYS(5) }];
      if (q.includes('having count(*)')) return [{ client_id: C(2) }, { client_id: C(3) }, { client_id: C(4) }];
      if (q.includes('percentile_cont')) return [
        { client_id: C(1), currency: 'USD', spent: '500.00', orders: 1, last_at: DAYS(40), median_gap_days: null },
        { client_id: C(3), currency: 'USD', spent: '3000.00', orders: 4, last_at: DAYS(90), median_gap_days: 10 },
        { client_id: C(4), currency: 'USD', spent: '9000.00', orders: 5, last_at: DAYS(8), median_gap_days: 7 },
      ];
      if (q.includes('cl.display_name as name')) return [1, 2, 3].map((n) => ({ id: C(n), name: `Customer ${n}`, conversation_id: ID(90 + n) }));
      return [];
    });
    const items = await readAttention(r.tx, NOW);
    // one entry each, under the first kind that applies; a regular still ordering is not slipping
    expect(items.map((i) => [i.name, i.kind])).toEqual([
      ['Customer 3', 'regular'], ['Customer 1', 'quote'], ['Customer 2', 'reply'],
    ]);
    expect(items[0]!.since).toEqual(DAYS(90));
    // the three questions each leave out whoever needs the owner, and whoever asked to be deleted
    const asked = r.seen.filter((s) => /with sent as|cross join lateral|having count/.test(s.sql));
    expect(asked).toHaveLength(3);
    for (const s of asked) {
      expect(s.sql).toMatch(/not exists \(select 1 from conversations c where c\.client_id = "\w+"\."\w+" and \(c\.assigned_to is not null/);
      expect(s.sql).toContain("from deletion_requests dr");
      expect(s.sql).toContain("dr.state = 'open'");
    }
    // three to thirty days, from the clock it was given
    const window = asked.slice(0, 2).flatMap((s) => s.params.filter((p): p is Date => p instanceof Date).map((d) => Math.round((NOW.getTime() - d.getTime()) / 86_400_000)));
    expect(window.sort((a, b) => a - b)).toEqual([QUIET_AFTER_DAYS, QUIET_AFTER_DAYS, QUIET_UNTIL_DAYS, QUIET_UNTIL_DAYS]);
    // "asked something" is a question mark in any of the scripts
    expect(asked[1]!.sql).toContain("lw.text_content ~ '[?？؟]'");
    // phase 9 (w4-customers-03) — whoever wrote last: our question (reply) or theirs (asked)
    expect(asked[1]!.sql).toContain('lw.direction');
    // a quote counts as sent the way G7b counts a price given
    expect(asked[0]!.sql).toContain("d.status <> 'approved'");
  });
});

describe('phase 4 · the cursors: each lens pages by its own key', () => {
  const id = '0b5e7c1a-2f3d-4e8a-9c6b-1d2e3f4a5b6c';
  it('encode and decode round-trip, in both lenses, with nothing a URL would percent-encode', () => {
    const keys = [
      { lens: 'waiting', rank: 0, at: '1790000000000000', id },
      { lens: 'waiting', rank: 7, at: null, id },
      { lens: 'value', spent: '48250.50', quoted: '0', at: '1790000000000001', id },
      { lens: 'value', spent: '0', quoted: '7250.00', at: null, id },
      { lens: 'value', spent: '12', quoted: '0', at: '-5', id },
    ] as const;
    for (const k of keys) {
      const s = encodeListKey(k);
      expect(s).toMatch(/^[0-9a-fnqv._-]+$/);
      expect(encodeURIComponent(s)).toBe(s);
      expect(parseListKey(k.lens, s)).toEqual(k);
    }
    expect(encodeListKey(keys[0])).toBe(`0_1790000000000000_${id}`);
    expect(encodeListKey(keys[2])).toBe(`v48250.50_q0_1790000000000001_${id}`);
    // phase 9 (w4-customers-04) — a cursor written before the second tier is no place: the first page
    expect(parseListKey('value', `v48250.50_1790000000000001_${id}`)).toBeNull();
  });

  it('a malformed cursor, or one from the other lens, is no place: the first page', () => {
    const bad = [undefined, 42, '', 'nonsense', `8_1_${id}`, `0_1_${id.toUpperCase()}`, `v1e5_1_${id}`, `v1,240.00_1_${id}`,
      `v12.5.0_1_${id}`, `v_1_${id}`, `0_01_${id}`, `v0012_1_${id}`];
    for (const b of bad) {
      expect(parseListKey('waiting', b), String(b)).toBeNull();
      expect(parseListKey('value', b), String(b)).toBeNull();
    }
    expect(parseListKey('value', `0_n_${id}`)).toBeNull();
    expect(parseListKey('waiting', `v0_n_${id}`)).toBeNull();
    expect(lensOf('value')).toBe('value');
    for (const x of [undefined, '', 'VALUE', 'waiting', ['value']]) expect(lensOf(x)).toBe('waiting');
  });

  it('the "matters most" page is cut by spend, then the newest contact, then the customer — and hands out its own cursor', async () => {
    const r = recorder((q) => q.includes('row_number()')
      ? [{ id: CLIENT(1), conversation_id: ID(1), rank: 6, spent: '1240.00', quoted: '0', at_us: '1790000000000000', pos: 51, total: 130 },
         { id: CLIENT(2), conversation_id: ID(2), rank: 2, spent: '830.00', quoted: '0', at_us: null, pos: 52, total: 130 }] : []);
    const page = await readBuyersPage(r.tx, { filter: 'all', q: '', lens: 'value', after: `v1500.00_q0_1790000000000009_${id}`, size: 2 });
    const asked = r.seen[0]!;
    expect(asked.sql).toContain('row_number() over (order by spent desc, quoted desc, at_us desc nulls last, id desc)');
    expect(asked.sql).toMatch(/spent < \$\d+::numeric or \(spent = \$\d+::numeric and \(quoted < \$\d+::numeric/);
    // phase 9 (w4-customers-04) — nothing spent: the price they were last given, by the rule every page counts a quote by
    expect(asked.sql).toContain('(case when spent > 0 then 0 else given end)::numeric as quoted');
    expect(asked.sql).toContain("d.status <> 'approved'");
    expect(asked.params).toContain('1500.00');
    // the spend is the same SPENT customerValue.ts defines: the orders that stand, in the newest one's currency
    expect(asked.sql).toMatch(/coalesce\(\(select sum\(o\.total_value_usd\) from orders o[\s\S]*o\.status = any\(\$\d+::text\[\]\)[\s\S]*order by coalesce\(o2\.confirmed_at, o2\.created_at\) desc limit 1\)\), 0\)/);
    expect(asked.params).toContainEqual(['confirmed', 'in_production', 'shipped']);
    expect(page.rows).toEqual([{ clientId: CLIENT(1), conversationId: ID(1) }, { clientId: CLIENT(2), conversationId: ID(2) }]);
    expect(page.ids).toEqual([ID(1), ID(2)]);
    expect(page.next).toBe(`v830.00_q0_n_${CLIENT(2)}`);
    expect(page.prev).toEqual({ cursor: `v1240.00_q0_1790000000000000_${CLIENT(1)}` });
    // a "waiting now" cursor means nothing in "matters most": no bound, the first page
    const r2 = recorder(() => []);
    await readBuyersPage(r2.tx, { filter: 'all', q: '', lens: 'value', after: `6_1_${id}` });
    expect(r2.seen[0]!.sql).not.toContain('::numeric or');
  });
});

describe('phase 4 · five languages, right to left, a phone first', () => {
  it('Arabic: a right-to-left page; a Latin name keeps its order inside it; every figure isolated', () => {
    const page = withZone('Asia/Shanghai', () => withAssistantName('Lily', () => shell({
      title: 'T', active: 'inbox', locale: 'ar', path: '/app/inbox', bodyHtml: renderInboxList({ ...LIST, attention: BAND }, 'ar', NOW),
    })));
    expect(page).toContain('<html lang="ar" dir="rtl"');
    expect(rowOf(page, 2)).toContain('<span class="ir-name" dir="auto"><bdi>Alexandre Dupont</bdi></span>');
    expect(page).toContain('<span class="ar-name" dir="auto"><bdi>Carlos Mendes</bdi></span>');
    expect(unisolatedFigures(page.slice(page.indexOf('<main')))).toEqual([]);
    expect(CSS).toContain('[dir="rtl"] .ir-text:dir(ltr) { text-align:end; }');
  });

  it('Arabic and Chinese are drawn no smaller than English: the row and the band size nothing by language', () => {
    for (const l of ['zh', 'ar'] as const) {
      const css = linkedCss(shell({ title: 'T', active: 'inbox', locale: l, path: '/app/inbox', bodyHtml: '' }));
      expect(css, l).not.toMatch(/:lang\([a-z]+\)[^{]*\.(ir|ar|attn|lens)[-\w]*[^{]*\{[^}]*font-size/);
    }
    for (const sel of ['.ar-line', '.ir-when']) expect(rule(sel)).toContain('font-size:var(--font-size-caption)');
  });

  it('every new sentence is its own in each language, with no software words and nobody gendered in English', () => {
    const keys = ['buyers.lens.label', 'buyers.lens.waiting', 'buyers.lens.value', 'buyers.lens.waitingSays', 'buyers.lens.valueSays',
      'buyers.lens.noSpend', 'buyers.row.regular', 'buyers.row.spent', 'buyers.row.card', 'buyers.key.regular', 'buyers.badge.deletion',
      'buyers.attention.title', 'buyers.attention.quote', 'buyers.attention.reply', 'buyers.attention.regular', 'buyers.attention.more'];
    for (const k of keys) {
      const en = say('en', k as MessageKey);
      for (const l of LOCALES) {
        const s = say(l, k as MessageKey, { amount: '$1', who: 'Ahmed', n: 3, date: 'Sep 28' });
        if (l !== 'en') expect(s, `${l}/${k}`).not.toBe(say('en', k as MessageKey, { amount: '$1', who: 'Ahmed', n: 3, date: 'Sep 28' }));
        expect(s, `${l}/${k}`).not.toMatch(/\{\w+\}/);
        expect(s.toLowerCase(), `${l}/${k}`).not.toMatch(/\b(ai|model|token|prompt|api|server|database|system)\b/);
      }
      expect(en, k).not.toMatch(/\b(he|she|his|her|him)\b/i);
    }
  });

  it('the pane beside a conversation draws the same rows, and the customer open there is lit whichever conversation is open', () => {
    for (const l of LOCALES) {
      const open = conv(9, 'Zhang Wei', { conversationId: ID(99), clientId: CLIENT(3) });
      const pane = withAssistantName('Lily', () => renderListPane(LIST, l, NOW, ID(99), [], open));
      expect(pane, l).toContain('<div class="irow is-hers on">');
      expect(rows(pane), l).toHaveLength(LIST.conversations.length);
      expect(pane, l).toContain('<span class="ir-spent">');
      expect(pane, l).not.toContain(esc(say(l, 'pane.current')));
      expect(pane, l).toContain('<nav class="tabs lens"');
    }
    // the same function on both: no second copy of the row to drift
    const panes = readFileSync(`${ROOT}src/api/web/panes.ts`, 'utf8');
    expect(panes).toContain('inboxRow(locale, c, { now, people, pane: { current: isCurrent(c) } })');
    expect(inboxRow).toBeTypeOf('function');
  });
});

/**
 * A database that answers from a script and keeps every statement it was
 * asked: the SQL a reader writes, checked without a server (the readers'
 * real answers are the integration suite's).
 */
function recorder(answer: (sql: string, params: readonly unknown[]) => unknown[]): { tx: Tx; seen: { sql: string; params: readonly unknown[] }[] } {
  const seen: { sql: string; params: readonly unknown[] }[] = [];
  const db = new Kysely<Record<string, never>>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => ({
        init: async () => {}, destroy: async () => {},
        acquireConnection: async () => ({
          executeQuery: async <R>(q: CompiledQuery) => {
            seen.push({ sql: q.sql, params: q.parameters });
            return { rows: answer(q.sql, q.parameters) as R[] };
          },
          // eslint-disable-next-line require-yield
          streamQuery: async function* () { throw new Error('not streamed'); },
        }),
        beginTransaction: async () => {}, commitTransaction: async () => {}, rollbackTransaction: async () => {},
        releaseConnection: async () => {},
      }),
      createIntrospector: (k) => new PostgresIntrospector(k),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  return { tx: db as unknown as Tx, seen };
}
