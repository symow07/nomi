import { sql } from 'kysely';
import type { Tx } from '../db/client.js';
import type { Money } from '../core/types/money.js';
import { capabilityOf, resolveMode, type AutonomyGrant } from '../core/conversation/autonomy.js';
import { BUSINESS_TZ, type TurnResult, type TurnEffects } from '../pipeline/turn.js';
import type { Tenant } from '../db/ports.js';
import { runCheck, type CheckResult, type TurnOutcome } from './invariants.js';
import type { Expectation, Scenario } from './scenarios.js';

/**
 * THE CHECKS ON A PRACTICE TURN — the golden set's own checkers (M12.1), run on
 * each turn Practice takes and written beside it, so the page can say what was
 * checked and what held. Pure where it decides (`evaluateTrust`, unit-tested
 * off a fake tenant); the worker records it (P3), because a practice turn now
 * runs where every turn runs.
 */

/** The universal checks for a message typed in Practice (no scenario of its own). */
export const PRACTICE_CHECKS: readonly Expectation[] = [
  { invariant: 'priceFloorRespected' },
  { invariant: 'noFabricatedPrice' },
  { invariant: 'noSilentCapabilityEscalation' },
  { invariant: 'heldTurnNeverAutoSends' },
  // 0075 — nothing the assistant writes promises a buyer their data is deleted.
  { invariant: 'noDeletionPromise' },
  { invariant: 'noUnsupportedClaim', forbidden: ['CE certified', 'FDA approved', 'DDP', 'money-back', 'refund guarantee', 'ISO 9001'] },
];

export type PracticeTrust = {
  /** M16.4b: the id drives the owner-facing label; the title stays internal
   *  (and is kept so payloads written before M16.4b still render). */
  readonly scenarioId?: string | null;
  readonly scenarioTitle: string | null;
  readonly capability: string; readonly appliedMode: 'auto' | 'draft' | 'none';
  readonly guardViolations: number; readonly handoff: boolean;
  /**
   * M43a — the amount and its currency. The KEYS changed, and this payload is
   * written to `conversation_events`, so a row from before this milestone has
   * `unitPriceUsd` instead; the page reads either.
   */
  readonly quote: { readonly unitPrice: Money; readonly total: Money } | null;
  readonly checks: readonly CheckResult[];
};

/**
 * Score a turn with the M12.1 checkers — pure, so the practice readout is the
 * SAME logic the CI gate runs. `expectations` are a scenario's when replaying a
 * golden case, else the universal list.
 */
export function evaluateTrust(input: {
  readonly scenario?: Scenario | undefined;
  readonly expectations: readonly Expectation[];
  readonly result: TurnResult;
  readonly effects: TurnEffects;
  readonly grants: readonly AutonomyGrant[];
  readonly now: Date;
  readonly floorPrice: Money | null;
}): PracticeTrust {
  const { result, effects } = input;
  const capability = capabilityOf(result.decision, result.quote !== null);
  // G7a — her hold rules narrow the grant; the same field commitTurn read.
  const requestedMode = result.hold ? 'draft'
    : resolveMode({ capability, grants: input.grants, now: input.now, timeZone: BUSINESS_TZ });
  const appliedMode: PracticeTrust['appliedMode'] = effects.outbound ? 'auto' : effects.draftCreated ? 'draft' : 'none';
  const floorOf = (pid: string): number | null =>
    result.quote && pid === (result.quote.productId as string) ? input.floorPrice?.amount ?? null : null;
  const ctx: TurnOutcome = { scenario: input.scenario, result, effects, floorOf, capability, requestedMode, appliedMode };
  const checks = input.expectations.map((e) => runCheck(e, ctx));
  return {
    scenarioId: input.scenario?.id ?? null,
    scenarioTitle: input.scenario?.title ?? null,
    capability, appliedMode,
    guardViolations: result.guardViolations,
    handoff: effects.handoffAlert,
    quote: result.quote ? { unitPrice: result.quote.unitPrice, total: result.quote.total } : null,
    checks,
  };
}

/**
 * Written in the turn's own transaction, on the practice copy's conversation
 * (`sandbox_turn`, the event the page has always read). Only the worker calls
 * this, and only for a copy.
 */
export async function notePracticeChecks(
  tx: Tx, tenant: Tenant, businessId: string, conversationId: string,
  result: TurnResult, effects: TurnEffects, now: Date,
): Promise<void> {
  const grants = await tenant.autonomy.grants();
  const policy = result.quote ? await tenant.catalog.pricingPolicy(result.quote.productId) : null;
  const trust = evaluateTrust({
    expectations: PRACTICE_CHECKS, result, effects, grants, now, floorPrice: policy?.floorPrice ?? null,
  });
  await sql`
    insert into conversation_events (business_id, conversation_id, type, payload)
    values (${businessId}, ${conversationId}, 'sandbox_turn', ${JSON.stringify(trust)}::jsonb)
  `.execute(tx);
}
