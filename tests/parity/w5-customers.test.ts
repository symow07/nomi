import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, type CompiledQuery } from 'kysely';
import { usd } from '../../src/core/types/money.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { dayKey, dayStart } from '../../src/core/owner/i18n/format.js';
import type { Tx } from '../../src/db/client.js';
import { loadCustomerCard, type CustomerCard } from '../../src/db/customerCard.js';
import { renderCustomerCard, cardOpenedFrom } from '../../src/api/web/customerCard.js';
import { readAttention, quietAfterPrice, type AttentionItem } from '../../src/db/inboxAttention.js';
import { renderInboxList, attentionBand, type InboxList, type ConversationSummary } from '../../src/api/web/inbox.js';
import { renderCalendar, parseCalendarQuery } from '../../src/api/web/calendar.js';
import type { CalendarEntry, CalendarView } from '../../src/db/calendar.js';
import { renderAnalytics, type AnalyticsData } from '../../src/api/web/analytics.js';
import { renderOrder, orderTitle, type OrderView } from '../../src/api/web/orders.js';
import { shell, esc } from '../../src/api/web/layout.js';
import { withAssistantName } from '../../src/api/web/say.js';
import { withZone } from '../../src/api/web/zone.js';
import { linkedCss } from './linked-css.js';
import { withoutIsolates } from './isolates.js';

/**
 * Phase 9 of the warmth run (2026-10-03) — the fix wave, area "customers"
 * (UI-AUDIT §4: the Inbox, an order, the calendar, Results, the profile
 * card). Each block names the finding it holds; each assertion fails on the
 * code the audit read.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p: string): string => readFileSync(`${ROOT}${p}`, 'utf8');
const NOW = new Date('2026-10-03T04:00:00Z');
const C = (n: number) => `1c6f8d2b-3a4e-4f9b-8d7c-2e3f4a5b6c${String(n).padStart(2, '0')}`;
const V = (n: number) => `0b5e7c1a-2f3d-4e8a-9c6b-1d2e3f4a5b${String(n).padStart(2, '0')}`;
const shown = (l: Locale, key: string, params?: Record<string, string | number>) => esc(t(l, key as MessageKey, params));
const CSS = linkedCss(shell({ title: 'T', active: 'inbox', locale: 'en', path: '/app/inbox', bodyHtml: '' }));

/** A database that answers from a script and keeps every statement it was asked (as warmth-inbox.test.ts). */
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

