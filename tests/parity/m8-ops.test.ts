import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { effectiveMode, NO_KILL_SWITCHES, type KillSwitches } from '../../src/core/ops/killSwitch.js';
import { PERF_BUDGETS } from '../../src/core/ops/perf.js';
import { DESIGN_TOKENS } from '../../src/core/owner/tokens.js';
import { computeQuote } from '../../src/core/commerce/quote.js';
import { BANNED_OWNER_TERMS } from '../../src/core/owner/vocabulary.js';
import { textWidth } from '../../src/core/owner/components.js';
import { product, tiers, policy } from './fixtures.js';

const T0 = new Date('2026-07-18T08:00:00Z');
const after = (h: number) => new Date(T0.getTime() + h * 3600 * 1000);

/* ── LLM outage: hold, never drop ────────────────────────────────────────── */

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

/*
 * M34.8 — the 30-day arc, the lifecycle sequence and the support/KB surface
 * went with core/ops/arc.ts, core/owner/lifecycle.ts and core/owner/support.ts.
 * None was reachable: no beat was ever derived, no lifecycle message ever sent,
 * no contact page ever served.
 */

/* ── Performance: honest instant ─────────────────────────────────────────── */
describe('M8 · performance budgets', () => {
  it('budgets exist and agree with the motion system', () => {
    expect(PERF_BUDGETS.approvalCardOpenMs).toBeLessThanOrEqual(1000);
    expect(PERF_BUDGETS.rendererMs).toBeLessThanOrEqual(16);
    expect(DESIGN_TOKENS.motionMs.max).toBeLessThanOrEqual(PERF_BUDGETS.approvalCardOpenMs);
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

  it('quote compute is honestly instant: 1000 quotes well under budget, zero LLM', () => {
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      const r = computeQuote({ product: product(), tiers: tiers(), policy: policy(), rules: [], quantity: 5000 + i });
      if (!r.ok) throw new Error('fixture');
    }
    const perQuoteMs = (performance.now() - start) / 1000;
    expect(perQuoteMs).toBeLessThan(PERF_BUDGETS.quoteComputeMs);
  });

  // M34.8 — the 'digest renders within a frame budget' case went with
  // core/owner/digest.ts. PERF_BUDGETS.rendererMs now has no renderer to
  // measure, and inventing an HTML equivalent would be measuring something
  // nobody designed a budget for.
});
