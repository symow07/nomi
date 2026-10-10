import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { CAPABILITIES } from '../../src/core/conversation/autonomy.js';
import { emptyState, CONVERSATION } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';

/**
 * The messaging-policy audit's small fixes (2026-10-10), through the real turn.
 *
 *   · G8 — a reply goes alone only in a language whose sentence is signed off:
 *     the reply's own language, not only the customer's.
 *   · G5 — the disclosure sent in place of a reply waits behind an operator's
 *     "draft only", like everything else that would go alone.
 */

type Ports = TurnPorts & { tenant: FakeTenant; analyzer: FakeAnalyzer; replyWriter: FakeReplyWriter; retriever: FakeRetriever };

function ports(): Ports {
  const p = {
    tenant: new FakeTenant(), retriever: new FakeRetriever(),
    analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(),
    now: () => new Date('2026-10-10T04:00:00Z'),
  };
  p.tenant.grantRows = CAPABILITIES.filter((c) => c !== 'confirm_order')
    .map((capability) => ({ capability, mode: 'auto' as const, timeWindow: null }));
  p.tenant.seed(CONVERSATION, emptyState({
    aiDisclosedAt: new Date('2026-10-10T03:00:00Z'), aiDisclosureDeliveredAt: new Date('2026-10-10T03:00:00Z'),
  }));
  return p;
}
const analysis = (detected: string, replyIn: string): Analysis => ({
  language: { detected, replyIn },
  intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
  recommendedPhase: 'qualification', wantsPerson: false,
});
const req = (text: string) => ({ conversationId: CONVERSATION, messageId: `m-${text.slice(0, 10)}`, text });
async function run(p: Ports, text: string) {
  const r = await computeTurn(p, req(text));
  const fx = await commitTurn(p, req(text), r, Date.now());
  return { r, fx, events: p.tenant.eventRows };
}

describe('G8 · the reply\'s own language decides too', () => {
  it('the customer writes English, the writer answers in Spanish (unread): a draft, and Spanish is named', async () => {
    const p = ports();
    const { autonomyReleasedFor } = await import('../../src/core/conversation/disclosure.js');
    p.tenant.releasedFor = autonomyReleasedFor;
    p.analyzer.next = analysis('en', 'es');
    p.replyWriter.replies = ['Sí, tenemos la bolsa en azul.'];
    const { fx, events } = await run(p, 'Do you have the tote in blue?');
    expect(fx.outbound).toBeNull();
    expect(p.tenant.draftsCreated).toHaveLength(1);
    expect(events.find((e) => e.type === 'autonomy_withheld')?.payload)
      .toMatchObject({ reason: 'disclosure_not_reviewed', language: 'es' });
  });

  it('the same language both ways, signed off: it goes alone, as before', async () => {
    const p = ports();
    const { autonomyReleasedFor } = await import('../../src/core/conversation/disclosure.js');
    p.tenant.releasedFor = autonomyReleasedFor;
    p.analyzer.next = analysis('en', 'en');
    p.replyWriter.replies = ['Yes, we have the tote in blue.'];
    const { fx } = await run(p, 'Do you have the tote in blue?');
    expect(fx.outbound?.reply).toBe('Yes, we have the tote in blue.');
  });
});

describe('G5 · an operator\'s "draft only" holds the disclosure-instead too', () => {
  it('"are you a bot?" answered by the order line, with every capability forced to draft: nothing goes alone', async () => {
    const p = ports();
    p.tenant.switches = { globalSilence: false, forceDraft: [...CAPABILITIES], silenceCapability: [] };
    p.analyzer.next = analysis('en', 'en');
    p.tenant.latestOrder = {
      orderId: 'o1', reference: 'PI-T-0001',
      update: { state: 'shipped', at: new Date('2026-10-08T00:00:00Z'), note: null, trackingReference: null, by: 'owner' },
    };
    const { fx } = await run(p, 'where is my order? are you a bot?');
    expect(fx.outbound).toBeNull();
    expect(p.tenant.draftsCreated).toHaveLength(1);
    expect(p.tenant.draftsCreated[0]!.replacedByDisclosure).toBe(false);
  });
});
