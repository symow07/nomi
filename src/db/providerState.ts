import { sql } from 'kysely';
import type { Db, Tx } from './client.js';
import type { BalanceLine, BalancePoint, BalanceStep } from '../core/ops/providerWatch.js';

/**
 * BILLING RESILIENCE (0128) — the model provider's account, as written down.
 * Not tenant data: one provider serves the whole installation, so this is read
 * on the plain connection, through the security-definer functions 0128 grants
 * the app role (it cannot touch the tables themselves).
 */

export type ProviderHealth = {
  readonly refusingSince: Date | null;
  readonly reason: 'billing' | null;
  readonly lastRefusedAt: Date | null;
  readonly refusals: number;
  /** The provider's own words, for the operator only. */
  readonly words: string | null;
  readonly alertsSent: number;
  readonly lastAlertAt: Date | null;
  readonly lastSince: Date | null;
  readonly answeredAgainAt: Date | null;
  readonly recoveryOwed: boolean;
};

const ANSWERING: ProviderHealth = {
  refusingSince: null, reason: null, lastRefusedAt: null, refusals: 0, words: null,
  alertsSent: 0, lastAlertAt: null, lastSince: null, answeredAgainAt: null, recoveryOwed: false,
};

/** Is the provider refusing for billing now? The one fact an owner's page reads. */
export async function providerRefusing(db: Db | Tx): Promise<boolean> {
  return (await sql<{ r: boolean }>`select provider_refusing() as r`.execute(db)).rows[0]?.r === true;
}

export async function providerHealth(db: Db | Tx): Promise<ProviderHealth> {
  const r = (await sql<{
    refusing_since: Date | null; reason: string | null; last_refused_at: Date | null; refusals: number;
    words: string | null; alerts_sent: number; last_alert_at: Date | null;
    last_since: Date | null; answered_again_at: Date | null; recovery_owed: boolean;
  }>`select * from provider_health_now()`.execute(db)).rows[0];
  if (!r) return ANSWERING;
  return {
    refusingSince: r.refusing_since, reason: r.reason === 'billing' ? 'billing' : null,
    lastRefusedAt: r.last_refused_at, refusals: r.refusals, words: r.words,
    alertsSent: r.alerts_sent, lastAlertAt: r.last_alert_at,
    lastSince: r.last_since, answeredAgainAt: r.answered_again_at, recoveryOwed: r.recovery_owed,
  };
}

/** A billing refusal: when the outage began, and whether this one began it. */
export async function recordRefusal(db: Db, words: string): Promise<{ readonly since: Date; readonly began: boolean }> {
  const r = (await sql<{ since: Date; began: boolean }>`
    select since, began from provider_refused('billing', ${words})`.execute(db)).rows[0];
  if (!r) throw new Error('provider_refused() returned nothing');
  return { since: r.since, began: r.began };
}

/** An answer: the outage it ended, or null when there was none. */
export async function recordAnswered(db: Db): Promise<{ readonly since: Date; readonly until: Date } | null> {
  const r = (await sql<{ since: Date; until: Date }>`select since, until from provider_answered()`.execute(db)).rows[0];
  return r ? { since: r.since, until: r.until } : null;
}

export async function claimRefusalAlert(db: Db, step: number, since: Date): Promise<boolean> {
  return (await sql<{ ok: boolean }>`select claim_provider_alert(${step}, ${since}) as ok`.execute(db)).rows[0]?.ok === true;
}

export async function claimRecovery(db: Db): Promise<{ readonly since: Date; readonly until: Date } | null> {
  const r = (await sql<{ since: Date | null; until: Date | null }>`select since, until from claim_provider_recovery()`.execute(db)).rows[0];
  return r?.since && r.until ? { since: r.since, until: r.until } : null;
}

export async function recordBalance(db: Db, available: boolean, line: BalanceLine): Promise<void> {
  await sql`select record_provider_balance(${available}, ${line.currency}, ${line.total}, ${line.granted}, ${line.toppedUp})`.execute(db);
}

export async function balanceHistory(db: Db, since: Date): Promise<readonly BalancePoint[]> {
  const rows = (await sql<{ checked_at: Date; currency: string; total: string }>`
    select checked_at, currency, total::text as total from provider_balance_since(${since})`.execute(db)).rows;
  return rows.map((r) => ({ at: r.checked_at, currency: r.currency, total: Number(r.total) }));
}

export async function claimBalanceAlert(db: Db, step: BalanceStep): Promise<boolean> {
  return (await sql<{ ok: boolean }>`select claim_balance_alert(${step}) as ok`.execute(db)).rows[0]?.ok === true;
}

export async function rearmBalanceAlerts(db: Db, stillTrue: readonly BalanceStep[]): Promise<void> {
  await sql`select rearm_balance_alerts(${[...stillTrue]}::text[])`.execute(db);
}
