import type { Capability } from '../conversation/autonomy.js';

/**
 * M5 — Promotion and demotion as DETERMINISTIC evidence decisions.
 *
 * No confidence scores, no vibes: a capability is promoted when countable
 * requirements are met, and reduced when countable risk appears. Every
 * decision returns its reasons so the owner surface can show the evidence —
 * a silent authority change is structurally impossible (the renderer takes
 * the decision object, and the decision object always carries reasons).
 */

export type CapabilityEvidence = {
  readonly capability: Capability;
  readonly handled: number;                 // completed cases in window
  readonly approvedNoEdit: number;          // owner tapped 发送 unchanged
  readonly edited: number;                  // owner changed the draft
  readonly spotChecksPassed: number;
  readonly spotChecksFailed: number;        // needs_improvement
  readonly spotChecksSerious: number;       // 有问题
  readonly policyViolations: number;        // floor breach attempt, claims-guard hit
  readonly hallucinationAttempts: number;   // product not in retrieval
  readonly daysSupervised: number;
  readonly recentCorrections: number;       // owner edits in the last 7 days
  readonly trainingExamples: number;
};

export type PromotionRequirements = {
  readonly minHandled: number;
  readonly minCleanApprovals: number;
  readonly maxEditRatio: number;            // edited / handled
  readonly minSpotChecksPassed: number;
  readonly minDaysSupervised: number;
  readonly minTrainingExamples: number;
};

/** Defaults per capability — money-touching work needs more proof. */
export const PROMOTION_REQUIREMENTS: Record<string, PromotionRequirements> = {
  greet:      { minHandled: 15, minCleanApprovals: 12, maxEditRatio: 0.2, minSpotChecksPassed: 2, minDaysSupervised: 5, minTrainingExamples: 0 },
  qualify:    { minHandled: 15, minCleanApprovals: 12, maxEditRatio: 0.2, minSpotChecksPassed: 2, minDaysSupervised: 5, minTrainingExamples: 0 },
  recommend:  { minHandled: 20, minCleanApprovals: 16, maxEditRatio: 0.2, minSpotChecksPassed: 3, minDaysSupervised: 7, minTrainingExamples: 3 },
  quote:      { minHandled: 25, minCleanApprovals: 22, maxEditRatio: 0.12, minSpotChecksPassed: 3, minDaysSupervised: 10, minTrainingExamples: 5 },
  negotiate:  { minHandled: 30, minCleanApprovals: 27, maxEditRatio: 0.1, minSpotChecksPassed: 4, minDaysSupervised: 14, minTrainingExamples: 8 },
  follow_up:  { minHandled: 15, minCleanApprovals: 12, maxEditRatio: 0.2, minSpotChecksPassed: 2, minDaysSupervised: 7, minTrainingExamples: 0 },
  // confirm_order is permanently human (autonomy.ts) — no requirements exist,
  // so promotionDecision can never return eligible for it.
};

export type PromotionGap =
  | 'more_cases' | 'more_clean_approvals' | 'edit_ratio_high'
  | 'more_spot_checks' | 'more_supervised_time' | 'more_training_examples'
  | 'policy_violation' | 'never_promotable';

export type PromotionDecision =
  | { readonly eligible: true; readonly evidence: CapabilityEvidence }
  | { readonly eligible: false; readonly gaps: readonly PromotionGap[] };

export function promotionDecision(e: CapabilityEvidence): PromotionDecision {
  const req = PROMOTION_REQUIREMENTS[e.capability];
  if (!req) return { eligible: false, gaps: ['never_promotable'] };

  const gaps: PromotionGap[] = [];
  // A policy violation zeroes the case — trust restarts from evidence, not apology.
  if (e.policyViolations > 0 || e.hallucinationAttempts > 0) gaps.push('policy_violation');
  if (e.handled < req.minHandled) gaps.push('more_cases');
  if (e.approvedNoEdit < req.minCleanApprovals) gaps.push('more_clean_approvals');
  if (e.handled > 0 && e.edited / e.handled > req.maxEditRatio) gaps.push('edit_ratio_high');
  if (e.spotChecksPassed < req.minSpotChecksPassed || e.spotChecksSerious > 0) gaps.push('more_spot_checks');
  if (e.daysSupervised < req.minDaysSupervised) gaps.push('more_supervised_time');
  if (e.trainingExamples < req.minTrainingExamples) gaps.push('more_training_examples');

  return gaps.length === 0 ? { eligible: true, evidence: e } : { eligible: false, gaps };
}

/** ── The reverse path: limit, pause, return to learning, withdraw ───────── */

export type DemotionAction = 'none' | 'pause' | 'return_to_learning' | 'withdraw';

export type DemotionReason =
  | 'repeated_corrections'    // owner had to fix recent output
  | 'failed_spot_check'
  | 'serious_spot_check'
  | 'policy_violation'        // floor/claims guard fired
  | 'hallucination'
  | 'channel_unstable';       // provider instability — not the employee's fault

export type DemotionDecision = {
  readonly action: DemotionAction;
  readonly reasons: readonly DemotionReason[];
};

/** Corrections in 7 days that trigger review (spec example: two edited quotes). */
export const CORRECTIONS_THRESHOLD = 2;

export function demotionDecision(e: CapabilityEvidence, channelUnstable = false): DemotionDecision {
  const reasons: DemotionReason[] = [];
  // Worst first — the action is the most severe triggered level.
  if (e.policyViolations > 0) reasons.push('policy_violation');
  if (e.hallucinationAttempts > 0) reasons.push('hallucination');
  if (e.spotChecksSerious > 0) reasons.push('serious_spot_check');
  if (e.spotChecksFailed >= 2) reasons.push('failed_spot_check');
  if (e.recentCorrections >= CORRECTIONS_THRESHOLD) reasons.push('repeated_corrections');
  if (channelUnstable) reasons.push('channel_unstable');

  if (reasons.length === 0) return { action: 'none', reasons };
  if (reasons.includes('policy_violation') || reasons.includes('hallucination')) {
    return { action: 'withdraw', reasons };
  }
  if (reasons.includes('serious_spot_check')) return { action: 'return_to_learning', reasons };
  return { action: 'pause', reasons };
}

/** Spot-check verdicts fold into evidence — one arithmetic point, tested. */
export function applySpotCheck(
  e: CapabilityEvidence,
  verdict: 'correct' | 'needs_improvement' | 'serious',
): CapabilityEvidence {
  return {
    ...e,
    spotChecksPassed: e.spotChecksPassed + (verdict === 'correct' ? 1 : 0),
    spotChecksFailed: e.spotChecksFailed + (verdict === 'needs_improvement' ? 1 : 0),
    spotChecksSerious: e.spotChecksSerious + (verdict === 'serious' ? 1 : 0),
  };
}
