import { sql } from 'kysely';
import { withTenantTx, type Db, type Tx } from '../db/client.js';
import { parseBusinessId } from '../core/types/ids.js';
import type { Capability } from '../core/conversation/autonomy.js';
import type { CapabilityEvidence } from '../core/trust/evidence.js';

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

export async function loadCapabilityEvidence(tx: Tx, capability: string): Promise<CapabilityEvidence> {
  const d = (await sql<{ handled: number; approved: number; edited: number; recent: number }>`
    select count(*) filter (where status in ('approved','edited'))::int as handled,
           count(*) filter (where status = 'approved')::int as approved,
           count(*) filter (where status = 'edited')::int as edited,
           count(*) filter (where status = 'edited' and decided_at >= now() - interval '7 days')::int as recent
      from drafts where capability = ${capability}`.execute(tx)).rows[0]!;
  const s = (await sql<{ passed: number; failed: number; serious: number }>`
    select count(*) filter (where verdict = 'correct')::int as passed,
           count(*) filter (where verdict = 'needs_improvement')::int as failed,
           count(*) filter (where verdict = 'serious')::int as serious
      from spot_checks where capability = ${capability}`.execute(tx)).rows[0]!;
  const days = (await sql<{ d: number }>`
    select coalesce(floor(extract(epoch from now() - min(created_at)) / 86400), 0)::int as d
      from drafts where capability = ${capability}`.execute(tx)).rows[0]!.d;
  return {
    capability: capability as Capability,
    handled: d.handled, approvedNoEdit: d.approved, edited: d.edited,
    spotChecksPassed: s.passed, spotChecksFailed: s.failed, spotChecksSerious: s.serious,
    policyViolations: 0, hallucinationAttempts: 0,
    daysSupervised: days, recentCorrections: d.recent, trainingExamples: d.edited,
  };
}

/** confirm_order is permanently the owner's — never promotable. */
export const NON_PROMOTABLE: readonly string[] = ['confirm_order'];

async function changeMode(
  db: Db, businessIdRaw: string, capability: string,
  toMode: 'auto' | 'draft', action: string, reason: string, actor: string,
): Promise<{ ok: boolean; messageZh: string }> {
  if (NON_PROMOTABLE.includes(capability) && toMode === 'auto') {
    return { ok: false, messageZh: '确认订单永远由你来，不能放权。' };
  }
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { ok: false, messageZh: '操作失败。' };
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
  return { ok: true, messageZh: toMode === 'auto' ? '已放权，这类事她可以自己做了，随时可以收回。' : '已收回，这项以后先等你确认。' };
}

export const promoteCapability = (db: Db, biz: string, cap: string, actor: string) =>
  changeMode(db, biz, cap, 'auto', 'promote', 'owner_granted', actor);
export const revokeCapability = (db: Db, biz: string, cap: string, actor: string) =>
  changeMode(db, biz, cap, 'draft', 'pause', 'owner_revoked', actor);
