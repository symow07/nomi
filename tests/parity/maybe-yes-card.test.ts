import { describe, it, expect } from 'vitest';
import { renderConversationDetail, type ConversationDetail } from '../../src/api/web/inbox.js';
import { quantitiesSaid } from '../../src/core/conversation/acceptance.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import * as show from '../../src/api/web/values.js';
import { OWNER_VIEW } from '../../src/core/conversation/people.js';
import { usd } from '../../src/core/types/money.js';

/**
 * "THE 'MAY BE SAYING YES' CARD must carry, visibly, before any button: the buyer's message verbatim, in their own
 * words; the exact order being confirmed: product, quantity, price, total… 'ok, 5000 again please' after a price for a
 * different quantity… Show me the mismatch, don't hide it behind a verb." (the owner, 2026-10-14)
 *
 * The maybe card has no Confirm at all — the owner answers in their own words; the order card (a real yes) carries
 * their words and the unit price above its two buttons. Over Postgres: tests/integration/order-proposal.test.ts.
 */

const NOW = new Date('2026-10-14T10:00:00Z');
const OFFER = {
  productName: 'Gift box', quantity: 500, unit: 'boxes',
  unitPrice: usd('2.1'), total: usd('1050'), givenAt: '2026-10-14T09:00:00.000Z',
};
const base = (over: Partial<ConversationDetail> = {}): ConversationDetail => ({
  conversationId: 'conv-1', buyer: 'Maya', country: 'GB', status: 'awaiting',
  product: { name: 'Gift box', nameZh: null }, quantity: 500, quote: null, order: null, messages: [], pendingDraft: null,
  ownership: 'OWNER_CONTROLLED', refusals: [], uncertainSends: [], handoffReasons: ['maybe_confirmation'],
  unheardReason: null, unreadable: null, lastHumanAction: null, knowledgeUsed: [],
  rate: null, leadTimeBlocked: null, sampleAsked: null, proof: { quoteId: null, token: null },
  orderProposal: null,
  maybeYes: { said: 'ok, 5000 again please', offer: OFFER },
  ...over,
});

const bare = (x: string): string => x.replace(/[\u2068\u2069]/g, '');

/** The card alone: its own <div>, from its opening tag to the one that closes it. */
const cardOf = (html: string): string => {
  const at = html.indexOf('id="maybe-yes"');
  if (at < 0) return '';
  const start = html.lastIndexOf('<div', at);
  const tags = /<div\b|<\/div>/g;
  tags.lastIndex = start;
  let depth = 0;
  for (let m = tags.exec(html); m; m = tags.exec(html)) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  return html.slice(start);
};

describe('the numbers a buyer wrote', () => {
  it('reads figures as the buyer wrote them, in any script, ignoring "1" and decimals', () => {
    expect(quantitiesSaid('ok, 5000 again please')).toEqual([5000]);
    expect(quantitiesSaid('5,000 pcs then')).toEqual([5000]);
    expect(quantitiesSaid('好的，５０００个')).toEqual([5000]);
    expect(quantitiesSaid('تمام، ٥٠٠٠ قطعة')).toEqual([5000]);
    expect(quantitiesSaid('yes, 1 more thing — 2.5 each was fine')).toEqual([]);
    expect(quantitiesSaid('Sounds great')).toEqual([]);
  });
});

