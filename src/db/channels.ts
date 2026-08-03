import { isAllowlisted } from '../channels/allowlist.js';
import { DAILY_OUTBOUND_CEILING } from '../core/channel/limits.js';
import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import type { OutboundStore, OutboundWorkRow, ConversationSendContext } from '../outbound/worker.js';
import type { OutboundStatus } from '../outbound/sequencer.js';
import { applyStatus, type ProviderStatus } from '../core/channel/delivery.js';
import type { ConnectionAction } from '../channels/contract.js';

/**
 * M3 — DB-backed channel store (migration 0011). Runs inside withTenantTx
 * like every repo; RLS scopes every statement. Raw-SQL style: these tables
 * sit outside the typed core schema on purpose — they're plumbing, not
 * domain.
 */

export function channelStore(tx: Tx, businessId: BusinessId): OutboundStore & {
  reconcileStatus(providerMessageId: string, incoming: ProviderStatus, detail: string | null): Promise<{
    outcome: 'applied' | 'ignored' | 'unknown_message';
    conversationId: string | null;
  }>;
  recordAudit(action: ConnectionAction, actor: string, detail: Record<string, unknown>): Promise<void>;
} {
  async function logTransition(outboundId: string, from: string, to: string, detail: string | null) {
    await sql`
      insert into outbound_transitions (business_id, outbound_id, from_status, to_status, detail)
      values (${businessId}, ${outboundId}, ${from}, ${to}, ${detail})
    `.execute(tx);
  }

  return {
    async load(conversationId) {
      const res = await sql<{
        id: string; seq: number; status: OutboundStatus; requires_order: boolean;
        attempts: number; sent_at: Date | null; to_wa_id: string | null; body: string;
        origin: 'employee' | 'owner'; sending_since: Date | null;
      }>`
        select id, seq, status, requires_order, attempts, sent_at, to_wa_id, body,
               origin, sending_since
          from outbound_messages
         where conversation_id = ${conversationId}
           and (next_retry_at is null or next_retry_at <= now())
         order by seq
      `.execute(tx);

      const ctxRes = await sql<{
        assigned_to: string | null; paused: boolean; last_inbound_at: Date | null;
        pilot_mode: boolean | null; activated_at: Date | null;
        buyer_wa_id: string | null; sent_today: number;
      }>`
        select c.assigned_to,
               coalesce(tb.paused, false) as paused,
               ch.last_inbound_at,
               ch.pilot_mode, ch.activated_at,
               cc.channel_user_id as buyer_wa_id,
               (select count(*)::int from outbound_messages om
                 where om.business_id = c.business_id and om.origin = 'employee'
                   and om.status in ('sent','delivered','read')
                   and om.sent_at >= (date_trunc('day', now() at time zone 'Asia/Shanghai')
                                       at time zone 'Asia/Shanghai')) as sent_today
          from conversations c
          -- BUGFIX (found in M18.2): this compared a column named status,
          -- which tenant_budgets does not have, so the query threw on EVERY
          -- call and this whole load() path had never run against a real
          -- database (the M3 worker tests use an in-memory store, and in
          -- disabled mode no outbound ever drives). on_exceeded is the POLICY;
          -- a tenant is actually paused only when today's usage has exceeded
          -- its budget AND that policy is pause — the same rule that
          -- core/budget.ts checkBudget applies.
          left join lateral (
            select (b.on_exceeded = 'pause'
                    and (coalesce(u.llm_calls, 0) >= b.daily_llm_calls
                      or coalesce(u.input_tokens, 0) + coalesce(u.output_tokens, 0) >= b.daily_tokens)
                   ) as paused
              from tenant_budgets b
              left join usage_ledger u
                on u.business_id = b.business_id
               and u.day = (now() at time zone 'Asia/Shanghai')::date
             where b.business_id = c.business_id limit 1
          ) tb on true
          left join channels ch on ch.business_id = c.business_id and ch.kind = 'whatsapp'
          left join client_channels cc on cc.client_id = c.client_id and cc.channel = 'whatsapp'
         where c.id = ${conversationId}
      `.execute(tx);
      const c = ctxRes.rows[0];

      const rows: OutboundWorkRow[] = res.rows.map((r) => ({
        id: r.id, seq: r.seq, status: r.status, requiresOrder: r.requires_order,
        attempts: r.attempts, sentAt: r.sent_at, to: r.to_wa_id ?? '', body: r.body,
        origin: r.origin, sendingSince: r.sending_since,
      }));
      // M18.2 — pilot mode + allowlist resolved INSIDE this transaction, so the
      // gate decides on current state. Both fail closed: a missing channel row
      // counts as pilot mode ON, an unresolved buyer number as not allowed.
      // M20.1 — CONNECTED is not ACTIVATED. `activated_at` is written only by
      // the owner's explicit decision; a missing channel row means not live.
      const activated = c?.activated_at != null;
      const pilotMode = c?.pilot_mode ?? true;
      const recipientAllowed = pilotMode
        ? await isAllowlisted(tx, businessId, c?.buyer_wa_id ?? null)
        : true;

      const ctx: ConversationSendContext = {
        assignedTo: c?.assigned_to ?? null,
        paused: c?.paused ?? false,
        lastInboundAt: c?.last_inbound_at ?? null,
        template: 'none',   // template infra is post-M3; owner path applies
        activated,
        pilotMode,
        recipientAllowed,
        // M18.5 — counts EMPLOYEE messages actually sent today, so an owner
        // reply is never blocked by the ceiling.
        dailyCeilingReached: (c?.sent_today ?? 0) >= DAILY_OUTBOUND_CEILING,
      };
      return { rows, ctx };
    },

    // M18.2 — a blocked send is recorded where the owner can see it. The status
    // transition already makes it non-silent; this makes it visible.
    async auditBlocked(outboundId, to, reason) {
      await sql`
        insert into channel_audit (business_id, action, actor, detail)
        values (${businessId}, 'blocked_not_allowlisted', 'system',
                ${JSON.stringify({ outboundId, to, reason })}::jsonb)
      `.execute(tx);
    },

    async transition(id, to, detail) {
      const prev = await sql<{ status: string }>`
        select status from outbound_messages where id = ${id} for update
      `.execute(tx);
      const from = prev.rows[0]?.status ?? 'unknown';
      await sql`
        update outbound_messages
           set status = ${to},
               sending_since = case when ${to} = 'sending' then now() else sending_since end,
               sent_at       = case when ${to} = 'sent' then now() else sent_at end,
               delivered_at  = case when ${to} = 'delivered' then now() else delivered_at end,
               read_at       = case when ${to} = 'read' then now() else read_at end,
               cancel_reason = case when ${to} = 'canceled' then ${detail} else cancel_reason end,
               attempts      = case when ${to} = 'sending' then attempts + 1 else attempts end,
               last_error    = coalesce(${detail}, last_error)
         where id = ${id}
      `.execute(tx);
      await logTransition(id, from, to, detail);
    },

    async recordProviderId(id, providerMessageId) {
      await sql`
        update outbound_messages set provider_message_id = ${providerMessageId}
         where id = ${id}
      `.execute(tx);
    },

    async scheduleRetry(id, delayMs, error) {
      await sql`
        update outbound_messages
           set next_retry_at = now() + make_interval(secs => ${delayMs / 1000}),
               last_error = ${error}
         where id = ${id}
      `.execute(tx);
    },

    async deadLetter(id, error) {
      await sql`
        update outbound_messages
           set dead_lettered_at = now(), last_error = ${error}
         where id = ${id}
      `.execute(tx);
    },

    /** Status webhook → monotonic reconciliation; ignored events still audited.
     * Returns the conversation so the caller can re-drive its outbound queue
     * (a 'delivered' may unblock the next ordered message). */
    async reconcileStatus(providerMessageId, incoming, detail) {
      const res = await sql<{ id: string; status: OutboundStatus; conversation_id: string }>`
        select id, status, conversation_id from outbound_messages
         where provider_message_id = ${providerMessageId} for update
      `.execute(tx);
      const row = res.rows[0];
      if (!row) return { outcome: 'unknown_message', conversationId: null };

      const verdict = applyStatus(row.status, incoming);
      if (!verdict.apply) {
        await logTransition(row.id, row.status, row.status, `ignored ${incoming}: ${verdict.reason}`);
        return { outcome: 'ignored', conversationId: row.conversation_id };
      }
      await this.transition(row.id, verdict.next, detail);
      if (verdict.next === 'delivered' || verdict.next === 'read') {
        await sql`
          update channels set last_delivered_at = now(), consecutive_send_failures = 0,
                              updated_at = now()
           where business_id = ${businessId} and kind = 'whatsapp'
        `.execute(tx);
      }
      return { outcome: 'applied', conversationId: row.conversation_id };
    },

    async recordAudit(action, actor, detail) {
      await sql`
        insert into channel_audit (business_id, channel_id, action, actor, detail)
        select ${businessId}, id, ${action}, ${actor}, ${JSON.stringify(detail)}::jsonb
          from channels where business_id = ${businessId} and kind = 'whatsapp'
      `.execute(tx);
    },
  };
}

