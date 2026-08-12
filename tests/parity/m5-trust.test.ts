import { describe, it, expect } from 'vitest';
import {
  promotionDecision, demotionDecision, applySpotCheck,
  PROMOTION_REQUIREMENTS, CORRECTIONS_THRESHOLD, type CapabilityEvidence,
} from '../../src/core/trust/evidence.js';
import { classifyEditScope, learningAck, type EditSignals } from '../../src/core/trust/editScope.js';
import { selectSpotChecks, parseSpotCheckReply, type CompletedWork } from '../../src/core/trust/spotCheck.js';
import { nextRepairStep, canClose, type RepairRecord } from '../../src/core/trust/repair.js';
import { computeReview, type ReviewStats } from '../../src/core/trust/review.js';
import { FIRST_WEEK, nextJourneyBeat, journeyInOrder } from '../../src/core/trust/journey.js';
import { PilotEntry, triageOrder, renderTriage, PILOT_EVENT_KINDS } from '../../src/pilot/log.js';
import { DEMO_JOURNEY, DEMO_MONTH_STATS, DEMO_PROMOTED_EVIDENCE, DEMO_PAUSED_EVIDENCE, DEMO_REPAIR, demoTrustSeedSql } from '../../src/demo/trust.js';

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
describe('M5 · repair protocol', () => {
  const base: RepairRecord = { ...DEMO_REPAIR, id: 'r1' };

  it('a buyer-facing mistake demands containment before anything else', () => {
    expect(nextRepairStep({ ...base, status: 'open', containment: 'none_needed' })).toBe('stop_auto');
  });

  it('the full path: prepare → owner → send → confirm → learn → verify → done', () => {
    let r: RepairRecord = { ...base, status: 'open', correctedDraft: null,
      correctionApproved: false, correctionSent: false, correctionDelivered: false,
      learnedZh: null, verifiedAt: null };
    expect(nextRepairStep(r)).toBe('prepare_correction');
    r = { ...r, correctedDraft: 'fix' };
    expect(nextRepairStep(r)).toBe('await_owner');
    r = { ...r, correctionApproved: true };
    expect(nextRepairStep(r)).toBe('send_correction');
    r = { ...r, correctionSent: true };
    expect(nextRepairStep(r)).toBe('confirm_delivery');
    r = { ...r, correctionDelivered: true };
    expect(nextRepairStep(r)).toBe('record_learning');
    r = { ...r, learnedZh: '学到了' };
    expect(nextRepairStep(r)).toBe('verify');
    r = { ...r, verifiedAt: new Date() };
    expect(nextRepairStep(r)).toBe('done');
    expect(canClose(r)).toBe(true);
  });

  it('cannot close with missing steps — completeness is structural', () => {
    expect(canClose({ ...base, status: 'open', learnedZh: null })).toBe(false);
    expect(canClose({ ...base, status: 'open', correctionDelivered: false })).toBe(false);
  });
});

/* ── Monthly review: arithmetic + fixed outcomes ─────────────────────────── */
describe('M5 · monthly review calculations', () => {
  it('demo month: edit ratio, auto share, hours, improving, outcome', () => {
    const c = computeReview(DEMO_MONTH_STATS);
    expect(c.editRatio).toBeCloseTo(6 / 37, 5);
    expect(c.autoShare).toBeCloseTo(22 / 59, 5);
    expect(c.improving).toBe(true);              // 0.162 < 0.24
    expect(c.minutesSavedEstimate).toBe((31 + 22) * 3);
    expect(c.outcome).toBe('有进步，建议继续观察');
  });

  it('open repairs or failed-heavy spot checks force the withdrawal outcome', () => {
    const c = computeReview({ ...DEMO_MONTH_STATS, repairsClosed: 0 });
    expect(c.outcome).toBe('某项职责建议暂时收回');
  });

  it('high edit ratio → 需要加强培训; stable clean month → 表现稳定', () => {
    expect(computeReview({ ...DEMO_MONTH_STATS, draftsEdited: 20, previousEditRatio: null }).outcome)
      .toBe('需要加强培训');
    expect(computeReview({ ...DEMO_MONTH_STATS, previousEditRatio: null }).outcome)
      .toBe('表现稳定，可以继续');
  });
});

/* ── First-week journey ──────────────────────────────────────────────────── */
describe('M5 · first-week journey', () => {
  it('seven days, seven beats, in the defined order', () => {
    expect(FIRST_WEEK).toHaveLength(7);
    expect(FIRST_WEEK.map((d) => d.day)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('the demo journey is complete and correctly sequenced', () => {
    expect(journeyInOrder(DEMO_JOURNEY)).toBe(true);
    expect(nextJourneyBeat(DEMO_JOURNEY)).toBeNull();
  });

  it('beats are event-driven: the next beat waits for its real event', () => {
    const partial = DEMO_JOURNEY.slice(0, 2);
    expect(nextJourneyBeat(partial)?.beat).toBe('first_night_shift');
    expect(journeyInOrder([...partial].reverse())).toBe(true);   // order by time, not array
  });
});

/* ── Pilot log ───────────────────────────────────────────────────────────── */
describe('M5 · pilot log system', () => {
  const entry = (over: object) => PilotEntry.parse({
    at: '2026-07-20T10:00:00Z', owner: '王老板', surface: '审批卡',
    kind: 'hesitated_before_approval', event: '盯着卡片12秒才点发送',
    severity: 2, trustImpact: -1, ...over,
  });

  it('covers all 19 observation kinds from the spec', () => {
    expect(PILOT_EVENT_KINDS).toHaveLength(19);
    for (const k of PILOT_EVENT_KINDS) expect(() => entry({ kind: k })).not.toThrow();
  });

  it('triage: blockers first, then severity, then trust damage', () => {
    const list = [
      entry({ event: 'minor', severity: 1, trustImpact: 1 }),
      entry({ event: 'blocker', severity: 1, trustImpact: 0, blocksLaunch: true }),
      entry({ event: 'severe', severity: 3, trustImpact: -2 }),
    ];
    const order = triageOrder(list).map((e) => e.event);
    expect(order).toEqual(['blocker', 'severe', 'minor']);
    expect(renderTriage(list)).toContain('[BLOCKER]');
  });
});

/* ── Demo trust seed ─────────────────────────────────────────────────────── */
describe('M5 · demo trust scenarios', () => {
  it('is deterministic and idempotent by construction', () => {
    const sql = demoTrustSeedSql();
    expect(sql).toBe(demoTrustSeedSql());
    // identity-PK inserts are guarded; uuid inserts use on conflict
    expect(sql.match(/where not exists/g)!.length).toBe(2);
    expect(sql.match(/on conflict \(id\) do nothing/g)!.length).toBe(4);
  });

  it('the demo employee is not perfect: a pause, a failed check, a repair', () => {
    expect(demotionDecision(DEMO_PAUSED_EVIDENCE).action).toBe('pause');
    expect(promotionDecision(DEMO_PROMOTED_EVIDENCE).eligible).toBe(true);
    expect(DEMO_REPAIR.buyerReceivedMistake).toBe(true);
    expect(canClose(DEMO_REPAIR)).toBe(true);
  });
});
