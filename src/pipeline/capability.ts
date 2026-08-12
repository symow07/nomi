import { sql } from 'kysely';
import { withTenantTx, type Db, type Tx } from '../db/client.js';
import { parseBusinessId } from '../core/types/ids.js';
import type { Capability } from '../core/conversation/autonomy.js';
import type { CapabilityEvidence, DemotionAction, DemotionDecision } from '../core/trust/evidence.js';

/**
 * M9.6 — the ONE capability-authority service, reusing the existing tables
 * (autonomy_policy + capability_events). Promote/revoke are the M5 model
 * "autonomy is granted, never taken" finally wired to an owner action — not
 * a second trust system. The same insert pattern as applyOwnerCommand's 收回.
 *
 * loadCapabilityEvidence derives CapabilityEvidence from existing rows
 * (drafts + spot_checks) so promotionDecision can gate the "增加职责" offer —
 * no invented metrics.
 */

/**
 * M34.9 — FRESH EVIDENCE ONLY.
 *
 * After an automatic demotion, re-promotion must be earned again from scratch:
 * every count below is filtered to work done SINCE the most recent demotion of
 * that capability. The stricter of the two defensible readings — the other was
 * to reset only the spot-check counters — because a capability demoted for
 * inventing a number should not be re-promoted on the strength of the fifteen
 * approvals that preceded the invention. `evidence.ts` already says it: "a
 * policy violation zeroes the case — trust restarts from evidence, not apology".
 *
 * Nothing is deleted to achieve it. The demotion row in `capability_events` is
 * the watermark, so the history stays intact and the rule is a WHERE clause —
 * which also means the app role never needs a DELETE it does not have.
 */
export async function demotedSince(tx: Tx, capability: string): Promise<Date | null> {
  const r = await sql<{ at: Date | null }>`
    select max(at) as at from capability_events
     where capability = ${capability}
       and action in ('pause', 'return_to_learning', 'withdraw')`.execute(tx);
  return r.rows[0]?.at ?? null;
}

export async function loadCapabilityEvidence(tx: Tx, capability: string): Promise<CapabilityEvidence> {
  const since = await demotedSince(tx, capability);
  // `since ?? '-infinity'` keeps one query shape: an undemoted capability counts
  // everything, a demoted one counts only what came after.
  const from = since ?? new Date(0);

  const d = (await sql<{ handled: number; approved: number; edited: number; recent: number }>`
    select count(*) filter (where status in ('approved','edited'))::int as handled,
           count(*) filter (where status = 'approved')::int as approved,
           count(*) filter (where status = 'edited')::int as edited,
           count(*) filter (where status = 'edited' and decided_at >= now() - interval '7 days')::int as recent
      from drafts where capability = ${capability} and decided_at >= ${from}`.execute(tx)).rows[0]!;
  const s = (await sql<{ passed: number; failed: number; serious: number }>`
    select count(*) filter (where verdict = 'correct')::int as passed,
           count(*) filter (where verdict = 'needs_improvement')::int as failed,
           count(*) filter (where verdict = 'serious')::int as serious
      from spot_checks where capability = ${capability} and answered_at >= ${from}`.execute(tx)).rows[0]!;
  const days = (await sql<{ d: number }>`
    select coalesce(floor(extract(epoch from now() - min(created_at)) / 86400), 0)::int as d
      from drafts where capability = ${capability} and created_at >= ${from}`.execute(tx)).rows[0]!.d;

  // Guard violations recorded since the same watermark. Was hardcoded 0, which
  // meant demotionDecision could never see the one thing it treats as fatal.
  const v = (await sql<{ n: number }>`
    select count(*)::int as n from conversation_events
     where type = 'guard_violation' and payload->>'capability' = ${capability}
       and created_at >= ${from}`.execute(tx)).rows[0]!;

  return {
    capability: capability as Capability,
    handled: d.handled, approvedNoEdit: d.approved, edited: d.edited,
    spotChecksPassed: s.passed, spotChecksFailed: s.failed, spotChecksSerious: s.serious,
    policyViolations: v.n, hallucinationAttempts: 0,
    daysSupervised: days, recentCorrections: d.recent, trainingExamples: d.edited,
  };
}

