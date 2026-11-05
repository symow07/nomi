import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderSplitInbox } from '../../src/api/web/splitInbox.js';
import { SPLIT_CSS } from '../../src/api/web/splitStyle.js';
import { buyersHref, type ConversationSummary, type InboxList } from '../../src/api/web/inbox.js';
import { withWorkspace } from '../../src/api/web/say.js';
import { withZone } from '../../src/api/web/zone.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { moneyFromRow } from '../../src/core/types/money.js';
import { stageOf } from '../../src/db/customerStage.js';
import { buttonsAndDoors } from './buttons-and-doors.js';
import { unisolatedFigures, withoutIsolates } from './isolates.js';

/**
 * THE INBOX IN THE SPLIT LOOK (the owner, 2026-11-05): five views with counts, a search and a stage filter, Today's rows.
 * No card, no banner. Every door the plain page has stays, and "Did not send" and "Deletion requests" stay findable.
 */

const NOW = new Date('2026-11-05T12:00:00Z');
const SCOPE = { name: null, several: false, outreach: false, setup: null, business: 'Atlas', zone: 'UTC', needsYou: 2 };

const conv = (id: string, over: Partial<ConversationSummary> = {}): ConversationSummary => ({
  conversationId: `00000000-0000-4000-8000-00000000000${id}`, clientId: `10000000-0000-4000-8000-00000000000${id}`, buyer: `Customer ${id}`, country: 'AE',
  status: 'handled', needsAction: false, ownership: 'AI', heldBy: null, awaitingReview: false, handoffReason: null, deletionWaiting: false,
  latestMessage: 'hello', latestAt: new Date('2026-11-02T09:00:00Z'), product: { name: 'Rose Serum', nameZh: null }, quantity: null, unitPrice: null,
  channel: 'instagram', unanswered: false, stage: 'asked', value: null, thumb: null, ...over,
} as ConversationSummary);

const list = (over: Partial<InboxList> = {}): InboxList => ({
  filter: 'all', waitingCount: 2, blockedCount: 0, deletionCount: 0, conversations: [], query: '', lens: 'waiting', stage: null,
  views: { quiet: 3, assistant: 4, team: 1, everyone: 9 }, sampled: true, labels: [], label: null,
  page: { from: 1, to: 2, total: 2, next: null, prev: null }, attention: [], ...over,
});
const draw = (data: InboxList, locale: 'en' | 'ar' = 'en', outreach = false): string =>
  withWorkspace({ ...SCOPE, outreach }, () => withZone('UTC', () => renderSplitInbox(data, locale, NOW, [])));
const rowsOf = (html: string): string[] => html.split('<div class="sp-row si-row').slice(1).map((r) => r.split('</li>')[0]!);

describe('the views', () => {
  it('five, in the owner\'s order, each with its count, and the one on marked', () => {
    const html = withoutIsolates(draw(list({ filter: 'quiet' })));
    const tabs = html.split('<nav class="si-tabs"')[1]!.split('</nav>')[0]!;
    const words = [...tabs.matchAll(/>([^<>]+)<span class="si-tabn">([^<]+)</g)].map((m) => `${m[1]} ${m[2]}`);
    expect(words).toEqual(['Needs you 2', 'Gone quiet 3', 'With your assistant 4', 'With your team 1', 'Everyone 9']);
    expect(tabs.match(/aria-current="true"/g)).toHaveLength(1);
    expect(tabs).toMatch(/class="si-tab on" aria-current="true" href="\/app\/inbox\?filter=quiet"/);
  });

  it('"Did not send" and "Deletion requests" stand beside them while they hold someone, or are asked for (rule 18)', () => {
    expect(draw(list())).not.toContain('filter=deletion');
    expect(draw(list())).not.toContain('filter=blocked');
    const held = draw(list({ deletionCount: 1, blockedCount: 2 }));
    expect(held).toContain('filter=deletion');
    expect(held).toContain('filter=blocked');
    expect(draw(list({ filter: 'deletion' }))).toContain('filter=deletion');
  });

  it('every view says something of its own when it holds nobody', () => {
    for (const [filter, key] of [['quiet', 'inbox.empty.quiet'], ['assistant', 'inbox.empty.assistant'], ['team', 'inbox.empty.team'], ['pending', 'buyers.empty.calm'], ['deletion', 'inbox.empty.deletion'], ['blocked', 'refused.none'], ['all', 'inbox.empty.none']] as const) {
      expect(draw(list({ filter })), filter).toContain(t('en', key as MessageKey));
    }
    expect(draw(list({ stage: 'order' }))).toContain(t('en', 'inbox.empty.stage'));
  });
});

