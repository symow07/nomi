import type { Signal } from './signals.js';
import { type Money, scaleMoney, isAbove } from '../types/money.js';
import type { ConversationState } from '../types/conversation.js';
import type { Analysis } from '../conversation/decide.js';
import { asksForDeletion } from '../safety/deletion.js';

/**
 * Deterministic signal detection from the message text and analysis.
 * Ported from the n8n Escalation Score Calculator — same phrase lists, same
 * thresholds, so the shadow diff compares like with like.
 */

const HUMAN_PHRASES = [
  'speak to someone', 'real person', 'call me', 'human',
  'speak to a person',
  'التحدث مع شخص', 'اريد احد',      // Arabic
  '找人工', '找真人',                 // Chinese
];

/**
 * "MANAGER", SPLIT BY WHOSE IT IS (the owner's decision, 2026-09-28).
 *
 * It was on the list above as a bare word, so "my manager approved it" and
 * "my manager will confirm the price" — a buyer talking about their own
 * colleague, which trade chat does constantly — handed the conversation to a
 * person every time, for nothing.
 *
 *   · The buyer's OWN manager is not a request to reach a person: "my …
 *     manager", "our … manager", "I'm the … manager", "the … manager at my
 *     company". Up to two words between ("my new sales manager"), never
 *     "your", "to", "with" or "for" — "I'm talking to your manager" is not
 *     theirs.
 *   · Every OTHER mention still hands off, exactly as before: "your manager",
 *     "speak to a manager", "the manager approved it". Whose manager "the
 *     manager" is cannot be told, and a wrong hand-off costs the owner a
 *     minute where a missed one loses a buyer.
 *
 * The same test for "someone in charge", which the owner named as the
 * seller's side and the list never had: "let me talk to someone in charge"
 * hands off; "someone in charge at my company" does not.
 *
 * Chinese and Arabic never had a word for a manager on this list; nothing
 * changes there. tests/parity/person-request.test.ts holds both sides, and
 * pins what was reported to the owner about the rest of the list.
 */
const FILL = String.raw`(?:(?!your\b|yours\b|to\b|with\b|for\b)[a-z][a-z'’-]*\s+){0,2}`;
const THEIR_OWN_MANAGER = new RegExp([
  String.raw`\b(?:my|our)\s+${FILL}managers?\b`,                                // my (new sales) manager
  String.raw`\bi(?:'?m|’m| am)\s+(?:(?:the|a|an)\s+)?${FILL}managers?\b`,      // I'm the purchasing manager
  String.raw`\b(?:the|a)\s+${FILL}managers?\s+(?:of|at|in|from|on)\s+(?:my|our)\b`, // the manager at my company
].join('|'), 'g');
const IN_CHARGE = String.raw`\b(?:someone|somebody|anyone|anybody|(?:the|a|your)\s+person)\s+in\s+charge\b`;
const THEIR_OWN_IN_CHARGE = new RegExp(`${IN_CHARGE}\\s+(?:at|of|in|from|on)\\s+(?:my|our)\\b`, 'g');
const SELLERS_IN_CHARGE = new RegExp(IN_CHARGE);

/** Lower-cased text: does it ask for a person — or name the seller's manager? */
export function asksForPerson(t: string): boolean {
  if (HUMAN_PHRASES.some((p) => t.includes(p))) return true;
  if (t.includes('manager') && t.replace(THEIR_OWN_MANAGER, ' ').includes('manager')) return true;
  return SELLERS_IN_CHARGE.test(t.replace(THEIR_OWN_IN_CHARGE, ' '));
}

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

  if (asksForPerson(t)) {
    out.push({ kind: 'human_requested' });
  }

  // 0075 — "delete my data" goes to a person, and nothing is said to the buyer.
  // The buyer's own data as the object, never "delete that line from the quote"
  // (core/safety/deletion.ts, both lists in tests/parity/deletion-requests).
  if (asksForDeletion(text)) {
    out.push({ kind: 'deletion_requested' });
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
