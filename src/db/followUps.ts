import { sql } from 'kysely';
import type { BusinessId, ConversationId } from '../core/types/ids.js';
import { DEFAULT_FOLLOW_UP_RULE, type FollowUpRule } from '../core/conversation/followUps.js';
import { channelSendPlan } from '../core/channel/window.js';
import { aiMaySpeak, ownershipOf } from '../core/conversation/ownership.js';
import { type Tx } from './client.js';
import { assistantHold } from './assistantStop.js';
import { loadKillSwitches } from './opsFlags.js';
import { tenantRepos } from './repos.js';

export type FollowUpRun = {
  id: string; business_id: string; client_id: string; conversation_id: string; source_quote_id: string;
  source_outbound_id: string; episode_message_id: string | null; episode_key: string; channel: string;
  quoted_at: Date; due_at: Date; delay_days: number; wording: string; state: string; reason: string | null;
  draft_id: string | null; presented_at: Date | null; answered_after_approval: boolean;
  draft_status?: string | null; outbound_status?: string | null; accepted_at?: Date | null;
  source_words?: string | null;
};
export type FollowUpObservation = {
  id: string; business_id: string; client_id: string; conversation_id: string; quote_id: string; outbound_id: string;
  episode_message_id: string | null; quoted_at: Date; delay_days: number; wording: string;
};

export async function followUpRule(tx: Tx, businessId: string): Promise<FollowUpRule> {
  const r = (await sql<{ enabled: boolean; delay_days: number; wording: string }>`
    select enabled, delay_days, wording from follow_up_rules where business_id = ${businessId}::uuid`.execute(tx)).rows[0];
  return r ? { enabled: r.enabled, delayDays: r.delay_days, wording: r.wording } : DEFAULT_FOLLOW_UP_RULE;
}

/** Owner permission belongs to the route. Only future accepted quotes read an edited rule. */
export async function saveFollowUpRule(tx: Tx, businessId: string, rule: FollowUpRule, now: Date): Promise<void> {
  await sql`insert into follow_up_rules(business_id, enabled, delay_days, wording, enabled_at, updated_at)
    values (${businessId}::uuid, ${rule.enabled}, ${rule.delayDays}, ${rule.wording}, ${rule.enabled ? now : null}, ${now})
    on conflict (business_id) do update set enabled = excluded.enabled, delay_days = excluded.delay_days,
      wording = excluded.wording, updated_at = excluded.updated_at,
      enabled_at = case when excluded.enabled and not follow_up_rules.enabled then excluded.enabled_at
                        else follow_up_rules.enabled_at end`.execute(tx);
}

export async function followUpsOf(tx: Tx, businessId: string, conversationId: string): Promise<readonly FollowUpRun[]> {
  return (await sql<FollowUpRun>`select r.*, d.status as draft_status, o.status as outbound_status, o.sent_at as accepted_at,
    source.body as source_words
    from follow_up_runs r left join drafts d on d.id = r.draft_id
    left join follow_up_approvals a on a.run_id = r.id left join outbound_messages o on o.id = a.outbound_id
    left join outbound_messages source on source.id = r.source_outbound_id
    where r.business_id = ${businessId}::uuid and r.conversation_id = ${conversationId}::uuid
    order by r.created_at desc, r.id limit 20`.execute(tx)).rows;
}

/** Never trust the receipt observer alone: every inbound writer ultimately persists here. */
export async function followUpAnswered(tx: Tx, r: Pick<FollowUpRun, 'client_id' | 'business_id' | 'quoted_at' | 'episode_message_id'>): Promise<boolean> {
  return (await sql<{ answered: boolean }>`select exists (
    select 1 from messages m join conversations c on c.id = m.conversation_id
    where c.client_id = ${r.client_id}::uuid and c.business_id = ${r.business_id}::uuid
      and m.direction = 'inbound' and m.sent_at >= ${r.quoted_at}
      and m.id is distinct from ${r.episode_message_id}::uuid
  ) as answered`.execute(tx)).rows[0]?.answered === true;
}

