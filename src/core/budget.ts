/**
 * Tenant budgets. (Priority 5)
 *
 * A noisy tenant degrades only itself. The check is pure so the policy is
 * testable, and usage rows come from record_usage() (migration 0008), which is
 * also the pricing dataset that cannot be backfilled.
 *
 * ── M51.2 · WHY THIS WAS IN LIMBO, AND HOW IT WAS RESOLVED ───────────────
 *
 * It was written, tested, and never called — while `db/channels.ts`
 * re-implemented its pause rule in SQL, inside the lateral that feeds the send
 * gate. The same policy in two places, one enforced and one merely tested:
 * this repository's most expensive recurring defect, sitting in the open.
 *
 * The SQL now reads the NUMBERS and `checkBudget` makes the judgement, so
 * there is one rule and the tested copy is the one that runs.
 *
 * ── WHAT WAS NOT WIRED, AND WHY ──────────────────────────────────────────
 *
 * The header used to promise that "the worker consults this BEFORE the
 * analyzer call". It does not, deliberately. Skipping the turn would save the
 * tokens and cost the owner her record of it: the outbound row is what carries
 * `cancel_reason = 'paused'`, and that row is what the M22 refusal surface
 * renders as what happened / why / what to do. A saving that makes a held
 * message invisible to her is not a saving.
 *
 * `BUDGET_PAUSE_REPLY` was deleted with it. It read: "we are experiencing very
 * high volume right now… a member of our team will reply to you personally as
 * soon as possible." Both halves are inventions — she hit a ceiling SHE set,
 * which is not high volume, and nobody promised the buyer a personal reply.
 * A product whose moat is refusing to guess cannot ship a sentence like that
 * as a fallback. Silence to the buyer and a refusal card for the owner is the
 * honest pair, and it is what already happens.
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
