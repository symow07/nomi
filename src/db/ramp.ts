import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { zoneOf } from './zone.js';
import { sameWords } from './ownerWords.js';
import { figuresIn } from '../core/conversation/figures.js';
import { isRetailKind } from '../core/owner/sellingStyle.js';
import { checklistFor, type ChecklistItem } from './practiceChecklist.js';
import {
  talksProgress, sellsProgress, SELLS, TALKS, type RampDecision, type Rung, type RungProgress,
} from '../core/trust/ramp.js';

/**
 * R2 — THE WORKSPACE COUNTER. Reads the drafts decided for real customers
 * (never a conversation the owner marked "this is me testing"), newest first,
 * and turns each into what the ramp counts (`src/core/trust/ramp.ts`); stamps
 * a rung on a workspace that signed itself up the moment it is earned.
 * Retroactive by construction: drafts and what was sent are kept, so every
 * decision made before R2 counts.
 */

export type RampState = {
  /** A workspace that signed itself up: the rungs gate it. Otherwise they are advice. */
  readonly gated: boolean;
  /** How far the switch may go now (earned_rung()). */
  readonly rung: Rung;
  readonly talks: RungProgress & { readonly need: number };
  /** Null when prices go to the owner, or nothing has a price: the ceiling is rung 1. */
  readonly sells: RungProgress | null;
  readonly checklistComplete: boolean;
  readonly named: boolean;
  readonly talksEarnedAt: Date | null;
  readonly sellsEarnedAt: Date | null;
};

const sorted = (xs: readonly string[]): string => [...xs].sort().join('|');

export async function earnedRung(tx: Tx): Promise<Rung> {
  const r = Number((await sql<{ r: number }>`select earned_rung() as r`.execute(tx)).rows[0]?.r ?? 0);
  return (r >= 2 ? 2 : r >= 1 ? 1 : 0);
}

export async function rampState(tx: Tx, businessId: BusinessId): Promise<RampState> {
  const zone = await zoneOf(tx, businessId);
  const b = (await sql<{
    gated: boolean; talks_earned_at: Date | null; sells_earned_at: Date | null; kind: string | null;
    prices_to_owner: boolean; priced: boolean; named: boolean; n: number | null;
  }>`
    select b.signed_up_at is not null as gated, b.talks_earned_at, b.sells_earned_at, b.kind, b.prices_to_owner,
           exists (select 1 from products p where p.business_id = b.id and p.is_active and p.price_usd_per_unit is not null) as priced,
           coalesce((select assistant_named_at is not null from onboarding_state o where o.business_id = b.id), false) as named,
           (select auto_after_clean_approvals from autonomy_policy a where a.business_id = b.id and a.capability = 'greet') as n
      from businesses b where b.id = ${businessId}::uuid`.execute(tx)).rows[0];
  const rows = (await sql<{
    status: string; draft_text: string; sent_text: string | null; capability: string; customer: string;
    day: string; by_owner: boolean; flagged: boolean;
  }>`
    select d.status, d.draft_text, d.sent_text, d.capability, c.client_id::text as customer,
           to_char((d.decided_at at time zone ${zone})::date, 'YYYY-MM-DD') as day,
           coalesce(act.actor = 'owner' or exists (select 1 from people p where p.business_id = d.business_id and p.is_owner
                                                   and p.id::text = act.actor), false) as by_owner,
           (coalesce((select e.payload ? 'identity' from conversation_events e
                       where e.conversation_id = d.conversation_id and e.type = 'draft_pending'
                         and e.payload->>'draftId' = d.id::text order by e.id desc limit 1), false)
            or exists (select 1 from conversation_events g
                        where g.conversation_id = d.conversation_id
                          and g.type in ('guard_violation', 'deletion_promise_withheld')
                          and (g.type <> 'guard_violation' or coalesce(g.payload->>'final', 'true') = 'true')
                          and g.created_at between d.created_at - interval '1 minute' and d.created_at + interval '1 second')) as flagged
      from drafts d
      join conversations c on c.id = d.conversation_id and c.owner_testing = false
      left join lateral (select e.payload->>'actor' as actor from conversation_events e
                          where e.conversation_id = d.conversation_id and e.type = 'draft_resolved'
                            and e.payload->>'draftId' = d.id::text order by e.id desc limit 1) act on true
     where d.business_id = current_business_id()
       and d.status in ('approved', 'edited', 'rejected') and d.decided_at is not null
     order by d.decided_at desc, d.id desc
     limit 200`.execute(tx)).rows;
  const decisions: RampDecision[] = rows.map((r) => {
    const sentSame = r.status === 'approved' || (r.status === 'edited' && r.sent_text !== null && sameWords(r.draft_text, r.sent_text));
    return {
      asWritten: sentSame,
      figureChanged: r.status === 'rejected' || (!sentSame && sorted(figuresIn(r.draft_text)) !== sorted(figuresIn(r.sent_text ?? ''))),
      priced: (SELLS as readonly string[]).includes(r.capability),
      byOwner: r.by_owner,
      customer: r.customer,
      day: r.day,
      flagged: r.flagged,
    };
  });
  const kind = !b?.priced ? 'no_catalogue' : isRetailKind(b.kind) ? 'retail' : 'catalogue';
  const required: readonly ChecklistItem[] = checklistFor(kind);
  const seen = new Set((await sql<{ item: string }>`select item from practice_checks where business_id = ${businessId}::uuid`
    .execute(tx)).rows.map((x) => x.item));
  const checklistComplete = required.every((i) => seen.has(i));
  const named = b?.named === true;
  const talks = talksProgress(decisions, { ...(b?.n ? { n: Number(b.n) } : {}), checklistComplete, named });
  const sells = sellsProgress(decisions, talks.ready, !(b?.prices_to_owner ?? false) && (b?.priced ?? false));
  return {
    gated: b?.gated === true, rung: await earnedRung(tx), talks, sells, checklistComplete, named,
    talksEarnedAt: b?.talks_earned_at ?? null, sellsEarnedAt: b?.sells_earned_at ?? null,
  };
}

