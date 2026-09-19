import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ANSWER_PATHS, analyserWasAvoidable, estimateCost, summarizePaths, wordedByHer, type MeasuredTurn,
} from '../../src/core/conversation/answerPath.js';
import { computeTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { emptyState, CONVERSATION, PRODUCT } from './fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from '../pipeline/fakes.js';

/**
 * N1 — who answered: her own rules and memory, or a model?
 *
 * The direction is that she answers on her own power and falls back to a model
 * for a question she has never seen. Nothing can be moved off a model honestly
 * until each turn says who worded it and what it cost. These are the labels,
 * the sums, and the proof that the turn sets the label where it decides.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

describe('N1 · the labels', () => {
  it('only one path means a model wrote the words a buyer reads', () => {
    expect(ANSWER_PATHS.filter((p) => !wordedByHer(p))).toEqual(['model']);
  });

  it('the migration accepts exactly these labels', () => {
    const m = read('migrations/0060_turn_answer_path.sql');
    const listed = /answer_path in \(([\s\S]*?)\)\)/.exec(m)![1]!.match(/'([a-z_]+)'/g)!.map((x) => x.slice(1, -1));
    expect(listed.sort()).toEqual([...ANSWER_PATHS].sort());
  });

  it('the analyser bought nothing when her own rules answered from what she already had', () => {
    const base = { analyserCalled: true, productBefore: 'p1', productUsed: 'p1' };
    expect(analyserWasAvoidable({ ...base, path: 'order_status' })).toBe(true);
    expect(analyserWasAvoidable({ ...base, path: 'taught_answer' })).toBe(true);
    expect(analyserWasAvoidable({ ...base, path: 'taught_answer', productUsed: null })).toBe(true);
    // The analyser FOUND the product the answer was searched under: it earned its call.
    expect(analyserWasAvoidable({ ...base, path: 'taught_answer', productBefore: null })).toBe(false);
    expect(analyserWasAvoidable({ ...base, path: 'model' })).toBe(false);
    expect(analyserWasAvoidable({ ...base, path: 'order_status', analyserCalled: false })).toBe(false);
  });
});

describe('N1 · the sums', () => {
  const t = (over: Partial<MeasuredTurn>): MeasuredTurn => ({
    path: 'model', modelId: 'claude-haiku-4-5', llmCalls: 2, inputTokens: 3000, outputTokens: 300, analyserAvoidable: false, ...over,
  });

  it('counts replies, who worded them, and the calls that bought nothing', () => {
    const s = summarizePaths([
      t({}), t({}),
      t({ path: 'taught_answer', llmCalls: 1, inputTokens: 1500, outputTokens: 150, analyserAvoidable: true }),
      t({ path: 'fast_path', llmCalls: 0, inputTokens: 0, outputTokens: 0, modelId: null }),
      t({ path: 'silent', llmCalls: 0, inputTokens: 0, outputTokens: 0, modelId: null }),
    ]);
    expect(s.turns).toBe(5);
    expect(s.replies).toBe(4);               // silence is not a reply
    expect(s.repliesWordedByHer).toBe(2);
    expect(s.llmCalls).toBe(5);
    expect(s.avoidableAnalyserCalls).toBe(1);
    expect(s.byPath.model).toEqual({ turns: 2, llmCalls: 4 });
    // 7,500 in at $1 + 750 out at $5, per million.
    expect(s.estimatedCost?.currency).toBe('USD');
    expect(s.estimatedCost?.amount).toBeCloseTo(0.0075 + 0.00375, 8);
  });

  it('a model with no listed price makes the total unknown, never a partial sum', () => {
    expect(estimateCost('some-new-model', 1000, 1000)).toBeNull();
    expect(summarizePaths([t({}), t({ modelId: 'some-new-model' })]).estimatedCost).toBeNull();
    expect(summarizePaths([]).estimatedCost).toEqual({ amount: 0, currency: 'USD' });
  });
});

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
const req = (text: string) => ({ conversationId: CONVERSATION, messageId: 'm-n1', text });

describe('N1 · the turn labels itself where it decides', () => {
  it('the writer wrote it: model, two calls, nothing avoidable', async () => {
    const p = ports();
    p.tenant.seed(CONVERSATION, emptyState());
    p.analyzer.next = identify();
    const r = await computeTurn(p, req('tell me about your bags'));
    expect(r.answerPath).toBe('model');
    expect(r.usage.llmCalls).toBe(2);
    expect(r.analyserAvoidable).toBe(false);
  });

  it('the guards failed twice: a stand-in went out, and she worded it', async () => {
    const p = ports();
    p.tenant.seed(CONVERSATION, emptyState());
    p.analyzer.next = identify();
    p.replyWriter.replies = ['That is 999 each.', 'That is 999 each.'];
    const r = await computeTurn(p, req('price?'));
    expect(r.answerPath).toBe('stand_in');
    expect(wordedByHer(r.answerPath)).toBe(true);
  });

  it('her own taught answer, on a product the analyser had to find: the call earned its keep', async () => {
    const p = ports();
    p.tenant.seed(CONVERSATION, emptyState());
    p.tenant.knowledgeRows.push({ id: 'k-n1', productId: PRODUCT as string, kind: 'faq' as never,
      label: 'Do you ship to Morocco?', content: 'Yes, we ship to Morocco by sea.', source: 'owner_confirmed', status: 'active' as const });
    p.analyzer.next = identify();
    const r = await computeTurn(p, req('Do you ship to Morocco?'));
    expect(r.answerPath).toBe('taught_answer');
    expect(r.usage.llmCalls).toBe(1);        // the writer was never asked
    expect(r.analyserAvoidable).toBe(false); // …but the analyser is what found the product
  });

  it('every branch that decides the words also sets the label', () => {
    const src = read('src/pipeline/turn.ts');
    for (const label of ['silent', 'fast_path', 'handoff', 'order_flow', 'order_status', 'taught_answer', 'stand_in']) {
      expect(src, label).toContain(`'${label}'`);
    }
    expect(src).toMatch(/let answerPath: AnswerPath = 'model';/);
    expect(src).toMatch(/measure: \{\s*path: r\.answerPath, analyserAvoidable: r\.analyserAvoidable,/);
  });
});
