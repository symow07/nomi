import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn, UNCLAIMED_AGENT, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { CAPABILITIES } from '../../src/core/conversation/autonomy.js';
import { emptyState, CONVERSATION } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';

/**
 * The writer gave no words, or words that still carry our JSON. Nobody answered,
 * so a person has it and the customer is told nothing: not raw text, not a stock
 * thank-you, not the stand-in. Both modes, because a draft of raw JSON is one tap
 * from a customer.
 */

const analysis: Analysis = {
  language: { detected: 'en', replyIn: 'en' },
  intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
  recommendedPhase: 'qualification',
};

function ports(mode: 'auto' | 'draft', replies: (string | null)[]) {
  const p = {
    tenant: new FakeTenant(), retriever: new FakeRetriever(),
    analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(),
    now: () => new Date('2026-07-14T04:00:00Z'),
  };
  p.tenant.grantRows = CAPABILITIES.filter((c) => c !== 'confirm_order').map((capability) => ({ capability, mode, timeWindow: null }));
  p.tenant.seed(CONVERSATION, emptyState({
    phase: 'qualification',
    aiDisclosedAt: new Date('2026-07-14T03:00:00Z'),
    aiDisclosureDeliveredAt: new Date('2026-07-14T03:00:00Z'),
  }));
  p.analyzer.next = analysis;
  p.replyWriter.replies = replies;
  return p as TurnPorts & typeof p;
}

const req = { conversationId: CONVERSATION, messageId: 'm-1', text: 'Could you send me the catalogue?' };

const CASES: readonly [string, (string | null)[]][] = [
  ['no words at all', [null]],
  ['our JSON still in the words', ['Which one? "attach_product_image": false']],
  ['a guard trip, then no words', ['We ship in 99 days.', null]],
];

describe('no words from the writer: a person, in silence', () => {
  for (const mode of ['auto', 'draft'] as const) {
    for (const [what, replies] of CASES) {
      it(`${mode}: ${what}`, async () => {
        const p = ports(mode, replies);
        const r = await computeTurn(p, req);
        const fx = await commitTurn(p, req, r, Date.now());
        expect(r.reply).toBeNull();
        expect(r.answerPath).toBe('silent');
        expect(r.decision.action).toEqual({ kind: 'handoff', notifyOnly: false });
        expect(r.newState.assignedTo).toBe(UNCLAIMED_AGENT);
        expect(fx.outbound).toBeNull();
        expect(fx.draftCreated).toBeNull();
        expect(fx.handoffAlert).toBe(true);
        expect((p.tenant.signalRows.get(CONVERSATION) ?? []).map((s) => s.kind)).toContain('not_answered');
      });
    }
  }

  it('the last net reads the finished reply, whatever produced it: a stand-in carrying a question with our JSON', async () => {
    const p = ports('auto', ['We ship in 99 days.']);
    p.analyzer.next = { ...analysis, intent: { ...analysis.intent, nextLogicalQuestion: 'Which one? "tone":"warm"' } };
    const r = await computeTurn(p, req);
    expect(p.replyWriter.calls).toBe(2);
    expect(r.reply).toBeNull();
    expect(r.answerPath).toBe('silent');
  });

  it('words go out as usual', async () => {
    const p = ports('auto', ['Happy to help with that.']);
    const r = await computeTurn(p, req);
    expect(r.reply).toBe('Happy to help with that.');
    expect(r.answerPath).not.toBe('silent');
  });

  it('the writer is not asked twice for what it could not give', async () => {
    const p = ports('auto', [null, 'Too late.']);
    await computeTurn(p, req);
    expect(p.replyWriter.calls).toBe(1);
  });
});
