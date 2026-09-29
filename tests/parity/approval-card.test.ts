import { describe, it, expect } from 'vitest';
import { readReply, differsOn } from '../../src/core/owner/reading.js';
import { tn, t } from '../../src/core/owner/i18n/messages.js';
import { renderConversationDetail, type ConversationDetail } from '../../src/api/web/inbox.js';
import { moneyFromRow } from '../../src/core/types/money.js';
import { buttonsAndDoors } from './buttons-and-doors.js';
import { withoutIsolates } from './isolates.js';

/**
 * THE APPROVAL CARD (the design pass, 2026-09-29; the plan's §1): one card,
 * the reply once, the acts in a row, and — in place of a confidence number —
 * where each figure and product name in the reply came from, and whether a
 * second, separate reading of the message agreed.
 */

const usd = (n: number) => moneyFromRow(n, 'USD')!;
const NOW = new Date('2026-09-29T10:00:00Z');
const QUOTE = { unitPrice: 34.9, total: 349, quantity: 10, discountPct: 0, leadTimeDays: 5, moq: null };

describe('how the reply was read: each figure and name, with its source', () => {
  it('names the product, and gives each figure the source the numeral guard would', () => {
    const r = readReply({
      reply: 'Hi Maya! The Rose Face Serum is $34.90 each, $349 for 10, ready in 5 days.',
      productNames: ['Rose Face Serum', '玫瑰精华'], quote: QUOTE, theirTexts: ['how much for 10?'], heldQuantity: null,
    });
    // "for 10" and "in 5 days" are small plain figures: the guard lets them pass as words, and so does the card.
    expect(r.lines).toEqual([
      { kind: 'product', name: 'Rose Face Serum' },
      { kind: 'figure', value: 34.9, source: 'price' },
      { kind: 'figure', value: 349, source: 'total' },
    ]);
    expect(r.everyFigureSourced).toBe(true);
  });

  it('says so when a figure has no source — and the card then does not claim every figure has one', () => {
    const r = readReply({ reply: 'It is $29 today.', productNames: [], quote: QUOTE, theirTexts: [], heldQuantity: null });
    expect(r.lines).toEqual([{ kind: 'figure', value: 29, source: 'unsourced' }]);
    expect(r.everyFigureSourced).toBe(false);
  });

  it('a figure the customer wrote is theirs; one the conversation holds is theirs too', () => {
    const r = readReply({ reply: 'Yes, 5,000 units by March.', productNames: [], quote: null, theirTexts: ['can you do 5000?'], heldQuantity: null });
    expect(r.lines).toEqual([{ kind: 'figure', value: 5000, source: 'their_words' }]);
    expect(readReply({ reply: 'For 800 units, yes.', productNames: [], quote: null, theirTexts: [], heldQuantity: 800 }).lines)
      .toEqual([{ kind: 'figure', value: 800, source: 'their_words' }]);
  });

  it('reads a second reading\'s disagreement from the stored turn, and nothing from anything else', () => {
    expect(differsOn({ agrees: { language: true, quantity: true, product: true, complaint: true, phase: true } })).toEqual([]);
    expect(differsOn({ agrees: { language: null, quantity: false, product: false, complaint: true, phase: true } })).toEqual(['product', 'quantity']);
    expect(differsOn(null)).toBeNull();
    expect(differsOn({ own: {} })).toBeNull();
  });
});

describe('a counted sentence takes its language\'s form (Intl.PluralRules)', () => {
  it('English two, Chinese one, Arabic six', () => {
    expect([1, 2].map((n) => tn('en', 'card.reasons.count', n))).toEqual(['1 reason', '2 reasons']);
    expect([1, 7].map((n) => tn('zh', 'card.reasons.count', n))).toEqual(['1 条依据', '7 条依据']);
    expect([1, 2, 3, 11, 100].map((n) => tn('ar', 'card.reasons.count', n)))
      .toEqual(['سبب واحد', 'سببان', '3 أسباب', '11 سببًا', '100 سبب']);
  });
});

