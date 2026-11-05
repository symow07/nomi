import { renderSplitInbox as renderInboxList } from '../../src/api/web/splitInbox.js';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, type CompiledQuery } from 'kysely';
import { usd } from '../../src/core/types/money.js';
import {
  buyersHref,
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
import { whole } from '../../src/api/web/splitToday.js';
import type { Tx } from '../../src/db/client.js';
import { withoutIsolates, unisolatedFigures } from './isolates.js';
import { linkedCss } from './linked-css.js';
import { compareDecimal, decimal } from '../../src/core/types/decimal.js';

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
  quantity: 500, unitPrice: usd('2.4'), channel: 'whatsapp', unanswered: false, lastFrom: 'assistant',
  photo: null, spent: null, regular: false, ...over,
});

/** Five customers: one waiting with a deletion request, one waiting for a person, a regular, a big one-off buyer, a new one. */
const LIST: InboxList = {
  filter: 'all', lens: 'waiting', waitingCount: 2, blockedCount: 0, deletionCount: 1, channels: 1, query: '',
  conversations: [
    conv(1, 'Fatima Al-Zahra', { deletionWaiting: true, ownership: 'WAITING_HUMAN', handoffReason: 'deletion_requested', lastFrom: 'buyer', unanswered: true }),
    conv(2, 'Alexandre Dupont', { ownership: 'WAITING_HUMAN', handoffReason: 'human_requested', lastFrom: 'buyer', unanswered: true, spent: usd('830') }),
    conv(3, 'Zhang Wei', { spent: usd('1240'), regular: true }),
    conv(4, 'أحمد الراشد', { spent: usd('48250.5') }),
    conv(5, 'Lena Brandt', { lastFrom: 'buyer', unanswered: true }),
  ],
  page: { from: 1, to: 5, total: 5, next: null, prev: null },
};

const BAND: AttentionItem[] = [
  { clientId: CLIENT(80), name: 'Carlos Mendes', photo: null, conversationId: ID(80), kind: 'quote', since: DAYS(5), spent: usd('9000') },
  { clientId: CLIENT(81), name: 'Aisha Bello', photo: 'a1b2c3d4e5f6', conversationId: ID(81), kind: 'reply', since: DAYS(9), spent: null },
  { clientId: CLIENT(82), name: '陈莉', photo: null, conversationId: ID(82), kind: 'regular', since: DAYS(70), spent: usd('31000') },
];

const html = (l: Locale, over: Partial<InboxList> = {}) =>
  withZone('Asia/Shanghai', () => withAssistantName('Lily', () => renderInboxList({ ...LIST, ...over }, l, NOW)));
