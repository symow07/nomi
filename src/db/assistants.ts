import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { defaultAssistantName } from '../core/owner/assistants.js';
import { parseLocale } from '../core/owner/i18n/locale.js';
import { assistantFor, type Assistant, type AssistantChannel, type AssistantRole, type ValidAssistant } from '../core/owner/assistants.js';

/**
 * A5 — the business's assistants. Every function takes the tenant transaction,
 * so row-level security scopes it and the caller decides what happens together.
 */

type Row = { id: string; name: string; role: AssistantRole; note: string | null; channels: string[]; is_default: boolean };
const toAssistant = (r: Row): Assistant => ({
  id: r.id, name: r.name, role: r.role, note: r.note, channels: r.channels as AssistantChannel[], isDefault: r.is_default,
});

/** Live assistants, the default first. */
export async function listAssistants(tx: Tx, businessId: BusinessId): Promise<readonly Assistant[]> {
  const r = await sql<Row>`
    select id::text as id, name, role, note, channels, is_default from assistants
     where business_id = ${businessId}::uuid and archived_at is null
     order by is_default desc, created_at`.execute(tx);
  return r.rows.map(toAssistant);
}

/**
 * The default assistant, made the first time it is needed — carrying the name
 * this business's employee always had in its own language, so an account that
 * never adds a second one sees no difference. Safe to call concurrently: the
 * partial unique index lets one insert win and the rest read it.
 */
export async function ensureDefaultAssistant(tx: Tx, businessId: BusinessId, nameIfNew?: string): Promise<Assistant> {
  const read = async () => (await sql<Row>`
    select id::text as id, name, role, note, channels, is_default from assistants
     where business_id = ${businessId}::uuid and is_default and archived_at is null limit 1`.execute(tx)).rows[0];
  const existing = await read();
  if (existing) return toAssistant(existing);
  // The name she has been READING: the caller's page language when there is
  // one, else the language the business's alerts are written in.
  // The language the business signed up in decides what she is first called.
  // One moment, one decision; from here the row is the only source of it.
  let name = nameIfNew?.trim();
  if (!name) {
    const b = (await sql<{ owner_locale: string | null }>`
      select owner_locale from businesses where id = ${businessId}::uuid`.execute(tx)).rows[0];
    name = defaultAssistantName(parseLocale(b?.owner_locale ?? 'en') ?? 'en');
  }
  await sql`insert into assistants (business_id, name, role, is_default, created_by)
            values (${businessId}::uuid, ${name}, 'sales', true, 'system')
            on conflict do nothing`.execute(tx);
  const made = await read();
  if (!made) throw new Error('default assistant could not be created');
  return toAssistant(made);
}

/**
 * Who answers a conversation starting on this channel. Null when the business
 * has no assistant rows yet: the conversation is then "the default's", as every
 * conversation before 0059 is, and nothing is created on a buyer's message.
 */
export async function assistantIdForChannel(tx: Tx, businessId: BusinessId, channel: string): Promise<string | null> {
  return assistantFor(await listAssistants(tx, businessId), channel)?.id ?? null;
}

export type AssistantWrite = 'saved' | 'channel_taken' | 'not_found' | 'is_default';

/** A channel belongs to at most one live assistant; the default claims none. */
async function channelTaken(tx: Tx, businessId: BusinessId, channels: readonly string[], exceptId: string | null): Promise<boolean> {
  if (channels.length === 0) return false;
  const r = await sql<{ n: string }>`
    select count(*)::text as n from assistants
     where business_id = ${businessId}::uuid and archived_at is null
       and (${exceptId}::uuid is null or id <> ${exceptId}::uuid)
       and channels && ${channels as string[]}::text[]`.execute(tx);
  return Number(r.rows[0]?.n ?? 0) > 0;
}

const audit = (tx: Tx, businessId: BusinessId, action: 'assistant_added' | 'assistant_changed' | 'assistant_archived', actor: string, detail: unknown) =>
  sql`insert into channel_audit (business_id, channel_id, action, actor, detail)
      values (${businessId}::uuid, null, ${action}, ${actor}, ${JSON.stringify(detail)}::jsonb)`.execute(tx);

export async function addAssistant(tx: Tx, businessId: BusinessId, v: ValidAssistant, actor: string, mainNameIfNew?: string): Promise<AssistantWrite> {
  // The one she has always had exists before a second one does, so the new one
  // can never become the default by being first.
  await ensureDefaultAssistant(tx, businessId, mainNameIfNew);
  if (await channelTaken(tx, businessId, v.channels, null)) return 'channel_taken';
  const r = await sql<{ id: string }>`
    insert into assistants (business_id, name, role, note, channels, created_by)
    values (${businessId}::uuid, ${v.name}, ${v.role}, ${v.note}, ${v.channels as string[]}, ${actor})
    returning id::text as id`.execute(tx);
  await audit(tx, businessId, 'assistant_added', actor, { id: r.rows[0]!.id, role: v.role, channels: v.channels });
  return 'saved';
}

