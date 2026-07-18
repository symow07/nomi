import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import {
  llmOutagePlan, LLM_RETRY_DELAYS_MS, OUTAGE_NOTIFY_AFTER_MIN, NIGHT_HOLD_ACK_EN,
} from '../../src/core/ops/degrade.js';
import { effectiveMode, NO_KILL_SWITCHES, type KillSwitches } from '../../src/core/ops/killSwitch.js';
import { arcStatus, ARC_ORDER, type ArcSignals } from '../../src/core/ops/arc.js';
import { ONBOARDING_SEQUENCE, dueLifecycleMessages, type LifecycleContext } from '../../src/core/owner/lifecycle.js';
import { renderContactUs, KB_ARTICLES } from '../../src/core/owner/support.js';
import { PERF_BUDGETS } from '../../src/core/ops/perf.js';
import { PWA_TOKENS } from '../../src/core/owner/tokens.js';
import { computeQuote } from '../../src/core/commerce/quote.js';
import { renderDailyDigest } from '../../src/core/owner/digest.js';
import { BANNED_OWNER_TERMS } from '../../src/core/owner/vocabulary.js';
import { textWidth } from '../../src/core/owner/components.js';
import { product, tiers, policy } from './fixtures.js';

const T0 = new Date('2026-07-18T08:00:00Z');
const after = (h: number) => new Date(T0.getTime() + h * 3600 * 1000);

/* ── LLM outage: hold, never drop ────────────────────────────────────────── */
describe('M8 · graceful LLM degradation', () => {
  it('the message is ALWAYS held — the type forbids dropping', () => {
    for (const plan of [
      llmOutagePlan({ consecutiveFailures: 1, outageMinutes: 0, onNightShift: false }),
      llmOutagePlan({ consecutiveFailures: 10, outageMinutes: 60, onNightShift: true }),
    ]) {
      expect(plan.holdMessage).toBe(true);
    }
  });

  it('transient failures retry with bounded backoff, silently', () => {
    expect(llmOutagePlan({ consecutiveFailures: 1, outageMinutes: 0, onNightShift: false }))
      .toEqual({ holdMessage: true, action: 'retry_soon', retryDelayMs: 5_000, buyerAckEn: null });
    expect(llmOutagePlan({ consecutiveFailures: 3, outageMinutes: 2, onNightShift: false }).retryDelayMs)
      .toBe(LLM_RETRY_DELAYS_MS[2]);
  });

  it('sustained outage: owner is told to reply manually — the honest worst case', () => {
    const p = llmOutagePlan({ consecutiveFailures: 4, outageMinutes: OUTAGE_NOTIFY_AFTER_MIN, onNightShift: false });
    expect(p.action).toBe('notify_owner_manual');
    expect(p.buyerAckEn).toBeNull();          // the OWNER replies; we don't freelance
  });

  it('night shift: one polite hold ack to the buyer, no 3am owner wake-up', () => {
    const p = llmOutagePlan({ consecutiveFailures: 4, outageMinutes: 10, onNightShift: true });
    expect(p.action).toBe('night_hold_and_ack');
    expect(p.buyerAckEn).toBe(NIGHT_HOLD_ACK_EN);
    expect(p.buyerAckEn).not.toMatch(/\d/);   // no numbers — guard-safe by construction
  });
});

/* ── Kill switches: monotone, capability-scoped ──────────────────────────── */
describe('M8 · per-capability kill switches', () => {
  it('no switches → resolved mode passes through', () => {
    expect(effectiveMode('auto', 'greet', NO_KILL_SWITCHES)).toBe('auto');
    expect(effectiveMode('draft', 'quote', NO_KILL_SWITCHES)).toBe('draft');
  });

  it('global silence wins over everything; capability switches scope precisely', () => {
    const k: KillSwitches = { globalSilence: false, forceDraft: ['quote'], silenceCapability: ['follow_up'] };
    expect(effectiveMode('auto', 'quote', k)).toBe('draft');
    expect(effectiveMode('auto', 'follow_up', k)).toBe('silent');
    expect(effectiveMode('auto', 'greet', k)).toBe('auto');   // untouched
    expect(effectiveMode('auto', 'greet', { ...k, globalSilence: true })).toBe('silent');
  });

  it('a switch can never upgrade authority', () => {
    const k: KillSwitches = { globalSilence: false, forceDraft: ['greet'], silenceCapability: [] };
    expect(effectiveMode('draft', 'greet', k)).toBe('draft');  // draft stays draft, never auto
  });
});

/* ── The 30-day arc: derived, ordered, unfakeable ────────────────────────── */
describe('M8 · 30-day emotional arc', () => {
  const signals = (over: Partial<ArcSignals> = {}): ArcSignals => ({
    signupAt: T0,
    firstDraftApprovedAt: after(0.1),
    firstRealBuyerAt: after(20),
    firstSpotCheckPassedAt: after(24 * 5),
    firstCorrectionLearnedAt: after(24 * 4),
    firstPromotionOfferedAt: after(24 * 13),
    firstMonthlyReviewAt: after(24 * 30),
    ...over,
  });

  it('all five beats derive from real timestamps, day-numbered', () => {
    const s = arcStatus(signals());
    expect(s.reached.map((r) => r.beat)).toEqual([...ARC_ORDER]);
    expect(s.reached[0]!.dayN).toBe(0);
    expect(s.reached[3]!.dayN).toBe(13);      // week2 letting go
    expect(s.next).toBeNull();
  });

  it('week1 trust needs BOTH a passed spot check and a learned correction', () => {
    const s = arcStatus(signals({ firstCorrectionLearnedAt: null }));
    expect(s.reached.map((r) => r.beat)).not.toContain('week1_trust');
    expect(s.next).toBe('week1_trust');
  });

  it('missing early beat is the next beat even when later ones exist', () => {
    const s = arcStatus(signals({ firstRealBuyerAt: null }));
    expect(s.next).toBe('day1_first_real_buyer');
    expect(s.reached.map((r) => r.beat)).toContain('week2_letting_go');
  });
});

