import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { channelStore } from './channels.js';

/**
 * 0135 — A BUYER WHO SAYS STOP IS NOT WRITTEN TO AGAIN.
 *
 * `opt_outs` holds it per buyer AND per channel: the identity they wrote from
 * (a WhatsApp number, an Instagram or Messenger account, an e-mail address) on
 * the channel they wrote on. The send gate reads it (channelStore.load →
 * sendGate.ts); this module writes it, reads it for the owner's pages, and lets
 * the owner lift it.
 *
 * Recording it also clears what was already on its way: every queued message
 * to them in this conversation is refused now, through the same refusal
 * record the gate writes, and every reply still waiting for the owner's
 * approval is superseded — approving it later would answer a buyer who asked
 * not to be answered. Nothing waits to slip out once they write again.
 *
 * Every write is scoped by business as well as by row, like the read models.
 */

export type OptOutRecorded =
  /** A new opt-out: they are not written to from now on. */
  | 'recorded'
  /** They said it again while one stands: counted, and the silence starts again. */
  | 'asked_again'
  /** The conversation has no identity on its channel to record against. */
  | 'no_identity';

export type StandingOptOut = {
  readonly id: string;
  readonly channel: string;
  readonly askedAt: Date;
  readonly lastAskedAt: Date;
  readonly asks: number;
  readonly recordedBy: 'buyer' | 'owner';
  /** The buyer wrote after they last said it: replies may go again (never a first message). */
  readonly repliedSince: boolean;
};

/** The conversation's channel and the buyer's identity on it — the most recently heard from, as the gate reads it. */
async function identityOf(tx: Tx, businessId: BusinessId, conversationId: string): Promise<{
  readonly channel: string; readonly identity: string; readonly lastInboundAt: Date | null;
} | null> {
  const r = (await sql<{ channel: string; identity: string | null; last_inbound_at: Date | null }>`
    select c.channel, cc.channel_user_id as identity, cc.last_inbound_at
      from conversations c
      left join lateral (
        select cc.channel_user_id, cc.last_inbound_at from client_channels cc
         where cc.client_id = c.client_id and cc.channel = c.channel
         order by cc.last_inbound_at desc nulls last limit 1
      ) cc on true
     where c.id = ${conversationId}::uuid and c.business_id = ${businessId}::uuid`.execute(tx)).rows[0];
  if (!r?.identity) return null;
  return { channel: r.channel, identity: r.identity, lastInboundAt: r.last_inbound_at };
}

export async function recordOptOut(
  tx: Tx, businessId: BusinessId,
  input: { readonly conversationId: string; readonly by: 'buyer' | 'owner'; readonly now: Date },
): Promise<OptOutRecorded> {
  const who = await identityOf(tx, businessId, input.conversationId);
  if (!who) return 'no_identity';

  const row = (await sql<{ asks: number }>`
    insert into opt_outs (business_id, channel, identity, asked_at, last_asked_at, recorded_by)
    values (${businessId}::uuid, ${who.channel}, ${who.identity}, ${input.now}, ${input.now}, ${input.by})
    on conflict (business_id, channel, identity) where lifted_at is null
    do update set asks = opt_outs.asks + 1, last_asked_at = greatest(opt_outs.last_asked_at, excluded.last_asked_at)
    returning asks`.execute(tx)).rows[0];

  await refuseWaiting(tx, businessId, input.conversationId, who.identity, input.now);
  return (row?.asks ?? 1) > 1 ? 'asked_again' : 'recorded';
}

/**
 * What was already on its way to them, refused now — the gate would refuse it
 * at send time anyway, but only until they write again — and every reply still
 * waiting for the owner: approved later, it would answer someone who asked not
 * to be.
 */
async function refuseWaiting(tx: Tx, businessId: BusinessId, conversationId: string, identity: string, now: Date): Promise<void> {
  const queued = (await sql<{ id: string; to_wa_id: string | null }>`
    select id::text as id, to_wa_id from outbound_messages
     where conversation_id = ${conversationId}::uuid and business_id = ${businessId}::uuid
       and status = 'queued' and notice is null
     order by seq`.execute(tx)).rows;
  const store = channelStore(tx, businessId);
  for (const q of queued) {
    await store.transition(q.id, 'canceled', 'canceled: opted_out');
    await store.recordRefusal?.(q.id, q.to_wa_id ?? identity, 'opted_out');
  }
  await sql`
    update drafts set status = 'superseded', decided_at = ${now}
     where conversation_id = ${conversationId}::uuid and business_id = ${businessId}::uuid
       and status = 'pending'`.execute(tx);
}

/**
 * D9 (the data-protection audit, 2026-10-12) — THE UNSUBSCRIBE LINK IS A STOP.
 *
 * The link (and a mail program's one-click unsubscribe, which every mail
 * carries in its headers) said "nothing will be sent to this address again",
 * but wrote only a suppression, which only first e-mails and follow-ups read:
 * the assistant's replies, approved drafts, the owner's own typed e-mail — on a
 * cold thread the person never answered, too — and order confirmations still
 * went. Now it is the same stop as a buyer's own words (0135), recorded for that
 * address on that channel: nothing at all goes until they write to the business
 * again; then a reply may, never a follow-up or a first mail. What was queued to
 * that address is refused now and every waiting draft retired. The owner lifts
 * it, as any stop.
 */
