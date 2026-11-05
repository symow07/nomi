import {sql} from 'kysely';
import type {Tx} from './client.js';
import {readAssistantPage,type AssistantPage,type AssistantPageOptions} from './assistantKnowledge.js';
export type AssistantActivityKind='promote'|'revoke'|'self_demote'|'spotcheck_pass'|'spotcheck_improve'|'spotcheck_issue'|'learned_edit';
export type AssistantActivityRow={readonly id:string;readonly kind:AssistantActivityKind;readonly capability:string|null;readonly at:Date;readonly why:string|null;readonly language:string|null;readonly conversationId:string|null};
/** The existing growth union, fully paged. IDs stay text, including bigint capability events. */
export async function readAssistantActivity(tx:Tx,businessId:string,o:AssistantPageOptions={}):Promise<AssistantPage<AssistantActivityRow>> {
 const bid=businessId.toLowerCase();
 return readAssistantPage(tx,sql`
  select 'capability:'||e.id::text as id,case when e.action='promote' then 'promote' when e.actor='system_self_demoted' then 'self_demote' else 'revoke' end as kind,
   e.capability,e.at,e.reasons[1] as why,e.language,null::text as "conversationId" from capability_events e where e.business_id::text=${bid}
  union all
  select 'check:'||s.id::text,case when s.verdict='correct' then 'spotcheck_pass' when s.verdict='needs_improvement' then 'spotcheck_improve' else 'spotcheck_issue' end,
   null::text,s.answered_at,null::text,null::text,c.id::text from spot_checks s
   left join conversations c on c.id=s.conversation_id and c.business_id=s.business_id
   where s.business_id::text=${bid} and s.answered_at is not null
  union all
  select 'edit:'||d.id::text,'learned_edit',d.capability,d.decided_at,null::text,null::text,c.id::text from drafts d
   left join conversations c on c.id=d.conversation_id and c.business_id=d.business_id
   where d.business_id::text=${bid} and d.status='edited' and d.decided_at is not null`,sql`at desc,id`,o);
}
