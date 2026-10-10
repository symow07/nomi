import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { CAPABILITIES } from '../../src/core/conversation/autonomy.js';
import { acknowledgesAi } from '../../src/core/safety/identity.js';
import { emptyState, CONVERSATION } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';

/**
 * G4b / G5 (the messaging-policy audit, 2026-10-10) — "are you a bot?" is
 * answered whoever writes the answer.
 *
 *   · A taught answer that does not say what is answering is set aside: the
 *     writer answers both, under the guard.
 *   · The order's status line, which only ever states the order, is held for
 *     the owner; in auto the disclosure goes instead, as when the writer fails.
 *   · A writer's first attempt that dodged, and a second that answered, is an
 *     answer: the turn is not held and nothing is locked.
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
const analysis = (): Analysis => ({
  language: { detected: 'en', replyIn: 'en' },
  intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
  recommendedPhase: 'qualification', wantsPerson: false,
});
const req = (text: string) => ({ conversationId: CONVERSATION, messageId: `m-${text.slice(0, 10)}`, text });
async function run(p: Ports, text: string) {
  const r = await computeTurn(p, req(text));
  const fx = await commitTurn(p, req(text), r, Date.now());
  return { r, fx };
}

describe('G4b · a taught answer that dodges the question is set aside', () => {
  it('"who else do you supply? are you a bot?" — the writer answers both', async () => {
    const p = ports();
    p.analyzer.next = analysis();
    p.tenant.knowledgeRows.push({
      id: 'k-faq', productId: null, kind: 'faq', label: 'Who else do you supply?',
      content: 'We supply retailers across the Gulf.', source: 'owner_confirmed', status: 'active',
    });
    const honest = "I'm an AI assistant for the shop — we supply retailers across the Gulf.";
    p.replyWriter.replies = [honest];
    const { r, fx } = await run(p, 'who else do you supply? are you a bot?');
    expect(r.answerPath).toBe('model');
    expect(p.replyWriter.calls).toBe(1);
    expect(r.identityViolation).toBeNull();
    expect(fx.outbound?.reply).toBe(honest);
  });

  it('without the question, the taught answer goes word for word, as before', async () => {
    const p = ports();
    p.analyzer.next = analysis();
    p.tenant.knowledgeRows.push({
      id: 'k-faq', productId: null, kind: 'faq', label: 'Who else do you supply?',
      content: 'We supply retailers across the Gulf.', source: 'owner_confirmed', status: 'active',
    });
    const { r } = await run(p, 'who else do you supply?');
    expect(r.answerPath).toBe('taught_answer');
    expect(p.replyWriter.calls).toBe(0);
  });
});

describe('G4b · the order line does not say what is answering: held, and the disclosure goes instead', () => {
  it('"where is my order? are you a bot?"', async () => {
    const p = ports();
    p.analyzer.next = analysis();
    p.tenant.latestOrder = {
      orderId: 'o1', reference: 'PI-T-0001',
      update: { state: 'shipped', at: new Date('2026-10-08T00:00:00Z'), note: null, trackingReference: null, by: 'owner' },
    };
    const { r, fx } = await run(p, 'where is my order? are you a bot?');
    expect(r.answerPath).toBe('order_status');
    expect(r.identityViolation?.kind).toBe('identity_question_unanswered');
    expect(r.hold).not.toBeNull();
    // In auto, the buyer asked and was going to get a message: the disclosure, which answers.
    expect(fx.outbound?.reply && acknowledgesAi(fx.outbound.reply)).toBe(true);
    expect(p.tenant.draftsCreated).toHaveLength(1);
    expect(p.tenant.draftsCreated[0]!.replacedByDisclosure).toBe(true);
  });
});

describe('G5 · a dodge the second attempt corrected is not held against the turn', () => {
  it('first attempt dodges, second answers: sent, not held, not locked', async () => {
    const p = ports();
    p.analyzer.next = analysis();
    const honest = "I'm an AI assistant — which colour would you like?";
    p.replyWriter.replies = ['Which colour would you like?', honest];
    const { r, fx } = await run(p, 'are you a bot? also, which colours do you have?');
    expect(p.replyWriter.calls).toBe(2);
    expect(r.reply).toBe(honest);
    expect(r.identityViolation).toBeNull();
    expect(r.hold).toBeNull();
    expect(fx.outbound?.reply).toBe(honest);
    expect(p.tenant.draftsCreated).toEqual([]);
  });
});
