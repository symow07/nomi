import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import type { Db, Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';

/**
 * S7 (Phase 5, item 22; 0204) — TELEGRAM, ONE NOMI BOT FOR EVERY BUSINESS (the owner's choice, 2026-10-22).
 *
 * A business that turns Telegram on gets a start code, and shares the bot's link with it. A chat that opened that link
 * belongs to that business; a chat that opened several writes to the one it opened last, while that business has
 * Telegram on (`telegram_route`, 0204). A chat that never opened one writes to nobody.
 */
export const START_CODE = /^[A-Za-z0-9_-]{16}$/;
const newCode = (): string => randomBytes(12).toString('base64url');

/** The start code a chat writes under now, or null: no business it opened is answering on Telegram. */
export async function telegramRoute(db: Db, chat: string): Promise<string | null> {
  return (await sql<{ code: string | null }>`select telegram_route(${chat}) as code`.execute(db)).rows[0]?.code ?? null;
}

/** The business's start code while Telegram is on; null while it is off (or never was). */
export async function telegramCode(tx: Tx, businessId: BusinessId): Promise<string | null> {
  return (await sql<{ k: string }>`select external_ref as k from channel_credentials
    where business_id = ${businessId}::uuid and channel = 'telegram' and is_active order by created_at desc limit 1`.execute(tx)).rows[0]?.k ?? null;
}

/**
 * On: the business answers chats that open its link, at the code it had (a link once shared keeps working) or a new
 * one. Off: those chats are answered by nobody until it is on again. Recorded on the channel's audit.
 */
export async function setTelegram(tx: Tx, businessId: BusinessId, on: boolean, actor: string): Promise<string | null> {
  const had = (await sql<{ id: string }>`select id::text as id from channel_credentials
    where business_id = ${businessId}::uuid and channel = 'telegram' order by created_at desc limit 1`.execute(tx)).rows[0];
  let credId = had?.id ?? null;
  if (on && !had) {
    credId = (await sql<{ id: string }>`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
      values (${businessId}::uuid, 'telegram', ${newCode()}, 'installation', 'service') returning id::text as id`.execute(tx)).rows[0]!.id;
  } else if (had) {
    await sql`update channel_credentials set is_active = ${on} where id = ${had.id}::uuid`.execute(tx);
  }
  if (credId) {
    const ch = (await sql<{ id: string }>`
      insert into channels (business_id, kind, status, credential_id, connected_at, disconnected_at, updated_at)
      values (${businessId}::uuid, 'telegram', ${on ? 'connected' : 'disconnected'}, ${credId}::uuid,
              ${on ? new Date() : null}, ${on ? null : new Date()}, now())
      on conflict (business_id, kind) do update
        set status = excluded.status, credential_id = excluded.credential_id,
            connected_at = coalesce(excluded.connected_at, channels.connected_at), disconnected_at = excluded.disconnected_at, updated_at = now()
      returning id::text as id`.execute(tx)).rows[0]!;
    await sql`insert into channel_audit (business_id, channel_id, action, actor, detail)
      values (${businessId}::uuid, ${ch.id}::uuid, ${on ? 'connect' : 'disconnect'}, ${actor}, ${JSON.stringify({ channel: 'telegram' })}::jsonb)`.execute(tx);
  }
  return on ? telegramCode(tx, businessId) : null;
}