describe('"may be saying yes": what the owner sees before deciding anything', () => {
  it('in every language: their words verbatim, then product, quantity, unit price, total and when it was given', () => {
    for (const locale of LOCALES) {
      const card = cardOf(renderConversationDetail(base(), locale, NOW, null, OWNER_VIEW));
      expect(card, locale).toContain(esc(t(locale, 'maybeYes.title')));
      const words = card.indexOf('<bdi>ok, 5000 again please</bdi>');
      const facts = [
        '<bdi>Gift box</bdi>',
        `<bdi>${esc(show.quantityOf(locale, 500, 'boxes'))}</bdi>`,
        `<bdi>${esc(show.money(locale, usd('2.1')))}</bdi>`,
        `<bdi>${esc(show.money(locale, usd('1050')))}</bdi>`,
        esc(show.date(locale, new Date(OFFER.givenAt))),
      ].map((x) => card.indexOf(x));
      expect(words, `${locale}: their words`).toBeGreaterThan(-1);
      for (const i of facts) expect(i, locale).toBeGreaterThan(words);
    }
  });

  it('"ok, 5000 again please" after a price for 500: the mismatch, in words, in every language', () => {
    for (const locale of LOCALES) {
      const card = cardOf(renderConversationDetail(base(), locale, NOW, null, OWNER_VIEW));
      // The figures are drawn isolated where the page runs right to left (5000 between isolates): compared without the isolates.
      const line = bare(esc(t(locale, 'maybeYes.mismatch', { said: '5000', given: show.quantityOf(locale, 500, 'boxes') })));
      expect(bare(card), locale).toContain(line);
      expect(card, locale).toMatch(/role="alert"/);
    }
  });

  it('no mismatch line when they name the quantity they were priced for, or none', () => {
    for (const said of ['ok, 500 please', 'Sounds great, let us go with that']) {
      const card = cardOf(renderConversationDetail(base({ maybeYes: { said, offer: OFFER } }), 'en', NOW, null, OWNER_VIEW));
      expect(card, said).toContain(esc(said));
      expect(card, said).not.toContain('Check the quantity');
    }
  });

  it('no price on record: it says so, and still shows their words', () => {
    const card = cardOf(renderConversationDetail(base({ maybeYes: { said: '那就这么定了吧', offer: null } }), 'zh', NOW, null, OWNER_VIEW));
    expect(card).toContain('<bdi>那就这么定了吧</bdi>');
    expect(card).toContain(esc(t('zh', 'maybeYes.noOffer')));
  });

  // CHANGED BY DESIGN (the owner, on #345): this card had nothing to press, and that was a dead end — "what do I
  // actually do when the buyer HAS said yes in a phrasing that wasn't on the list?". It still has no Confirm: ONE form,
  // which PREPARES the order, and the order card that follows has the Confirm.
  it('no Confirm, ever: one form, and it prepares — its button says so, its address is not the order\'s confirm', () => {
    for (const locale of LOCALES) {
      const card = cardOf(renderConversationDetail(base(), locale, NOW, null, OWNER_VIEW));
      expect(card.match(/<form/g), locale).toHaveLength(1);
      expect(card, locale).toContain('action="/app/inbox/conv-1/maybe-yes/order"');
      expect(card, locale).not.toMatch(/order\/confirm/);
      expect(card, locale).not.toContain(esc(t(locale, 'order.action.confirm')));
      expect(card, locale).toContain(`>${esc(t(locale, 'maybeYes.prepare.button'))}</button>`);
      expect(card, locale).toContain(esc(t(locale, 'maybeYes.prepare.intro')));
      expect(card, locale).toContain(esc(t(locale, 'maybeYes.do')));
    }
  });

  it('their words name ANOTHER quantity: the quantity field starts empty — the owner types the one they mean', () => {
    const card = cardOf(renderConversationDetail(base(), 'en', NOW, null, OWNER_VIEW));
    expect(card).toMatch(/<input type="number" name="quantity"[^>]* value="" \/>/);
  });

  it('no other quantity in their words: the quantity priced, and the e-mail on record, are filled in', () => {
    const card = cardOf(renderConversationDetail(base({ maybeYes: { said: 'Sounds great, let us go with that', offer: OFFER, email: 'maya@example.com' } }),
      'en', NOW, null, OWNER_VIEW));
    expect(card).toMatch(/<input type="number" name="quantity"[^>]* value="500" \/>/);
    expect(card).toMatch(/<input type="email" name="email"[^>]* value="maya@example.com" \/>/);
  });

  it('no price on record, or an order already waiting: nothing to prepare here', () => {
    const none = cardOf(renderConversationDetail(base({ maybeYes: { said: 'ok', offer: null } }), 'en', NOW, null, OWNER_VIEW));
    expect(none).not.toContain('<form');
    const waiting = cardOf(renderConversationDetail(base({
      orderProposal: {
        id: 'f0000000-0000-0000-0000-000000000001', conversationId: 'conv-1',
        productId: 'b0000000-0000-0000-0000-000000000001', productName: 'Gift box', quantity: 500, unit: 'boxes',
        unitPrice: usd('2.1'), total: usd('1050'), email: 'maya@example.com',
        paymentTerms: null, incoterm: null, createdAt: new Date('2026-10-14T09:30:00Z'),
      },
    }), 'en', NOW, null, OWNER_VIEW));
    expect(waiting).not.toContain('<form');
  });

  it('their words are escaped, never markup', () => {
    const card = cardOf(renderConversationDetail(base({ maybeYes: { said: '<b>ok</b> 5000', offer: OFFER } }), 'en', NOW, null, OWNER_VIEW));
    expect(card).toContain('&lt;b&gt;ok&lt;/b&gt; 5000');
    expect(card).not.toContain('<b>ok</b>');
  });

  it('the card is cut out whole, and nothing after it: the reply box below has a form', () => {
    const html = renderConversationDetail(base(), 'en', NOW, null, OWNER_VIEW);
    const card = cardOf(html);
    expect(card.startsWith('<div class="card refused" id="maybe-yes">')).toBe(true);
    expect(card.endsWith('</div>')).toBe(true);
    expect(html.indexOf(card)).toBeGreaterThan(-1);
  });

  it('only while the maybe is the reason it waits', () => {
    expect(cardOf(renderConversationDetail(base({ handoffReasons: [] }), 'en', NOW, null, OWNER_VIEW))).toBe('');
    expect(cardOf(renderConversationDetail(base({ maybeYes: null }), 'en', NOW, null, OWNER_VIEW))).toBe('');
  });
});

