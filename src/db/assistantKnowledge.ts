import {sql,type RawBuilder} from 'kysely';
import type {Tx} from './client.js';
import type {KnowledgeKind,KnowledgeSource} from '../core/types/knowledge.js';
import {literalLike} from './customerPaging.js';

export type AssistantPageOptions={readonly page?:number;readonly size?:number;readonly q?:string};
export type AssistantPage<T>={readonly rows:readonly T[];readonly total:number;readonly page:number;readonly pageSize:number;readonly from:number;readonly to:number;readonly next:number|null;readonly prev:number|null};
export type KnowledgeProductRow={readonly id:string;readonly name:string|null;readonly nameZh:string|null;readonly count:number;readonly isActive:boolean};
export type KnowledgeFactRow={readonly id:string;readonly productId:string|null;readonly kind:KnowledgeKind;readonly label:string;readonly content:string;readonly source:KnowledgeSource;readonly createdAt:Date};
export type KnowledgeReadingRow={readonly id:string;readonly source:string;readonly lineCount:number;readonly createdAt:Date;readonly decidedAt:Date|null;readonly written:number|null;readonly replacedBy:string|null;readonly state:'pending'|'approved'|'replaced'};
export const assistantSearch=(s:string|undefined):string=>s?.trim().slice(0,200)??'';

/** Count, clamp and rows share one statement snapshot. Source must supply a unique text id. */
export async function readAssistantPage<T extends {readonly id:string}>(tx:Tx,source:RawBuilder<unknown>,sort:RawBuilder<unknown>,o:AssistantPageOptions):Promise<AssistantPage<T>> {
 const size=Number.isSafeInteger(o.size)?Math.max(1,Math.min(100,o.size!)):50;
 const wanted=Number.isSafeInteger(o.page)?Math.max(1,o.page!):1;
 const result=(await sql<T&{_total:number;_page:number}>`
  with records as (${source}), bounds as (
   select count(*)::int as n,least(${wanted}::numeric,greatest(1,ceil(count(*)::numeric/${size})))::int as p from records
  ) select r.*,bounds.n as _total,bounds.p as _page from bounds left join lateral (
   select * from records order by ${sort} limit ${size} offset ((bounds.p-1)*${size})
  ) r on true order by ${sort}`.execute(tx)).rows;
 const total=result[0]?._total??0,page=result[0]?._page??1;
 const rows=result.filter(r=>r.id!==null).map(({_total:_n,_page:_p,...r})=>r as unknown as T);
 return {rows,total,page,pageSize:size,from:rows.length?(page-1)*size+1:0,to:rows.length?(page-1)*size+rows.length:0,next:page*size<total?page+1:null,prev:page>1?page-1:null};
}
export async function readKnowledgeProductsPage(tx:Tx,businessId:string,o:AssistantPageOptions&{readonly state?:'active'|'inactive'|'all'}={}):Promise<AssistantPage<KnowledgeProductRow>> {
 const q=assistantSearch(o.q),state=o.state==='all'?sql`true`:sql`p.is_active=${o.state!=='inactive'}`;
 return readAssistantPage(tx,sql`select p.id::text as id,p.name,p.name_zh as "nameZh",p.is_active as "isActive",
  (select count(*)::int from product_knowledge k where k.business_id=p.business_id and k.product_id=p.id and k.status='active') as count
  from products p where p.business_id::text=${businessId.toLowerCase()} and ${state}
  and ${q?sql`(coalesce(p.name,'') ilike ${literalLike(q)} or coalesce(p.name_zh,'') ilike ${literalLike(q)} or p.sku ilike ${literalLike(q)})`:sql`true`}`,sql`name asc nulls last,id`,o);
}
export async function readKnowledgeFactsPage(tx:Tx,businessId:string,o:AssistantPageOptions&{readonly productId?:string|null}={}):Promise<AssistantPage<KnowledgeFactRow>> {
 const q=assistantSearch(o.q);
 return readAssistantPage(tx,sql`select k.id::text as id,k.product_id::text as "productId",k.kind,k.label,k.content,k.source,k.created_at as "createdAt"
  from product_knowledge k where k.business_id::text=${businessId.toLowerCase()} and k.status='active'
  and ${o.productId?sql`k.product_id::text=${o.productId.toLowerCase()} and exists(select 1 from products p where p.id=k.product_id and p.business_id=k.business_id)`:sql`k.product_id is null`}
  and ${q?sql`(k.label ilike ${literalLike(q)} or k.content ilike ${literalLike(q)})`:sql`true`}`,sql`"createdAt" desc,id`,o);
}
export async function readKnowledgeReadingsPage(tx:Tx,businessId:string,o:AssistantPageOptions&{readonly state?:KnowledgeReadingRow['state']}={}):Promise<AssistantPage<KnowledgeReadingRow>> {
 const q=assistantSearch(o.q),filter=o.state==='pending'?sql`p.decided_at is null and p.replaced_by is null`:o.state==='approved'?sql`p.decided_at is not null and p.replaced_by is null`:o.state==='replaced'?sql`p.replaced_by is not null`:sql`true`;
 return readAssistantPage(tx,sql`select p.id::text as id,p.source,jsonb_array_length(p.lines)::int as "lineCount",p.created_at as "createdAt",p.decided_at as "decidedAt",p.written,
  (select newer.id::text from knowledge_proposals newer where newer.id=p.replaced_by and newer.business_id=p.business_id) as "replacedBy",
  case when p.replaced_by is not null then 'replaced' when p.decided_at is not null then 'approved' else 'pending' end as state
  from knowledge_proposals p where p.business_id::text=${businessId.toLowerCase()} and ${filter}
  and ${q?sql`p.source ilike ${literalLike(q)}`:sql`true`}`,sql`"createdAt" desc,id`,o);
}
