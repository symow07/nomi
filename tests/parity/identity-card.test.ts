import { describe, it, expect } from 'vitest';
import { renderConversationDetail } from '../../src/api/web/inbox.js';
import { withAssistantName } from '../../src/api/web/say.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { OWNER_VIEW } from '../../src/core/conversation/people.js';

/**
 * The identity hold card names HER assistant — the one in the assistants table,
 * set on this page by withAssistantName exactly as C does for every other line
 * — and never assumes who the buyer is.
 */

const NOW = new Date('2026-09-22T04:00:00Z');

const detail = (heldBecause: 'identity_question' | 'identity_denial', disclosureSent: boolean) => ({
  conversationId: 'c1', buyer: 'Sam', country: 'AE', status: 'awaiting' as const,
  product: { name: 'Canvas tote', nameZh: '帆布袋' }, quantity: null, quote: null, order: null,
  messages: [{ direction: 'inbound' as const, text: 'are you a bot?', at: NOW }],
  pendingDraft: {
    draftId: 'd1', draftText: 'What size were you looking for?', capability: 'qualify',
    heldBecause, disclosureSent,
  },
  ownership: 'AI' as const, refusals: [], uncertainSends: [], handoffReasons: [], unheardReason: null,
  lastHumanAction: null, knowledgeUsed: [], rate: null, leadTimeBlocked: null, sampleAsked: null,
  proof: { quoteId: null, token: null },
});

const render = (locale: (typeof LOCALES)[number], held: 'identity_question' | 'identity_denial', sent: boolean) =>
  withAssistantName('Mei Ling', () => renderConversationDetail(detail(held, sent) as never, locale, NOW, null, OWNER_VIEW));

describe('the identity hold card', () => {
  it('uses the assistant’s own name in every locale, never the product default', () => {
    for (const l of LOCALES) {
      const html = render(l, 'identity_question', true) + render(l, 'identity_denial', false);
      expect(html, l).toContain('Mei Ling');
      expect(html, l).not.toContain('Lily');
      expect(html, l).not.toContain('小雅');
    }
  });

  it('never assumes the buyer is a man', () => {
    const en = render('en', 'identity_question', true);
    expect(en).toContain('whether they are talking');
    expect(en).toContain('They have already been told');
    expect(en).not.toMatch(/\b(he|him|his)\b/i);

    const zh = render('zh', 'identity_question', true);
    const zhCard = zh.match(/<p class="held-why[^"]*"[^>]*>[\s\S]*?<\/p>/g)?.join('') ?? '';
    expect(zhCard).not.toContain('他');

    const ar = render('ar', 'identity_question', true);
    const arCard = ar.match(/<p class="held-why[^"]*"[^>]*>[\s\S]*?<\/p>/g)?.join('') ?? '';
    for (const masc of ['سأل هذا المشتري', 'يتحدث', 'أرسلت له', 'عليه']) expect(arCard, masc).not.toContain(masc);
  });
});
