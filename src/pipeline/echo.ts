import { sql } from 'kysely';
import { withTenantTx, lockConversation, type Db } from '../db/client.js';
import { tenantRepos } from '../db/repos.js';
import { channelStore } from '../db/channels.js';
import { ownershipOf, OWNER_AGENT } from '../core/conversation/ownership.js';
import { parseBusinessId, type ConversationId } from '../core/types/ids.js';
import type { EchoJob } from '../queue/boss.js';

/**
 * CH3 — A REPLY THE OWNER TYPED IN INSTAGRAM'S OR MESSENGER'S OWN APP.
 *
 * Meta sends back every message the business's account sends (an "echo"):
 * Nomi's own, and the owner's from Meta's apps. Nomi never knew of the second
 * kind, so a customer the owner had already answered was answered again — by
 * a reply waiting for approval, or by the assistant on its own.
 *
 * Ours or the owner's:
 *   · ours when it came from Nomi's own Meta app (`app_id`), or when its id is
 *     one Nomi recorded for a message it sent. The job waits a little first
 *     (`ECHO_SETTLE_SECONDS`): Meta can send the echo before the send that
 *     caused it has written the id down.
 *   · otherwise the owner's. It is written on the transcript as the owner's
 *     (`echo:<mid>`); every reply waiting for approval is superseded — sending
 *     it later would answer twice; a reply queued to go alone is cancelled;
 *     and a conversation the assistant held passes to the owner, as the take
 *     over button does. The assistant says nothing more until it is handed back.
 */

export const ECHO_SETTLE_SECONDS = 30;

export type EchoOutcome = 'ours' | 'no_conversation' | 'duplicate' | 'recorded' | 'not_found';

/** Pure: an echo Nomi sent. */
export function echoIsOurs(e: { readonly appId: string | null }, ourAppIds: readonly string[], sentByUs: boolean): boolean {
  return sentByUs || (e.appId !== null && ourAppIds.includes(e.appId));
}

export async function handleEcho(db: Db, job: EchoJob, ourAppIds: readonly string[]): Promise<EchoOutcome> {
  const bid = parseBusinessId(job.businessId);
  if (!bid.ok) return 'not_found';
  return withTenantTx(db, bid.value, async (tx) => {
    const sentByUs = (await sql<{ ours: boolean }>`
      select exists (select 1 from outbound_messages where provider_message_id = ${job.mid}) as ours`.execute(tx)).rows[0]?.ours ?? false;
    if (echoIsOurs(job, ourAppIds, sentByUs)) return 'ours' as const;

    // The customer's conversation on this channel: the open one, else the latest.
    const conv = (await sql<{ id: string; assigned_to: string | null }>`
      select c.id::text as id, c.assigned_to
        from conversations c
        join client_channels cc on cc.client_id = c.client_id and cc.channel = ${job.channel}
       where cc.channel_user_id = ${job.customer} and c.channel = ${job.channel}
       order by (c.closed_at is null) desc, c.updated_at desc
       limit 1`.execute(tx)).rows[0];
    if (!conv) return 'no_conversation' as const;
    await lockConversation(tx, conv.id);

    const written = (await sql<{ id: string }>`
      insert into messages (conversation_id, external_id, direction, input_type, text_content, ai_analysis, sent_at)
      values (${conv.id}::uuid, ${`echo:${job.mid}`}, 'outbound', ${job.text !== null ? 'text' : 'unknown'},
              ${job.text}, ${JSON.stringify({ received: job.received, by: 'owner_elsewhere' })}::jsonb, ${new Date(job.occurredAt)})
      on conflict do nothing
      returning id::text as id`.execute(tx)).rows[0];
    if (!written) return 'duplicate' as const;

    const owner = (await sql<{ id: string }>`
      select id::text as id from people where business_id = ${bid.value} and is_owner and archived_at is null
       order by created_at limit 1`.execute(tx)).rows[0] ?? null;
    // `decided_by` names a legacy agent row, which nothing writes any more; the
    // conversation's `owner_replied_elsewhere` event below says who and why.
    const superseded = (await sql<{ id: string }>`
      update drafts set status = 'superseded', decided_at = now()
       where conversation_id = ${conv.id}::uuid and status = 'pending'
      returning id::text as id`.execute(tx)).rows.length;

    const store = channelStore(tx, bid.value);
    const queued = (await sql<{ id: string }>`
      select id::text as id from outbound_messages
       where conversation_id = ${conv.id}::uuid and origin = 'employee' and status = 'queued'`.execute(tx)).rows;
    for (const q of queued) await store.transition(q.id, 'canceled', 'owner_replied_elsewhere');

    const repos = tenantRepos(tx, bid.value);
    const cid = conv.id as ConversationId;
    // The assistant's conversation, or one waiting for a person, becomes the
    // owner's; one a person already holds stays with them.
    if (ownershipOf(conv.assigned_to) !== 'OWNER_CONTROLLED') await repos.conversations.assign(cid, owner?.id ?? OWNER_AGENT);
    await repos.events.append(cid, 'owner_replied_elsewhere', {
      channel: job.channel, superseded, canceled: queued.length,
    });
    return 'recorded' as const;
  });
}
