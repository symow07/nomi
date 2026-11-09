import {sql} from 'kysely';
import type {Tx} from './client.js';
import type {SendResult} from '../channels/contract.js';
import type {ConversationSendContext} from '../outbound/worker.js';
import type {BusinessId} from '../core/types/ids.js';
type Facts=NonNullable<ConversationSendContext['commentPrivateReplies']>;
type Binding={id:string;comment_id:string;account_id:string;outbound_id:string;conversation_id:string|null;identity:string;
 created_at:Date|null;asking:boolean;enabled:boolean;attempted_at:Date|null;outcome:string;public_requested:boolean;
 account_bound:boolean;origin:string;approved:boolean;kind:string;channel:string;to_wa_id:string;erased:boolean};

/** Erasure and prepare take the same per-comment lock before any comment row lock. */
async function binding(tx:Tx,business:string,outbound:string):Promise<Binding|null>{
 const key=(await sql<{id:string;account_id:string;comment_id:string}>`select c.id,c.account_id,c.comment_id from ig_comments c
 join ig_comment_replies r on r.comment_id=c.id and r.business_id=c.business_id
 where c.business_id=${business}::uuid and r.outbound_id=${outbound}::uuid`.execute(tx)).rows[0];
 if(!key)return null;
 await sql`select pg_advisory_xact_lock(hashtextextended(${'ig-comment:'+business+':'+key.account_id+':'+key.comment_id},0))`.execute(tx);
 return (await sql<Binding>`select c.id,c.comment_id,c.account_id,r.outbound_id,c.conversation_id,c.identity,c.created_at,c.asking,s.enabled,
 r.attempted_at,r.outcome,r.public_requested,o.origin,o.approved,o.kind,o.channel,o.to_wa_id,
 (m.archived_at is null and m.last_error is null and m.ig_account_id=c.account_id and b.practice_of is null and b.is_active
  and o.conversation_id=c.conversation_id and v.channel='instagram' and v.client_id=c.client_id
  and exists(select 1 from client_channels cc where cc.client_id=v.client_id and cc.channel='instagram' and cc.channel_user_id=c.identity)) as account_bound,
 ig_comment_was_erased(c.account_id,c.comment_id) as erased
 from ig_comments c join ig_comment_replies r on r.comment_id=c.id and r.business_id=c.business_id
 join outbound_messages o on o.id=r.outbound_id and o.business_id=c.business_id
 join conversations v on v.id=o.conversation_id and v.business_id=c.business_id
 join ig_comment_settings s on s.meta_account_id=c.meta_account_id and s.business_id=c.business_id and s.account_id=c.account_id
 join meta_accounts m on m.id=c.meta_account_id and m.business_id=c.business_id
 join businesses b on b.id=c.business_id
 where c.business_id=${business}::uuid and r.outbound_id=${outbound}::uuid
 for update of c,r,s,m`.execute(tx)).rows[0]??null;
}
export async function lockedCommentReplyFacts(tx:Tx,business:string,conversation:string,outbounds:readonly string[]):Promise<Facts>{
 const result:Record<string,Facts[string]>={};
 for(const id of [...outbounds].sort()){
  const r=await binding(tx,business,id);if(!r||r.conversation_id!==conversation)continue;
  result[id]={enabled:r.enabled,asking:r.asking,accountBound:r.account_bound&&!r.erased&&r.to_wa_id===r.identity,
   claim:r.attempted_at||r.outcome!=='reserved'?'used':'ready',createdAt:r.created_at,accountId:r.account_id};
 }
 return result;
}
export async function claimCommentPrivateReply(tx:Tx,business:string,outbound:string,now:Date):Promise<string|null>{
 const r=await binding(tx,business,outbound);
 if(!r||!r.account_bound||r.erased||!r.enabled||!r.asking||r.to_wa_id!==r.identity||r.attempted_at||r.outcome!=='reserved'
  ||r.origin!=='owner'||!r.approved||r.kind!=='comment_private_reply'||r.channel!=='instagram'||!r.created_at)return null;
 const age=now.getTime()-r.created_at.getTime();if(!Number.isFinite(age)||age<0||age>=7*86400000)return null;
 const got=await sql`update ig_comment_replies set attempted_at=${now} where outbound_id=${outbound}::uuid and business_id=${business}::uuid and attempted_at is null`.execute(tx);
 return got.numAffectedRows===1n?r.comment_id:null;
}
/** The transactional caller queues public work only when this insertion wins. Erased rows stay erased. */
export async function recordCommentPrivateReply(tx:Tx,business:string,outbound:string,result:SendResult,now:Date):Promise<string|null>{
 const r=await binding(tx,business,outbound);if(!r||!r.attempted_at||r.outcome!=='reserved')return null;
 const accepted=result.ok&&!!result.recipientId&&!!result.providerMessageId;
 await sql`update ig_comment_replies set outcome=${accepted?'accepted':!result.ok&&!result.uncertain?'refused':'uncertain'},
 accepted_at=${accepted?now:null},recipient_id=${accepted&&result.ok?result.recipientId!:null},provider_message_id=${accepted&&result.ok?result.providerMessageId:null}
 where business_id=${business}::uuid and outbound_id=${outbound}::uuid`.execute(tx);
 if(!accepted||!r.public_requested)return null;
 const inserted=await sql<{comment_id:string}>`insert into ig_comment_public_replies(business_id,comment_id) values(${business}::uuid,${r.id}::uuid)
 on conflict(comment_id) do nothing returning comment_id`.execute(tx);
 return inserted.rows[0]?.comment_id??null;
}

