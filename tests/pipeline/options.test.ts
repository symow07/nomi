import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { HANDOFF_REPLIES } from '../../src/core/conversation/templates.js';
import { emptyState, CONVERSATION, PRODUCT } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';

/**
 * VAR (0111, decision 31) — THE TURN. The identified product's options reach
 * the writer whole, and their figures (a size 42) are sourced like the owner's
 * facts; a question about stock goes to the owner before any model, with the
 * ordinary hand-off sentence in the customer's language.
 */

const NOW = new Date('2026-10-01T04:00:00Z');

function ports() {
  const p = { tenant: new FakeTenant(), retriever: new FakeRetriever(), analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(), now: () => NOW };
  p.tenant.grantRows = (['greet', 'qualify', 'recommend'] as const).map((capability) => ({ capability, mode: 'auto', timeWindow: null }));
  p.tenant.seed(CONVERSATION, emptyState({
    phase: 'clarification', product: { productId: PRODUCT, confidence: 0.95, confirmedByClient: true, matchMethod: 'text' },
    aiDisclosedAt: new Date('2026-10-01T03:00:00Z'), aiDisclosureDeliveredAt: new Date('2026-10-01T03:00:05Z'),
  }));
  p.analyzer.next = {
    language: { detected: 'en', replyIn: 'en' },
    intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
    recommendedPhase: 'clarification', wantsPerson: false,
  } satisfies Analysis;
  return p;
}
async function run(p: ReturnType<typeof ports>, text: string) {
  const req = { conversationId: CONVERSATION, messageId: `m-${text.slice(0, 10)}`, text };
  const r = await computeTurn(p as TurnPorts, req);
  return { r, fx: await commitTurn(p as TurnPorts, req, r, Date.now()) };
}

describe('VAR · the options reach the writer', () => {
  it('whole, from the identified product — and a size in them is a figure the reply may say', async () => {
    const p = ports();
    p.tenant.productOptionRows.set(PRODUCT, [{ name: 'Size', values: ['40', '42', '44'] }, { name: 'Colour', values: ['black', 'white'] }]);
    p.replyWriter.replies = ['It comes in 40, 42 and 44, in black or white.'];
    // The customer names no size: only the options can source the figures.
    const { fx } = await run(p, 'Which sizes does it come in?');
    expect(p.replyWriter.inputs[0]!.options).toEqual([{ name: 'Size', values: ['40', '42', '44'] }, { name: 'Colour', values: ['black', 'white'] }]);
    expect(fx.outbound?.reply).toBe('It comes in 40, 42 and 44, in black or white.');
  });
  it('the control: without options the size is unsourced, and that reply never goes', async () => {
    const p = ports();
    p.replyWriter.replies = ['It comes in 40, 42 and 44, in black or white.', 'It comes in 40, 42 and 44, in black or white.'];
    const { fx } = await run(p, 'Which sizes does it come in?');
    expect(p.replyWriter.inputs[0]!.options).toBeUndefined();
    expect(fx.outbound?.reply ?? '').not.toContain('42');
  });
});

describe('VAR · a question about stock goes to the owner, before any model', () => {
  for (const [text, lang] of [['Is the black one in stock?', 'en'], ['黑色的还有货吗？', 'zh'], ['هل يوجد مخزون؟', 'ar']] as const) {
    it(`${lang}: ${JSON.stringify(text)}`, async () => {
      const p = ports();
      const { r, fx } = await run(p, text);
      expect(p.analyzer.calls).toBe(0);
      expect(p.replyWriter.calls).toBe(0);
      expect(r.decision.action.kind).toBe('handoff');
      expect((p.tenant.signalRows.get(CONVERSATION) ?? []).map((s) => s.kind)).toContain('stock_asked');
      expect(fx.outbound?.reply).toBe(HANDOFF_REPLIES[lang]);
    });
  }
  it('an option is not stock: "in black?" is answered', async () => {
    const p = ports();
    p.tenant.productOptionRows.set(PRODUCT, [{ name: 'Colour', values: ['black', 'white'] }]);
    p.replyWriter.replies = ['Yes, it comes in black.'];
    const { r, fx } = await run(p, 'Do you have it in black?');
    expect(r.decision.action.kind).not.toBe('handoff');
    expect(fx.outbound?.reply).toBe('Yes, it comes in black.');
  });
});