/** The locked run keeps its original words and delay; its history keeps both anchors. */
async function moveFollowUpAnchor(tx: Tx, r: FollowUpRun, quote: Pick<FollowUpObservation, 'conversation_id' | 'quote_id' | 'outbound_id' | 'quoted_at'>): Promise<void> {
  const due = new Date(quote.quoted_at.getTime() + r.delay_days * 86400000);
  await sql`update follow_up_runs set conversation_id = ${quote.conversation_id}::uuid,
    channel = (select channel from conversations where id = ${quote.conversation_id}::uuid),
    source_quote_id = ${quote.quote_id}::uuid, source_outbound_id = ${quote.outbound_id}::uuid,
    quoted_at = ${quote.quoted_at}, due_at = ${due} where id = ${r.id}::uuid`.execute(tx);
  await tenantRepos(tx, r.business_id as BusinessId).events.append(quote.conversation_id as ConversationId, 'follow_up_rescheduled', {
    followUpRunId: r.id, previousOutboundId: r.source_outbound_id, outboundId: quote.outbound_id,
    previousQuoteId: r.source_quote_id, quoteId: quote.quote_id, previousDueAt: r.due_at.toISOString(), dueAt: due.toISOString(),
  });
}

/** Observations are an optimization, not the authority for the last accepted quote. */
async function refreshFollowUpAnchor(tx: Tx, r: FollowUpRun, now: Date): Promise<boolean> {
  const latest = (await sql<Pick<FollowUpObservation, 'conversation_id' | 'quote_id' | 'outbound_id' | 'quoted_at'>>`
    select o.conversation_id, o.quote_id, o.id as outbound_id, o.sent_at as quoted_at
    from outbound_messages o join quotes q on q.id = o.quote_id
      and q.business_id = o.business_id and q.conversation_id = o.conversation_id
    where o.business_id = ${r.business_id}::uuid and o.conversation_id = ${r.conversation_id}::uuid
      and o.status in ('sent', 'delivered', 'read') and o.sent_at > ${r.quoted_at} and o.sent_at <= ${now}
    order by o.sent_at desc, o.seq desc limit 1`.execute(tx)).rows[0];
  if (!latest) return false;
  await moveFollowUpAnchor(tx, r, latest);
  return true;
}

/** A quote observation folds into a single quiet episode, not a second follow-up. */
export async function foldFollowUpQuote(tx: Tx, businessId: BusinessId, id: string, now: Date): Promise<void> {
  const o = (await sql<FollowUpObservation>`select * from follow_up_observations where id = ${id}::uuid
    and business_id = ${businessId}::uuid and kind = 'quote' and processed_at is null
    for update skip locked`.execute(tx)).rows[0];
  if (!o) return;
  await sql`select pg_advisory_xact_lock(hashtextextended(${`${o.client_id}:follow-ups`}, 0))`.execute(tx);
  const key = o.episode_message_id ?? o.client_id;
  const r = (await sql<FollowUpRun>`select * from follow_up_runs where business_id = ${businessId}::uuid
    and client_id = ${o.client_id}::uuid and episode_key = ${key}::uuid for no key update`.execute(tx)).rows[0];
  if (!r) {
    await sql`insert into follow_up_runs (business_id, client_id, conversation_id, source_quote_id, source_outbound_id,
      episode_message_id, episode_key, channel, quoted_at, due_at, delay_days, wording)
      select ${businessId}::uuid, ${o.client_id}::uuid, c.id, ${o.quote_id}::uuid, ${o.outbound_id}::uuid,
        ${o.episode_message_id}::uuid, ${key}::uuid, c.channel, ${o.quoted_at},
        ${new Date(o.quoted_at.getTime() + o.delay_days * 86400000)}, ${o.delay_days}, ${o.wording}
      from conversations c where c.id = ${o.conversation_id}::uuid and c.business_id = ${businessId}::uuid`.execute(tx);
  } else if (r.state === 'scheduled' && o.quoted_at > r.quoted_at && o.quoted_at < r.due_at) {
    await moveFollowUpAnchor(tx, r, o);
  }
  await sql`update follow_up_observations set processed_at = ${now} where id = ${id}::uuid`.execute(tx);
}

