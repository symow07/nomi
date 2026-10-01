import { sql } from 'kysely';
import type { Tx } from '../db/client.js';
import {
  selectSpotChecks, parseSpotCheckReply, SPOT_CHECKS_PER_WEEK,
  type CompletedWork, type SpotCheckVerdict,
} from '../core/trust/spotCheck.js';
import { applySpotCheck, demotionDecision, type DemotionDecision } from '../core/trust/evidence.js';
import { SELLS } from '../core/trust/ramp.js';
import { figuresIn } from '../core/conversation/figures.js';
import { clearRungFor } from '../db/ramp.js';
import { loadCapabilityEvidence, autoDemote } from './capability.js';

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
  /** R5 — the reply went out alone (an `auto_sent` event), not as a draft someone approved. */
  readonly wasAuto?: boolean;
};

/**
 * R5 (0109) — WHAT A CHECK POINTS AT. A draft by its id (as since M34.7), or
 * work sent alone as `auto:<event id>` — the `auto_sent` event the turn wrote
 * with the words it queued. The joins read whichever it is; a reference of
 * neither shape matches nothing, and a check whose work cannot be shown is
 * not shown.
 */
const AUTO_REF = 'auto:';
const WORK_JOINS = sql`
      left join drafts d on s.work_ref !~ '^auto:' and d.business_id = s.business_id
            and d.id = case when s.work_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then s.work_ref::uuid end
      left join conversation_events e on s.work_ref ~ '^auto:[0-9]+$' and e.business_id = s.business_id and e.type = 'auto_sent'
            and e.id = case when s.work_ref ~ '^auto:[0-9]+$' then substr(s.work_ref, 6)::bigint end
      left join turns t on t.business_id = s.business_id and t.message_id = coalesce(d.turn_message_id, e.payload->>'messageId')`;

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
    select d.id::text as id,
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
    union all
    -- R5 — work sent alone in the last fortnight, once it actually left: the
    -- words the turn queued are on the conversation's timeline as sent.
    select ${AUTO_REF} || e.id::text,
           e.payload->>'capability',
           t.input->>'text',
           e.payload->>'body',
           e.created_at,
           true
      from conversation_events e
      left join turns t on t.message_id = e.payload->>'messageId' and t.business_id = e.business_id
     where e.business_id = ${businessId}::uuid
       and e.type = 'auto_sent'
       and e.created_at >= now() - interval '14 days'
       and exists (select 1 from messages m
                    where m.conversation_id = e.conversation_id and m.direction = 'outbound'
                      and m.text_content = e.payload->>'body')
       and not exists (
         select 1 from spot_checks s
          where s.business_id = e.business_id and s.work_ref = ${AUTO_REF} || e.id::text
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
    // conversation_id comes from the work rather than being carried through
    // the pure selector, which has no business knowing about conversations.
    if (w.id.startsWith(AUTO_REF)) {
      await sql`
        insert into spot_checks (business_id, conversation_id, capability, work_ref, asked_at)
        select ${businessId}::uuid, e.conversation_id, ${w.capability}, ${w.id}, now()
          from conversation_events e where e.id = ${Number(w.id.slice(AUTO_REF.length))} and e.business_id = ${businessId}::uuid
      `.execute(tx);
      continue;
    }
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
    buyer_message: string | null; reply: string | null; asked_at: Date; was_auto: boolean;
  }>`
    select s.id, s.capability, s.conversation_id,
           t.input->>'text' as buyer_message,
           coalesce(d.sent_text, d.draft_text, e.payload->>'body') as reply,
           s.asked_at, e.id is not null as was_auto
      from spot_checks s
      ${WORK_JOINS}
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
      ...(r.was_auto ? { wasAuto: true } : {}),
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
/**
 * R5 — A WRONG PRICE. A check of priced work (quote, negotiate) that the owner
 * calls seriously wrong, or corrects with figures the reply did not hold. Not
 * a wording correction: "too formal" changes no figure.
 */
export function wrongPrice(capability: string, verdict: SpotCheckVerdict, correction: string | null, reply: string): boolean {
  if (!(SELLS as readonly string[]).includes(capability)) return false;
  if (verdict === 'serious') return true;
  if (correction === null) return false;
  const said = figuresIn(correction);
  const sorted = (xs: readonly string[]) => [...xs].sort().join('|');
  return said.length > 0 && sorted(said) !== sorted(figuresIn(reply));
}

export async function answerSpotCheck(
  tx: Tx, businessId: string, spotCheckId: string, rawReply: string,
): Promise<{ answered: boolean; verdict: SpotCheckVerdict | null; demoted: boolean }> {
  const parsed = parseSpotCheckReply(rawReply);
  const { correction } = parsed;
  // R1 (fix 5) — the evidence is read BEFORE the verdict is written, and the
  // verdict folded in once below. Read after, it already held the verdict and
  // `applySpotCheck` added it a second time: one correction demoted at once.
  const open = (await sql<{ capability: string; reply: string | null }>`
    select s.capability, coalesce(d.sent_text, d.draft_text, e.payload->>'body') as reply
      from spot_checks s
      ${WORK_JOINS}
     where s.id = ${spotCheckId}::uuid and s.business_id = ${businessId}::uuid and s.answered_at is null
       for update of s`.execute(tx)).rows[0];
  if (!open) return { answered: false, verdict: null, demoted: false };
  // R5 — a wrong price found this way is serious, whatever words said it: the
  // workspace goes back to rung 1 (below), and the capability to drafts. Only
  // against the reply itself: work that cannot be shown is never judged.
  const priceWrong = open.reply !== null && wrongPrice(open.capability, parsed.verdict, correction, open.reply);
  const verdict: SpotCheckVerdict = priceWrong ? 'serious' : parsed.verdict;
  const base = await loadCapabilityEvidence(tx, open.capability);
  const r = await sql<{ id: string; capability: string }>`
    update spot_checks
       set verdict = ${verdict}, correction = ${correction}, answered_at = now()
     where id = ${spotCheckId}::uuid
       and business_id = ${businessId}::uuid
       and answered_at is null
    returning id, capability
  `.execute(tx);
  const row = r.rows[0];
  if (!row) return { answered: false, verdict: null, demoted: false };

  // M34.9 — a bad verdict is evidence, and evidence can take authority away.
  //
  // `applySpotCheck` folds this verdict into the counts BEFORE the decision, so
  // the demotion is made on the answer the owner just gave rather than on the
  // state of the table a moment ago. That function existed since M5 with no
  // caller; this is it.
  //
  // Only ever downward: `autoDemote` writes the literal 'draft' and refuses a
  // capability that is not currently in auto, so a "correct" verdict cannot
  // promote anything. Promotion stays the owner's tap.
  const evidence = applySpotCheck(base, verdict);
  const decision: DemotionDecision = priceWrong
    ? { action: 'return_to_learning', reasons: ['wrong_price'] } : demotionDecision(evidence);
  const d = await autoDemote(tx, businessId, row.capability, decision, evidence);
  // R5 — and the price rung goes, even where the capability was not in auto
  // (the check was of an approved draft): on a workspace that earned it, the
  // loss is the system's own demotion, on the record and told to the owner.
  if (priceWrong && !d.demoted) {
    const had = (await sql<{ had: boolean }>`
      select sells_earned_at is not null as had from businesses where id = ${businessId}::uuid`.execute(tx)).rows[0]?.had === true;
    if (had) {
      await clearRungFor(tx, businessId, row.capability);
      const mode = (await sql<{ mode: string }>`
        select mode from autonomy_policy where business_id = ${businessId}::uuid and capability = ${row.capability}`.execute(tx)).rows[0]?.mode;
      await sql`
        insert into capability_events (business_id, capability, action, from_mode, to_mode, reasons, evidence, actor)
        values (${businessId}::uuid, ${row.capability}, 'return_to_learning', ${mode === 'auto' ? 'auto' : 'draft'}, 'draft',
                array['wrong_price'], ${JSON.stringify(evidence)}::jsonb, 'system_self_demoted')`.execute(tx);
    }
  }
  return { answered: true, verdict, demoted: d.demoted || priceWrong };
}
