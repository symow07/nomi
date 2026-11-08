import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import type { InstagramCommentEvent } from '../channels/meta/comments.js';
import type { PostMatch } from '../core/conversation/sharedPost.js';
import { asksPriceOrAvailability } from '../core/channel/commentQuestions.js';

export type InstagramComment = {
  id: string; business_id: string; meta_account_id: string; account_id: string; comment_id: string;
  identity: string; username: string | null; words: string; media_id: string; received_at: Date;
  created_at: Date | null; asking: boolean; match_state: 'none' | 'matched' | 'several';
  product_id: string | null; product_name: string | null; post_url: string | null;
  enriched_at: Date | null; read_failed: boolean; conversation_id: string | null; attribution_ambiguous: boolean;
};

/** OFF, Practice and archived accounts produce no row, job, customer or outbound. Called inside ingress's transaction. */
export async function insertInstagramComment(tx: Tx, business: BusinessId, e: InstagramCommentEvent): Promise<string | null> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${'ig-comment:' + business + ':' + e.phoneNumberId + ':' + e.eventId},0))`.execute(tx);
  const account = (await sql<{ id: string }>`select m.id from meta_accounts m
    join ig_comment_settings s on s.meta_account_id=m.id and s.enabled
    join businesses b on b.id=m.business_id and b.practice_of is null and b.is_active
    where m.business_id=${business} and m.ig_account_id=${e.phoneNumberId} and m.archived_at is null and m.last_error is null
    for update of s, m`.execute(tx)).rows[0];
  if (!account || e.authorId === e.phoneNumberId) return null;
  if ((await sql<{ erased: boolean }>`select ig_comment_was_erased(${e.phoneNumberId},${e.eventId}) as erased`.execute(tx)).rows[0]?.erased) return null;
  return (await sql<{ id: string }>`insert into ig_comments
    (business_id,meta_account_id,account_id,comment_id,identity,username,words,media_id,notified_at,created_at,asking)
    values(${business},${account.id},${e.phoneNumberId},${e.eventId},${e.authorId},${e.username},${e.text},${e.mediaId},${e.occurredAt},${e.createdAt},${asksPriceOrAvailability(e.text)})
    on conflict(business_id,account_id,comment_id) do nothing returning id`.execute(tx)).rows[0]?.id ?? null;
}

export async function instagramComments(tx: Tx, business: BusinessId): Promise<InstagramComment[]> {
  return (await sql<InstagramComment>`select c.*,p.name as product_name from ig_comments c
    left join products p on p.id=c.product_id and p.business_id=c.business_id
    where c.business_id=${business} and c.asking order by c.received_at desc,c.id limit 200`.execute(tx)).rows;
}

export async function instagramComment(tx: Tx, business: BusinessId, id: string): Promise<InstagramComment | null> {
  return (await sql<InstagramComment>`select c.*,p.name as product_name from ig_comments c
    left join products p on p.id=c.product_id and p.business_id=c.business_id
    where c.business_id=${business} and c.id=${id}::uuid`.execute(tx)).rows[0] ?? null;
}

export async function commentsEnabled(tx: Tx, business: BusinessId, account: string): Promise<boolean> {
  return (await sql<{ enabled: boolean }>`select s.enabled from ig_comment_settings s join meta_accounts m on m.id=s.meta_account_id
    where s.business_id=${business} and s.meta_account_id=${account}::uuid and m.archived_at is null and m.last_error is null`.execute(tx)).rows[0]?.enabled === true;
}

/** A repeated enrichment job cannot queue another logical alert; its insert is in the same transaction as the job. */
export async function finishCommentRead(tx: Tx, business: BusinessId, id: string, input: {
  createdAt: Date | null; match: PostMatch; postUrl: string | null; failed: boolean;
}): Promise<boolean> {
  const row = (await sql<{ id: string; asking: boolean }>`update ig_comments c set
    created_at=coalesce(c.created_at,${input.createdAt}),match_state=${input.match.kind},
    product_id=${input.match.kind === 'matched' ? input.match.productId : null}::uuid,
    post_url=${input.postUrl},read_failed=${input.failed},enriched_at=now()
    where c.business_id=${business} and c.id=${id}::uuid and c.enriched_at is null
      and exists(select 1 from ig_comment_settings s join meta_accounts m on m.id=s.meta_account_id
        where s.meta_account_id=c.meta_account_id and s.enabled and m.archived_at is null and m.last_error is null)
    returning c.id,c.asking`.execute(tx)).rows[0];
  if (!row?.asking) return false;
  return (await sql<{ comment_id: string }>`insert into ig_comment_alerts(business_id,comment_id) values(${business},${id}::uuid)
    on conflict(comment_id) do nothing returning comment_id`.execute(tx)).rows.length > 0;
}