/**
 * Stamps a rung the moment it is earned, on a workspace that signed itself up.
 * Called in the transaction that decides a draft. Returns the rung newly
 * stamped, if any. Rung 1 also opens the gate G4 reads (`auto_earned_at`,
 * `auto_earned_by = 'ramp'`), unless the operator already lifted it.
 */
export async function stampRungs(tx: Tx, businessId: BusinessId): Promise<Rung | null> {
  const s = await rampState(tx, businessId);
  if (!s.gated) return null;
  let stamped: Rung | null = null;
  if (s.talks.ready && !s.talksEarnedAt) {
    await sql`update businesses set talks_earned_at = now(),
                auto_earned_at = coalesce(auto_earned_at, now()), auto_earned_by = coalesce(auto_earned_by, 'ramp')
               where id = ${businessId}::uuid`.execute(tx);
    stamped = 1;
  }
  if (s.sells?.ready && !s.sellsEarnedAt) {
    await sql`update businesses set sells_earned_at = now() where id = ${businessId}::uuid and talks_earned_at is not null`.execute(tx);
    stamped = 2;
  }
  return stamped;
}

/**
 * The system demoted a capability (a guard trip, a spot check): its rung is
 * earned again from fresh evidence. Talks takes sells with it.
 */
export async function clearRungFor(tx: Tx, businessId: string, capability: string): Promise<void> {
  if ((TALKS as readonly string[]).includes(capability)) {
    await sql`update businesses set talks_earned_at = null, sells_earned_at = null,
                auto_earned_at = case when auto_earned_by = 'ramp' then null else auto_earned_at end,
                auto_earned_by = case when auto_earned_by = 'ramp' then null else auto_earned_by end
               where id = ${businessId}::uuid and signed_up_at is not null`.execute(tx);
  } else if ((SELLS as readonly string[]).includes(capability)) {
    await sql`update businesses set sells_earned_at = null where id = ${businessId}::uuid and signed_up_at is not null`.execute(tx);
  }
}
