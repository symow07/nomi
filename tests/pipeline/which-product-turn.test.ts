import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { CAPABILITIES } from '../../src/core/conversation/autonomy.js';
import type { RetrievedProduct } from '../../src/retrieval/ports.js';
import type { ProductId } from '../../src/core/types/ids.js';
import { emptyState, CONVERSATION, PRODUCT, product, tiers } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';

/**
 * The close call through a WHOLE turn (the owner, on #343: "the 85% line itself is untested: add a pair just above
 * and just below it… What happens with THREE close products?"). Every capability on auto; the model is faked to do the
 * dangerous thing — name the first product confidently with a quantity — so a turn that trusted it would price it.
 */

type Ports = TurnPorts & { tenant: FakeTenant; analyzer: FakeAnalyzer; replyWriter: FakeReplyWriter; retriever: FakeRetriever };
const id = (s: string) => s as ProductId;
const TOTE = id('b0000000-0000-0000-0000-0000000000a2');
const VEST = id('b0000000-0000-0000-0000-0000000000a3');
const hit = (productId: ProductId, name: string, relevance: number): RetrievedProduct =>
  ({ productId, sku: name, name, category: null, moq: 1000, relevance, matchedVia: 'trigram' });

function ports(found: RetrievedProduct[]): Ports {
  const p = {
    tenant: new FakeTenant(), retriever: new FakeRetriever(),
    analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(),
    now: () => new Date('2026-07-14T04:00:00Z'),
  };
  p.tenant.grantRows = CAPABILITIES.map((capability) => ({ capability, mode: 'auto' as const, timeWindow: null }));
  for (const [pid, name] of [[TOTE, 'Non-woven tote bag'], [VEST, 'Non-woven vest bag']] as const) {
    p.tenant.products.set(pid, product({ id: pid, sku: name, name }));
    p.tenant.tiers.set(pid, tiers().map((t) => ({ ...t, productId: pid })));
  }
  p.tenant.seed(CONVERSATION, emptyState({
    aiDisclosedAt: new Date('2026-07-14T03:00:00Z'), aiDisclosureDeliveredAt: new Date('2026-07-14T03:00:00Z'),
  }));
  p.retriever.results = found;
  const analysis: Analysis = {
    language: { detected: 'en', replyIn: 'en' },
    intent: {
      primary: 'price_request',
      productCandidate: { productId: PRODUCT, confidence: 0.95, confirmedByClient: true, matchMethod: 'text' },
      quantityMentioned: { value: 5000, unit: 'pcs' }, nextLogicalQuestion: null, missingFields: [],
    },
    recommendedPhase: 'commercial_discussion',
  };
  p.analyzer.next = analysis;
  p.replyWriter.replies = ['That is 0.45 each for 5,000.'];
  return p;
}

async function turn(found: RetrievedProduct[]) {
  const p = ports(found);
  const req = { conversationId: CONVERSATION, messageId: `m-${found.map((f) => f.relevance).join('-')}`, text: 'how much are the non-woven bags for 5000?' };
  const r = await computeTurn(p, req);
  const fx = await commitTurn(p, req, r, Date.now());
  return { r, fx, written: p.replyWriter.calls };
}

const SHOPPING = 'Non-woven shopping bag';

describe('the 85% line, through a whole turn', () => {
  it('JUST ABOVE — 0.340 against 0.400 (85.0%): asked which, by name; nothing priced, nothing written', async () => {
    const { r, fx, written } = await turn([hit(PRODUCT, SHOPPING, 0.4), hit(TOTE, 'Non-woven tote bag', 0.34)]);
    expect(fx.outbound?.reply).toBe('Which one do you mean — Non-woven shopping bag or Non-woven tote bag?');
    expect(r.quote).toBeNull();
    expect(r.decision.product).toBeNull();
    expect(written).toBe(0);
  });

  it('JUST BELOW — 0.339 against 0.400 (84.75%): the clear lead is priced, no question', async () => {
    const { r, fx } = await turn([hit(PRODUCT, SHOPPING, 0.4), hit(TOTE, 'Non-woven tote bag', 0.339)]);
    expect(fx.outbound?.reply ?? '').not.toMatch(/Which one/);
    expect(r.quote?.unitPrice.amount).toBe(0.45);
  });

  it('THREE close: all three named, best first — nothing priced', async () => {
    const { r, fx } = await turn([
      hit(TOTE, 'Non-woven tote bag', 0.38), hit(PRODUCT, SHOPPING, 0.4), hit(VEST, 'Non-woven vest bag', 0.36),
    ]);
    expect(fx.outbound?.reply).toBe('Which one do you mean — Non-woven shopping bag, Non-woven tote bag or Non-woven vest bag?');
    expect(r.quote).toBeNull();
  });
});
