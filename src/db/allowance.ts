import { sql } from 'kysely';
import type { Tx } from './client.js';
import { checkBudget, type Budget, type BudgetVerdict, type Usage } from '../core/budget.js';

/**
 * G3 (0101) — THE DAY'S ALLOWANCE, read once for everyone who asks: the hold
 * (before any model call), the send gate, Today and My business. The numbers
 * come from `allowance_today()`, which answers for the transaction's own
 * business from the workspace that pays — a practice copy spends its owner's
 * allowance (P5) — and `checkBudget` judges them: one rule.
 *
 * A workspace with no budget row has no cap (those made before 0100): its
 * verdict is always `ok`, and its photos are still counted.
 */

/** G3 — catalogue photos read a day, per workspace (the plan's cohort cap). */
export const PHOTO_READS_A_DAY = 20;

export type Allowance = {
  readonly budget: Budget | null;
  readonly usage: Usage;
  readonly photoReads: number;
  readonly verdict: BudgetVerdict;
  /** 0–100 (or past it): the larger of calls and tokens used, as `checkBudget` reckons; null without a cap. */
  readonly pctUsed: number | null;
  /**
   * KS5 (0113) — the installation is past its day's ceiling and this is a beta
   * workspace (it signed itself up): it waits as if its own allowance were
   * used. A pilot never does. Absent: not held.
   */
  readonly breaker?: boolean;
};

const NONE: Allowance = { budget: null, usage: { llmCalls: 0, tokens: 0 }, photoReads: 0, verdict: { kind: 'ok' }, pctUsed: null };

/** Inside a transaction bound to the business (`withTenantTx`): the function answers for that one only. */
export async function allowanceOf(tx: Tx): Promise<Allowance> {
  const r = (await sql<{
    daily_llm_calls: number | null; daily_tokens: string | null; soft_warn_pct: number | null; on_exceeded: string | null;
    used_calls: number; used_tokens: string; photo_reads: number;
  }>`select * from allowance_today()`.execute(tx)).rows[0];
  if (!r) return NONE;
  // KS5 — the installation's ceiling, asked once with the workspace's own.
  const breaker = (await sql<{ h: boolean }>`select spend_breaker_held() as h`.execute(tx)).rows[0]?.h === true;
  const usage: Usage = { llmCalls: Number(r.used_calls), tokens: Number(r.used_tokens) };
  const photoReads = Number(r.photo_reads);
  if (r.daily_llm_calls == null || r.daily_tokens == null || r.on_exceeded == null) {
    return { ...NONE, usage, photoReads, ...(breaker ? { breaker } : {}) };
  }
  const budget: Budget = {
    dailyLlmCalls: Number(r.daily_llm_calls), dailyTokens: Number(r.daily_tokens),
    softWarnPct: Number(r.soft_warn_pct ?? 80), onExceeded: r.on_exceeded === 'pause' ? 'pause' : 'throttle',
  };
  const pctUsed = Math.floor(Math.max(
    (100 * usage.llmCalls) / budget.dailyLlmCalls, (100 * usage.tokens) / budget.dailyTokens));
  return { budget, usage, photoReads, verdict: checkBudget(usage, budget), pctUsed, ...(breaker ? { breaker } : {}) };
}

/** The allowance renews when the ledger's day turns: the next midnight UTC. */
export const allowanceRenewsAt = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

/** True when the day's allowance is used and the cap holds — or the installation's breaker holds (KS5): no model is asked. */
export const allowanceUsed = (a: Allowance): boolean => a.verdict.kind === 'pause' || a.breaker === true;
