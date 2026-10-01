import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { emptyState, CONVERSATION, PRODUCT } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';

/**
 * G10 — the draft carries the language its reply is in, so the card can say
 * when its owner may not be able to read it.
 */
function ports(): TurnPorts & { tenant: FakeTenant; analyzer: FakeAnalyzer; replyWriter: FakeReplyWriter } {
  const p = { tenant: new FakeTenant(), retriever: new FakeRetriever(), analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(), now: () => new Date('2026-10-01T04:00:00Z') };
  p.tenant.grantRows = (['qualify', 'recommend', 'quote'] as const).map((capability) => ({ capability, mode: 'draft' as const, timeWindow: null }));
  p.tenant.speakerIs = { name: 'Lily', role: 'sales', note: null, business: { name: 'Rose Co', kind: null, country: null, description: null } };
  p.tenant.seed(CONVERSATION, emptyState({ phase: 'clarification', product: { productId: PRODUCT, confidence: 0.95, confirmedByClient: true, matchMethod: 'text' } }));
  return p;
}

describe('G10 · the draft says which language its reply is in', () => {
  it('the reply language the analysis chose, two letters', async () => {
    const p = ports();
    p.analyzer.next = {
      language: { detected: 'zh-CN', replyIn: 'zh-CN' },
      intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
      recommendedPhase: 'clarification',
    } satisfies Analysis;
    // Not a stock question: since VAR those go to the owner before any model.
    p.replyWriter.replies = ['有的，玫瑰精华有粉色和白色。'];
    const req = { conversationId: CONVERSATION, messageId: 'm-1', text: '玫瑰精华有什么颜色？' };
    await commitTurn(p, req, await computeTurn(p, req), Date.now());
    expect(p.tenant.eventRows.find((e) => e.type === 'draft_pending')?.payload).toMatchObject({ language: 'zh' });
  });
});