describe('the card, drawn', () => {
  const base: ConversationDetail = {
    conversationId: 'c-1', buyer: 'Maya Rahman', country: 'GB', status: 'awaiting',
    product: { name: 'Rose Face Serum', nameZh: '玫瑰精华' }, quantity: 10,
    quote: { unitPrice: usd(34.9), total: usd(349), quantity: 10 }, order: null,
    messages: [{ direction: 'inbound', text: 'how much for 10 of the rose serum?', at: new Date('2026-09-29T09:58:00Z') }],
    pendingDraft: { draftId: 'd-1', draftText: 'The Rose Face Serum is $34.90 each, $349 for 10.', capability: 'quote' },
    ownership: 'AI', refusals: [], uncertainSends: [], handoffReasons: [], unheardReason: null, lastHumanAction: null,
    knowledgeUsed: ['Ships from Leeds'], rate: null, leadTimeBlocked: null, sampleAsked: null, proof: { quoteId: null, token: null },
    channel: 'instagram',
    reading: { intent: 'price_request', quantity: { value: 10, unit: 'bottles' }, language: 'en', differsOn: [], quote: QUOTE },
  };
  const card = (html: string) => html.slice(html.indexOf('id="approve"'), html.indexOf('</section>', html.indexOf('id="approve"')));

  it('who asked, where and when; what was understood; how it was read, closed; the reply once; one Send', () => {
    const html = withoutIsolates(renderConversationDetail(base, 'en', NOW, null));
    const c = card(html);
    expect(c).toMatch(/<b><bdi>Maya Rahman<\/bdi><\/b> asked · Instagram · Today \d\d:\d\d/);
    expect(c).toContain('<span class="as"><span aria-hidden="true">✦</span> Your assistant drafted</span>');
    expect(c).toContain('<blockquote class="said" dir="auto"><bdi>how much for 10 of the rose serum?</bdi></blockquote>');
    expect(c).toContain('<bdi>a price question</bdi> · <bdi>Rose Face Serum</bdi> · <bdi>10 bottles</bdi> · <bdi>English</bdi>');
    expect(c).toMatch(/<details><summary><span class="t">How your assistant read this<\/span><span class="c">5 reasons<\/span><\/summary>/);
    expect(c).toContain('<bdi>$34.90</bdi><span>your price for Rose Face Serum</span>');
    expect(c).toContain('<bdi>$349.00</bdi><span>the total, at your prices</span>');
    expect(c).toContain('<bdi>Ships from Leeds</bdi><span>something you taught</span>');
    expect(c).toContain('checked twice');
    expect(c).toContain('Every figure has a source');
    expect(c).toMatch(/Instagram takes replies until \d\d:\d\d tomorrow/);
    expect(html.split('The Rose Face Serum is $34.90 each')).toHaveLength(2);   // once, in the box
    expect(buttonsAndDoors(html)).toEqual([]);
  });

  it('what made it wait is the card\'s state line, drawn before the rest', () => {
    const held = withoutIsolates(renderConversationDetail({ ...base, pendingDraft: { ...base.pendingDraft!, heldBecause: 'discount_needs_owner' } }, 'en', NOW, null));
    const c = card(held);
    expect(c).toMatch(/<p class="stateline" role="note"><span class="dot warn" aria-hidden="true">●<\/span> <b>Waiting for you<\/b> /);
    expect(c.indexOf('class="stateline"')).toBeLessThan(c.indexOf('class="said"'));
  });

  it('a figure nothing accounts for, and a second reading that differed, are said plainly', () => {
    const html = withoutIsolates(renderConversationDetail({
      ...base,
      pendingDraft: { ...base.pendingDraft!, draftText: 'Today only: $29.' },
      reading: { ...base.reading!, differsOn: ['product'] },
    }, 'en', NOW, null));
    const c = card(html);
    expect(c).toContain('<span class="mk warn" aria-hidden="true">○</span><bdi>29</bdi><span>no source found</span>');
    expect(c).toContain('Not every figure has a source');
    expect(c).toContain('a second, separate reading differed on the product');
  });

  it('in Chinese and Arabic: the same card, the customer\'s words kept in their own direction, nobody gendered', () => {
    const zh = card(withoutIsolates(renderConversationDetail(base, 'zh', NOW, null)));
    expect(zh).toContain('<b><bdi>Maya Rahman</bdi></b> 在 Instagram 上问');
    expect(zh).toContain('<bdi>问价</bdi> · <bdi>玫瑰精华</bdi>');
    expect(zh).toContain('5 条依据');
    const ar = card(withoutIsolates(renderConversationDetail(base, 'ar', NOW, null)));
    expect(ar).toContain('سؤال من <b><bdi>Maya Rahman</bdi></b>');
    expect(ar).toContain('5 أسباب');
    expect(ar).toContain(t('ar', 'card.handToMe'));
    expect(ar).toContain('<blockquote class="said" dir="auto">');
  });

  it('the page\'s other cards are states of the one card: a dot, the state\'s own words, then why and what to do', () => {
    const html = withoutIsolates(renderConversationDetail({
      ...base, unheardReason: 'transcription_failed',
      refusals: [{ outboundId: 'o-1', conversationId: 'c-1', buyer: 'Maya', reason: 'window_closed', at: NOW, origin: 'employee' }],
    }, 'en', NOW, null));
    expect(html).toContain(`<p class="stateline rf-h"><span class="dot warn" aria-hidden="true">●</span> <b>${t('en', 'unheard.title')}</b></p>`);
    expect(html).toContain(`<p class="stateline rf-h"><span class="dot bad" aria-hidden="true">●</span> <b>${t('en', 'refused.title')}</b></p>`);
    expect(html).not.toContain('<h3 class="rf-h">');
  });

  it('CH5 · under two hours left in the window, the card says so first, with the time left in words', () => {
    const late = { ...base, messages: [{ ...base.messages[0]!, at: new Date(NOW.getTime() - (22 * 60 + 40) * 60_000) }] };
    const en = card(withoutIsolates(renderConversationDetail(late, 'en', NOW, null)));
    expect(en).toContain('<p class="stateline" role="note"><span class="dot warn" aria-hidden="true">●</span> <b>Closing soon</b> Instagram takes replies for 1 hour, 20 minutes more</p>');
    expect(en.indexOf('Closing soon')).toBeLessThan(en.indexOf('class="said"'));
    expect(card(withoutIsolates(renderConversationDetail(late, 'zh', NOW, null)))).toContain('Instagram 还能回复 1小时20分钟');
    // with the day still ahead, nothing to say about it but the time it closes
    expect(card(withoutIsolates(renderConversationDetail(base, 'en', NOW, null)))).not.toContain('Closing soon');
  });

  it('no turn on record (a fixture, an old conversation): the card still works, and claims nothing it cannot show', () => {
    const c = card(withoutIsolates(renderConversationDetail({ ...base, reading: null, knowledgeUsed: [] }, 'en', NOW, null)));
    // no reading of the message: no intent, no language, no second reading — only the product the conversation holds
    expect(c).toContain('<p class="und"><span class="k">Understood</span><span><bdi>Rose Face Serum</bdi></span></p>');
    expect(c).not.toContain('checked twice');
    // …and the quote the page holds still sources its figures
    expect(c).toContain('<bdi>$34.90</bdi><span>your price for Rose Face Serum</span>');
    expect(c).toContain('Every figure has a source');
    expect(c).toContain('name="command" value="send"');
  });
});
