import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderConversationDetail, type ConversationDetail } from '../../src/api/web/inbox.js';
import { moneyFromRow } from '../../src/core/types/money.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import { withoutIsolates } from './isolates.js';

/**
 * R3 (0107) — the first quote of each product waits for the owner: where the
 * turn decides it, what the card says, what vets a product and what unvets it.
 * The turn: tests/pipeline/first-quote.test.ts. Over Postgres:
 * tests/integration/r3-first-quote.test.ts.
 */

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const usd = (n: number) => moneyFromRow(n, 'USD')!;
const NOW = new Date('2026-10-01T10:00:00Z');
const base: ConversationDetail = {
  conversationId: '0b0c3a3e-6a5c-4f0e-9a3b-1d2e3f405061', buyer: 'Maya', country: 'AE', status: 'awaiting',
  product: { name: 'Rose lip oil', nameZh: null }, quantity: null,
  quote: { unitPrice: usd(12), total: usd(12), quantity: 1 }, order: null,
  messages: [{ direction: 'inbound', text: 'How much is the rose lip oil?', at: new Date('2026-10-01T09:58:00Z') }],
  pendingDraft: { draftId: 'd-1', draftText: 'That one is $12.00.', capability: 'quote', withheld: { reason: 'first_quote' } },
  ownership: 'AI', refusals: [], uncertainSends: [], handoffReasons: [], unheardReason: null, lastHumanAction: null,
  knowledgeUsed: [], rate: null, leadTimeBlocked: null, sampleAsked: null, proof: { quoteId: null, token: null },
  channel: 'instagram',
};
const card = (html: string) => html.slice(html.indexOf('id="approve"'), html.indexOf('</section>', html.indexOf('id="approve"')));

describe('R3 · the card', () => {
  for (const locale of LOCALES) {
    it(`${locale} · the first price of a product waits: said so, and that one sent lets its price go alone until it changes`, () => {
      const c = withoutIsolates(card(renderConversationDetail(base, locale, NOW, null)));
      expect(t(locale, 'inbox.draft.held.first_quote')).not.toBe('inbox.draft.held.first_quote');
      expect(c).toContain(esc(t(locale, 'inbox.draft.held.first_quote')));
    });
  }
  it('a draft without the reason says nothing of it', () => {
    const plain = { ...base, pendingDraft: { ...base.pendingDraft!, withheld: null } };
    expect(card(renderConversationDetail(plain, 'en', NOW, null))).not.toContain(esc(t('en', 'inbox.draft.held.first_quote')));
  });
  it('the card reads the reason back from the draft\'s own event', () => {
    expect(src('src/api/web/inbox.ts')).toContain("if (reason === 'not_earned' || reason === 'first_quote' || reason === 'language_unknown') return { reason };");
  });
});

describe('R3 · the turn', () => {
  const turn = src('src/pipeline/turn.ts');
  it('a reply that states a product\'s price goes alone only when that product is vetted — beside every other condition', () => {
    expect(turn).toContain('const quotedProduct = r.quote && r.decision.product ? r.decision.product.productId : null;');
    expect(turn).toContain('const vetted = !speaksAlone || !quotedProduct || await tenant.autonomy.quoteVetted(quotedProduct);');
    expect(turn).toContain('const mayDisclose = !speaksAlone || (earned && vetted && released && proven && named && sentence !== null);');
  });
  it('the reason named: not earned first, then the first quote, then the language', () => {
    expect(turn).toContain("...(!earned ? { reason: 'not_earned' } : !vetted ? { reason: 'first_quote' } : languageWithheld");
    expect(turn).toContain(": speaksAlone && !vetted ? { withheld: { reason: 'first_quote' } }");
  });
  it('every draft that quotes carries its product, so the owner\'s approval of it can vet it', () => {
    expect(turn).toContain('...(quotedProduct ? { productId: quotedProduct } : {}),');
  });
});

describe('R3 · what vets and what unvets', () => {
  it('only the owner\'s approval or edit vets — never staff\'s, never a rejection — and only the product the draft quoted', () => {
    const a = src('src/pipeline/approve.ts');
    const at = a.indexOf('update products set quote_vetted_at = now()');
    expect(at).toBeGreaterThan(-1);
    const block = a.slice(a.lastIndexOf('if (', at), at + 700);
    expect(block).toContain("if (status === 'approved' || status === 'edited') {");
    expect(block).toContain("e.type = 'draft_pending'");
    expect(block).toContain('and p.is_owner and p.id::text = ${input.decidedBy}');
  });
  it('the triggers: the product\'s own price and currency, and any tier inserted, updated or deleted', () => {
    const m = src('migrations/0107_first_quote.sql');
    expect(m).toContain('before update of price_usd_per_unit, currency on products');
    expect(m).toContain('after insert or update or delete on price_tiers');
    // The operator's workspaces are untouched; a practice copy answers for its source.
    expect(m).toContain('when p.signed_up_at is null then true');
    expect(m).toContain("when p.auto_earned_at is not null and coalesce(p.auto_earned_by, 'operator') <> 'ramp' then true");
    expect(m).toContain('coalesce(me.practice_of, me.id)');
  });
});
