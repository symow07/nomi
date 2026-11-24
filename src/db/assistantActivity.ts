import {sql} from 'kysely';
import type {Tx} from './client.js';
import {readAssistantPage,type AssistantPage,type AssistantPageOptions} from './assistantKnowledge.js';
export type AssistantActivityKind='promote'|'revoke'|'self_demote'|'spotcheck_pass'|'spotcheck_improve'|'spotcheck_issue'|'learned_edit';
export type AssistantActivityRow={readonly id:string;readonly kind:AssistantActivityKind;readonly capability:string|null;readonly at:Date;readonly why:string|null;readonly language:string|null;readonly conversationId:string|null};
/** UI Block 6 · F39 — which events the page shows: all, the sending changes, the reply checks, or the corrections. */
export type AssistantActivityShow='all'|'sending'|'checks'|'edits';
export const ACTIVITY_SHOWS:readonly AssistantActivityShow[]=['all','sending','checks','edits'];
export const activityShow=(raw:unknown):AssistantActivityShow=>ACTIVITY_SHOWS.includes(raw as AssistantActivityShow)?raw as AssistantActivityShow:'all';
/** The existing growth union, fully paged. IDs stay text, including bigint capability events. */
export async function readAssistantActivity(tx:Tx,businessId:string,o:AssistantPageOptions&{readonly show?:AssistantActivityShow}={}):Promise<AssistantPage<AssistantActivityRow>> {
 const bid=businessId.toLowerCase(),show=o.show??'all';
 const sending=sql`
  select 'capability:'||e.id::text as id,case when e.action='promote' then 'promote' when e.actor='system_self_demoted' then 'self_demote' else 'revoke' end as kind,
   e.capability,e.at,e.reasons[1] as why,e.language,null::text as "conversationId" from capability_events e where e.business_id::text=${bid}`;
 const checks=sql`
  select 'check:'||s.id::text as id,case when s.verdict='correct' then 'spotcheck_pass' when s.verdict='needs_improvement' then 'spotcheck_improve' else 'spotcheck_issue' end as kind,
   null::text as capability,s.answered_at as at,null::text as why,null::text as language,c.id::text as "conversationId" from spot_checks s
   left join conversations c on c.id=s.conversation_id and c.business_id=s.business_id
   where s.business_id::text=${bid} and s.answered_at is not null`;
 const edits=sql`
  select 'edit:'||d.id::text as id,'learned_edit' as kind,d.capability,d.decided_at as at,null::text as why,null::text as language,c.id::text as "conversationId" from drafts d
   left join conversations c on c.id=d.conversation_id and c.business_id=d.business_id
   where d.business_id::text=${bid} and d.status='edited' and d.decided_at is not null`;
 const parts=show==='sending'?[sending]:show==='checks'?[checks]:show==='edits'?[edits]:[sending,checks,edits];
 return readAssistantPage(tx,sql.join(parts,sql` union all `),sql`at desc,id`,o);
}