describe('the rows', () => {
  const needing = conv('1', { ownership: 'WAITING_HUMAN', unopened: true, handoffReason: 'human_requested', stage: 'price', value: moneyFromRow('3900.00', 'USD'), thumb: '/p/thumb.jpg', photo: 'v1' });
  const opened = conv('2', { awaitingReview: true, unopened: false });
  const quiet = conv('3', { stage: 'order', value: moneyFromRow('1450.50', 'USD') });

  it('photo or initial, name, product photo, stage, value, days quiet: in that order', () => {
    const [row] = rowsOf(withoutIsolates(draw(list({ conversations: [needing] }))));
    const at = (needle: string): number => { const i = row!.indexOf(needle); expect(i, needle).toBeGreaterThan(-1); return i; };
    expect(at('class="face-link si-face"')).toBeLessThan(at('class="sp-rname"'));
    expect(at('class="sp-rname"')).toBeLessThan(at('class="sp-thumb sp-thumb-s"'));
    expect(at('class="sp-thumb sp-thumb-s"')).toBeLessThan(at('>Price given<'));
    expect(at('>Price given<')).toBeLessThan(at('$3,900'));
    expect(at('$3,900')).toBeLessThan(at('3d'));
  });

  it('the dot and the bold: only what needs the owner, and bold only until it is opened', () => {
    const [a, b, c] = rowsOf(draw(list({ conversations: [needing, opened, quiet] })));
    expect(a).toMatch(/^ is-needs is-new"/);
    expect(a).toContain('class="row-dot"');
    expect(b).toMatch(/^ is-needs"/);
    expect(b).toContain('class="row-dot"');
    expect(c).toMatch(/^"/);
    expect(c).not.toContain('class="row-dot"');
    expect(SPLIT_CSS).toContain('.si-row.is-new .sp-rname { font-weight:700; }');
  });

  it('says why in words; the dot is never alone', () => {
    const [a] = rowsOf(withoutIsolates(draw(list({ conversations: [needing] }))));
    expect(a).toContain(t('en', 'takeover.reason.human_requested'));
    const [o] = rowsOf(withoutIsolates(draw(list({ conversations: [conv('4', { orderWaiting: true })] }))));
    expect(o).toContain(t('en', 'buyers.badge.order'));
  });

  it('an order and a deletion request lead, headed apart', () => {
    const html = withoutIsolates(draw(list({ conversations: [conv('5', { orderWaiting: true }), conv('6', { deletionWaiting: true }), needing] })));
    expect(html.indexOf(t('en', 'buyers.group.order'))).toBeGreaterThan(-1);
    expect(html.indexOf(t('en', 'buyers.group.order'))).toBeLessThan(html.indexOf(t('en', 'buyers.group.deletion')));
    expect(html.indexOf(t('en', 'buyers.group.deletion'))).toBeLessThan(html.indexOf('Customer 1'));
  });

  it('nothing to show is nothing: no "$0", and an empty place where there is no photo', () => {
    const [r] = rowsOf(draw(list({ conversations: [conv('7')] })));
    expect(r).toContain('<span class="sp-rval"></span>');
    expect(r).toContain('sp-thumb-none');
    expect(r).not.toMatch(/\$0/);
  });

  it('the row is the conversation\'s door, landing on the newest; the face still opens the card', () => {
    const [r] = rowsOf(draw(list({ conversations: [needing] })));
    expect(r).toContain(`href="/app/inbox/${needing.conversationId}?from=${encodeURIComponent('/app/inbox?filter=all#inbox-' + needing.conversationId)}#latest"`);
    expect(r).toContain('data-card');
    // Its reach is the row's, under the face, so the two doors stay two.
    expect(SPLIT_CSS).toMatch(/\.si-door::after \{[^}]*position:absolute; inset:0/);
    expect(SPLIT_CSS).toMatch(/\.si-row \.si-face \{[^}]*z-index:1/);
  });

  it('"Matters most" shows what it is ordered by, not the stage\'s figure', () => {
    const spent = conv('8', { spent: moneyFromRow('8200.00', 'USD'), value: moneyFromRow('100.00', 'USD'), stage: 'order' });
    const [r] = rowsOf(withoutIsolates(draw(list({ lens: 'value', conversations: [spent] }))));
    expect(r).toContain('$8,200');
    expect(r).not.toContain('$100');
  });

  it('a find by product says the product: the photo alone cannot', () => {
    const [r] = rowsOf(withoutIsolates(draw(list({ query: 'rose', conversations: [conv('9')] }))));
    expect(r).toContain('<mark class="hit">Rose</mark>');
  });
});

describe('search and the stage filter', () => {
  it('a find looks across everyone, and carries the stage, the order and the label', () => {
    const form = draw(list({ filter: 'pending', stage: 'price', lens: 'value' })).split('<form class="si-search"')[1]!.split('</form>')[0]!;
    expect(form).toContain('name="filter" value="all"');
    expect(form).toContain('name="stage" value="price"');
    expect(form).toContain('name="lens" value="value"');
    expect(form).toContain('type="search" name="q"');
  });

  it('the stages are doors that keep the view; the one on is marked', () => {
    const html = draw(list({ filter: 'team', stage: 'order' }));
    expect(html).toContain('href="/app/inbox?filter=team&amp;stage=asked"');
    expect(html).toMatch(/class="si-fil on" aria-current="true" href="\/app\/inbox\?filter=team&amp;stage=order"/);
    expect(html).toContain('href="/app/inbox?filter=team">All stages');
  });

  it('a sample is a stage only where it is one', () => {
    expect(draw(list({ sampled: false }))).not.toContain('stage=sample');
    expect(draw(list({ sampled: true }))).toContain('stage=sample');
    expect(draw(list({ sampled: false, stage: 'sample' }))).toContain('stage=sample');
  });

  it('an address names a stage or none', () => {
    expect(stageOf('order')).toBe('order');
    for (const x of ['', 'nope', undefined, 3, ['order']]) expect(stageOf(x)).toBeNull();
  });

  it('"Everyone" says so in the address, because the bare address opens on who needs you', () => {
    expect(buyersHref({ filter: 'all', explicit: true })).toBe('/app/inbox?filter=all');
    expect(buyersHref({ filter: 'all' })).toBe('/app/inbox');
  });
});

describe('the page', () => {
  it('Today\'s head: the serif title under the wash, the mark for a phone, the live slot', () => {
    const html = draw(list());
    expect(html).toContain('<header class="il-header">');
    expect(html).toContain('<h1 class="page">Inbox</h1>');
    expect(html).toContain('class="il-workspace"');
    expect(html).toContain('class="il-view-form"');
  });

  it('no card and no banner: one flat sheet, its parts ruled apart', () => {
    const html = draw(list({ conversations: [conv('1')] }));
    expect(html.match(/class="il-main sp-sheet"/g)).toHaveLength(1);
    for (const gone of ['class="sp-card', 'class="attn', 'class="flash', 'class="irow']) expect(html).not.toContain(gone);
  });

  it('keeps every door of the plain page, and paging', () => {
    const html = draw(list({ page: { from: 51, to: 100, total: 120, next: '6_1_x', prev: { cursor: null } }, conversations: [conv('1')] }), 'en', true);
    for (const door of ['/app/customers/outreach', '/app/inbox/replies', '/app/customers/labels', '/app/customers/feedback']) expect(html).toContain(`href="${door}"`);
    expect(html).toContain('action="/app/customers/outreach/write"');
    expect(html).toContain('after=6_1_x');
    expect(html).toContain('href="/app/inbox?filter=all"');
    const labelled = draw(list({ labels: [{ id: 'l1', name: 'VIP', buyers: 2 }] }));
    expect(labelled).toContain('label=l1');
  });

  it('buttons do things and doors go places, in English and in Arabic', () => {
    for (const l of ['en', 'ar'] as const) expect(buttonsAndDoors(draw(list({ conversations: [conv('1', { stage: 'price', value: moneyFromRow('12.00', 'USD') })] }), l))).toEqual([]);
  });

  it('in Arabic every figure is isolated and a Latin name is its own isolate', () => {
    const html = draw(list({ conversations: [conv('1', { buyer: 'Bartholomew Featherstonehaugh', stage: 'price', value: moneyFromRow('3900.00', 'USD') })] }), 'ar');
    expect(unisolatedFigures(html)).toEqual([]);
    expect(html).toContain('<bdi class="sp-rname">Bartholomew');
    // The wash, the rows and the views follow the page by logical properties alone.
    const mine = SPLIT_CSS.split('/* The Inbox:')[1]!.split('/* The list of who else waits')[0]!;
    expect(mine).not.toMatch(/(?:margin|padding|border)-(?:left|right)\b|text-align:(?:left|right)|\b(?:left|right):/);
  });

  it('a phone row: name and value, chip, reason and days, then the last message; the tab bar stays over nothing', () => {
    const phone = SPLIT_CSS.split('@media (max-width: 720px)')[1]!;
    expect(phone).toContain('grid-template-areas:"dot face thumb name name val go" "dot face thumb chip why day go"');
    expect(phone).toContain('"dot face thumb said said said go"');
    expect(phone).toContain('.split .content { padding-block-end:calc(84px');
  });
});

describe('the last message on a row', () => {
  const rowOf = (c: ConversationSummary, locale: 'en' | 'ar' = 'en'): string =>
    draw(list({ conversations: [c] }), locale).split('<div class="sp-row si-row')[1]!.split('</li>')[0]!;

  it('is the customer\'s own words, held in the isolate that cuts them', () => {
    expect(rowOf(conv('1', { latestMessage: 'Do you ship to Fes?', lastFrom: 'buyer' }))).toContain('<span class="si-said"><bdi class="si-last">Do you ship to Fes?</bdi></span>');
    expect(rowOf(conv('1', { latestMessage: 'أريد التحدث مع شخص', lastFrom: 'buyer' }), 'ar')).toContain('<bdi class="si-last">أريد التحدث مع شخص</bdi>');
  });

  it('says who wrote it when it was not the customer', () => {
    expect(rowOf(conv('1', { latestMessage: 'On its way.', lastFrom: 'person' }))).toContain('<span class="si-by"><bdi>You</bdi>:</span><bdi class="si-last">On its way.</bdi>');
    expect(rowOf(conv('1', { latestMessage: 'It is $12.', lastFrom: 'assistant', answeredBy: 'Lily' }))).toContain('<span class="si-by"><bdi>Lily</bdi>:</span><bdi class="si-last">');
  });

  it('is plain text, however it was written, and no page carries a whole long message', () => {
    const said = rowOf(conv('1', { latestMessage: '<script>alert(1)</script>' }));
    expect(said).not.toContain('<script>');
    expect(said).toContain('&lt;script&gt;');
    const long = rowOf(conv('1', { latestMessage: 'word '.repeat(200) })).split('<bdi class="si-last">')[1]!.split('</bdi>')[0]!;
    expect(long.endsWith('…')).toBe(true);
    expect(long.length).toBeLessThan(210);
  });

  it('draws nothing when there is no message, and keeps the reason', () => {
    expect(rowOf(conv('1', { latestMessage: null as unknown as string }))).not.toContain('si-said');
    const waiting = rowOf(conv('1', { ownership: 'WAITING_HUMAN', latestMessage: 'Hi' }));
    expect(waiting).toContain('class="si-why"');
    expect(waiting).toContain('class="si-last"');
  });

  it('is one faded line, cut with an ellipsis at its own end', () => {
    const rule = SPLIT_CSS.split('.si-last {')[1]!.split('}')[0]!;
    for (const part of ['white-space:nowrap', 'text-overflow:ellipsis', 'overflow:hidden']) expect(rule).toContain(part);
    expect(SPLIT_CSS.split('.si-said {')[1]!.split('}')[0]).toContain('color:var(--color-ink-secondary)');
    expect(SPLIT_CSS).toContain('[dir="rtl"] .si-last:dir(ltr), [dir="ltr"] .si-last:dir(rtl) { text-align:end; }');
  });
});

describe('the word is "Inbox", and the address stays', () => {
  it('the Split rail and the plain rail say it; no page is called anything else', () => {
    const layout = readFileSync('src/api/web/layout.ts', 'utf8');
    expect(layout).toContain("{ href: '/app/inbox', id: 'inbox' }");
    expect(layout).not.toContain('nav.customers');
  });
});