describe('w4-customers-25 · w4-conversation-12 · the card: what they asked about, the waiting word, its door', () => {
  it('"asked about" reads the prices worked out for them and what their conversation is about, not analysed turns alone', async () => {
    const r = recorder((q) => q.includes('display_name as name') ? [{ name: 'Aisha Bello' }]
      : q.includes('from quotes q') && q.includes('conversation_state cs') ? [{ name: 'LED String Lights 10m', name_zh: 'LED灯串' }]
      : q.includes('percentile_cont') ? [] : []);
    const card = await loadCustomerCard(r.tx, C(1), 'owner');
    expect(card!.bought).toEqual([]);
    expect(card!.askedAbout).toEqual([{ name: 'LED String Lights 10m', nameZh: 'LED灯串' }]);
    const asked = r.seen.find((s) => s.sql.includes('conversation_state cs'))!.sql;
    expect(asked).toContain("t.analysis->'intent'->'productCandidate'->>'productId'");
    expect(asked).toContain('from quotes q join conversations c on c.id = q.conversation_id');
    expect(asked).toContain('cs.identified_product_id');
  });

  it('waits as THIS reader sees it: a colleague\'s conversation is not the owner\'s "Needs you"', async () => {
    const r = recorder((q) => q.includes('display_name as name') ? [{ name: 'Omar' }] : []);
    await loadCustomerCard(r.tx, C(2), 'p-reader');
    const convs = r.seen.find((s) => s.sql.includes('as waiting'))!;
    expect(convs.params).toContain('p-reader');
    expect(convs.sql).toContain('c.assigned_to is not null and (c.assigned_to =');
  });

  const card = (over: Partial<CustomerCard> = {}): CustomerCard => ({
    clientId: C(3), name: 'Aisha Bello', photo: null, channels: ['whatsapp'], lastWrote: NOW, bought: [], askedAbout: [],
    value: { clientId: C(3), spent: null, orders: 0, lastOrderAt: null, regular: false, quietSince: null },
    waiting: true, conversationId: V(3), ...over,
  });

  it('the waiting flag is the strip\'s and the Inbox\'s word, in every language', () => {
    for (const l of LOCALES) {
      const html = renderCustomerCard(card(), l, NOW);
      expect(html, l).toContain(`<p class="pc-wait">${shown(l, 'inbox.filter.pending')}</p>`);
      expect(t(l, 'inbox.filter.pending'), l).toBe(t(l, 'buyers.group.needsYou'));
    }
  });

  it('opened from the conversation its door leads to, it has no door; the page form leads back there', () => {
    for (const l of LOCALES) {
      expect(renderCustomerCard(card(), l, NOW, V(3)), l).not.toContain('pc-open');
      expect(renderCustomerCard(card(), l, NOW, V(4)), l).toContain('<a class="deeper pc-open"');
    }
    expect(cardOpenedFrom(`https://app.nomidoes.com/app/inbox/${V(3)}`, 'app.nomidoes.com')).toBe(V(3));
    expect(cardOpenedFrom(`https://app.nomidoes.com/app/inbox/${V(3)}?before=1_2`, 'app.nomidoes.com')).toBe(V(3));
    expect(cardOpenedFrom(`https://elsewhere.test/app/inbox/${V(3)}`, 'app.nomidoes.com')).toBeNull();
    expect(cardOpenedFrom('https://app.nomidoes.com/app/inbox', 'app.nomidoes.com')).toBeNull();
    expect(cardOpenedFrom(undefined, 'app.nomidoes.com')).toBeNull();
    expect(cardOpenedFrom('not a url', 'app.nomidoes.com')).toBeNull();
    const app = read('src/api/web/app.ts');
    expect(app).toContain('loadCustomerCard(tx, id, personOf(s).id)');
    expect(app).toContain("from ? back(conversationUrl(from), t(locale, 'pcard.back'))");
  });

  it('w4-customers-26 · its one action is the graphite primary one, its words inside their padding', () => {
    const r = /\n\s*\.pc-open \{([^}]*)\}/.exec(CSS)![1]!;
    expect(r).toContain('background:var(--color-ink)');
    expect(r).toContain('color:var(--color-surface)');
    expect(r).toMatch(/padding:var\(--space-12\) var\(--space-16\)/);
    expect(CSS).toContain('.pc-open .go { color:var(--color-surface); }');
  });
});

describe('w4-customers-02 · who went quiet after a price: one definition, Today and the Inbox', () => {
  it('Today names the band\'s first "went quiet after a price", in the band\'s own order', async () => {
    const r = recorder((q) => {
      if (q.includes('with sent as')) return [{ client_id: C(1), since: new Date('2026-09-29T00:00:00Z') }, { client_id: C(2), since: new Date('2026-09-12T00:00:00Z') }];
      if (q.includes('percentile_cont')) return [{ client_id: C(2), currency: 'USD', spent: '900.00', orders: 1, last_at: null, median_gap_days: null }];
      if (q.includes('cl.display_name as name')) return [1, 2].map((n) => ({ id: C(n), name: `Customer ${n}`, conversation_id: V(n) }));
      return [];
    });
    const band = await readAttention(r.tx, NOW, 'owner');
    const first = await quietAfterPrice(r.tx, NOW, 'owner');
    expect(first?.clientId).toBe(band.find((a) => a.kind === 'quote')!.clientId);
    expect(first?.clientId).toBe(C(2));   // the one who spent more, as the band orders them
    // nobody waiting for THIS reader: a colleague's conversation does not hide its customer
    const slipping = r.seen.filter((s) => s.sql.includes('with sent as'));
    expect(slipping[0]!.params).toContain('owner');
    // a closed conversation is over, not slipping; the price was GIVEN
    expect(slipping[0]!.sql).toContain('c.is_active');
    expect(slipping[0]!.sql).toContain("d.status <> 'approved'");
  });

  it('Today reads it from there, for the reader, and keeps no reading of its own', () => {
    const insights = read('src/api/web/insights.ts');
    expect(insights).toContain('await quietAfterPrice(tx, new Date(), viewerId)');
    expect(insights).not.toContain("interval '2 days'");
    expect(read('src/api/web/inbox.ts')).toContain('readAttention(tx, new Date(), viewerId)');
  });
});

