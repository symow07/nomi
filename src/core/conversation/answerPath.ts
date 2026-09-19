/**
 * N1 — WHO answered this buyer: her own rules and memory, or a model?
 *
 * The product's direction (2026-09-19): she should understand and answer on her
 * own power, and a model is what she falls back to for a question she has never
 * seen. Before anything is moved off a model, this says — per turn — what
 * actually happened, so the next step is chosen from numbers and not a guess.
 *
 * Two questions are kept apart on purpose, because they cost separately:
 *
 *   · who WORDED the reply   — the path below;
 *   · who UNDERSTOOD the message — a model call the turn makes first, today,
 *     even when the words then come from her own rules. `analyserAvoidable`
 *     marks the turns where that call bought nothing.
 *
 * Pure: labels, a sum and a price table. No I/O.
 */
import { usd, type Money } from '../types/money.js';

export const ANSWER_PATHS = [
  'silent',         // a person holds the conversation; she says nothing
  'handoff',        // she hands over with the fixed sentence
  'fast_path',      // a bare yes/no to a question she asked — no model at all
  'canned',         // another fixed reply decided by the rules
  'order_flow',     // confirming an order, or saying why it cannot be confirmed
  'order_status',   // "where is my order?" answered from the order's own row
  'taught_answer',  // the owner's own answer, word for word
  'stand_in',       // the writer failed the guards twice; a fixed sentence went out
  'model',          // the reply writer wrote it
] as const;
export type AnswerPath = (typeof ANSWER_PATHS)[number];

/** True when no model wrote the words a buyer reads. */
export const wordedByHer = (p: AnswerPath): boolean => p !== 'model';

/**
 * The analyser ran and then her own rules answered from facts she already had:
 * the order-status question is recognised from the text alone, and a taught
 * answer is found by searching what she was taught — the second only counts
 * when the product it searched under was known BEFORE this turn, because
 * otherwise the analyser is what found it.
 */
export function analyserWasAvoidable(f: {
  readonly path: AnswerPath; readonly analyserCalled: boolean;
  readonly productBefore: string | null; readonly productUsed: string | null;
}): boolean {
  if (!f.analyserCalled) return false;
  if (f.path === 'order_status') return true;
  if (f.path === 'taught_answer') return f.productUsed === null || f.productUsed === f.productBefore;
  return false;
}

/**
 * List prices per million tokens, for an ESTIMATE only. The
 * invoice is the truth; this exists so a report can say "about half a cent a
 * message" without anybody opening a billing page. Dated, because prices move.
 */
export const MODEL_PRICES_PER_MTOK: Readonly<Record<string, { readonly input: Money; readonly output: Money; readonly asOf: string }>> = {
  'claude-haiku-4-5': { input: usd(1), output: usd(5), asOf: '2026-09' },
};

/** The currency travels with the amount (M43a): an estimate is money, not a bare number. */
export function estimateCost(modelId: string | null, inputTokens: number, outputTokens: number): Money | null {
  const p = modelId ? MODEL_PRICES_PER_MTOK[modelId] : undefined;
  if (!p || p.input.currency !== p.output.currency) return null;
  return {
    amount: (inputTokens * p.input.amount + outputTokens * p.output.amount) / 1_000_000,
    currency: p.input.currency,
  };
}

export type MeasuredTurn = {
  readonly path: AnswerPath; readonly modelId: string | null;
  readonly llmCalls: number; readonly inputTokens: number; readonly outputTokens: number;
  readonly analyserAvoidable: boolean;
};

export type PathSummary = {
  readonly turns: number;
  /** Turns where a buyer was actually sent or drafted words (everything but `silent`). */
  readonly replies: number;
  readonly repliesWordedByHer: number;
  readonly llmCalls: number;
  readonly avoidableAnalyserCalls: number;
  readonly inputTokens: number; readonly outputTokens: number;
  /** Null when any turn used a model with no listed price: a partial sum would read as a total. */
  readonly estimatedCost: Money | null;
  readonly byPath: Readonly<Partial<Record<AnswerPath, { readonly turns: number; readonly llmCalls: number }>>>;
};

export function summarizePaths(turns: readonly MeasuredTurn[]): PathSummary {
  const byPath: Partial<Record<AnswerPath, { turns: number; llmCalls: number }>> = {};
  let replies = 0, hers = 0, calls = 0, avoidable = 0, tin = 0, tout = 0;
  // One currency or none: a sum across currencies is not a number anybody can read.
  let cost: Money | null | undefined;
  for (const t of turns) {
    const slot = (byPath[t.path] ??= { turns: 0, llmCalls: 0 });
    slot.turns++; slot.llmCalls += t.llmCalls;
    if (t.path !== 'silent') { replies++; if (wordedByHer(t.path)) hers++; }
    calls += t.llmCalls; tin += t.inputTokens; tout += t.outputTokens;
    if (t.analyserAvoidable) avoidable++;
    if (t.llmCalls > 0 && cost !== null) {
      const c = estimateCost(t.modelId, t.inputTokens, t.outputTokens);
      cost = c === null || (cost !== undefined && cost.currency !== c.currency)
        ? null
        : { amount: (cost?.amount ?? 0) + c.amount, currency: c.currency };
    }
  }
  return {
    turns: turns.length, replies, repliesWordedByHer: hers, llmCalls: calls,
    avoidableAnalyserCalls: avoidable, inputTokens: tin, outputTokens: tout,
    estimatedCost: cost === undefined ? usd(0) : cost, byPath,
  };
}
