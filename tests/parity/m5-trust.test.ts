import { describe, it, expect } from 'vitest';
import {
  promotionDecision, demotionDecision, applySpotCheck,
  PROMOTION_REQUIREMENTS, CORRECTIONS_THRESHOLD, type CapabilityEvidence,
} from '../../src/core/trust/evidence.js';
import { classifyEditScope, learningAck, type EditSignals } from '../../src/core/trust/editScope.js';
import { selectSpotChecks, parseSpotCheckReply, type CompletedWork } from '../../src/core/trust/spotCheck.js';
import { DEMO_PROMOTED_EVIDENCE, DEMO_PAUSED_EVIDENCE, demoTrustSeedSql } from '../../src/demo/trust.js';

const evidence = (over: Partial<CapabilityEvidence> = {}): CapabilityEvidence => ({
  capability: 'greet', handled: 20, approvedNoEdit: 18, edited: 2,
  spotChecksPassed: 3, spotChecksFailed: 0, spotChecksSerious: 0,
  policyViolations: 0, hallucinationAttempts: 0,
  daysSupervised: 10, recentCorrections: 0, trainingExamples: 5, ...over,
});

/* ── Promotion: deterministic evidence, never vibes ──────────────────────── */
describe('M5 · promotion evidence', () => {
  it('meets every threshold → eligible, with the evidence attached', () => {
    const d = promotionDecision(evidence());
    expect(d.eligible).toBe(true);
  });

  const gapsOf = (e: CapabilityEvidence): readonly string[] => {
    const d = promotionDecision(e);
    return d.eligible ? [] : d.gaps;
  };

  it('no promotion without evidence — each missing requirement is named', () => {
    const gaps = gapsOf(evidence({ handled: 3, approvedNoEdit: 2 }));
    expect(gaps).toContain('more_cases');
    expect(gaps).toContain('more_clean_approvals');
  });

  it('a single policy violation or hallucination attempt blocks promotion', () => {
    expect(gapsOf(evidence({ policyViolations: 1 }))).toContain('policy_violation');
    expect(gapsOf(evidence({ hallucinationAttempts: 1 }))).toContain('policy_violation');
  });

  it('confirm_order can never become eligible', () => {
    expect(PROMOTION_REQUIREMENTS['confirm_order']).toBeUndefined();
    const d = promotionDecision(evidence({ capability: 'confirm_order' }));
    expect(d).toMatchObject({ eligible: false, gaps: ['never_promotable'] });
  });

  it('money-touching capabilities require more proof than greetings', () => {
    expect(PROMOTION_REQUIREMENTS['quote']!.minHandled).toBeGreaterThan(PROMOTION_REQUIREMENTS['greet']!.minHandled);
    expect(PROMOTION_REQUIREMENTS['negotiate']!.maxEditRatio).toBeLessThan(PROMOTION_REQUIREMENTS['greet']!.maxEditRatio);
  });
});

/* ── Demotion: countable risk, graded response ───────────────────────────── */
describe('M5 · capability withdrawal triggers', () => {
  it('clean evidence → no action', () => {
    expect(demotionDecision(evidence())).toEqual({ action: 'none', reasons: [] });
  });

  it('repeated corrections (spec: two edited quotes) → pause', () => {
    const d = demotionDecision(evidence({ recentCorrections: CORRECTIONS_THRESHOLD }));
    expect(d.action).toBe('pause');
    expect(d.reasons).toContain('repeated_corrections');
  });

  it('serious spot check → return to learning; violation/hallucination → withdraw', () => {
    expect(demotionDecision(evidence({ spotChecksSerious: 1 })).action).toBe('return_to_learning');
    expect(demotionDecision(evidence({ policyViolations: 1 })).action).toBe('withdraw');
    expect(demotionDecision(evidence({ hallucinationAttempts: 1 })).action).toBe('withdraw');
  });

  it('every reduction carries its reasons — a silent change cannot be expressed', () => {
    const d = demotionDecision(evidence({ spotChecksFailed: 2 }));
    expect(d.action).not.toBe('none');
    expect(d.reasons.length).toBeGreaterThan(0);
  });

  it('spot-check verdicts fold into evidence arithmetic', () => {
    const e = applySpotCheck(applySpotCheck(evidence({ spotChecksPassed: 0 }), 'correct'), 'serious');
    expect(e.spotChecksPassed).toBe(1);
    expect(e.spotChecksSerious).toBe(1);
  });
});