// ── The public "Sent you a message", once ────────────────────────────────

export type PublicClaim = { readonly metaAccountId: string; readonly accountId: string; readonly commentId: string };

/**
 * Claims the one public reply: only after the private reply was ACCEPTED, only while comments stay on for a live
 * account, and only once — `attempted_at` is written here and never cleared, so a job run twice asks nothing twice.
 * A claim that cannot go is finished as failed at once, with no call.
 */
export async function claimCommentPublicReply(tx: Tx, business: BusinessId, id: string): Promise<PublicClaim | null> {
  const key = (await sql<{ account_id: string; comment_id: string }>`select account_id, comment_id from ig_comments
    where business_id = ${business} and id = ${id}::uuid`.execute(tx)).rows[0];
  if (!key) return null;
  await sql`select pg_advisory_xact_lock(hashtextextended(${'ig-comment:' + business + ':' + key.account_id + ':' + key.comment_id},0))`.execute(tx);
  const row = (await sql<{ outcome: string; attempted_at: Date | null; private_outcome: string | null; requested: boolean | null;
    ready: boolean; meta_account_id: string }>`select p.outcome, p.attempted_at, r.outcome as private_outcome,
      r.public_requested as requested, c.meta_account_id,
      (coalesce(s.enabled, false) and m.archived_at is null and m.last_error is null and m.ig_account_id = c.account_id
        and b.practice_of is null and b.is_active) as ready
    from ig_comment_public_replies p
    join ig_comments c on c.id = p.comment_id and c.business_id = p.business_id
    join businesses b on b.id = c.business_id
    join meta_accounts m on m.id = c.meta_account_id and m.business_id = c.business_id
    left join ig_comment_settings s on s.meta_account_id = c.meta_account_id and s.business_id = c.business_id
    left join ig_comment_replies r on r.comment_id = c.id and r.business_id = c.business_id
   where p.business_id = ${business} and p.comment_id = ${id}::uuid
   for update of p`.execute(tx)).rows[0];
  if (!row || row.outcome !== 'waiting' || row.attempted_at !== null) return null;
  if (row.private_outcome !== 'accepted' || row.requested !== true || !row.ready) {
    await sql`update ig_comment_public_replies set attempted_at = now(), finished_at = now(), outcome = 'failed'
      where business_id = ${business} and comment_id = ${id}::uuid`.execute(tx);
    return null;
  }
  await sql`update ig_comment_public_replies set attempted_at = now()
    where business_id = ${business} and comment_id = ${id}::uuid`.execute(tx);
  return { metaAccountId: row.meta_account_id, accountId: key.account_id, commentId: key.comment_id };
}

export async function finishCommentPublicReply(tx: Tx, business: BusinessId, id: string, result: SendResult): Promise<void> {
  const outcome = result.ok ? 'accepted' : result.uncertain ? 'uncertain' : 'failed';
  await sql`update ig_comment_public_replies set finished_at = now(), outcome = ${outcome}
    where business_id = ${business} and comment_id = ${id}::uuid and attempted_at is not null and outcome = 'waiting'`.execute(tx);
}

// ── When the person answers in DMs ────────────────────────────────────────

/**
 * Which comment a DM answers, only when that is certain: the message replies to our private reply's own id, or there
 * is exactly one accepted private reply to this person whose context has not been used. The comment is linked to the
 * conversation and its context used once. Several candidates are an ambiguity, shown on the comments and guessed at
 * never. Returns the product to name, or null (none, ambiguous, or the comment named no single product).
 */
export async function attributeCommentReply(tx: Tx, business: BusinessId, conversationId: string, replyToMid: string | null):
Promise<{ readonly productName: string | null } | null> {
  const who = (await sql<{ identity: string; client_id: string }>`select cc.channel_user_id as identity, v.client_id
    from conversations v join client_channels cc on cc.client_id = v.client_id and cc.channel = 'instagram'
   where v.id = ${conversationId}::uuid and v.business_id = ${business} and v.channel = 'instagram'`.execute(tx)).rows;
  if (who.length === 0) return null;
  const ids = who.map((w) => w.identity);
  const candidates = (await sql<{ comment: string; name: string | null; matched: boolean }>`
    select c.id as comment, p.name, (c.match_state = 'matched' and p.id is not null) as matched
      from ig_comment_replies r
      join ig_comments c on c.id = r.comment_id and c.business_id = r.business_id
      left join products p on p.id = c.product_id and p.business_id = c.business_id
     where r.business_id = ${business} and r.outcome = 'accepted' and r.context_used_at is null
       and r.recipient_id = any(${ids}::text[])
       ${replyToMid ? sql`and r.provider_message_id = ${replyToMid}` : sql``}
     order by c.id
     for update of r`.execute(tx)).rows;
  if (candidates.length === 0) return null;
  if (candidates.length > 1) {
    await sql`update ig_comments set attribution_ambiguous = true
      where business_id = ${business} and id = any(${candidates.map((c) => c.comment)}::uuid[])`.execute(tx);
    return null;
  }
  const one = candidates[0]!;
  await sql`update ig_comment_replies set context_used_at = now()
    where business_id = ${business} and comment_id = ${one.comment}::uuid and context_used_at is null`.execute(tx);
  await sql`update ig_comments set conversation_id = coalesce(conversation_id, ${conversationId}::uuid),
      client_id = coalesce(client_id, ${who[0]!.client_id}::uuid)
    where business_id = ${business} and id = ${one.comment}::uuid`.execute(tx);
  return { productName: one.matched ? one.name : null };
}
