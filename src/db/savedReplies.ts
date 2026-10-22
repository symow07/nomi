import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { savedReplyProblem, type SavedReplyTexts } from '../core/owner/savedReplies.js';

/**
 * S1 (Phase 5, item 18; 0195) — the workspace's saved replies, read and kept. Nothing here sends: a saved reply's
 * words reach a buyer only from a reply box, by the owner's own reply (src/outbound/ownerReply.ts). Archived, never
 * deleted (G20).
 */
export type SavedReply = {
  readonly id: string; readonly title: string; readonly texts: SavedReplyTexts;
  readonly archived: boolean; readonly updatedAt: string;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listSavedReplies(tx: Tx, businessId: BusinessId, o: { readonly archived?: boolean } = {}): Promise<SavedReply[]> {
  return (await sql<{ id: string; title: string; texts: SavedReplyTexts; archived: boolean; updated_at: string }>`
    select id::text as id, title, texts, archived_at is not null as archived, to_json(coalesce(updated_at, created_at)) #>> '{}' as updated_at
      from saved_replies where business_id = ${businessId}::uuid and (${o.archived ?? false} or archived_at is null)
     order by archived_at is not null, lower(title)`.execute(tx)).rows
    .map((r) => ({ id: r.id, title: r.title, texts: r.texts, archived: r.archived, updatedAt: r.updated_at }));
}

export async function savedReplyOf(tx: Tx, businessId: BusinessId, id: string): Promise<SavedReply | null> {
  if (!UUID.test(id)) return null;
  return (await listSavedReplies(tx, businessId, { archived: true })).find((r) => r.id === id) ?? null;
}

export type SavedReplyRefusal = 'title' | 'texts' | 'too_long' | 'taken' | 'not_found';

/** A new saved reply, or why not (a title another one in use already has is `taken`). */
export async function addSavedReply(tx: Tx, businessId: BusinessId, by: string, title: string, texts: SavedReplyTexts):
  Promise<{ readonly kind: 'added'; readonly id: string } | { readonly kind: 'refused'; readonly reason: SavedReplyRefusal }> {
  const why = savedReplyProblem(title, texts);
  if (why) return { kind: 'refused', reason: why };
  if (await titleTaken(tx, businessId, title, null)) return { kind: 'refused', reason: 'taken' };
  const id = (await sql<{ id: string }>`insert into saved_replies (business_id, title, texts, created_by)
    values (${businessId}::uuid, ${title.trim()}, ${JSON.stringify(texts)}::jsonb, ${by}) returning id::text as id`.execute(tx)).rows[0]!.id;
  return { kind: 'added', id };
}

/** Its title and words, changed; an archived one is changed too (and stays archived). */
export async function updateSavedReply(tx: Tx, businessId: BusinessId, id: string, by: string, title: string, texts: SavedReplyTexts):
  Promise<{ readonly kind: 'saved' } | { readonly kind: 'refused'; readonly reason: SavedReplyRefusal }> {
  if (!UUID.test(id)) return { kind: 'refused', reason: 'not_found' };
  const why = savedReplyProblem(title, texts);
  if (why) return { kind: 'refused', reason: why };
  if (await titleTaken(tx, businessId, title, id)) return { kind: 'refused', reason: 'taken' };
  const n = (await sql`update saved_replies set title = ${title.trim()}, texts = ${JSON.stringify(texts)}::jsonb, updated_by = ${by}, updated_at = now()
    where business_id = ${businessId}::uuid and id = ${id}::uuid`.execute(tx)).numAffectedRows ?? 0n;
  return n > 0n ? { kind: 'saved' } : { kind: 'refused', reason: 'not_found' };
}

/** Archived (out of every list a reply box offers), or back in use. True when there was such a reply. */
export async function setSavedReplyArchived(tx: Tx, businessId: BusinessId, id: string, by: string, archived: boolean): Promise<boolean> {
  if (!UUID.test(id)) return false;
  if (!archived) {
    const row = await savedReplyOf(tx, businessId, id);
    if (!row || await titleTaken(tx, businessId, row.title, id)) return false;
  }
  const n = (await sql`update saved_replies set archived_at = ${archived ? sql`now()` : null}, archived_by = ${archived ? by : null}
    where business_id = ${businessId}::uuid and id = ${id}::uuid and (archived_at is null) = ${archived}`.execute(tx)).numAffectedRows ?? 0n;
  return n > 0n;
}

async function titleTaken(tx: Tx, businessId: BusinessId, title: string, except: string | null): Promise<boolean> {
  return (await sql<{ n: number }>`select count(*)::int as n from saved_replies where business_id = ${businessId}::uuid
    and archived_at is null and lower(btrim(title)) = lower(btrim(${title})) and (${except}::uuid is null or id <> ${except}::uuid)`.execute(tx)).rows[0]!.n > 0;
}

/** The language the buyer of this conversation writes in, as Nomi knows it (null when it does not). */
export async function buyerLanguageOf(tx: Tx, businessId: BusinessId, conversationId: string): Promise<string | null> {
  if (!UUID.test(conversationId)) return null;
  return (await sql<{ l: string | null }>`select cl.preferred_language as l from conversations c left join clients cl on cl.id = c.client_id
    where c.business_id = ${businessId}::uuid and c.id = ${conversationId}::uuid`.execute(tx)).rows[0]?.l ?? null;
}
