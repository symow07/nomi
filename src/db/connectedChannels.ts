import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';

/**
 * Phase 4b (audit A4 / CC-11) — which of the places a buyer writes to this
 * business are CONNECTED, answered once for every surface that asks.
 *
 * Setup's "channels" step and Getting ready's channel item used to ask only
 * about WhatsApp, so a business that sells on Instagram, Messenger or e-mail
 * could never finish setting up — production's one live business among them.
 * They now read THIS, and so does the Channels page, which is where the
 * definitions came from:
 *
 *   - WhatsApp: a channel row that the owner has not disconnected, holding an
 *     active credential. `loadChannels` adds one condition only it can know —
 *     the installation's provider is configured — and otherwise reads this.
 *   - Instagram / Messenger: an active credential for that channel, written by
 *     C9 (the host's account) or C10 (her own Page). `metaLinkStatus` reads it.
 *   - E-mail: the live mailbox — `liveMailAccount`'s row, unarchived — unless
 *     the provider has refused its token (`last_error`): the page shows that one
 *     as needing attention, not as connected. Written here as SQL rather than a
 *     call, because `mailAccounts.ts` names the OAuth connector's types and this
 *     module sits on the worker's import path, which must never reach a
 *     connector (c5-prospects.test.ts); phase4-first-run's integration test
 *     holds the two answers equal. The installation's own mail server is not
 *     counted: it can send, but no buyer can write to it.
 *
 * Tenant-safe regardless of RLS: every figure filters by `business_id`.
 */
export type BuyerChannel = 'whatsapp' | 'instagram' | 'messenger' | 'email';
export const BUYER_CHANNELS: readonly BuyerChannel[] = ['whatsapp', 'instagram', 'messenger', 'email'];

export type ConnectedChannels = Readonly<Record<BuyerChannel, boolean>>;

export async function connectedChannels(tx: Tx, businessId: BusinessId): Promise<ConnectedChannels> {
  const r = (await sql<{ whatsapp: boolean; instagram: boolean; messenger: boolean; email: boolean }>`
    select
      exists(select 1 from channels ch
              where ch.business_id = ${businessId}::uuid and ch.kind = 'whatsapp' and ch.status <> 'disconnected'
                and exists(select 1 from channel_credentials cc
                            where cc.business_id = ch.business_id and cc.channel = 'whatsapp' and cc.is_active)) as whatsapp,
      exists(select 1 from channel_credentials
              where business_id = ${businessId}::uuid and channel = 'instagram' and is_active) as instagram,
      exists(select 1 from channel_credentials
              where business_id = ${businessId}::uuid and channel = 'messenger' and is_active) as messenger,
      exists(select 1 from mail_accounts
              where business_id = ${businessId}::uuid and archived_at is null and last_error is null) as email
  `.execute(tx)).rows[0]!;
  return { whatsapp: r.whatsapp, instagram: r.instagram, messenger: r.messenger, email: r.email };
}

/** Setup's step and Getting ready's item: at least one place a buyer can write is connected. */
export const anyConnected = (c: ConnectedChannels): boolean => BUYER_CHANNELS.some((k) => c[k]);