describe('w4-customers-13 · w4-customers-20 · V1-201 · a price given, one rule, one name', () => {
  it('every page that counts or marks a price reads PRICE_GIVEN', () => {
    for (const f of ['src/api/web/today.ts', 'src/api/web/analytics.ts', 'src/db/inboxAttention.ts', 'src/db/calendar.ts', 'src/db/buyersList.ts']) {
      expect(read(f), f).toContain('PRICE_GIVEN');
    }
    expect(read('src/api/web/today.ts')).not.toContain("o.status in ('sent', 'delivered', 'read') and o.sent_at >= q.created_at");
  });

  const ZONE = 'Asia/Shanghai';
  const TODAY = dayKey(NOW, ZONE);
  const at = (ymd: string, hhmm: string): Date => new Date(dayStart(ymd, ZONE).getTime() + (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))) * 60_000);
  const price = (id: string, state: 'given' | 'review' | 'unsent' | undefined, name: string): CalendarEntry => ({
    category: 'negotiation', kind: 'price_worked_out', day: TODAY, at: at(TODAY, '09:00'), allDay: false, conversationId: V(9), orderId: null,
    buyer: { id: C(9), name, country: 'NG', photo: null }, identity: null,
    detail: { price: usd(1.45), quantity: 5000, ...(state ? { priceState: state } : {}) }, source: { table: 'quotes', id, column: 'created_at' },
  });
  const draw = (l: Locale, entries: CalendarEntry[], over: Partial<CalendarView> = {}, kind: 'list' | 'week' | 'month' = 'list') => withZone(ZONE, () => {
    const q = parseCalendarQuery({ view: kind }, NOW);
    return renderCalendar({ from: q.from, to: q.to, today: TODAY, category: null, buyer: null, buyers: [], categories: ['negotiation'], entries, ...over }, l, { view: q.view, at: q.at, now: NOW });
  });
  const rowOf = (h: string, id: string) => new RegExp(`<li class="dl-row (solid|dashed)( done)?" data-src="quotes:${id}"[\\s\\S]*?</li>`).exec(h)?.[0] ?? '';
  const words = (h: string) => withoutIsolates(h).replace(/<[^>]+>/g, '');

  it('a price whose reply waits for review is owed, never "✓ done"; one never sent is neither; one given is done once past', () => {
    for (const l of LOCALES) {
      const h = withAssistantName('Lily', () => draw(l, [price('q1', 'review', 'Aisha Bello'), price('q2', 'unsent', 'Layla Mansour'), price('q3', 'given', 'Carlos Mendes')]));
      const review = rowOf(h, 'q1');
      expect(review, l).not.toContain(' done"');
      expect(review, l).toContain('<span class="dot warn" aria-hidden="true">○</span>');
      expect(words(review), l).toContain(withoutIsolates(shown(l, 'calendar.say.price_review', { who: 'Aisha Bello' })));
      const unsent = rowOf(h, 'q2');
      expect(unsent, l).not.toContain(' done"');
      expect(unsent, l).not.toContain('class="dot');
      expect(words(unsent), l).toContain(withoutIsolates(shown(l, 'calendar.say.price_unsent', { who: 'Layla Mansour' })));
      const given = rowOf(h, 'q3');
      expect(given, l).toContain(' done"');
      expect(words(given), l).toContain(withoutIsolates(shown(l, 'calendar.say.price_worked_out', { who: 'Carlos Mendes' })));
    }
  });

  it('the event has Today\'s name for it — a quote — in the calendar, the band and Results; "worked out" is gone', () => {
    for (const l of LOCALES) {
      const quote = { en: 'Quote', zh: '报价', ar: 'عرض', es: 'Presupuesto', fr: 'Devis' }[l];
      for (const k of ['calendar.say.price_worked_out', 'calendar.say.price_review', 'calendar.say.price_unsent', 'calendar.line.price', 'buyers.attention.quote'] as const) {
        expect(t(l, k, { who: 'X', date: 'D', price: 'P', qty: 'Q' }).toLowerCase(), `${l} ${k}`).toContain(quote.toLowerCase());
      }
    }
    expect(t('en', 'calendar.say.price_worked_out', { who: 'Carlos' })).toBe('Quote sent to Carlos');
    expect(read('src/api/web/analytics.ts')).toContain("stat(d.commerce.quotes, 'today.tally.quotes')");
    expect(read('src/api/web/analytics.ts')).toContain("stat(d.commerce.orders, 'today.tally.orders')");
  });

  it('w4-customers-16 · Chinese breaks only where the sentence has a space, never inside 报价', () => {
    expect(CSS).toContain('html[lang="zh"] .dl-say { word-break:keep-all; overflow-wrap:anywhere; }');
  });

  it('w4-customers-14 · the marks are explained under the dates — only those the page shows — not at the foot of the fold', () => {
    for (const l of LOCALES) {
      const h = withAssistantName('Lily', () => draw(l, [price('q1', 'review', 'Aisha Bello')]));
      const fold = /<details class="cal-tools"[\s\S]*?<\/details>/.exec(h)![0];
      expect(fold, l).not.toContain('cal-legend');
      const legend = /<p class="cal-legend small">([\s\S]*?)<\/p>/.exec(h)![1]!;
      expect(h.indexOf('cal-legend'), l).toBeGreaterThan(h.indexOf('data-src="quotes:q1"'));
      expect(legend, l).toContain(shown(l, 'calendar.legend.owed'));
      expect(legend, l).not.toContain(shown(l, 'calendar.legend.done'));
      expect(legend, l).not.toContain('cal-sw dashed');
    }
  });

  it('w4-customers-15 · the list says where its dates stop', () => {
    for (const l of LOCALES) {
      const h = draw(l, [price('q1', 'given', 'Carlos Mendes')]);
      expect(h, l).toContain('<p class="muted cal-rest">');
    }
  });

  it('w4-customers-18 · a kind the period does not hold is offered but cannot be chosen', () => {
    const h = draw('en', [price('q1', 'given', 'Carlos'), { ...price('q2', 'given', 'Aisha'), buyer: { id: C(8), name: 'Aisha', country: null } }],
      { buyers: [{ id: C(9), name: 'Carlos', country: null }, { id: C(8), name: 'Aisha', country: null }] });
    expect(h).toContain(`<option value="negotiation">${shown('en', 'calendar.cat.negotiation')}</option>`);
    expect(h).toContain(`<option value="samples" disabled>${shown('en', 'calendar.cat.none', { kind: t('en', 'calendar.cat.samples') })}</option>`);
  });

  it('V2 calendar-month · w4-customers-17 · on a phone the whole week fits, and "+N more" keeps the cell\'s inset', () => {
    const phone = CSS.slice(CSS.indexOf('Phase 9 (V2 calendar-month)'));
    expect(phone).toMatch(/@media \(max-width: 720px\) \{\s*\.mo \{ min-width:0; \}/);
    expect(phone).toContain('.mo-e .mo-n { position:absolute;');
    expect(CSS).toContain('.mo-more { padding-inline:var(--space-4); }');
    // the signal stays beside the face when the name folds away
    const h = withAssistantName('Lily', () => draw('en', [price('q1', 'review', 'Aisha Bello')], {}, 'month'));
    expect(h).toMatch(/<span class="mo-n"><bdi>Aisha Bello<\/bdi><\/span> <span class="dot warn"/);
  });
});

