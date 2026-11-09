import type { SendResult } from '../contract.js';
import type { MetaFetch } from './messaging.js';
import { SEND_TIMEOUT_MS } from './messaging.js';

type Config={accountId:string;accessToken:string;graphVersion:string;fetchImpl?:MetaFetch};
const identifier=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,512}$/.test(v);
const uncertain=():SendResult=>({ok:false,retryable:false,uncertain:true,error:'meta acceptance unknown'});
/** The Facebook Login private reply endpoint. No recipient.id or messaging_type: this is not a DM reply. */
export function metaCommentPrivateReplySender(cfg:Config):(commentId:string,body:string)=>Promise<SendResult>{
 const request:MetaFetch=cfg.fetchImpl??(fetch as unknown as MetaFetch);
 return async(commentId,body)=>{
  if(!/^\d+$/.test(cfg.accountId)||!/^\d+$/.test(commentId)||!/^v\d+\.\d+$/.test(cfg.graphVersion)||!body.trim()||body.length>1000)
   return {ok:false,retryable:false,error:'meta invalid comment reply'};
  try{
   const response=await request(`https://graph.facebook.com/${cfg.graphVersion}/${cfg.accountId}/messages`,{
    method:'POST',headers:{Authorization:`Bearer ${cfg.accessToken}`,'Content-Type':'application/json'},
    body:JSON.stringify({recipient:{comment_id:commentId},message:{text:body}}),signal:AbortSignal.timeout(SEND_TIMEOUT_MS),
   });
   if(response.status<200||response.status>=300)return {ok:false,retryable:false,error:`meta ${response.status}`};
   const data:unknown=JSON.parse(await response.text());
   if(!data||typeof data!=='object')return uncertain();
   const result=data as Record<string,unknown>;
   return identifier(result['message_id'])&&identifier(result['recipient_id'])
    ?{ok:true,providerMessageId:result['message_id'],recipientId:result['recipient_id']}:uncertain();
  }catch{return uncertain();}
 };
}

/** The public line under the comment. Fixed, and the only words this path can post. */
export const PUBLIC_COMMENT_REPLY = 'Sent you a message';

/**
 * The optional public reply, `POST /{ig-comment-id}/replies` with `message` (Meta's IG Comment Replies reference,
 * read 2026-11-10). Answered once by whoever claimed it: every failure, a lost answer included, is final here.
 */
export function metaCommentPublicReplySender(cfg:{accessToken:string;graphVersion:string;fetchImpl?:MetaFetch}):(commentId:string)=>Promise<SendResult>{
 const request:MetaFetch=cfg.fetchImpl??(fetch as unknown as MetaFetch);
 return async(commentId)=>{
  if(!/^\d+$/.test(commentId)||!/^v\d+\.\d+$/.test(cfg.graphVersion))return {ok:false,retryable:false,error:'meta invalid public reply'};
  try{
   const response=await request(`https://graph.facebook.com/${cfg.graphVersion}/${commentId}/replies`,{
    method:'POST',headers:{Authorization:`Bearer ${cfg.accessToken}`,'Content-Type':'application/json'},
    body:JSON.stringify({message:PUBLIC_COMMENT_REPLY}),signal:AbortSignal.timeout(SEND_TIMEOUT_MS),
   });
   if(response.status<200||response.status>=300)return {ok:false,retryable:false,error:`meta ${response.status}`};
   const data:unknown=JSON.parse(await response.text());
   const id=data&&typeof data==='object'?(data as Record<string,unknown>)['id']:undefined;
   return identifier(id)?{ok:true,providerMessageId:id}:uncertain();
  }catch{return uncertain();}
 };
}
