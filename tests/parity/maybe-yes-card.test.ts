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
  unitPrice: usd(2.1), total: usd(1050), givenAt: '2026-10-14T09:00:00.000Z',
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

/** The maybe card alone: from its id to the next card. */
const cardOf = (html: string): string => {
  const from = html.indexOf('id="maybe-yes"');
  if (from < 0) return '';
  const rest = html.slice(from);
  const next = rest.indexOf('<div class="card', 1);
  return next > 0 ? rest.slice(0, next) : rest;
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
        `<bdi>${esc(show.money(locale, usd(2.1)))}</bdi>`,
        `<bdi>${esc(show.money(locale, usd(1050)))}</bdi>`,
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

  it('nothing to press: no Confirm, no form — the owner answers in their own words', () => {
    for (const locale of LOCALES) {
      const card = cardOf(renderConversationDetail(base(), locale, NOW, null, OWNER_VIEW));
      expect(card, locale).not.toMatch(/<form|<button|order\/confirm/);
      expect(card, locale).toContain(esc(t(locale, 'maybeYes.do')));
    }
  });

  it('their words are escaped, never markup', () => {
    const card = cardOf(renderConversationDetail(base({ maybeYes: { said: '<b>ok</b> 5000', offer: OFFER } }), 'en', NOW, null, OWNER_VIEW));
    expect(card).toContain('&lt;b&gt;ok&lt;/b&gt; 5000');
    expect(card).not.toContain('<b>ok</b>');
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
      unitPrice: usd(2.1), total: usd(84), email: 'customer@example.com',
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
      expect(html, locale).toContain(esc(show.money(locale, usd(2.1))));
    }
  });
  it('a proposal from before their words were kept: the card still renders, without the quote', () => {
    const html = renderConversationDetail(proposal(null), 'en', NOW, null, OWNER_VIEW);
    expect(html).toContain('order/confirm');
    expect(html).not.toContain('<blockquote class="unsure-q"');
  });
});