describe('the order card — a real yes — shows their words and the unit price above its two buttons', () => {
  const proposal = (said: string | null) => base({
    handoffReasons: [], maybeYes: null, ownership: 'AI',
    orderProposal: {
      id: 'f0000000-0000-0000-0000-000000000001', conversationId: 'conv-1',
      productId: 'b0000000-0000-0000-0000-000000000001', productName: 'Gift box', quantity: 40, unit: 'boxes',
      unitPrice: usd('2.1'), total: usd('84'), email: 'customer@example.com',
      paymentTerms: null, incoterm: null, createdAt: new Date('2026-10-14T09:00:00Z'), said,
    },
  });
  it('in every language, before Confirm', () => {
    for (const locale of LOCALES) {
      const html = renderConversationDetail(proposal('yes, go ahead with the 40'), locale, NOW, null, OWNER_VIEW);
      const confirm = html.indexOf('order/confirm');
      const words = html.indexOf('<bdi>yes, go ahead with the 40</bdi>');
      const unit = html.indexOf(esc(t(locale, 'order.field.unitPrice')));
      expect(words, locale).toBeGreaterThan(-1);
      expect(unit, locale).toBeGreaterThan(-1);
      expect(words, locale).toBeLessThan(confirm);
      expect(unit, locale).toBeLessThan(confirm);
      expect(html, locale).toContain(esc(show.money(locale, usd('2.1'))));
    }
  });
  it('ON #345 — prepared at a price never sent to them: said, before Confirm, in every language; not otherwise', () => {
    for (const locale of LOCALES) {
      const base0 = proposal('yes');
      const html = renderConversationDetail({ ...base0, orderProposal: { ...base0.orderProposal!, unquoted: true } }, locale, NOW, null, OWNER_VIEW);
      const line = html.indexOf(esc(t(locale, 'order.card.unquoted')));
      expect(line, locale).toBeGreaterThan(-1);
      expect(line, locale).toBeLessThan(html.indexOf('order/confirm'));
      expect(renderConversationDetail(base0, locale, NOW, null, OWNER_VIEW), locale).not.toContain(esc(t(locale, 'order.card.unquoted')));
    }
  });

  it('a proposal from before their words were kept: the card still renders, without the quote', () => {
    const html = renderConversationDetail(proposal(null), 'en', NOW, null, OWNER_VIEW);
    expect(html).toContain('order/confirm');
    expect(html).not.toContain('<blockquote class="unsure-q"');
  });
});