const shown = (l: Locale, key: string, params?: Record<string, string | number>) => esc(say(l, key as MessageKey, params));
const rows = (h: string) => [...h.matchAll(/<li id="inbox-[^"]+">([\s\S]*?)<\/li>/g)].map((m) => m[1]!);
const rowOf = (h: string, n: number) => rows(h).find((r) => r.includes(`href="/app/inbox/${ID(n)}?from=`)) ?? '';
const CSS = linkedCss(shell({ title: 'T', active: 'inbox', locale: 'en', path: '/app/inbox', bodyHtml: '' }));

describe('phase 4 · one customer, one row', () => {
  it('in both lenses and five languages: a row per customer, each with their face (their card) and their conversation', () => {
    for (const l of LOCALES) {
      for (const lens of ['waiting', 'value'] as const) {
        const h = html(l, { lens });
        expect(rows(h), `${l} ${lens}`).toHaveLength(LIST.conversations.length);
        for (const c of LIST.conversations) {
          expect(h.split(`href="/app/customers/${c.clientId}" data-card`).length - 1, `${l} ${lens} ${c.buyer}`).toBe(1);
          expect(h.split(`class="si-door" href="/app/inbox/${c.conversationId}?from=`).length - 1, `${l} ${lens} ${c.buyer}`).toBe(1);
        }
        // the face is the shared one: drawn by faces.ts, a 40 px face on a 64 px row
        expect(h, l).toContain('<span class="face face-s t');
      }
    }
    expect(CSS).toContain('.il-page .si-row, .il-compact-list .si-row { min-block-size:80px; }');
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
    expect(r.seen[1]!.sql.match(/count\(distinct c\.client_id\)/g)).toHaveLength(7);
  });
});

describe('phase 4 · the row: spend is the headline, no order count, the regular\'s mark', () => {
  it('value lens renders actual spend and leaves absent amounts empty', () => {
    for (const l of LOCALES) {
      const h = html(l, { lens: 'value' });
      for (const c of LIST.conversations) {
        const row = rowOf(h, Number(c.conversationId.slice(-2)));
        const value = /<span class="sp-rval">([\s\S]*?)<\/span>/.exec(row)?.[1];
        expect(value, `${l} ${c.buyer}`).toBe(c.spent ? esc(whole(show.money(l, c.spent))) : '');
        expect(row.indexOf('sp-rname'), l).toBeLessThan(row.indexOf('sp-rval'));
      }
    }
  });

  it('rows do not invent order counts or expose unit-price and quantity fields', () => {
    for (const l of LOCALES) {
      const h = html(l);
      expect(rows(h)).toHaveLength(LIST.conversations.length);
      for (const row of rows(h)) {
        expect(row).not.toContain('500');
        expect(row).not.toContain(esc(show.money(l, usd('2.4'))));
        expect(row.replace(/<[^>]+>/g, ' ')).not.toContain('%');
      }
    }
  });

  it('regular status is stated on only the actual regular customer row in every locale', () => {
    for (const l of LOCALES) {
      const h = html(l);
      expect(rowOf(h, 3), l).toContain(`<bdi>${shown(l, 'buyers.row.regular')}</bdi>`);
      for (const n of [1, 2, 4, 5]) expect(rowOf(h, n), `${l} ${n}`).not.toContain(shown(l, 'buyers.row.regular'));
    }
  });

  it('waiting and deletion reasons remain beside their row dot in every locale', () => {
    for (const l of LOCALES) {
      const h = html(l);
      expect(rowOf(h, 2), l).toContain(`<span class="si-why"><bdi>${shown(l, 'takeover.reason.human_requested')}</bdi>`);
      expect(rowOf(h, 1), l).toContain(`<span class="si-why"><bdi>${shown(l, 'buyers.badge.deletion')}</bdi>`);
      for (const n of [1, 2]) expect(rowOf(h, n), l).toContain('class="row-dot"');
      for (const n of [3, 4, 5]) expect(rowOf(h, n), l).not.toContain('class="row-dot"');
    }
  });
});

describe('phase 4 · two lenses, both whole', () => {
  it('waiting order retains deletion priority and exposes the selected lens', () => {
    for (const l of LOCALES) {
      const h = html(l);
      expect(h, l).toContain(`<a class="si-fil on" aria-current="true" href="/app/inbox?filter=all">${shown(l, 'buyers.lens.waiting')}</a>`);
      expect(h.indexOf(ID(1)), l).toBeLessThan(h.indexOf(ID(3)));
      expect(h, l).toContain(`<h2 class="sp-cap">${shown(l, 'buyers.group.deletion')}</h2>`);
    }
  });

  it('value lens retains the reader order and waiting signals without ownership regrouping', () => {
    const byValue = [...LIST.conversations].sort((a, b) => compareDecimal(b.spent?.amount ?? decimal('0'), a.spent?.amount ?? decimal('0')));
    for (const l of LOCALES) {
      const h = html(l, { lens: 'value', conversations: byValue });
      expect(h, l).toContain(`<a class="si-fil on" aria-current="true" href="/app/inbox?filter=all&amp;lens=value">${shown(l, 'buyers.lens.value')}</a>`);
      expect(h, l).toContain(shown(l, 'buyers.lens.valueSays'));
      expect(h, l).not.toContain('<h2 class="sp-cap">');
      const at = (n: number) => h.indexOf(`id="inbox-${ID(n)}"`);
      expect(at(4), l).toBeLessThan(at(3));
      expect(at(3), l).toBeLessThan(at(2));
      expect(at(2), l).toBeLessThan(at(1));
      expect(rowOf(h, 2), l).toContain(shown(l, 'takeover.reason.human_requested'));
    }
  });

  it('the lens rides along every address the page writes: the search, the pages, the narrowings, the way back', () => {
    for (const l of LOCALES) {
      const h = html(l, { lens: 'value', blockedCount: 2, query: 'Zh', page: { from: 51, to: 55, total: 130, next: NEXT, prev: { cursor: PREV } } });
      expect(h, l).toContain('<input type="hidden" name="lens" value="value" />');
      expect(h, l).toContain(`<a class="deeper" href="/app/inbox?filter=all&amp;lens=value&amp;q=Zh&amp;after=${NEXT}">`);
      expect(h, l).toContain(`<a class="back" href="/app/inbox?filter=all&amp;lens=value&amp;q=Zh&amp;before=${PREV}">`);
      expect(h, l).toContain('href="/app/inbox?filter=blocked&amp;lens=value&amp;q=Zh"');
      expect(h, l).toContain('<a class="clear" href="/app/inbox?filter=all&amp;lens=value">');
      // the lenses keep the search, both ways
      expect(h, l).toContain('href="/app/inbox?filter=all&amp;q=Zh"');
      expect(h, l).toContain('href="/app/inbox?filter=all&amp;lens=value&amp;q=Zh"');
      // "waiting now" writes no lens at all
      const plain = html(l, { page: { from: 51, to: 55, total: 130, next: NEXT, prev: null } });
      expect(plain, l).not.toContain('<input type="hidden" name="lens"');
      expect(plain, l).toContain(`<a class="deeper" href="/app/inbox?filter=all&amp;after=${NEXT}">`);
    }
    expect(buyersHref({ filter: 'deletion', lens: 'value', q: 'a b' })).toBe('/app/inbox?filter=deletion&lens=value&q=a+b');
    expect(buyersHref({ filter: 'all', lens: 'waiting' })).toBe('/app/inbox');
  });

  it('deletion and blocked views remain conditional and Needs you is always discoverable', () => {
    for (const l of LOCALES) {
      const h = html(l, { blockedCount: 3, deletionCount: 1 });
      const views = /<nav class="si-tabs"[^>]*>([\s\S]*?)<\/nav>/.exec(h)![1]!;
      for (const f of ['pending', 'blocked', 'deletion']) expect(views, l).toContain(`filter=${f}`);
      expect(views, l).toContain(`<span class="si-tabn">${esc(show.count(l, 3))}</span>`);
      expect(h, l).not.toContain('filter=mine');
      expect(html(l, { blockedCount: 0, deletionCount: 0 }), l).not.toContain('filter=blocked');
      expect(html(l, { blockedCount: 0, deletionCount: 0 }), l).not.toContain('filter=deletion');
      expect(html(l, { filter: 'pending' }), l).toContain('class="si-tab on" aria-current="true" href="/app/inbox?filter=pending"');
    }
  });
});

describe('phase 4 · the "needs attention" band', () => {
  it('quiet reasons, faces and conversation doors render once on their existing customer rows', () => {
    for (const l of LOCALES) {
      const conversations = BAND.map((a, i) => conv(80 + i, a.name!, { photo: a.photo }));
      const h = html(l, { filter: 'quiet', conversations, attention: BAND });
      expect(rows(h), l).toHaveLength(3);
      for (const a of BAND) {
        const r = rowOf(h, Number(a.conversationId.slice(-2)));
        expect(r, l).toContain(`href="/app/customers/${a.clientId}" data-card`);
        expect(r, l).toContain(shown(l, `buyers.attention.${a.kind}`, { date: show.shortWhen(l, a.since, NOW) }));
        expect(r, l).toContain(esc(a.name!));
      }
      expect(h, l).toContain('src="/app/faces/');
    }
  });

  it('attention context does not insert duplicate customers or displace waiting rows', () => {
    const waiting = conv(1, 'WAITING-ROW', { ownership: 'WAITING_HUMAN', handoffReason: 'human_requested' });
    const quiet = conv(2, 'QUIET-ROW');
    for (const l of LOCALES) {
      const page = html(l, { attention: BAND, conversations: [waiting, quiet] });
      expect(rows(page), l).toHaveLength(2);
      expect(page.indexOf('WAITING-ROW'), l).toBeLessThan(page.indexOf('QUIET-ROW'));
      for (const a of BAND) expect(page, l).not.toContain(esc(a.name!));
      expect(html(l, { attention: BAND, conversations: [], filter: 'pending' }), l).toContain(shown(l, 'buyers.empty.calm'));
    }
  });

  it('quiet view displays every returned row and pagination is owned by the existing reader', () => {
    const many = Array.from({ length: 8 }, (_, i): AttentionItem => ({ ...BAND[i % 3]!, clientId: CLIENT(60 + i), conversationId: ID(60 + i) }));
    const conversations = many.map((a, i) => conv(60 + i, a.name!));
    for (const l of LOCALES) {
      for (const lens of ['waiting', 'value'] as const) {
        const h = html(l, { filter: 'quiet', lens, conversations, attention: many });
        expect(rows(h), `${l} ${lens}`).toHaveLength(8);
        expect(h, l).not.toContain('attn-more');
        expect(html(l, { filter: 'quiet', lens, conversations: [], attention: [] }), l).toContain(shown(l, 'inbox.empty.quiet'));
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
    expect(rowOf(page, 2)).toContain('<bdi class="sp-rname">Alexandre Dupont</bdi>');
    expect(page).not.toContain('Carlos Mendes');
    expect(unisolatedFigures(page.slice(page.indexOf('<main')))).toEqual([]);
    expect(CSS).toContain('[dir="rtl"] .si-last:dir(ltr), [dir="ltr"] .si-last:dir(rtl) { text-align:end; }');
  });

  it('Arabic and Chinese are drawn no smaller than English: the row and the band size nothing by language', () => {
    for (const l of ['zh', 'ar'] as const) {
      const css = linkedCss(shell({ title: 'T', active: 'inbox', locale: l, path: '/app/inbox', bodyHtml: '' }));
      expect(css, l).not.toMatch(/:lang\([a-z]+\)[^{]*\.(ir|ar|attn|lens)[-\w]*[^{]*\{[^}]*font-size/);
    }
    expect(CSS).toContain('.il-page .si-why, .il-page .si-said, .il-compact-list .si-why, .il-compact-list .si-said { font-size:var(--font-size-small); }');
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
      expect(pane, l).toContain('si-row is-selected');
      expect(pane, l).toContain('aria-current="page"');
      expect(rows(pane), l).toHaveLength(LIST.conversations.length);
      expect(pane, l).toContain('<span class="sp-rval">');
      expect(pane, l).not.toContain(esc(say(l, 'pane.current')));
      expect(pane, l).toContain('<select name="filter">');
    }
    // the same function on both: no second copy of the row to drift
    const panes = readFileSync(`${ROOT}src/api/web/panes.ts`, 'utf8');
    expect(panes).toContain('renderInboxRows(shown, locale, now, people,');
    expect(panes).toContain('renderInboxViews(data, locale, { compact: true })');
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