/* ── Edit learning: honest scope, no global creep ────────────────────────── */
describe('M5 · edit-learning scope', () => {
  const signals = (over: Partial<EditSignals> = {}): EditSignals => ({
    ownerMarkedBuyerOnly: false, ownerMarkedGlobal: false,
    touchedCommercialTerms: false, phrasingOnly: true,
    productBound: false, timesSeenAcrossBuyers: 1, ...over,
  });

  it('a first-time phrasing edit is one-time — nothing generalizes from one sample', () => {
    expect(classifyEditScope(signals())).toEqual({ scope: 'one_time', needsOwnerConfirm: false });
  });

  it('buyer-specific stays buyer-specific; never global', () => {
    const d = classifyEditScope(signals({ ownerMarkedBuyerOnly: true, timesSeenAcrossBuyers: 5 }));
    expect(d.scope).toBe('buyer_specific');
    expect(d.needsOwnerConfirm).toBe(false);
  });

  it('commercial terms always need the owner to confirm generalization', () => {
    expect(classifyEditScope(signals({ touchedCommercialTerms: true })))
      .toEqual({ scope: 'policy', needsOwnerConfirm: true });
  });

  it('repetition earns wider scope: style at 2, global candidate (confirmed) at 3', () => {
    expect(classifyEditScope(signals({ timesSeenAcrossBuyers: 2 })).scope).toBe('style');
    const g = classifyEditScope(signals({ timesSeenAcrossBuyers: 3 }));
    expect(g.scope).toBe('global_candidate');
    expect(g.needsOwnerConfirm).toBe(true);
  });

  it('the ack never claims learning that did not happen', () => {
    const ctx = { employeeName: '小雅', buyerName: 'Ahmed' };
    const oneTime = learningAck({ scope: 'one_time', needsOwnerConfirm: false }, ctx);
    expect(oneTime).toBe('已按你的修改发送。');
    expect(oneTime).not.toContain('培训');
    expect(oneTime).not.toContain('学');

    const buyerOnly = learningAck({ scope: 'buyer_specific', needsOwnerConfirm: false }, ctx);
    expect(buyerOnly).toContain('只用于Ahmed');
    expect(buyerOnly).toContain('不影响其他买家');

    const confirm = learningAck({ scope: 'policy', needsOwnerConfirm: true }, ctx);
    expect(confirm).toContain('都这样');   // asks, doesn't assume
  });
});

/* ── Spot checks: deterministic selection, low-friction verdicts ─────────── */
describe('M5 · spot checks', () => {
  const work = (id: string, capability: string, wasAuto = true): CompletedWork => ({
    id, capability, buyerMessage: 'q', reply: 'a', wasAuto,
    at: new Date('2026-07-17T00:00:00Z'),
  });

  it('selection is deterministic, budget-capped, capability-spread, auto-first', () => {
    const pool = [work('a', 'greet'), work('b', 'greet'), work('c', 'greet'),
      work('d', 'quote'), work('e', 'quote', false)];
    const first = selectSpotChecks(pool, 3);
    expect(first).toEqual(selectSpotChecks(pool, 3));
    expect(first).toHaveLength(3);
    expect(new Set(first.map((w) => w.capability)).size).toBe(2);
    expect(first.every((w) => w.wasAuto)).toBe(true);   // auto work first
  });

  it('owner replies map to verdicts; substantive text is a correction', () => {
    expect(parseSpotCheckReply('好')).toEqual({ verdict: 'correct', correction: null });
    expect(parseSpotCheckReply('有问题')).toEqual({ verdict: 'serious', correction: null });
    const fix = parseSpotCheckReply('付款条件要写TT 30%定金');
    expect(fix.verdict).toBe('needs_improvement');
    expect(fix.correction).toContain('30%');
  });
});

/* ── Repair lifecycle: completeness before closure ───────────────────────── */
/*
 * M34.8 — the repair-protocol, monthly-review, first-week-journey and pilot-log
 * blocks were deleted with their modules. Each modelled a ritual that no
 * production path ever ran: no repair record was ever written, no review ever
 * rendered, no journey beat ever fired, no pilot entry ever logged.
 *
 * What remains here is what is REACHED: promotion evidence and withdrawal
 * (core/trust/evidence.ts, read by pipeline/capability.ts), the spot-check
 * selector and reply parser (wired in M34.7), and edit scope, which is held
 * pending a decision.
 */
describe('M5 · demo trust scenarios', () => {
  it('is deterministic and idempotent by construction', () => {
    const sql = demoTrustSeedSql();
    expect(sql).toBe(demoTrustSeedSql());
    // EVERY insert is guarded, derived rather than counted: this asserted a
    // literal 4 and broke when the repairs seed was deleted, which is a test
    // measuring the size of the seed instead of the property that matters.
    const inserts = sql.match(/insert into \w+/g) ?? [];
    expect(inserts.length).toBeGreaterThan(0);
    const guards = (sql.match(/where not exists/g) ?? []).length
      + (sql.match(/on conflict \(id\) do nothing/g) ?? []).length;
    expect(guards, 'every seeded insert must be idempotent').toBe(inserts.length);
  });

  it('the demo employee is not perfect: a pause and a failed check', () => {
    expect(demotionDecision(DEMO_PAUSED_EVIDENCE).action).toBe('pause');
    expect(promotionDecision(DEMO_PROMOTED_EVIDENCE).eligible).toBe(true);
    // The repair half went with core/trust/repair.ts — nothing wrote a repair
    // record in production, so the demo no longer seeds one either.
  });
});