/**
 * Find-or-create the client + active conversation for an inbound WhatsApp
 * identity. Tenant comes from the channel credential (caller resolved it) —
 * NEVER from the payload. Runs inside the caller's tenant transaction.
 */
export async function ensureConversation(
  tx: Tx,
  businessId: BusinessId,
  waId: string,
  profileName: string | null,
): Promise<{ conversationId: string; clientId: string }> {
  const existing = await sql<{ client_id: string }>`
    select client_id from client_channels
     where channel = 'whatsapp' and channel_user_id = ${waId}
  `.execute(tx);
  let clientId = existing.rows[0]?.client_id;

  if (!clientId) {
    const client = await sql<{ id: string }>`
      insert into clients (business_id, display_name, phone)
      values (${businessId}, ${profileName}, ${waId})
      returning id
    `.execute(tx);
    clientId = client.rows[0]!.id;
    await sql`
      insert into client_channels (client_id, channel, channel_user_id)
      values (${clientId}, 'whatsapp', ${waId})
      on conflict (channel, channel_user_id) do nothing
    `.execute(tx);
  }

  const active = await sql<{ id: string }>`
    select id from conversations
     where client_id = ${clientId} and is_active order by created_at desc limit 1
  `.execute(tx);
  let conversationId = active.rows[0]?.id;

  if (!conversationId) {
    const conv = await sql<{ id: string }>`
      insert into conversations (business_id, client_id, channel)
      values (${businessId}, ${clientId}, 'whatsapp')
      returning id
    `.execute(tx);
    conversationId = conv.rows[0]!.id;
    await sql`
      insert into conversation_state (conversation_id)
      values (${conversationId}) on conflict (conversation_id) do nothing
    `.execute(tx);
  }
  return { conversationId, clientId };
}