/** A refusal ends this run. It never becomes a backlog when a hold clears. */
export async function followUpRefusal(tx: Tx, businessId: BusinessId, r: FollowUpRun): Promise<string | null> {
  if (await followUpAnswered(tx, r)) return 'customer_answered';
  const c = (await sql<{ active: boolean; is_active: boolean; practice_of: string | null; owner_testing: boolean;
    assigned_to: string | null; closed_at: Date | null; opted_out: boolean; suppressed: boolean; deletion: boolean }>`
    select b.is_active as active, c.is_active, b.practice_of, c.owner_testing, c.assigned_to, c.closed_at,
      exists (select 1 from client_channels cc join opt_outs oo on oo.business_id = cc.business_id
        and oo.channel = cc.channel and oo.identity = cc.channel_user_id and oo.lifted_at is null
        where cc.client_id = c.client_id and cc.business_id = b.id) as opted_out,
      exists (select 1 from client_channels cc join suppressions s on s.business_id = cc.business_id
        and s.channel = cc.channel and s.identity = cc.channel_user_id
        where cc.client_id = c.client_id and cc.business_id = b.id) as suppressed,
      (exists (select 1 from deletion_asks a where a.client_id = c.client_id and a.business_id = b.id and a.state = 'waiting')
       or exists (select 1 from deletion_requests d where d.client_id = c.client_id and d.business_id = b.id and d.state = 'open')
       or exists (select 1 from conversation_signals s where s.conversation_id = c.id and s.kind = 'deletion_requested' and s.resolved_at is null)) as deletion
    from conversations c join businesses b on b.id = c.business_id
    where c.id = ${r.conversation_id}::uuid and b.id = ${businessId}::uuid`.execute(tx)).rows[0];
  if (!c || !c.active) return 'workspace_closed';
  if (c.practice_of || c.owner_testing) return 'practice';
  if (c.opted_out) return 'opted_out';
  if (c.suppressed) return 'unsubscribed';
  if (c.deletion) return 'deletion';
  if (!c.is_active || c.closed_at) return 'conversation_closed';
  if (!aiMaySpeak(ownershipOf(c.assigned_to))) return 'held_by_person';
  const hold = await assistantHold(tx, businessId);
  if (hold) return hold;
  if ((await loadKillSwitches(tx, businessId)).silenceCapability.includes('follow_up')) return 'silenced';
  return null;
}

/** Call with the conversation locked. A locked approval draft wins over cancellation. */
export async function cancelFollowUp(tx: Tx, r: FollowUpRun, reason: string, skip = false): Promise<boolean> {
  if (r.draft_id) {
    const d = (await sql<{ status: string }>`select status from drafts where id = ${r.draft_id}::uuid
      for update skip locked`.execute(tx)).rows[0];
    if (!d || d.status === 'approved' || d.status === 'edited') {
      if (reason === 'customer_answered') await sql`update follow_up_runs set answered_after_approval = true,
        reason = 'answer_during_approval' where id = ${r.id}::uuid`.execute(tx);
      return false;
    }
    if (d.status === 'pending') await sql`update drafts set status = 'superseded' where id = ${r.draft_id}::uuid`.execute(tx);
  }
  await sql`update follow_up_runs set state = ${skip ? 'skipped' : 'canceled'}, reason = ${reason}
    where id = ${r.id}::uuid`.execute(tx);
  return true;
}

export async function presentFollowUp(tx: Tx, businessId: BusinessId, r: FollowUpRun, now: Date): Promise<boolean> {
  const refusal = await followUpRefusal(tx, businessId, r);
  if (refusal) { await cancelFollowUp(tx, r, refusal); return false; }
  if (r.state !== 'scheduled' || r.due_at > now) return false;
  if (await refreshFollowUpAnchor(tx, r, now)) return false;
  const last = (await sql<{ last_inbound_at: Date | null }>`select max(last_inbound_at) as last_inbound_at from client_channels
    where business_id = ${businessId}::uuid and client_id = ${r.client_id}::uuid and channel = ${r.channel}`.execute(tx)).rows[0]?.last_inbound_at ?? null;
  if (channelSendPlan(r.channel, last, now, 'none').action !== 'send_free') {
    await sql`update follow_up_runs set state = 'window_closed', reason = 'window_closed', presented_at = ${now}
      where id = ${r.id}::uuid`.execute(tx);
    return false;
  }
  // Re-read the durable messages immediately before making the draft, even if its observer was dropped.
  if (await followUpAnswered(tx, r)) { await cancelFollowUp(tx, r, 'customer_answered'); return false; }
  if (await refreshFollowUpAnchor(tx, r, now)) return false;
  const tenant = tenantRepos(tx, businessId);
  const draft = await tenant.drafts.create({ conversationId: r.conversation_id as ConversationId,
    capability: 'follow_up', draftText: r.wording, turnMessageId: null });
  await tenant.events.append(r.conversation_id as ConversationId, 'draft_pending', {
    draftId: draft.draftId, capability: 'follow_up', withheld: { reason: 'owner_follow_up' }, followUpRunId: r.id,
  });
  await sql`update follow_up_runs set state = 'draft', draft_id = ${draft.draftId}::uuid, presented_at = ${now}
    where id = ${r.id}::uuid`.execute(tx);
  return true;
}