export async function recordAddressStop(
  tx: Tx, businessId: BusinessId, input: { readonly channel: string; readonly identity: string; readonly now: Date },
): Promise<void> {
  await sql`
    insert into opt_outs (business_id, channel, identity, asked_at, last_asked_at, recorded_by)
    values (${businessId}::uuid, ${input.channel}, ${input.identity}, ${input.now}, ${input.now}, 'buyer')
    on conflict (business_id, channel, identity) where lifted_at is null
    do update set asks = opt_outs.asks + 1, last_asked_at = greatest(opt_outs.last_asked_at, excluded.last_asked_at)`.execute(tx);
  // Every conversation of the business on that channel with that person, and
  // any with a row queued to that address.
  const conversations = (await sql<{ id: string }>`
    select c.id::text as id from conversations c
     where c.business_id = ${businessId}::uuid and c.channel = ${input.channel}
       and exists (select 1 from client_channels cc where cc.client_id = c.client_id and cc.channel = c.channel
                    and lower(cc.channel_user_id) = lower(${input.identity}))
    union
    select o.conversation_id::text from outbound_messages o
     where o.business_id = ${businessId}::uuid and o.status = 'queued' and lower(o.to_wa_id) = lower(${input.identity})`.execute(tx)).rows;
  for (const c of conversations) await refuseWaiting(tx, businessId, c.id, input.identity, input.now);
}

/** 0135 — is this draft the line that answers a stop? Its mark lets it past the stop it answers. */
export async function draftNotice(tx: Tx, businessId: BusinessId, draftId: string): Promise<'handoff' | 'opt_out' | null> {
  const r = (await sql<{ notice: 'handoff' | 'opt_out' | null }>`
    select notice from drafts where id = ${draftId}::uuid and business_id = ${businessId}::uuid`.execute(tx)).rows[0];
  return r?.notice ?? null;
}

/** The opt-out standing for this conversation's buyer on its channel, or null. */
export async function standingOptOut(
  tx: Tx, businessId: BusinessId, conversationId: string,
): Promise<StandingOptOut | null> {
  const who = await identityOf(tx, businessId, conversationId);
  if (!who) return null;
  const r = (await sql<{
    id: string; channel: string; asked_at: Date; last_asked_at: Date; asks: number; recorded_by: 'buyer' | 'owner';
  }>`
    select id::text as id, channel, asked_at, last_asked_at, asks, recorded_by from opt_outs
     where business_id = ${businessId}::uuid and channel = ${who.channel} and identity = ${who.identity}
       and lifted_at is null
     limit 1`.execute(tx)).rows[0];
  if (!r) return null;
  return {
    id: r.id, channel: r.channel, askedAt: r.asked_at, lastAskedAt: r.last_asked_at, asks: r.asks,
    recordedBy: r.recorded_by,
    repliedSince: who.lastInboundAt !== null && who.lastInboundAt.getTime() > r.last_asked_at.getTime(),
  };
}

/**
 * The OWNER lifts it, on the buyer's page, because the buyer asked to hear from
 * the business again. On the audit trail with who and when; the row stays, as
 * the record that they once asked.
 */
export async function liftOptOut(
  tx: Tx, businessId: BusinessId,
  input: { readonly conversationId: string; readonly actor: string; readonly now: Date },
): Promise<'lifted' | 'none'> {
  const standing = await standingOptOut(tx, businessId, input.conversationId);
  if (!standing) return 'none';
  await sql`
    update opt_outs set lifted_at = ${input.now}, lifted_by = ${input.actor}
     where id = ${standing.id}::uuid and business_id = ${businessId}::uuid and lifted_at is null`.execute(tx);
  await sql`
    insert into channel_audit (business_id, action, actor, detail)
    values (${businessId}::uuid, 'opt_out_lifted', ${input.actor},
            ${JSON.stringify({ conversationId: input.conversationId, channel: standing.channel })}::jsonb)`.execute(tx);
  return 'lifted';
}

/**
 * The owner records one, having read a message the words did not settle (a
 * stop that also named a person, a bare "cancel"). The same record as the
 * buyer's own words make, marked as the owner's, and on the audit trail.
 */
export async function recordOwnersOptOut(
  tx: Tx, businessId: BusinessId,
  input: { readonly conversationId: string; readonly actor: string; readonly now: Date },
): Promise<OptOutRecorded> {
  const r = await recordOptOut(tx, businessId, { conversationId: input.conversationId, by: 'owner', now: input.now });
  if (r !== 'no_identity') {
    await sql`
      insert into channel_audit (business_id, action, actor, detail)
      values (${businessId}::uuid, 'opt_out_recorded', ${input.actor},
              ${JSON.stringify({ conversationId: input.conversationId })}::jsonb)`.execute(tx);
  }
  return r;
}
