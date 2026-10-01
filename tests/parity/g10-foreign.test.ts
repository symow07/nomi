import { describe, it, expect } from 'vitest';
import { figuresIn, westernDigits } from '../../src/core/conversation/figures.js';
import { renderConversationDetail, approvalCard, languageName, type ConversationDetail } from '../../src/api/web/inbox.js';
import { moneyFromRow } from '../../src/core/types/money.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import { withoutIsolates } from './isolates.js';

/**
 * G10 (decision 38) — a reply in a language the owner may not be able to
 * read: the card says so, lists the reply's figures in Western digits, and
 * offers a translation into the owner's own language — never sent.
 * Over Postgres and the route: tests/integration/g10-translate.test.ts.
 */

const usd = (n: number) => moneyFromRow(n, 'USD')!;
const NOW = new Date('2026-09-29T10:00:00Z');
const base: ConversationDetail = {
  conversationId: '0b0c3a3e-6a5c-4f0e-9a3b-1d2e3f405060', buyer: 'Wang Fang', country: 'CN', status: 'awaiting',
  product: { name: 'Rose Face Serum', nameZh: '玫瑰精华' }, quantity: 10,
  quote: { unitPrice: usd(34.9), total: usd(349), quantity: 10 }, order: null,
  messages: [{ direction: 'inbound', text: '玫瑰精华10瓶多少钱？', at: new Date('2026-09-29T09:58:00Z') }],
  pendingDraft: { draftId: 'd-1', draftText: '玫瑰精华每瓶34.90美元，10瓶共349美元，满１０瓶包邮。', capability: 'quote', language: 'zh' },
  ownership: 'AI', refusals: [], uncertainSends: [], handoffReasons: [], unheardReason: null, lastHumanAction: null,
  knowledgeUsed: [], rate: null, leadTimeBlocked: null, sampleAsked: null, proof: { quoteId: null, token: null },
  channel: 'instagram',
};
const card = (html: string) => html.slice(html.indexOf('id="approve"'), html.indexOf('</section>', html.indexOf('id="approve"')));

describe('G10 · the figures, in Western digits, from the reply itself', () => {
  it('every figure once, in order, whatever digits it was written in', () => {
    expect(figuresIn('玫瑰精华每瓶34.90美元，10瓶共349美元，满１０瓶包邮。')).toEqual(['34.90', '10', '349']);
    expect(figuresIn('السعر ٣٤٫٩٠ دولار، والكمية ١٠ قطع، خصم ٥%')).toEqual(['34.90', '10', '5%']);
    expect(figuresIn('कीमत ३५० रुपये, 1,250 pcs')).toEqual(['350', '1,250']);
    expect(figuresIn('Yes, we have it in blue.')).toEqual([]);
    expect(westernDigits('۱۲۳٬۴۵۶')).toBe('123,456');
  });
});

describe('G10 · the card', () => {
  for (const locale of ['en', 'ar'] as const) {
    it(`${locale} · a Chinese reply: said so, its figures listed, and a button to translate it`, () => {
      const c = withoutIsolates(card(renderConversationDetail(base, locale, NOW, null)));
      expect(c).toContain(esc(t(locale, 'card.foreign', { language: languageName(locale, 'zh') })));
      expect(c).toContain(esc(t(locale, 'card.foreign.figures')));
      expect(c).toContain('<bdi dir="ltr">34.90</bdi>, <bdi dir="ltr">10</bdi>, <bdi dir="ltr">349</bdi>');
      expect(c).toContain(`action="/app/inbox/${base.conversationId}/translate"`);
      expect(c).toContain(esc(t(locale, 'card.foreign.translate', { language: languageName(locale, locale) })));
    });
  }
  it('a reply in the owner\'s own language says nothing of the kind', () => {
    expect(card(renderConversationDetail(base, 'zh', NOW, null))).not.toContain('class="foreign"');
    const en = { ...base, pendingDraft: { ...base.pendingDraft!, language: 'en' } };
    expect(card(renderConversationDetail(en, 'en', NOW, null))).not.toContain('class="foreign"');
    // A draft from before G10 carries no language: nothing is guessed.
    const old = { ...base, pendingDraft: { ...base.pendingDraft!, language: null } };
    expect(card(renderConversationDetail(old, 'en', NOW, null))).not.toContain('class="foreign"');
  });
  it('once translated: the translation, said to be for checking and not what is sent — and the reply box still holds the reply', () => {
    const done = { ...base, pendingDraft: { ...base.pendingDraft!, translation: { text: 'Rose serum is $34.90 a bottle; 10 bottles are $349.', locale: 'en' } } };
    const c = withoutIsolates(card(renderConversationDetail(done, 'en', NOW, null)));
    expect(c).toContain(esc(t('en', 'card.foreign.translation', { language: 'English' })));
    expect(c).toContain('Rose serum is $34.90 a bottle; 10 bottles are $349.');
    expect(c).not.toContain('/translate"');
    expect(c).toMatch(/<textarea id="reply"[^>]*>玫瑰精华每瓶34\.90美元/);
  });
  it('Practice has no translate button: no route for it there', () => {
    const c = approvalCard(base, 'en', NOW, { act: '/app/sandbox/act', handTo: '/app/sandbox/takeover' });
    expect(c).toContain('class="foreign"');
    expect(c).not.toContain('/translate"');
  });
  for (const l of LOCALES) {
    it(`${l} · the words exist`, () => {
      for (const k of ['card.foreign', 'card.foreign.figures', 'card.foreign.translate', 'card.foreign.translation',
        'inbox.flash.translate.gone', 'inbox.flash.translate.unavailable', 'inbox.flash.translate.allowance', 'inbox.flash.translate.failed'] as const) {
        expect(t(l, k, { language: 'X' }), `${l} ${k}`).not.toBe(k);
      }
    });
  }
});
