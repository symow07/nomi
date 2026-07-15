import type { Phase } from '../types/conversation.js';

/**
 * Legal transitions. Forward-only is now a property of this table, not a
 * convention someone has to remember. `closed` is terminal.
 */
const ALLOWED: Readonly<Record<Phase, readonly Phase[]>> = {
  warm_intake: ['clarification', 'qualification', 'escalated', 'closed'],
  clarification: ['qualification', 'commercial_discussion', 'escalated', 'closed'],
  qualification: ['commercial_discussion', 'escalated', 'closed'],
  commercial_discussion: ['confirmation', 'escalated', 'closed'],
  confirmation: ['closed', 'escalated'],
  escalated: ['closed'],
  closed: [],
};

export function canAdvance(from: Phase, to: Phase): boolean {
  return from === to || (ALLOWED[from] ?? []).includes(to);
}

/**
 * Move the conversation. An illegal transition is not an error — it is simply
 * refused, and the phase stays put. The AI proposing a backwards step is normal
 * (it does not know the history); silently regressing the funnel is not.
 */
export function advance(from: Phase, to: Phase): Phase {
  return canAdvance(from, to) ? to : from;
}