/** confirm_order is permanently the owner's — never promotable. */
export const NON_PROMOTABLE: readonly string[] = ['confirm_order'];

/** Neutral result code (ADR-0008); the route localizes the flash. */
export type CapabilityFlash = 'promoted' | 'revoked' | 'confirm_order_blocked' | 'failed';

async function changeMode(
  db: Db, businessIdRaw: string, capability: string,
  toMode: 'auto' | 'draft', action: string, reason: string, actor: string,
): Promise<{ ok: boolean; code: CapabilityFlash }> {
  if (NON_PROMOTABLE.includes(capability) && toMode === 'auto') {
    return { ok: false, code: 'confirm_order_blocked' };
  }
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { ok: false, code: 'failed' };
  await withTenantTx(db, bid.value, async (tx) => {
    const cur = (await sql<{ mode: string }>`
      select mode from autonomy_policy where business_id = ${bid.value} and capability = ${capability}`.execute(tx)).rows[0];
    const fromMode = cur?.mode === 'auto' ? 'auto' : 'draft';
    await sql`
      insert into autonomy_policy (business_id, capability, mode) values (${bid.value}, ${capability}, ${toMode})
      on conflict (business_id, capability) do update set mode = ${toMode}, updated_at = now()`.execute(tx);
    await sql`
      insert into capability_events (business_id, capability, action, from_mode, to_mode, reasons, actor)
      values (${bid.value}, ${capability}, ${action}, ${fromMode}, ${toMode}, array[${reason}], ${actor})`.execute(tx);
  });
  return { ok: true, code: toMode === 'auto' ? 'promoted' : 'revoked' };
}

export const promoteCapability = (db: Db, biz: string, cap: string, actor: string) =>
  changeMode(db, biz, cap, 'auto', 'promote', 'owner_granted', actor);
export const revokeCapability = (db: Db, biz: string, cap: string, actor: string) =>
  changeMode(db, biz, cap, 'draft', 'pause', 'owner_revoked', actor);

/**
 * M34.9 — she demotes HERSELF.
 *
 * TRUST-PLAYBOOK.md described this and nothing implemented it: "any guard fires
 * in auto mode → that capability drops to draft", announced. Until M34.7 it was
 * harmless, because nothing could be promoted and so nothing could need
 * demoting. Promotion works now, and a ladder that only goes up is not
 * reversible autonomy — it is autonomy with the brakes described in a document.
 *
 * MONOTONE IN THE SAFE DIRECTION, structurally: `toMode` is the literal
 * 'draft'. There is no branch, no parameter and no evidence value that lets this
 * function grant authority. That is the same shape as `effectiveMode`, and it is
 * why demotion can run automatically while promotion still waits for the owner.
 *
 * Runs INSIDE the caller's transaction: the demotion and the thing that caused
 * it commit together or not at all. A guard violation recorded without the
 * demotion it triggered would be the worst of both.
 */
export async function autoDemote(
  tx: Tx,
  businessId: string,
  capability: string,
  decision: DemotionDecision,
  evidence: CapabilityEvidence,
): Promise<{ demoted: boolean; action: DemotionAction }> {
  if (decision.action === 'none') return { demoted: false, action: 'none' };

  // Only a capability currently in auto can be demoted. A draft capability is
  // already at the floor, and writing an event that changes nothing would put
  // noise in the one timeline the owner reads to understand her.
  const cur = (await sql<{ mode: string }>`
    select mode from autonomy_policy
     where business_id = ${businessId}::uuid and capability = ${capability}`.execute(tx)).rows[0];
  if (cur?.mode !== 'auto') return { demoted: false, action: 'none' };

  await sql`
    update autonomy_policy set mode = 'draft', updated_at = now()
     where business_id = ${businessId}::uuid and capability = ${capability}`.execute(tx);
  await sql`
    insert into capability_events (business_id, capability, action, from_mode, to_mode, reasons, evidence, actor)
    values (${businessId}::uuid, ${capability}, ${decision.action}, 'auto', 'draft',
            ${sql.raw(`array[${decision.reasons.map((r) => `'${r}'`).join(',') || `''`}]::text[]`)},
            ${JSON.stringify(evidence)}::jsonb, 'system_self_demoted')`.execute(tx);
  return { demoted: true, action: decision.action };
}
