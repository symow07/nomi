import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import type { SetupMilestones } from '../core/onboard/setupMinutes.js';

/**
 * BLOCK 4.4 — SETUP IN MINUTES: when each of the four milestones was FIRST reached (C0's `SetupMilestones`), read
 * from the rows that hold it. Historical: a milestone once reached stays reached, whatever happens after (a product
 * switched off, a channel disconnected). Setup's five steps (src/db/setup.ts) are the other question — is it true
 * now — and are unchanged. Every query names the workspace as well as RLS (an admin connection sees every row).
 *
 *   · signedUpAt — `businesses.signed_up_at`: null for a workspace the operator made (no stopwatch, dates only).
 *   · productsIn — the first product row of the workspace, or the first time the owner turned "Prices go to me" on
 *     (`prices_to_owner_set` with `on: true` on the audit trail), whichever came first: the design spec's rule, and
 *     the same two facts Setup's products step reads. Setup's step asks more NOW (a product active, priced and found
 *     by a name; every name a language needs); the milestone is the moment products first came in, so a later
 *     price or name the step still waits for does not move it.
 *   · contactsIn — the first customer in the list, by either door (the design spec, §3.3): the first file of customers
 *     added or matched (`businesses.contacts_first_imported_at`, 0232; a trigger keeps the first value), or the first
 *     customer of this workspace who wrote in — the earliest `clients.created_at` whose client has a conversation the
 *     owner did not mark as their own testing — whichever came first. A practice copy is another workspace, so its
 *     customers are never read here. The second door is READ, not stamped: erasing that first customer (their
 *     conversations go with them) can move this time later, to the next customer who wrote in or to the import.
 *   · channelConnected — the earliest connection of any kind Setup's channels step counts, archived or disconnected
 *     since or not: a WhatsApp channel (`channels.connected_at`, and its routing credential's `created_at`), an
 *     Instagram or Messenger credential (`channel_credentials.created_at`), a Meta account (`meta_accounts`), a mailbox
 *     (`mail_accounts.connected_at`). `first_channel_at()` (0117, billing's clock) reads the WhatsApp, Meta and mail
 *     ones; this adds the credentials, which a Page connected before 0117's tables also has.
 *   · firstReply — the first message the assistant wrote that went out to a customer: Setup's `first_success` rule (an
 *     outbound row with `origin = 'employee'` that reached sent, delivered or read), in a conversation of this
 *     workspace that the owner did not mark as their own testing; its send time (the queue time where none is kept).
 *
 * `funnel_workspaces()` (0104) is not touched: the cohort's figures stay as they were.
 */
export async function loadSetupMilestones(tx: Tx, businessId: BusinessId): Promise<SetupMilestones> {
  const r = (await sql<{
    signed_up_at: Date | null; products_in: Date | null; contacts_in: Date | null; channel_connected: Date | null; first_reply: Date | null;
  }>`
    select
      b.signed_up_at,
      least(
        (select min(p.created_at) from products p where p.business_id = ${businessId}::uuid),
        (select min(a.at) from channel_audit a
          where a.business_id = ${businessId}::uuid and a.action = 'prices_to_owner_set' and a.detail ->> 'on' = 'true')
      ) as products_in,
      least(
        b.contacts_first_imported_at,
        (select min(cl.created_at) from clients cl
          where cl.business_id = ${businessId}::uuid
            and exists (select 1 from conversations c
                         where c.client_id = cl.id and c.business_id = ${businessId}::uuid and not c.owner_testing))
      ) as contacts_in,
      least(
        (select min(ch.connected_at) from channels ch where ch.business_id = ${businessId}::uuid and ch.kind = 'whatsapp'),
        (select min(cc.created_at) from channel_credentials cc
          where cc.business_id = ${businessId}::uuid and cc.channel in ('whatsapp', 'instagram', 'messenger')),
        (select min(m.connected_at) from meta_accounts m where m.business_id = ${businessId}::uuid),
        (select min(ma.connected_at) from mail_accounts ma where ma.business_id = ${businessId}::uuid)
      ) as channel_connected,
      (select min(coalesce(o.sent_at, o.created_at)) from outbound_messages o
         join conversations c on c.id = o.conversation_id and c.business_id = ${businessId}::uuid
        where o.business_id = ${businessId}::uuid and o.origin = 'employee'
          and o.status in ('sent', 'delivered', 'read') and not c.owner_testing) as first_reply
    from businesses b
   where b.id = ${businessId}::uuid`.execute(tx)).rows[0];
  return {
    signedUpAt: r?.signed_up_at ?? null,
    productsIn: r?.products_in ?? null,
    contactsIn: r?.contacts_in ?? null,
    channelConnected: r?.channel_connected ?? null,
    firstReply: r?.first_reply ?? null,
  };
}
