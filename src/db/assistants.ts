import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { EMPLOYEE_NAME } from '../core/owner/i18n/messages.js';
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
export async function ensureDefaultAssistant(tx: Tx, businessId: BusinessId): Promise<Assistant> {
  const read = async () => (await sql<Row>`
    select id::text as id, name, role, note, channels, is_default from assistants
     where business_id = ${businessId}::uuid and is_default and archived_at is null limit 1`.execute(tx)).rows[0];
  const existing = await read();
  if (existing) return toAssistant(existing);
  const b = (await sql<{ owner_locale: string | null }>`
    select owner_locale from businesses where id = ${businessId}::uuid`.execute(tx)).rows[0];
  const name = EMPLOYEE_NAME[parseLocale(b?.owner_locale ?? 'en') ?? 'en'];
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

export async function addAssistant(tx: Tx, businessId: BusinessId, v: ValidAssistant, actor: string): Promise<AssistantWrite> {
  // The one she has always had exists before a second one does, so the new one
  // can never become the default by being first.
  await ensureDefaultAssistant(tx, businessId);
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
