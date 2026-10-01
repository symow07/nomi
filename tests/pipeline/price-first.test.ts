import { describe, it, expect } from 'vitest';
import { computeTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { CAPABILITIES } from '../../src/core/conversation/autonomy.js';
import { guardFallbackReply } from '../../src/core/conversation/templates.js';
import { emptyState, CONVERSATION, PRODUCT, product } from '../parity/fixtures.js';
import { usd } from '../../src/core/types/money.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';

/**
 * RT (0095) — A SHOP'S PRICE COMES FIRST, through the real turn.
 *
 * A business that gives its price first (a shop, a brand — or any business
 * whose owner said so) is quoted the price of one as soon as the product is
 * known, and the writer and the analyser are both told; a business that asks
 * how many first (a factory, a wholesaler — or any business whose owner said
 * so) waits for the quantity, exactly as before. The model's side — that the
 * writer then states the price and asks no quantity — is the live check
 * `tools/check-price-first.mjs`, run before and after the prompt change.
 */

type Ports = TurnPorts & { tenant: FakeTenant; analyzer: FakeAnalyzer; replyWriter: FakeReplyWriter; retriever: FakeRetriever };

function ports(quantityFirst: boolean, moq: number | null = null): Ports {
  const p = {
    tenant: new FakeTenant(), retriever: new FakeRetriever(),
    analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(),
    now: () => new Date('2026-07-14T04:00:00Z'),
  };
  p.tenant.selling = { pricesToOwner: false, kind: quantityFirst ? 'manufacturer' : 'online_shop', quantityFirst };
  p.tenant.products.set(PRODUCT, product({ name: 'Rose lip oil', moq, unit: 'item' }));
  p.tenant.tiers.set(PRODUCT, [{ productId: PRODUCT, minQty: 1, maxQty: null, unitPrice: usd(12) }]);
  p.tenant.grantRows = CAPABILITIES.filter((c) => c !== 'confirm_order').map((capability) => ({ capability, mode: 'auto' as const, timeWindow: null }));
  p.tenant.seed(CONVERSATION, emptyState({ phase: 'clarification', aiDisclosedAt: new Date('2026-07-14T03:00:00Z'), aiDisclosureDeliveredAt: new Date('2026-07-14T03:00:00Z') }));
  p.replyWriter.replies = ['That one is $12.00.'];
  p.analyzer.next = {
    language: { detected: 'en', replyIn: 'en' },
    intent: { primary: 'price_request', productCandidate: { productId: PRODUCT, confidence: 0.95, confirmedByClient: true, matchMethod: 'text' },
      quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
    recommendedPhase: 'commercial_discussion', wantsPerson: false,
  } satisfies Analysis;
  return p;
}
const req = { conversationId: CONVERSATION, messageId: 'm-price', text: 'How much is the rose lip oil?' };

describe('RT · price first', () => {
  it('a shop: the product known and no quantity — the price of one, and the writer and analyser are told', async () => {
    const p = ports(false);
    const r = await computeTurn(p, req);
    expect(r.quote).not.toBeNull();
    expect(r.quote!.quantity.value).toBe(1);
    expect(r.quote!.unitPrice).toEqual(usd(12));
    expect(p.replyWriter.inputs[0]!.priceFirst).toBe(true);
    // The quantity is not invented into the conversation: the customer named none.
    expect(r.newState.quantity).toBeNull();
  });

  it('a shop that set a minimum is quoted the minimum, never below it', async () => {
    const p = ports(false, 3);
    const r = await computeTurn(p, req);
    expect(r.quote!.quantity.value).toBe(3);
  });

  it('a factory waits for the quantity, as before: no quote, the writer told nothing new', async () => {
    const p = ports(true);
    const r = await computeTurn(p, req);
    expect(r.quote).toBeNull();
    expect(p.replyWriter.inputs[0]!.priceFirst).toBeUndefined();
  });

  it('the stand-in reply at quantity one is the price of one — no "for 1 pcs", no total repeating it', () => {
    const one = guardFallbackReply({ quantity: { value: 1, unit: 'item' }, unitPrice: usd(12), total: usd(12), leadTimeDays: null } as never, null);
    expect(one).toBe('$12.00 USD each.');
    const many = guardFallbackReply({ quantity: { value: 500, unit: 'pcs' }, unitPrice: usd(1), total: usd(500), leadTimeDays: 20 } as never, null);
    expect(many).toBe('For 500 pcs: $1.00 USD each, $500 in total, ready in 20 days.');
  });
});
