import { describe, it, expect } from 'vitest';
import { computeTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { CAPABILITIES } from '../../src/core/conversation/autonomy.js';
import { emptyState, CONVERSATION } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';

/** Whatever the writer returned, a customer reads 您; the guards before it read the words as written. */

const analysis: Analysis = {
  language: { detected: 'zh', replyIn: 'zh' },
  intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
  recommendedPhase: 'clarification',
};

function ports(replies: (string | null)[]) {
  const p = {
    tenant: new FakeTenant(), retriever: new FakeRetriever(),
    analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(),
    now: () => new Date('2026-07-14T04:00:00Z'),
  };
  p.tenant.grantRows = CAPABILITIES.filter((c) => c !== 'confirm_order').map((capability) => ({ capability, mode: 'draft' as const, timeWindow: null }));
  p.tenant.seed(CONVERSATION, emptyState({ phase: 'clarification' }));
  p.analyzer.next = analysis;
  p.replyWriter.replies = replies;
  return p as TurnPorts & typeof p;
}

const req = { conversationId: CONVERSATION, messageId: 'm-1', text: '这个多少钱' };

describe('the writer says 你', () => {
  it('the customer reads 您, at no second model call', async () => {
    const p = ports(['谢谢你的询问。请问你想要哪一款？']);
    const r = await computeTurn(p, req);
    expect(r.reply).toBe('谢谢您的询问。请问您想要哪一款？');
    expect(r.guardViolations).toBe(0);
    expect(p.replyWriter.calls).toBe(1);
  });

  it('a reply in another language passes untouched', async () => {
    const p = ports(['Which one did you have in mind?']);
    p.analyzer.next = { ...analysis, language: { detected: 'en', replyIn: 'en' } };
    const r = await computeTurn(p, { ...req, text: 'how much is this' });
    expect(r.reply).toBe('Which one did you have in mind?');
  });
});
