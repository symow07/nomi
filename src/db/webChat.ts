import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import type { Db, Tx } from './client.js';
import { parseBusinessId, type BusinessId } from '../core/types/ids.js';

/**
 * S7 (Phase 5, item 22) — THE BUSINESS'S CHAT PAGE, kept.
 *
 * A page is a credential like any channel's: a `channel_credentials` row on 'web_chat' whose `external_ref` is the
 * page's key — the unguessable part of its address, which the owner shares. It is found the way a webhook's account
 * is (`resolve_tenant`), so a page switched off answers nobody. A visitor is a handle on that channel, kept in their
 * own browser (the page's cookie) and nowhere else: `client_channels.channel_user_id`.
 */
export const CHAT_KEY = /^[A-Za-z0-9_-]{22}$/;
export const VISITOR = /^[A-Za-z0-9_-]{32}$/;
const newKey = (): string => randomBytes(16).toString('base64url');
export const newVisitor = (): string => randomBytes(24).toString('base64url');

/** The business whose page this is, while the page is on; null otherwise. */
export async function chatPageBusiness(db: Db, key: string): Promise<BusinessId | null> {
  if (!CHAT_KEY.test(key)) return null;
  const row = (await sql<{ business_id: string }>`select business_id::text as business_id from resolve_tenant('web_chat', ${key})`.execute(db)).rows[0];
  if (!row) return null;
  const b = parseBusinessId(row.business_id);
  return b.ok ? b.value : null;
}

export type ChatLine = { readonly id: string; readonly mine: boolean; readonly text: string; readonly at: Date };

/** What the visitor and the business said on this page, the newest 50, oldest first. */
export async function visitorLines(tx: Tx, businessId: BusinessId, visitor: string): Promise<readonly ChatLine[]> {
  if (!VISITOR.test(visitor)) return [];
  const rows = (await sql<{ id: string; direction: string; text: string; at: Date }>`
    select m.id::text as id, m.direction, m.text_content as text, m.sent_at as at
      from messages m
      join conversations c on c.id = m.conversation_id and c.business_id = ${businessId}::uuid and c.channel = 'web_chat'
      join client_channels cc on cc.client_id = c.client_id and cc.channel = 'web_chat' and cc.channel_user_id = ${visitor}
     where coalesce(m.text_content, '') <> ''
     order by m.sent_at desc, m.id desc limit 50`.execute(tx)).rows;
  return rows.reverse().map((r) => ({ id: r.id, mine: r.direction === 'inbound', text: r.text, at: new Date(r.at) }));
}

/** The newest line's mark: the page asks for it and looks again only when it moved. */
export async function visitorMark(tx: Tx, businessId: BusinessId, visitor: string): Promise<string> {
  const last = (await visitorLines(tx, businessId, visitor)).at(-1);
  return last ? `${last.at.getTime()}_${last.id}` : '0';
}

export async function businessName(tx: Tx, businessId: BusinessId): Promise<string> {
  return (await sql<{ name: string }>`select name from businesses where id = ${businessId}::uuid`.execute(tx)).rows[0]?.name ?? '';
}

/** The page's key while it is on; null while it is off (or was never made). */
export async function chatPageKey(tx: Tx, businessId: BusinessId): Promise<string | null> {
  return (await sql<{ k: string }>`select external_ref as k from channel_credentials
    where business_id = ${businessId}::uuid and channel = 'web_chat' and is_active order by created_at desc limit 1`.execute(tx)).rows[0]?.k ?? null;
}

/**
 * On: the page answers, at the key it had (an address once shared keeps working) or at a new one. Off: it answers
 * nobody — the key is kept, so switching on again brings the same address back. Recorded on the channel's audit.
 */
export async function setChatPage(tx: Tx, businessId: BusinessId, on: boolean, actor: string): Promise<string | null> {
  const had = (await sql<{ id: string; k: string }>`select id::text as id, external_ref as k from channel_credentials
    where business_id = ${businessId}::uuid and channel = 'web_chat' order by created_at desc limit 1`.execute(tx)).rows[0];
  let credId = had?.id ?? null;
  if (on && !had) {
    credId = (await sql<{ id: string }>`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
      values (${businessId}::uuid, 'web_chat', ${newKey()}, 'none', 'service') returning id::text as id`.execute(tx)).rows[0]!.id;
  } else if (had) {
    await sql`update channel_credentials set is_active = ${on} where id = ${had.id}::uuid`.execute(tx);
  }
  if (credId) {
    const ch = (await sql<{ id: string }>`
      insert into channels (business_id, kind, status, credential_id, connected_at, disconnected_at, updated_at)
      values (${businessId}::uuid, 'web_chat', ${on ? 'connected' : 'disconnected'}, ${credId}::uuid,
              ${on ? new Date() : null}, ${on ? null : new Date()}, now())
      on conflict (business_id, kind) do update
        set status = excluded.status, credential_id = excluded.credential_id,
            connected_at = coalesce(excluded.connected_at, channels.connected_at), disconnected_at = excluded.disconnected_at, updated_at = now()
      returning id::text as id`.execute(tx)).rows[0]!;
    await sql`insert into channel_audit (business_id, channel_id, action, actor, detail)
      values (${businessId}::uuid, ${ch.id}::uuid, ${on ? 'connect' : 'disconnect'}, ${actor}, ${JSON.stringify({ channel: 'web_chat' })}::jsonb)`.execute(tx);
  }
  return on ? chatPageKey(tx, businessId) : null;
}
