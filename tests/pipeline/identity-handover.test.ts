import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn } from '../../src/pipeline/turn.js';
import { CAPABILITIES } from '../../src/core/conversation/autonomy.js';
import { HANDOFF_REPLIES } from '../../src/core/conversation/templates.js';
import { emptyState, CONVERSATION } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';

/**
 * Rule 3 — the disclosure goes out "again whenever a buyer asks what they are talking to". Found 2026-10-14
 * (measuring the Arabic guard through the turn): in a conversation already told once, "Are you a bot? I want a human"
 * was handed over with only "someone from our team will reply" — the question asked NOW went unanswered. A hand-over
 * sentence in answer to it now carries the disclosure; one that answers nothing of the kind does not.
 */

async function handOver(text: string) {
  const p = {
    tenant: new FakeTenant(), retriever: new FakeRetriever(), analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(),
    now: () => new Date('2026-07-14T12:00:00Z'),
  };
  p.tenant.grantRows = CAPABILITIES.map((capability) => ({ capability, mode: 'auto' as const, timeWindow: null }));
  p.analyzer.next = {
    language: { detected: 'en', replyIn: 'en' },
    intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
    recommendedPhase: 'clarification', wantsPerson: true,
  };
  // Told once already: the "first message" rule is spent, so only the question can bring the disclosure back.
  p.tenant.seed(CONVERSATION, emptyState({
    aiDisclosedAt: new Date('2026-07-14T11:00:00Z'), aiDisclosureDeliveredAt: new Date('2026-07-14T11:00:05Z'),
  }));
  const req = { conversationId: CONVERSATION, messageId: `m-${text.length}`, text };
  const r = await computeTurn(p, req);
  const fx = await commitTurn(p, req, r, Date.now());
  return { r, fx, events: p.tenant.eventRows.filter((e) => e.type === 'ai_disclosed').map((e) => e.payload) };
}

describe('rule 3 · a hand-over in answer to "what am I talking to?" says what is answering', () => {
  for (const [lang, text, ai] of [
    ['en', 'Are you a bot? I want a human', 'AI assistant'],
    ['zh', '你是机器人吗？我要找人工客服', 'AI助手'],
    ['ar', 'هل أنت روبوت؟ أريد التحدث مع شخص', 'مساعد آلي'],
  ] as const) {
    it(`${lang}: ${text}`, async () => {
      const { r, fx, events } = await handOver(text);
      expect(r.decision.action.kind).toBe('handoff');
      expect(fx.outbound?.reply).toContain(HANDOFF_REPLIES[lang]);
      expect(fx.outbound?.reply).toContain(ai);
      expect(events).toContainEqual({ reason: 'identity_question' });
    });
  }

  it('a hand-over that answers no such question carries nothing more than before', async () => {
    const { fx, events } = await handOver('I want to speak to a real person now.');
    expect(fx.outbound?.reply).toBe(HANDOFF_REPLIES.en);
    expect(events).toEqual([]);
  });
});
