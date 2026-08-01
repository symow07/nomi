import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { ownershipOf } from '../../core/conversation/ownership.js';
import { loadKnowledgeOps, type Range } from './knowledge-insights.js';
import { loadChannels } from './channels.js';

/**
 * M16.2a — the Operations read model. A READ-ONLY composition layer that answers
 * "what needs my attention today?" from data other systems already own. It
 * writes nothing, invents nothing, and duplicates no existing loader:
 *   - knowledge gaps/activity → REUSE loadKnowledgeOps (M14)
 *   - channel status          → REUSE loadChannels (M9.4)
 *   - ownership mapping        → REUSE ownershipOf (M16.1)
 * The remaining numbers are plain COUNT(*) over the real queue tables (drafts,
 * conversations, turns). No scores, no percentages, no confidence, no ranking.
 */

export type { Range } from './knowledge-insights.js';
const RANGE_UNIT: Record<Range, 'day' | 'week' | 'month'> = { today: 'day', week: 'week', month: 'month' };

export type OperationsSnapshot = {
  readonly range: Range;
  /** What needs the owner: a human is waiting, drafts await approval, plus
   *  in-progress takeovers (context, not a demand). */
  readonly attention: {
    readonly pendingApprovals: number;   // drafts awaiting the owner
    readonly handoffs: number;           // conversations WAITING_HUMAN (unclaimed)
    readonly ownerHandling: number;      // conversations the owner already controls
  };
  /** What the employee did in the range. */
  readonly activity: {
    readonly handled: number;            // conversations with a processed turn
    readonly draftsCreated: number;
    readonly corrections: number;        // drafts the owner edited before sending
  };
  /** Knowledge health — straight from M14, not recomputed. */
  readonly knowledge: {
    readonly openGaps: number;
    readonly recentCorrections: number;
    readonly recentlyTaught: number;
  };
  readonly channel: { readonly status: string; readonly provider: string };
  /** True when any attention bucket is non-zero — the "you have work" signal. */
  readonly hasAttention: boolean;
};

/**
 * Explicit priority order for the future UI — NO urgency scoring. Each entry is
 * a concern the owner acts on, most-important first. `ownerHandling` and
 * `activity` are context, not demands, so they are not in this list. A real-time
 * "buyer waiting" concern has no honest source until Meta and is omitted rather
 * than invented.
 */
export const ATTENTION_PRIORITY = ['handoffs', 'pendingApprovals', 'openGaps'] as const;
export type AttentionKind = (typeof ATTENTION_PRIORITY)[number];

const EMPTY = (range: Range, provider: string): OperationsSnapshot => ({
  range,
  attention: { pendingApprovals: 0, handoffs: 0, ownerHandling: 0 },
  activity: { handled: 0, draftsCreated: 0, corrections: 0 },
  knowledge: { openGaps: 0, recentCorrections: 0, recentlyTaught: 0 },
  channel: { status: 'not_connected', provider },
  hasAttention: false,
});

export async function loadOperationsSnapshot(
  db: Db, businessIdRaw: string, range: Range, provider = 'disabled',
): Promise<OperationsSnapshot> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return EMPTY(range, provider);
  const B = bid.value;
  const unit = RANGE_UNIT[range];

  // Compose the existing loaders (their own RLS-scoped txns) — no duplicated SQL.
  const [ops, channels, counts] = await Promise.all([
    loadKnowledgeOps(db, businessIdRaw, range),
    loadChannels(db, businessIdRaw, provider !== 'disabled'),
    withTenantTx(db, B, async (tx) => {
      const cutoff = (await sql<{ c: Date }>`
        select (date_trunc(${unit}, now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai') as c
      `.execute(tx)).rows[0]!.c;

      // Ownership counts: map assigned_to through ownershipOf (M16.1) — never
      // hard-code the sentinel semantics in SQL.
      const own = (await sql<{ assigned_to: string | null; n: number }>`
        select assigned_to, count(*)::int as n from conversations
         where business_id = ${B} and is_active group by assigned_to
      `.execute(tx)).rows;
      let handoffs = 0, ownerHandling = 0;
      for (const r of own) {
        const o = ownershipOf(r.assigned_to);
        if (o === 'WAITING_HUMAN') handoffs += r.n;
        else if (o === 'OWNER_CONTROLLED') ownerHandling += r.n;
      }

      const q = (await sql<{ pending: number; handled: number; drafts: number; corrections: number }>`
        select
          (select count(*)::int from drafts where business_id = ${B} and status = 'pending') as pending,
          (select count(distinct conversation_id)::int from turns where business_id = ${B} and created_at >= ${cutoff}) as handled,
          (select count(*)::int from drafts where business_id = ${B} and created_at >= ${cutoff}) as drafts,
          (select count(*)::int from drafts where business_id = ${B} and status = 'edited' and decided_at >= ${cutoff}) as corrections
      `.execute(tx)).rows[0]!;
      return { handoffs, ownerHandling, ...q };
    }),
  ]);

  const attention = { pendingApprovals: counts.pending, handoffs: counts.handoffs, ownerHandling: counts.ownerHandling };
  return {
    range,
    attention,
    activity: { handled: counts.handled, draftsCreated: counts.drafts, corrections: counts.corrections },
    knowledge: {
      openGaps: ops.gaps.length,                    // M14 derived gaps
      recentCorrections: ops.report.answersCorrected, // M14 (owner_corrected in range)
      recentlyTaught: ops.report.factsAdded,          // M14 (owner_confirmed in range)
    },
    channel: { status: channels.whatsapp.status, provider },
    hasAttention: attention.pendingApprovals + attention.handoffs + attention.ownerHandling > 0,
  };
}