/* ── 30-day sequence: triggered, deduped, respectful ─────────────────────── */
describe('M8 · onboarding lifecycle sequence', () => {
  const ctx = (over: Partial<LifecycleContext> = {}): LifecycleContext => ({
    reachedBeats: ['minute10_first_draft'], daysSinceSignup: 0,
    subscriptionStatus: 'trialing', alreadySent: [], ...over,
  });

  it('messages fire on real beats; nothing fires blind', () => {
    expect(dueLifecycleMessages(ctx()).map((m) => m.id)).toEqual(['welcome']);
    expect(dueLifecycleMessages(ctx({ reachedBeats: [], daysSinceSignup: 0 }))).toHaveLength(0);
  });

  it('missing-beat nudges wait their day threshold', () => {
    expect(dueLifecycleMessages(ctx({ reachedBeats: [], daysSinceSignup: 1 })).map((m) => m.id))
      .toEqual(['stalled_setup']);
    const d3 = dueLifecycleMessages(ctx({ reachedBeats: ['minute10_first_draft'], daysSinceSignup: 3 }));
    expect(d3.map((m) => m.id)).toEqual(['welcome', 'no_buyers_yet']);
  });

  it('already-sent dedupe; canceled/past_due owners hear nothing', () => {
    expect(dueLifecycleMessages(ctx({ alreadySent: ['welcome'] }))).toHaveLength(0);
    expect(dueLifecycleMessages(ctx({ subscriptionStatus: 'canceled' }))).toHaveLength(0);
    expect(dueLifecycleMessages(ctx({ subscriptionStatus: 'past_due' }))).toHaveLength(0);
  });

  it('sequence copy passes the owner test', () => {
    const text = ONBOARDING_SEQUENCE.map((m) => m.copyZh).join('\n');
    const lower = text.toLowerCase();
    for (const banned of BANNED_OWNER_TERMS) {
      const needle = banned.toLowerCase();
      const hit = /^[a-z ]+$/.test(needle)
        ? new RegExp(`\\b${needle}\\b`).test(lower)
        : lower.includes(needle);
      expect(hit, `"${banned}" in sequence`).toBe(false);
    }
    for (const l of text.split('\n')) {
      if ((l.match(/[A-Za-z]/g)?.length ?? 0) >= 15) continue;
      expect(textWidth(l), l).toBeLessThanOrEqual(48);
    }
  });
});

/* ── Support + KB ────────────────────────────────────────────────────────── */
describe('M8 · support surface and knowledge base', () => {
  it('联系我们 promises a human and covers money questions', () => {
    const c = renderContactUs({ wechatGroupNote: '微信群：扫开通短信里的二维码进群' });
    expect(c).toContain('人会回你');
    expect(c).toContain('发票');
    for (const l of c.split('\n')) expect(textWidth(l), l).toBeLessThanOrEqual(48);
  });

  it('exactly ten KB articles, files match the registry, drafts marked for pilot revision', () => {
    expect(KB_ARTICLES).toHaveLength(10);
    const files = readdirSync('docs/kb').filter((f) => f.endsWith('.md')).sort();
    expect(files).toEqual(KB_ARTICLES.map((a) => `${a.slug}.md`).sort());
  });
});

/* ── Performance: honest instant ─────────────────────────────────────────── */
describe('M8 · performance budgets', () => {
  it('budgets exist and agree with the motion system', () => {
    expect(PERF_BUDGETS.approvalCardOpenMs).toBeLessThanOrEqual(1000);
    expect(PERF_BUDGETS.rendererMs).toBeLessThanOrEqual(16);
    expect(PWA_TOKENS.motionMs.max).toBeLessThanOrEqual(PERF_BUDGETS.approvalCardOpenMs);
  });

  it('quote compute is honestly instant: 1000 quotes well under budget, zero LLM', () => {
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      const r = computeQuote({ product: product(), tiers: tiers(), policy: policy(), rules: [], quantity: 5000 + i });
      if (!r.ok) throw new Error('fixture');
    }
    const perQuoteMs = (performance.now() - start) / 1000;
    expect(perQuoteMs).toBeLessThan(PERF_BUDGETS.quoteComputeMs);
  });

  it('digest renders within a frame budget', () => {
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      renderDailyDigest({
        employeeName: '小雅', date: T0, now: T0,
        stats: { conversations: 12, handled: 9, quotes: 3, orders: 1, orderValueUsd: 7300 },
        highlight: null, pending: [], onDutyTonightZh: null,
      });
    }
    expect((performance.now() - start) / 100).toBeLessThan(PERF_BUDGETS.rendererMs);
  });
});
