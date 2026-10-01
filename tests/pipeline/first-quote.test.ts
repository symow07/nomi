import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { CAPABILITIES } from '../../src/core/conversation/autonomy.js';
import { modesFor } from '../../src/core/conversation/autonomyLevel.js';
import { emptyState, CONVERSATION, PRODUCT, product } from '../parity/fixtures.js';
import { usd } from '../../src/core/types/money.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';

/**
 * R3 (0107) — THE FIRST QUOTE OF EACH PRODUCT WAITS FOR THE OWNER. At "sells",
 * earned, released and named, a reply that states the price of a product the
 * owner has never sent a quote of becomes a draft — `first_quote` on the
 * timeline and beside the draft, and the draft carries the product so the
 * owner's approval vets it. A reply that quotes nothing is untouched.
 * Over Postgres: tests/integration/r3-first-quote.test.ts.
 */

const NOW = new Date('2026-10-01T04:00:00Z');

function ports(): TurnPorts & { tenant: FakeTenant; analyzer: FakeAnalyzer; replyWriter: FakeReplyWriter } {
  const p = { tenant: new FakeTenant(), retriever: new FakeRetriever(), analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(), now: () => NOW };
  p.tenant.selling = { pricesToOwner: false, kind: 'online_shop', quantityFirst: false };
  p.tenant.products.set(PRODUCT, product({ name: 'Rose lip oil', moq: null, unit: 'item' }));
  p.tenant.tiers.set(PRODUCT, [{ productId: PRODUCT, minQty: 1, maxQty: null, unitPrice: usd(12) }]);
  const sells = modesFor('sells');
  p.tenant.grantRows = CAPABILITIES.map((capability) => ({ capability, mode: sells[capability], timeWindow: null }));
  p.tenant.seed(CONVERSATION, emptyState({ phase: 'clarification', aiDisclosedAt: new Date('2026-10-01T03:00:00Z'), aiDisclosureDeliveredAt: new Date('2026-10-01T03:00:00Z') }));
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

async function run(p: ReturnType<typeof ports>) {
  const r = await computeTurn(p, req);
  const fx = await commitTurn(p, req, r, Date.now());
  return { r, fx, events: p.tenant.eventRows };
}

describe('R3 · the first quote of each product', () => {
  it('NOT VETTED: the priced reply drafts — first_quote on the timeline, beside the draft, and the product on it', async () => {
    const p = ports();
    p.tenant.quoteVettedFlag = false;
    const { r, fx, events } = await run(p);
    expect(r.quote).not.toBeNull();
    expect(fx.outbound).toBeNull();
    expect(fx.draftCreated).not.toBeNull();
    expect(events.find((e) => e.type === 'autonomy_withheld')?.payload).toMatchObject({ reason: 'first_quote' });
    expect(events.find((e) => e.type === 'draft_pending')?.payload).toMatchObject({ withheld: { reason: 'first_quote' }, productId: PRODUCT });
  });
  it('VETTED: the same reply goes alone', async () => {
    const { fx } = await run(ports());
    expect(fx.draftCreated).toBeNull();
    expect(fx.outbound?.reply).toBe('That one is $12.00.');
  });
  it('a reply that quotes nothing is not held, vetted or not', async () => {
    const p = ports();
    p.tenant.quoteVettedFlag = false;
    p.analyzer.next = { ...p.analyzer.next!, intent: { ...p.analyzer.next!.intent, primary: 'greeting', productCandidate: null }, recommendedPhase: 'clarification' } as Analysis;
    p.replyWriter.replies = ['Hello! How can we help?'];
    const { r, fx, events } = await run(p);
    expect(r.quote).toBeNull();
    expect(events.some((e) => e.type === 'autonomy_withheld' && (e.payload as { reason?: string }).reason === 'first_quote')).toBe(false);
    expect(fx.outbound?.reply).toContain('Hello! How can we help?');
  });
  it('not earned is named first: the rung is what the owner works toward, the first quote comes after', async () => {
    const p = ports();
    p.tenant.quoteVettedFlag = false;
    p.tenant.earnedRungValue = 1;
    const { events } = await run(p);
    expect(events.find((e) => e.type === 'autonomy_withheld')?.payload).toMatchObject({ reason: 'not_earned' });
  });
  it('a DRAFT that quotes carries the product too — the owner\'s approval of it is the first quote', async () => {
    const p = ports();
    p.tenant.grantRows = CAPABILITIES.map((capability) => ({ capability, mode: 'draft', timeWindow: null }));
    const { events } = await run(p);
    expect(events.some((e) => e.type === 'autonomy_withheld')).toBe(false);
    expect(events.find((e) => e.type === 'draft_pending')?.payload).toMatchObject({ productId: PRODUCT });
  });
});
