import type { Scores } from '../types/conversation.js';

/**
 * Observations about a conversation. Scores are DERIVED from these, never
 * accumulated into a running total.
 *
 * The n8n system seeded `score` from the stored value and only ever added, so
 * the score was monotonic — it could never come down, even after the problem was
 * resolved. Combined with a close gate at `score >= 70`, and `high_value` worth
 * +60, this meant large orders permanently blocked their own confirmation.
 *
 * Storing signals and recomputing means a resolved problem simply stops being
 * in the set, and the score falls. See docs/adr/0003 §4.
 */
export type Signal =
  // --- problem signals: something is going wrong. These GATE the close. ---
  | { readonly kind: 'human_requested' }
  | { readonly kind: 'complaint' }
  | { readonly kind: 'repeated_ambiguity'; readonly turns: number }
  | { readonly kind: 'low_confidence_image' }
  // --- lead signals: the client is BUYING. These never gate anything. ---
  | { readonly kind: 'high_value'; readonly totalUsd: number }
  | { readonly kind: 'customization_requested' }
  | { readonly kind: 'logistics_discussed' }
  | { readonly kind: 'moq_accepted' }
  | { readonly kind: 'price_acknowledged' };

export type SignalKind = Signal['kind'];

const PROBLEM_KINDS = new Set<SignalKind>([
  'human_requested',
  'complaint',
  'repeated_ambiguity',
  'low_confidence_image',
]);

export const isProblemSignal = (s: Signal): boolean => PROBLEM_KINDS.has(s.kind);
export const isLeadSignal = (s: Signal): boolean => !isProblemSignal(s);

/** Maps to the DB CHECK constraint on escalation_events.trigger_reason. */
export type TriggerReason =
  | 'high_value'
  | 'unclear_product'
  | 'customization'
  | 'complex_negotiation'
  | 'repeated_ambiguity'
  | 'client_request'
  | 'logistics_payment'
  | 'manual'
  | 'low_confidence_image';

export function toTriggerReason(s: Signal): TriggerReason {
  switch (s.kind) {
    case 'human_requested':
      return 'client_request';
    case 'complaint':
      return 'complex_negotiation';
    case 'repeated_ambiguity':
      return 'repeated_ambiguity';
    case 'low_confidence_image':
      return 'low_confidence_image';
    case 'high_value':
      return 'high_value';
    case 'customization_requested':
      return 'customization';
    case 'logistics_discussed':
      return 'logistics_payment';
    case 'moq_accepted':
    case 'price_acknowledged':
      return 'manual';
  }
}

const clamp = (n: number): number => Math.max(0, Math.min(100, n));

/**
 * Pure, total, and the ONLY place scores are produced.
 *
 * Note what does NOT appear here: any notion of "previous score". The score is a
 * function of the signals currently believed true, and nothing else.
 */
export function computeScores(signals: readonly Signal[]): Scores {
  let problem = 0;
  let lead = 0;

  for (const s of signals) {
    switch (s.kind) {
      // --- problem ---
      case 'human_requested':
        problem = 100; // absolute. Stop the AI.
        break;
      case 'complaint':
        problem += 40;
        break;
      case 'repeated_ambiguity':
        problem += s.turns >= 3 ? 45 : 35;
        break;
      case 'low_confidence_image':
        problem += 15;
        break;

      // --- lead: the client is buying. NEVER add these to `problem`. ---
      case 'high_value':
        lead += s.totalUsd > 10_000 ? 60 : 40;
        break;
      case 'customization_requested':
        lead += 30;
        break;
      case 'logistics_discussed':
        lead += 25;
        break;
      case 'moq_accepted':
        lead += 20;
        break;
      case 'price_acknowledged':
        lead += 20;
        break;
    }
  }

  return { problem: clamp(problem), lead: clamp(lead) };
}

/** Threshold at which a human must own the conversation. */
export const PROBLEM_HANDOFF_THRESHOLD = 70;

/** Threshold at which the sales team is told a deal is hot. Notifies; never gates. */
export const LEAD_HOT_THRESHOLD = 60;

export const needsHandoff = (s: Scores): boolean => s.problem >= PROBLEM_HANDOFF_THRESHOLD;
export const isHotLead = (s: Scores): boolean => s.lead >= LEAD_HOT_THRESHOLD;
