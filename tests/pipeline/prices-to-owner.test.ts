import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn, UNCLAIMED_AGENT, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { HANDOFF_REPLY } from '../../src/core/conversation/templates.js';
import { CAPABILITIES } from '../../src/core/conversation/autonomy.js';
import { toTriggerReason, isProblemSignal } from '../../src/core/scoring/signals.js';
import { alertKindFor } from '../../src/pipeline/notify.js';
import { emptyState, CONVERSATION, PRODUCT } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';

/**
 * K5 — "PRICES GO TO ME" THROUGH THE REAL TURN (the onboarding plan; 0094).
 *
 * A business whose prices go to the owner states no price. Two layers:
 *   · layer 1 — the analysis says the customer asked a price: the owner
 *     answers it (`price_to_owner`), before any reply is written or any quote
 *     worked out; the customer gets the ordinary hand-off sentence;
 *   · layer 2 — whatever else produced a reply, if it states a price (the
 *     customer's own "$20?" echoed back), it is thrown away and the turn is
 *     the same hand-off.
 * A reply with no price in it goes as usual. Every capability is on AUTO
 * unless a test says draft: the setting in which a reply would go out alone.
 */

type Ports = TurnPorts & { tenant: FakeTenant; analyzer: FakeAnalyzer; replyWriter: FakeReplyWriter; retriever: FakeRetriever };

function ports(mode: 'auto' | 'draft' = 'auto', pricesToOwner = true): Ports {
  const p = {
    tenant: new FakeTenant(), retriever: new FakeRetriever(),
    analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(),
    now: () => new Date('2026-07-14T04:00:00Z'),
  };
  p.tenant.selling = { pricesToOwner, kind: 'services', quantityFirst: false };
  if (mode === 'auto') {
    p.tenant.grantRows = CAPABILITIES.filter((c) => c !== 'confirm_order')
      .map((capability) => ({ capability, mode: 'auto' as const, timeWindow: null }));
  }
  p.tenant.seed(CONVERSATION, emptyState({
    phase: 'qualification',
    aiDisclosedAt: new Date('2026-07-14T03:00:00Z'),
    aiDisclosureDeliveredAt: new Date('2026-07-14T03:00:00Z'),
  }));
  return p;
}

const analysis = (primary: string, over: Partial<Analysis['intent']> = {}): Analysis => ({
  language: { detected: 'en', replyIn: 'en' },
  intent: { primary, productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [], ...over },
  recommendedPhase: 'qualification',
  wantsPerson: false,
});

const req = (text: string) => ({ conversationId: CONVERSATION, messageId: `m-${text.slice(0, 12)}`, text });
async function run(p: Ports, text: string) {
  const r = await computeTurn(p, req(text));
  const fx = await commitTurn(p, req(text), r, Date.now());
  return { r, fx };
}
const signalsOf = (p: Ports) => (p.tenant.signalRows.get(CONVERSATION) ?? []).map((s) => s.kind);

describe('K5 · layer 1 — a price question goes to the owner, and nothing is priced', () => {
  for (const mode of ['auto', 'draft'] as const) {
    it(`${mode}: "how much is it?" — the ordinary hand-off, no writer, no quote`, async () => {
      const p = ports(mode);
      p.analyzer.next = analysis('price_request', {
        productCandidate: { productId: PRODUCT, confidence: 0.95, confirmedByClient: true, matchMethod: 'text' },
        quantityMentioned: { value: 5000, unit: 'pcs' },
      });
      const { r, fx } = await run(p, 'How much for 5000 of the bags?');
      expect(p.replyWriter.calls).toBe(0);
      expect(r.decision.action).toEqual({ kind: 'handoff', notifyOnly: false });
      expect(r.reply).toBe(HANDOFF_REPLY);
      expect(r.quote).toBeNull();
      expect(p.tenant.quotesRecorded).toEqual([]);
      expect(r.newState.assignedTo).toBe(UNCLAIMED_AGENT);
      expect(signalsOf(p)).toContain('price_to_owner');
      expect(alertKindFor(fx)).toBe('handoff');
      if (mode === 'auto') expect(fx.outbound?.reply).toBe(HANDOFF_REPLY);
    });
  }

  it('the same question where prices come from the list is answered as usual (the control)', async () => {
    const p = ports('auto', false);
    p.analyzer.next = analysis('price_request');
    p.replyWriter.replies = ['Which one would you like a price for?'];
    const { r } = await run(p, 'How much is it?');
    expect(r.decision.action.kind).toBe('generate_reply');
    expect(signalsOf(p)).not.toContain('price_to_owner');
  });
});

describe('K5 · layer 2 — no reply states a price', () => {
  it('"is it $20?" answered "yes, $20" is thrown away: the owner answers', async () => {
    const p = ports();
    p.analyzer.next = analysis('inquiry');
    p.replyWriter.replies = ['Yes, it is $20.'];
    const { r, fx } = await run(p, 'Is the scarf $20?');
    expect(p.replyWriter.calls).toBe(1);
    expect(r.reply).toBe(HANDOFF_REPLY);
    expect(r.answerPath).toBe('handoff');
    expect(signalsOf(p)).toContain('price_to_owner');
    expect(fx.outbound?.reply).toBe(HANDOFF_REPLY);
  });

  it('a reply with a figure that is not a price goes as usual (the customer\'s own size)', async () => {
    const p = ports();
    p.analyzer.next = analysis('inquiry');
    p.replyWriter.replies = ['Yes, we have it in size 38.'];
    const { r, fx } = await run(p, 'Do you have it in size 38?');
    expect(r.reply).toBe('Yes, we have it in size 38.');
    expect(signalsOf(p)).not.toContain('price_to_owner');
    expect(fx.outbound?.reply).toBe('Yes, we have it in size 38.');
  });
});

describe('K5 · the signal', () => {
  it('is a problem, held by a person until handed back, with its own reason on the trail', () => {
    expect(isProblemSignal({ kind: 'price_to_owner' })).toBe(true);
    expect(toTriggerReason({ kind: 'price_to_owner' })).toBe('price_to_owner');
  });
});