export async function updateAssistant(tx: Tx, businessId: BusinessId, id: string, v: ValidAssistant, actor: string): Promise<AssistantWrite> {
  const cur = (await sql<{ is_default: boolean }>`
    select is_default from assistants where business_id = ${businessId}::uuid and id = ${id}::uuid and archived_at is null`.execute(tx)).rows[0];
  if (!cur) return 'not_found';
  // The default answers whatever nobody else claimed, so it is given no channels of its own.
  const channels = cur.is_default ? [] : v.channels;
  if (await channelTaken(tx, businessId, channels, id)) return 'channel_taken';
  await sql`update assistants set name = ${v.name}, role = ${v.role}, note = ${v.note}, channels = ${channels as string[]}
             where business_id = ${businessId}::uuid and id = ${id}::uuid`.execute(tx);
  await audit(tx, businessId, 'assistant_changed', actor, { id, fields: ['name', 'role', 'note', 'channels'] });
  return 'saved';
}

/**
 * Her name, and nothing else about her.
 *
 * Getting ready asks for the name alone, so it cannot go through
 * `updateAssistant`: that takes a whole assistant, and a page that does not ask
 * for a role, a note or channels would have to invent all three to say one
 * thing. The row is created if this is the first anyone has said about her —
 * which is the common case, since Getting ready comes before the team page.
 *
 * Audited as a change like any other. The caller stamps the attestation in the
 * same transaction, so the confirmation and what was confirmed cannot drift.
 */
export async function renameMainAssistant(tx: Tx, businessId: BusinessId, name: string, actor: string): Promise<void> {
  const current = await ensureDefaultAssistant(tx, businessId, name);
  if (current.name === name) return;
  await sql`update assistants set name = ${name}
             where business_id = ${businessId}::uuid and id = ${current.id}::uuid`.execute(tx);
  await audit(tx, businessId, 'assistant_changed', actor, { id: current.id, fields: ['name'] });
}

/** Archive, never erase — and never the default: someone always answers. */
export async function archiveAssistant(tx: Tx, businessId: BusinessId, id: string, actor: string): Promise<AssistantWrite> {
  const cur = (await sql<{ is_default: boolean }>`
    select is_default from assistants where business_id = ${businessId}::uuid and id = ${id}::uuid and archived_at is null`.execute(tx)).rows[0];
  if (!cur) return 'not_found';
  if (cur.is_default) return 'is_default';
  await sql`update assistants set archived_at = now() where business_id = ${businessId}::uuid and id = ${id}::uuid`.execute(tx);
  // Conversations she was answering go to whoever answers their channel now.
  await sql`update conversations set assistant_id = null where business_id = ${businessId}::uuid and assistant_id = ${id}::uuid and is_active`.execute(tx);
  await audit(tx, businessId, 'assistant_archived', actor, { id });
  return 'saved';
}

/**
 * A5.2 — the name a page about the WHOLE business says: the main assistant's.
 * Null when she has never opened the team page, which reads as the product's
 * constant for her language — the name that row would be given anyway.
 */
export async function mainAssistantName(tx: Tx, businessId: BusinessId): Promise<string | null> {
  return (await mainAssistant(tx, businessId)).name;
}

/**
 * The same look-up, and HOW MANY there are — because the nav asks a different
 * question from every other surface. A menu entry reading as one person's name
 * is right for a business with one assistant and wrong for a business with
 * four; that entry says "Team" instead. Counted in the same round trip the
 * name already costs, and cached together with it.
 */
export async function mainAssistant(
  tx: Tx, businessId: BusinessId,
): Promise<{ readonly name: string | null; readonly several: boolean }> {
  const r = await sql<{ name: string | null; n: number }>`
    select (select a.name from assistants a
             where a.business_id = ${businessId}::uuid and a.is_default and a.archived_at is null
             limit 1) as name,
           (select count(*)::int from assistants a
             where a.business_id = ${businessId}::uuid and a.archived_at is null) as n`.execute(tx);
  return { name: r.rows[0]?.name ?? null, several: (r.rows[0]?.n ?? 0) > 1 };
}

/**
 * The name a page or an alert about ONE conversation says: its own assistant's
 * — archived or not, because a conversation she held still names her — else
 * the main one's.
 */
export async function assistantNameOfConversation(tx: Tx, businessId: BusinessId, conversationId: string): Promise<string | null> {
  const r = await sql<{ name: string | null }>`
    select (select a.name from assistants a where a.id = c.assistant_id) as name
      from conversations c where c.business_id = ${businessId}::uuid and c.id = ${conversationId}::uuid`.execute(tx);
  return r.rows[0]?.name ?? mainAssistantName(tx, businessId);
}
