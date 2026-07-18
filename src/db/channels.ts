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
  reconcileStatus(providerMessageId: string, incoming: ProviderStatus, detail: string | null): Promise<'applied' | 'ignored' | 'unknown_message'>;
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
      }>`
        select c.assigned_to,
               coalesce(tb.paused, false) as paused,
               ch.last_inbound_at
          from conversations c
          left join lateral (
            select (status = 'pause') as paused
              from tenant_budgets where business_id = c.business_id limit 1
          ) tb on true
          left join channels ch on ch.business_id = c.business_id and ch.kind = 'whatsapp'
         where c.id = ${conversationId}
      `.execute(tx);
      const c = ctxRes.rows[0];

      const rows: OutboundWorkRow[] = res.rows.map((r) => ({
        id: r.id, seq: r.seq, status: r.status, requiresOrder: r.requires_order,
        attempts: r.attempts, sentAt: r.sent_at, to: r.to_wa_id ?? '', body: r.body,
        origin: r.origin, sendingSince: r.sending_since,
      }));
      const ctx: ConversationSendContext = {
        assignedTo: c?.assigned_to ?? null,
        paused: c?.paused ?? false,
        lastInboundAt: c?.last_inbound_at ?? null,
        template: 'none',   // template infra is post-M3; owner path applies
      };
      return { rows, ctx };
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

    /** Status webhook → monotonic reconciliation; ignored events still audited. */
    async reconcileStatus(providerMessageId, incoming, detail) {
      const res = await sql<{ id: string; status: OutboundStatus }>`
        select id, status from outbound_messages
         where provider_message_id = ${providerMessageId} for update
      `.execute(tx);
      const row = res.rows[0];
      if (!row) return 'unknown_message';

      const verdict = applyStatus(row.status, incoming);
      if (!verdict.apply) {
        await logTransition(row.id, row.status, row.status, `ignored ${incoming}: ${verdict.reason}`);
        return 'ignored';
      }
      await this.transition(row.id, verdict.next, detail);
      if (verdict.next === 'delivered' || verdict.next === 'read') {
        await sql`
          update channels set last_delivered_at = now(), consecutive_send_failures = 0,
                              updated_at = now()
           where business_id = ${businessId} and kind = 'whatsapp'
        `.execute(tx);
      }
      return 'applied';
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
