import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { emptyState, CONVERSATION, PRODUCT } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';
import type { KnowledgeSource } from '../../src/core/types/knowledge.js';

/**
 * M13 — Factory Knowledge in the pipeline. Knowledge enters AFTER product
 * identification and BEFORE reply generation; numbers are sourced ONLY from the
 * identified product's rows; a strong FAQ ships the owner's answer verbatim;
 * certifications never leak through an answer.
 */

function ports(): TurnPorts & { tenant: FakeTenant; analyzer: FakeAnalyzer; replyWriter: FakeReplyWriter } {
  return {
    tenant: new FakeTenant(), retriever: new FakeRetriever(),
    analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(),
    now: () => new Date('2026-07-14T12:00:00Z'),
  };
}

const identify = (): Analysis => ({
  language: { detected: 'en', replyIn: 'en' },
  intent: {
    primary: 'inquiry',
    productCandidate: { productId: PRODUCT, confidence: 0.95, confirmedByClient: false, matchMethod: 'text' },
    quantityMentioned: null, nextLogicalQuestion: null, missingFields: [],
  },
  recommendedPhase: 'clarification',
});

let kseq = 0;
const krow = (over: {
  productId?: string | null; kind: string; label: string; content: string; source?: KnowledgeSource; status?: 'active' | 'archived';
}) => ({
  id: `k-${++kseq}`, productId: over.productId ?? (PRODUCT as string),
  kind: over.kind as never, label: over.label, content: over.content,
  source: over.source ?? 'owner_confirmed', status: over.status ?? 'active' as const,
});

const req = (text: string) => ({ conversationId: CONVERSATION, messageId: `m-${kseq}`, text });

describe('M13 · knowledge answers, guarded', () => {
  it('a spec number the owner taught is sayable (sourced), and audited', async () => {
    const p = ports();
    p.tenant.seed(CONVERSATION, emptyState());
    p.tenant.knowledgeRows.push(krow({ kind: 'specification', label: 'Dimensions', content: '38 x 40 cm, 90 gsm' }));
    p.analyzer.next = identify();
    p.replyWriter.replies = ["Sure — it's 38 x 40 cm at 90 gsm."];

    const r = await computeTurn(p, req('what are the dimensions?'));
    expect(r.guardViolations).toBe(0);
    expect(r.reply).toContain('38 x 40 cm');
    expect(r.knowledgeUsed.length).toBeGreaterThan(0);

    await commitTurn(p, req('what are the dimensions?'), r, Date.now());
    expect(p.tenant.eventRows.some((e) => e.type === 'knowledge_used')).toBe(true);
  });

  it('a number NOT in any taught row or the quote is still blocked', async () => {
    const p = ports();
    p.tenant.seed(CONVERSATION, emptyState());
    p.tenant.knowledgeRows.push(krow({ kind: 'specification', label: 'Dimensions', content: '38 x 40 cm' }));
    p.analyzer.next = identify();
    p.replyWriter.replies = ["It's 38 x 40 cm and weighs 250 g.", "It's 38 x 40 cm and weighs 250 g."];

    const r = await computeTurn(p, req('dimensions and weight?'));
    expect(r.guardViolations).toBe(2);          // 250 is unsourced → rejected twice
    expect(r.reply).not.toContain('250');
    expect(r.replyDeterministic).toBe(true);    // fell back
  });

  it('DECISION 1: a business-level number is NOT sourced for the identified product', async () => {
    const p = ports();
    p.tenant.seed(CONVERSATION, emptyState());
    p.tenant.knowledgeRows.push(krow({ productId: null, kind: 'production_note', label: 'Factory', content: 'Established 1998, 500 staff.' }));
    p.analyzer.next = identify();
    p.replyWriter.replies = ["We've made these since 1998.", "We've made these since 1998."];

    const r = await computeTurn(p, req('how long have you made this?'));
    expect(r.guardViolations).toBe(2);          // 1998 is business-level → not in the allow-set
    expect(r.reply).not.toContain('1998');
  });

  it('FAQ path: a strong match ships the owner answer verbatim — no LLM call', async () => {
    const p = ports();
    p.tenant.seed(CONVERSATION, emptyState());
    p.tenant.knowledgeRows.push(krow({ kind: 'faq', label: 'What colors are available?', content: 'We offer red, blue, black and white; custom colors on request.' }));
    p.analyzer.next = identify();
    p.replyWriter.replies = ['(the model should never be called)'];

    const r = await computeTurn(p, req('what colors are available?'));
    expect(r.replyDeterministic).toBe(true);
    expect(r.reply).toBe('We offer red, blue, black and white; custom colors on request.');
    expect(p.replyWriter.calls).toBe(0);        // deterministic — zero tokens
    expect(r.knowledgeUsed).toHaveLength(1);
  });

  it('teach → answer → correct → NEW answer (archive-not-replace)', async () => {
    const p = ports();
    p.tenant.seed(CONVERSATION, emptyState());
    const first = krow({ kind: 'buyer_answer', label: 'What colors are available?', content: 'Red and blue only.' });
    p.tenant.knowledgeRows.push(first);
    p.analyzer.next = identify();

    const before = await computeTurn(p, req('what colors are available?'));
    expect(before.reply).toBe('Red and blue only.');

    // correction: archive the old, add a new active row (owner_corrected)
    first.status = 'archived';
    p.tenant.knowledgeRows.push(krow({ kind: 'buyer_answer', label: 'What colors are available?', content: 'Red, blue and now green.', source: 'owner_corrected' }));

    p.analyzer.next = identify();
    const after = await computeTurn(p, req('what colors are available?'));
    expect(after.reply).toBe('Red, blue and now green.');
  });

  it('DECISION 2: a certification claim inside an answer cannot ship without claims_policy', async () => {
    const p = ports();
    p.tenant.seed(CONVERSATION, emptyState());
    // owner wrote "food-grade" (a certification claim) into an FAQ answer, but
    // never authorised it in claims_policy → the answer must not ship raw.
    p.tenant.knowledgeRows.push(krow({ kind: 'faq', label: 'Is it food safe?', content: 'Yes, it is food-grade for dry goods.' }));
    p.analyzer.next = identify();
    p.replyWriter.replies = ['Let me check the exact suitability for your use and confirm.'];

    const r = await computeTurn(p, req('is it food safe?'));
    expect(r.reply).not.toContain('food-grade');   // claim blocked; fell through to a guarded reply
  });
});
