import { sql } from 'kysely';
import type { Tx } from '../db/client.js';
import {
  selectSpotChecks, parseSpotCheckReply, SPOT_CHECKS_PER_WEEK,
  type CompletedWork, type SpotCheckVerdict,
} from '../core/trust/spotCheck.js';

/**
 * M34.7 — the producer for 抽查.
 *
 * THE DEFECT. `spot_checks` had a table, an RLS policy, a selector, a reply
 * parser, a read model that renders the results, and a promotion rule that
 * counts them. What it had no writer. The only INSERT anywhere was
 * `demo/trust.ts`, the seed — so the demo employee had a spot-check history and
 * every real factory had none, forever. `promotionDecision` returns
 * `more_spot_checks` until 2–4 have passed, so no capability in a real tenant
 * could ever be promoted, and `/app/employee` rendered a "passed a spot check"
 * condition that could only read false.
 *
 * WHAT A SPOT CHECK IS. The owner confirming work 小雅 already did, days after
 * she did it, read properly and out of the moment. It is not a quiz and not a
 * score: there is no right answer to produce, nothing is rated, and a check the
 * owner never answers simply stays unanswered. Approving a draft is a decision
 * made in seconds while busy; a spot check is the same work re-read on purpose.
 * That difference is why one is evidence and the other is throughput.
 *
 * WHEN THEY ARE OFFERED. When work COMPLETES — the owner resolves a draft — not
 * when a page is viewed. Read models in this repo write nothing (M14, M16.2a
 * say so explicitly), and creating rows on a GET would make the employee page a
 * writer and break that rule for everyone after us. Completion is also simply
 * the honest moment: work becomes checkable when it is done.
 *
 * NO NOTIFICATION. A fixed budget of three a week accumulates on /app/employee
 * and waits. M5's rule was "never pushed one by one", and it holds: nothing here
 * enqueues an alert.
 */

/** One check waiting for the owner, with the work it is asking about. */
export type PendingSpotCheck = {
  readonly id: string;
  readonly capability: string;
  readonly buyerMessage: string;
  readonly reply: string;
  readonly conversationId: string | null;
  readonly askedAt: Date;
};

/**
 * Completed work that has never been spot-checked.
 *
 * A draft the owner APPROVED or EDITED is work she signed off in the moment,
 * which is precisely what a later re-read is for. Every business starts fully
 * draft (migration 0009: "trust is earned, not defaulted"), so if this only
 * offered auto-sent work there would be nothing to check until promotion, and
 * nothing could be promoted without checks — a closed loop with no entrance.
 */
async function checkableWork(tx: Tx, businessId: string): Promise<readonly CompletedWork[]> {
  const rows = await sql<{
    id: string; capability: string; buyer_message: string | null;
    reply: string; decided_at: Date; was_auto: boolean;
  }>`
    select d.id,
           d.capability,
           t.input->>'text' as buyer_message,
           coalesce(d.sent_text, d.draft_text) as reply,
           d.decided_at,
           false as was_auto
      from drafts d
      left join turns t
        on t.message_id = d.turn_message_id and t.business_id = d.business_id
     where d.business_id = ${businessId}::uuid
       and d.status in ('approved', 'edited')
       and d.decided_at is not null
       and not exists (
         select 1 from spot_checks s
          where s.business_id = d.business_id and s.work_ref = d.id::text
       )
  `.execute(tx);
  return rows.rows.map((r) => ({
    id: r.id,
    capability: r.capability,
    buyerMessage: r.buyer_message ?? '',
    reply: r.reply,
    wasAuto: r.was_auto,
    at: r.decided_at,
  }));
}

/**
 * Create up to the weekly budget of checks, and no more. Idempotent: safe to
 * call on every resolved draft, because it counts what already exists rather
 * than assuming it created nothing.
 */
export async function ensureSpotChecks(tx: Tx, businessId: string): Promise<number> {
  const counts = await sql<{ pending: number; this_week: number }>`
    select count(*) filter (where answered_at is null)::int as pending,
           count(*) filter (where asked_at >= now() - interval '7 days')::int as this_week
      from spot_checks where business_id = ${businessId}::uuid
  `.execute(tx);
  const c = counts.rows[0] ?? { pending: 0, this_week: 0 };

  // Two ceilings, and the lower wins. The weekly one is the M5 budget; the
  // pending one stops unanswered checks piling into a backlog that reads as a
  // chore rather than a two-minute ritual.
  const room = Math.min(
    SPOT_CHECKS_PER_WEEK - c.this_week,
    SPOT_CHECKS_PER_WEEK - c.pending,
  );
  if (room <= 0) return 0;

  const picked = selectSpotChecks(await checkableWork(tx, businessId), room);
  for (const w of picked) {
    // conversation_id comes from the draft rather than being carried through
    // the pure selector, which has no business knowing about conversations.
    await sql`
      insert into spot_checks (business_id, conversation_id, capability, work_ref, asked_at)
      select ${businessId}::uuid, d.conversation_id, ${w.capability}, ${w.id}, now()
        from drafts d where d.id = ${w.id}::uuid
    `.execute(tx);
  }
  return picked.length;
}

/** Checks waiting for an answer, newest work first. Read-only. */
export async function loadPendingSpotChecks(
  tx: Tx, businessId: string,
): Promise<readonly PendingSpotCheck[]> {
  const rows = await sql<{
    id: string; capability: string; conversation_id: string | null;
    buyer_message: string | null; reply: string | null; asked_at: Date;
  }>`
    select s.id, s.capability, s.conversation_id,
           t.input->>'text' as buyer_message,
           coalesce(d.sent_text, d.draft_text) as reply,
           s.asked_at
      from spot_checks s
      left join drafts d on d.id = s.work_ref::uuid and d.business_id = s.business_id
      left join turns t on t.message_id = d.turn_message_id and t.business_id = s.business_id
     where s.business_id = ${businessId}::uuid and s.answered_at is null
     order by s.asked_at desc
  `.execute(tx);
  // A check whose work cannot be shown is not shown. Asking the owner to judge
  // a reply we cannot display would be asking her to guess.
  return rows.rows
    .filter((r) => r.reply !== null)
    .map((r) => ({
      id: r.id,
      capability: r.capability,
      conversationId: r.conversation_id,
      buyerMessage: r.buyer_message ?? '',
      reply: r.reply!,
      askedAt: r.asked_at,
    }));
}

/**
 * Record the owner's answer. `parseSpotCheckReply` decides the verdict from her
 * own words — the same parser the M5 design specified, now reachable: the two
 * buttons post the wire words it already understands, and anything she types
 * instead is a correction. Nothing is scored.
 *
 * Idempotent by `answered_at is null`: a double submit finds it answered and
 * changes nothing, the same guard `applyOwnerCommand` uses on drafts.
 */
export async function answerSpotCheck(
  tx: Tx, businessId: string, spotCheckId: string, rawReply: string,
): Promise<{ answered: boolean; verdict: SpotCheckVerdict | null }> {
  const { verdict, correction } = parseSpotCheckReply(rawReply);
  const r = await sql<{ id: string }>`
    update spot_checks
       set verdict = ${verdict}, correction = ${correction}, answered_at = now()
     where id = ${spotCheckId}::uuid
       and business_id = ${businessId}::uuid
       and answered_at is null
    returning id
  `.execute(tx);
  return r.rows[0] ? { answered: true, verdict } : { answered: false, verdict: null };
}
