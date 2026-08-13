import type { Signal } from './signals.js';
import { type Money, scaleMoney, isAbove } from '../types/money.js';
import type { ConversationState } from '../types/conversation.js';
import type { Analysis } from '../conversation/decide.js';

/**
 * Deterministic signal detection from the message text and analysis.
 * Ported from the n8n Escalation Score Calculator — same phrase lists, same
 * thresholds, so the shadow diff compares like with like.
 */

const HUMAN_PHRASES = [
  'speak to someone', 'real person', 'call me', 'human', 'manager',
  'speak to a person',
  'التحدث مع شخص', 'اريد احد',      // Arabic
  '找人工', '找真人',                 // Chinese
];

const LOGISTICS_PHRASES = [
  'letter of credit', 'lc at sight', 'ddp', 'ddu', 'incoterms',
  'customs clearance', 'lcl', 'fcl', 'freight',
];

export function detectSignals(input: {
  text: string;
  state: ConversationState;
  analysis: Analysis | null;
  /** unit price for value estimation; from SQL, never the model */
  unitPrice: Money | null;
}): Signal[] {
  const { text, state, analysis, unitPrice } = input;
  const t = (text ?? '').toLowerCase();
  const out: Signal[] = [];

  if (HUMAN_PHRASES.some((p) => t.includes(p))) {
    out.push({ kind: 'human_requested' });
  }

  if (LOGISTICS_PHRASES.some((p) => t.includes(p))) {
    out.push({ kind: 'logistics_discussed' });
  }

  if (analysis?.intent.primary === 'complaint') {
    out.push({ kind: 'complaint' });
  }

  // High value: quantity × price, using the SQL price (n8n guessed $2 when it
  // had no price; we only emit the signal when a real price exists).
  const qty = analysis?.intent.quantityMentioned?.value ?? state.quantity?.value ?? 0;
  // The threshold is written in the price's own currency, so the comparison is
  // between two comparable amounts rather than two bare numbers.
  if (unitPrice !== null) {
    const total = scaleMoney(unitPrice, qty);
    if (isAbove(total, { amount: 3_000, currency: total.currency })) {
      out.push({ kind: 'high_value', total });
    }
  }

  // Two turns in and still no product candidate: the AI is failing this client.
  if (analysis && analysis.intent.productCandidate === null && state.turnCount >= 2) {
    out.push({ kind: 'repeated_ambiguity', turns: state.turnCount });
  }

  return out;
}
