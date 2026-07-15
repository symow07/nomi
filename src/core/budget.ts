/**
 * Tenant budgets. (Priority 5)
 *
 * A noisy tenant degrades only itself: the worker consults this BEFORE the
 * analyzer call — the expensive step — and the check is pure so the policy is
 * testable. Usage rows come from record_usage() (migration 0008), which is
 * also the pricing dataset that cannot be backfilled.
 */

export type Usage = { llmCalls: number; tokens: number };
export type Budget = {
  dailyLlmCalls: number;
  dailyTokens: number;
  softWarnPct: number;                 // e.g. 80
  onExceeded: 'throttle' | 'pause';
};

export type BudgetVerdict =
  | { kind: 'ok' }
  | { kind: 'soft_warn'; pctUsed: number }          // notify owner; keep serving
  | { kind: 'throttle'; retryAfterSeconds: number } // delay this turn, don't drop it
  | { kind: 'pause' };                              // deterministic fallback reply only

export function checkBudget(usage: Usage, budget: Budget): BudgetVerdict {
  const callPct = (100 * usage.llmCalls) / budget.dailyLlmCalls;
  const tokPct = (100 * usage.tokens) / budget.dailyTokens;
  const pctUsed = Math.max(callPct, tokPct);

  if (pctUsed >= 100) {
    return budget.onExceeded === 'pause'
      ? { kind: 'pause' }
      // Throttle spreads the remaining day thinly rather than going dark:
      // exponential-ish backoff proportional to overshoot, capped at 15 min.
      : { kind: 'throttle', retryAfterSeconds: Math.min(900, Math.ceil((pctUsed - 99) * 60)) };
  }
  if (pctUsed >= budget.softWarnPct) return { kind: 'soft_warn', pctUsed: Math.round(pctUsed) };
  return { kind: 'ok' };
}

/** What a paused tenant's customers see. Deterministic; never silent. */
export const BUDGET_PAUSE_REPLY =
  'Thanks for your message — we are experiencing very high volume right now. A member of our team will reply to you personally as soon as possible.';