/**
 * Queue a reply as an outbound row (the drive loop sends it). Seq is
 * per-conversation under the caller's advisory lock; recipient wa_id comes
 * from the conversation's own channel identity.
 */
export async function enqueueOutboundRow(
  tx: Tx,
  businessId: BusinessId,
  conversationId: string,
  body: string,
  origin: 'employee' | 'owner' = 'employee',
): Promise<string | null> {
  const to = await sql<{ channel_user_id: string }>`
    select cc.channel_user_id
      from conversations c
      join client_channels cc on cc.client_id = c.client_id and cc.channel = 'whatsapp'
     where c.id = ${conversationId}
     limit 1
  `.execute(tx);
  const waId = to.rows[0]?.channel_user_id;
  if (!waId) return null;   // no channel identity — nothing to send to

  // At-least-once jobs: a retry after commit must not queue the reply twice.
  // Employee replies dedupe on identical recent body; owner text never does
  // (repeating yourself on purpose is a human right).
  const row = await sql<{ id: string }>`
    insert into outbound_messages
      (business_id, conversation_id, seq, body, origin, to_wa_id)
    select ${businessId}, ${conversationId},
           coalesce(max(seq), 0) + 1, ${body}, ${origin}, ${waId}
      from outbound_messages where conversation_id = ${conversationId}
    having ${origin} = 'owner' or not exists (
      select 1 from outbound_messages
       where conversation_id = ${conversationId} and body = ${body}
         and origin = 'employee' and status not in ('failed','canceled')
         and created_at > now() - interval '10 minutes')
    returning id
  `.execute(tx);
  return row.rows[0]?.id ?? null;
}