describe('Results (w4-customers-19 · -20 · -21 · -22 · -23 · -24)', () => {
  const DATA: AnalyticsData = {
    range: 'month', hasActivity: true, since: new Date('2026-09-30T16:00:00Z'),
    summary: { newClients: 27, activeConvos: 29, quotes: 8, orders: 1 },
    activity: { inbound: 40, replied: 41, waiting: 1 },
    commerce: { quotes: 8, orders: 1, deals: [{ status: 'confirmed', n: 1 }], totals: [usd(11750)] },
    employee: { handled: 1, waiting: 1, edits: 0 },
  };
  it('customers are counted as the Inbox counts them, so the new ones are among those in touch', () => {
    const src = read('src/api/web/analytics.ts');
    expect(src).toContain('select distinct cv.client_id from messages m join conversations cv');
    expect(src).toContain('(select count(*)::int from talked t join clients cl on cl.id = t.client_id where cl.created_at >= ${cutoff}) as new_clients');
    expect(src).toContain('coalesce(o.confirmed_at, o.created_at) >= ${cutoff}) as orders');
  });
  it('says where the period starts, Sales is a section, and no picture stands in for a chart', () => {
    for (const l of LOCALES) {
      const h = withZone('Asia/Shanghai', () => renderAnalytics(DATA, l));
      expect(h, l).toContain('<p class="caption muted an-since">');
      expect(h, l).toContain(`<h2>${shown(l, 'analytics.commerce.deals')}</h2>`);
      expect(h, l).not.toContain('<div class="sub">');
      const empty = renderAnalytics({ ...DATA, hasActivity: false }, l);
      expect(empty, l).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
  it('w4-customers-23 · Chinese: one 你 and one 的 clause', () => {
    const s = t('zh', 'analytics.n.handled.other', { name: '你的助手' });
    expect(s.match(/你/g)).toHaveLength(1);
    expect(s).toBe('条你的助手起草、经确认后发出的回复');
  });
});

describe('an order (V1-184 · w4-customers-09 · -10 · -11 · -12)', () => {
  const ORDER: OrderView = {
    orderId: '44444444-4444-4444-8444-444444444444', reference: 'USAB-de300000-0001', conversationId: V(1),
    buyer: 'Khalid Mansoor', clientId: C(1), photo: null, productName: 'Stainless Steel Thermos 500ml', productNameZh: '保温杯', productSku: 'ZX-200',
    quantity: 5000, unit: 'pcs', unitPriceAmount: 2.35, totalAmount: 11750, currency: 'USD', email: null, paymentTerms: '30 days', incoterm: 'FOB',
    sellerName: 'Atlas Trading', confirmedAt: new Date('2026-10-01T06:00:00Z'), history: [],
  };
  it('names whose order it is, with their face; the record code is a row', () => {
    for (const l of LOCALES) {
      const h = withZone('Asia/Shanghai', () => renderOrder(ORDER, l, null));
      expect(h, l).toMatch(/<div class="ord-head"><a class="face-link" href="\/app\/customers\/[^"]+" data-card/);
      expect(h, l).toMatch(/<h1 class="page">[^<]*<bdi>Khalid Mansoor<\/bdi>/);
      expect(h, l).not.toMatch(/<h1 class="page">[^<]*<bdi>USAB/);
      expect(h, l).toContain(`<span class="flabel">${shown(l, 'order.field.reference')}</span><span class="fval"><bdi>USAB-de300000-0001</bdi></span>`);
      expect(orderTitle(l, ORDER), l).toContain('Khalid Mansoor');
    }
  });
});

describe('the Inbox (w4-customers-03 · -04 · -06 · -07 · V1-164 · V1-166 · V2 phone preview)', () => {
  const conv = (n: number, buyer: string, over: Partial<ConversationSummary> = {}): ConversationSummary => ({
    conversationId: V(n), clientId: C(n), buyer, country: 'AE', status: 'handled', needsAction: false,
    ownership: 'AI', heldBy: null, awaitingReview: false, handoffReason: null, deletionWaiting: false,
    latestMessage: 'Thanks, noted.', latestAt: new Date(NOW.getTime() - n * 60_000), product: { name: 'Canvas tote', nameZh: '帆布袋' },
    quantity: 500, unitPrice: usd(2.4), channel: 'whatsapp', unanswered: false, lastFrom: 'assistant', photo: null, spent: null, regular: false, ...over,
  });
  const LIST: InboxList = {
    filter: 'all', lens: 'value', waitingCount: 1, blockedCount: 0, deletionCount: 0, channels: 1, query: '',
    conversations: [conv(1, 'Khalid', { spent: usd(11750) }), conv(2, 'Omar', { quoted: usd(6150) }), conv(3, 'Lena')],
    page: { from: 1, to: 3, total: 3, next: null, prev: null },
  };
  const html = (l: Locale, over: Partial<InboxList> = {}) => withZone('Asia/Shanghai', () => withAssistantName('Lily', () => renderInboxList({ ...LIST, ...over }, l, NOW)));

  it('-04 · "matters most": spent, then the price they were given and have not ordered on, then the rest, each headed', () => {
    for (const l of LOCALES) {
      const h = html(l);
      expect(h.indexOf('Khalid'), l).toBeLessThan(h.indexOf(shown(l, 'buyers.lens.quoted')));
      expect(h.indexOf(shown(l, 'buyers.lens.quoted')), l).toBeLessThan(h.indexOf('Omar'));
      expect(h.indexOf('Omar'), l).toBeLessThan(h.indexOf(shown(l, 'buyers.lens.noSpend')));
      expect(h, l).toContain(`<span class="ir-spent ir-quoted"><bdi aria-hidden="true">`);
      expect(withoutIsolates(h), l).toContain(`<span class="sr">${withoutIsolates(shown(l, 'buyers.row.quoted', { amount: '\u0000' })).split('\u0000')[0]}`);
    }
    expect(CSS).toContain('.ir-spent.ir-quoted { font-weight:400; color:var(--color-ink-secondary); }');
  });

  it('-06 · the lens says the state\'s own word; -07 · under a narrowing no lens is shown selected, and the way back is said once', () => {
    for (const l of LOCALES) {
      const plain = html(l, { lens: 'waiting' });
      expect(plain, l).toContain('class="tabs lens"');
      expect(plain, l).toContain(shown(l, 'buyers.lens.waitingSays'));
      const narrowed = html(l, { lens: 'waiting', filter: 'pending', conversations: [] });
      expect(narrowed, l).not.toContain('class="tabs lens"');
      expect(narrowed, l).not.toContain('lens-says');
      expect(narrowed.split(shown(l, 'inbox.empty.seeAll')).length - 1, l).toBe(1);
      const blocked = html(l, { filter: 'blocked', blockedCount: 0, conversations: [] });
      expect(blocked.split(shown(l, 'inbox.empty.seeAll')).length - 1, l).toBe(1);
    }
    expect(t('en', 'buyers.lens.waiting')).toBe('Needs you first');
    expect(t('zh', 'buyers.lens.waiting')).toContain(t('zh', 'inbox.filter.pending'));
  });

  it('-03 · the group of the assistant\'s rows the customer wrote last says only that; the band counts their questions nobody answered', () => {
    expect(t('en', 'buyers.group.hersWaiting', { name: 'Lily' })).toBe('Lily is handling — they wrote last');
    const band: AttentionItem[] = [{ clientId: C(5), name: 'Marco', photo: null, conversationId: V(5), kind: 'asked', since: new Date('2026-09-28T00:00:00Z'), spent: null }];
    for (const l of LOCALES) {
      expect(attentionBand(band, l, NOW), l).toContain(`<span class="ar-line">${shown(l, 'buyers.attention.asked', { date: '\u0000' }).split('\u0000')[0]}`);
    }
  });

  it('V1-164 · previews are cut by the row, not at ninety characters; V2 · on a phone a reason gives the message its own line', () => {
    const long = 'Kids Water Bottle with Straw: $1.08/pc for 30,000 pcs, lead time 25 days from the deposit, and we can send samples';
    const h = html('en', { lens: 'waiting', conversations: [conv(6, 'Rahim', { latestMessage: long })] });
    expect(h).toContain(`<span class="ir-text" dir="auto">${long}</span>`);
    expect(CSS).toContain('.ir-l2:has(.ir-wait, .ir-hold) { flex-wrap:wrap; row-gap:0; }');
    expect(CSS).toContain('.ir-l2:has(.ir-wait, .ir-hold) .ir-text { flex-basis:100%; }');
  });

  it('V1-166 · no calendar door under the list (the rail has it); the contacts door names what it opens', () => {
    for (const l of LOCALES) {
      expect(html(l), l).not.toContain('href="/app/calendar"');
      expect(t(l, 'contacts.door'), l).toContain(t(l, 'contacts.title').replace(/^Vos /, '').trim().slice(0, 4));
    }
  });
});
