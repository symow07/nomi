import {sql} from 'kysely';
import type {Tx} from './client.js';
import type {SendResult} from '../channels/contract.js';
import type {ConversationSendContext} from '../outbound/worker.js';
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
