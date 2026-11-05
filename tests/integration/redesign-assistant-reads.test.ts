import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {sql} from 'kysely';
import {createDb,withTenantTx,type Db,type Tx} from '../../src/db/client.js';
import {parseBusinessId} from '../../src/core/types/ids.js';
import {readKnowledgeProductsPage,readKnowledgeFactsPage,readKnowledgeReadingsPage} from '../../src/db/assistantKnowledge.js';
import {readAssistantActivity} from '../../src/db/assistantActivity.js';
const d=process.env['DATABASE_URL']?describe:describe.skip;
const B=randomUUID(),OTHER=randomUUID(),P=randomUUID(),INACTIVE=randomUUID(),CHAT=randomUUID(),FOREIGNCHAT=randomUUID();
const STAMP='2026-11-06T01:02:03.123456Z';
d('Area 6 complete bounded Assistant reads',()=>{
 let db:Db;
 const tx=<T>(fn:(t:Tx)=>Promise<T>,bid=B)=>{const b=parseBusinessId(bid);if(!b.ok)throw Error('fixture');return withTenantTx(db,b.value,fn);};
 beforeAll(async()=>{
  db=createDb(process.env['DATABASE_URL']!);
  for(const bid of [B,OTHER])await tx(async t=>{
   await sql`insert into businesses(id,name) values(${bid}::uuid,'Assistant reader fixture')`.execute(t);
   await sql`insert into clients(id,business_id,display_name) values(${bid}::uuid,${bid}::uuid,'Customer')`.execute(t);
   await sql`insert into conversations(id,business_id,client_id,channel) values(${bid===B?CHAT:FOREIGNCHAT}::uuid,${bid}::uuid,${bid}::uuid,'whatsapp')`.execute(t);
  },bid);
  await tx(async t=>{
   await sql`insert into products(business_id,sku,name) select ${B}::uuid,'P-'||n,'Same product' from generate_series(1,205)n`.execute(t);
   await sql`insert into products(id,business_id,sku,name,is_active) values(${P}::uuid,${B}::uuid,'LITERAL','100%_ true',true),(${INACTIVE}::uuid,${B}::uuid,'OLD','Old product',false)`.execute(t);
   await sql`insert into product_knowledge(business_id,product_id,kind,label,content,source,status,created_at)
    values(${B}::uuid,${P}::uuid,'faq','Live','Evidence','owner_confirmed','active',${STAMP}::timestamptz),
    (${B}::uuid,${P}::uuid,'faq','Archived','Old','owner_confirmed','archived',${STAMP}::timestamptz),
    (${B}::uuid,null,'faq','100%_ literal','Business evidence','owner_corrected','active',${STAMP}::timestamptz)`.execute(t);
   await sql`insert into product_knowledge(business_id,kind,label,content,source,created_at) select ${B}::uuid,'faq','Same fact','Same words','owner_confirmed',${STAMP}::timestamptz from generate_series(1,105)`.execute(t);
   await sql`insert into knowledge_proposals(business_id,source,lines,created_by,created_at)
    select ${B}::uuid,'https://example.test/'||n,'[{"key":"a","fact":"Stored fact","quote":"Stored sentence"}]'::jsonb,'owner',${STAMP}::timestamptz from generate_series(1,105)n`.execute(t);
   const approved=(await sql<{id:string}>`insert into knowledge_proposals(business_id,source,lines,created_by,created_at,decided_at,written) values(${B}::uuid,'https://example.test/approved','[]','owner',${STAMP}::timestamptz,${STAMP}::timestamptz,0) returning id`.execute(t)).rows[0]!;
   await sql`insert into knowledge_proposals(business_id,source,lines,created_by,created_at,decided_at,written,replaced_by) values(${B}::uuid,'https://example.test/replaced','[]','owner',${STAMP}::timestamptz,${STAMP}::timestamptz,0,${approved.id}::uuid)`.execute(t);
   await sql`insert into capability_events(business_id,capability,action,from_mode,to_mode,actor,reasons,at)
    select ${B}::uuid,'greet','promote','draft','auto','owner','{evidence_met}'::text[],${STAMP}::timestamptz from generate_series(1,105)`.execute(t);
   await sql`insert into capability_events(business_id,capability,action,from_mode,to_mode,actor,reasons,language,at)
    values(${B}::uuid,'quote','withdraw','auto','draft','system_self_demoted','{repeated_corrections}','fr',${STAMP}::timestamptz)`.execute(t);
   await sql`insert into spot_checks(business_id,conversation_id,capability,verdict,answered_at) values
    (${B}::uuid,${CHAT}::uuid,'greet','correct',${STAMP}::timestamptz),
    (${B}::uuid,${CHAT}::uuid,'greet','needs_improvement',${STAMP}::timestamptz),
    (${B}::uuid,${CHAT}::uuid,'quote','serious',${STAMP}::timestamptz),
    (${B}::uuid,${CHAT}::uuid,'greet',null,null)`.execute(t);
   await sql`insert into drafts(business_id,conversation_id,capability,draft_text,status,sent_text,decided_at) values
    (${B}::uuid,${CHAT}::uuid,'greet','Original','edited','Correction',${STAMP}::timestamptz),
    (${B}::uuid,${CHAT}::uuid,'greet','Waiting','pending',null,null)`.execute(t);
  });
  await tx(async t=>{
   await sql`insert into products(business_id,sku,name) values(${OTHER}::uuid,'FOREIGN','Foreign')`.execute(t);
   await sql`insert into product_knowledge(business_id,kind,label,content) values(${OTHER}::uuid,'faq','Foreign','Private')`.execute(t);
   await sql`insert into knowledge_proposals(business_id,source,created_by) values(${OTHER}::uuid,'https://foreign.test','owner')`.execute(t);
   await sql`insert into capability_events(business_id,capability,action,from_mode,to_mode,actor) values(${OTHER}::uuid,'greet','promote','draft','auto','owner')`.execute(t);
  },OTHER);
 });
 afterAll(async()=>{await db?.destroy();});
 it('pages every active product beyond200 with stable ties, exact fact counts and literal search',async()=>{
  const ids:string[]=[];for(let page=1;page<=5;page++){const p=await tx(t=>readKnowledgeProductsPage(t,B,{page}));expect(p.total).toBe(206);ids.push(...p.rows.map(r=>r.id));}
  expect(new Set(ids).size).toBe(206);expect(ids).not.toContain(INACTIVE);
  const p=await tx(t=>readKnowledgeProductsPage(t,B,{q:'%_'}));expect(p.rows).toMatchObject([{id:P,count:1}]);
  expect((await tx(t=>readKnowledgeProductsPage(t,B,{state:'inactive'}))).rows.map(r=>r.id)).toEqual([INACTIVE]);
  expect((await tx(t=>readKnowledgeProductsPage(t,B,{state:'all',size:999,page:Number.MAX_SAFE_INTEGER}))).page).toBe(3);
  expect((await tx(t=>readKnowledgeProductsPage(t,B,{page:NaN,size:NaN}))).page).toBe(1);
 });
 it('keeps business and product facts separate, active only, fully paged and searchable',async()=>{
  const p=await tx(t=>readKnowledgeFactsPage(t,B,{page:3}));expect(p.total).toBe(106);expect(p.rows).toHaveLength(6);
  expect((await tx(t=>readKnowledgeFactsPage(t,B,{productId:P}))).rows).toMatchObject([{label:'Live',content:'Evidence',source:'owner_confirmed',productId:P}]);
  expect((await tx(t=>readKnowledgeFactsPage(t,B,{q:'%_'}))).rows[0]).toMatchObject({label:'100%_ literal',source:'owner_corrected',productId:null});
  expect((await tx(t=>readKnowledgeFactsPage(t,B,{productId:'invalid'}))).total).toBe(0);
 });
 it('retains every pending, approved and replaced reading beyond the old10 preview',async()=>{
  const all=[];for(let page=1;page<=3;page++){const p=await tx(t=>readKnowledgeReadingsPage(t,B,{page}));expect(p.total).toBe(107);all.push(...p.rows);}
  expect(new Set(all.map(r=>r.id)).size).toBe(107);
  expect((await tx(t=>readKnowledgeReadingsPage(t,B,{state:'pending',page:3}))).rows).toHaveLength(5);
  expect((await tx(t=>readKnowledgeReadingsPage(t,B,{state:'approved'}))).rows).toMatchObject([{state:'approved',written:0,lineCount:0}]);
  expect((await tx(t=>readKnowledgeReadingsPage(t,B,{state:'replaced'}))).rows[0]?.replacedBy).toBeTruthy();
 });
 it('pages the complete event union with stable IDs, precise demotion reasons and actual conversation references',async()=>{
  const all=[];for(let page=1;page<=3;page++){const p=await tx(t=>readAssistantActivity(t,B,{page}));expect(p.total).toBe(110);all.push(...p.rows);}
  expect(new Set(all.map(r=>r.id)).size).toBe(110);expect(all.every(r=>typeof r.id==='string')).toBe(true);
  expect(all.find(r=>r.kind==='self_demote')).toMatchObject({why:'repeated_corrections',language:'fr',conversationId:null});
  expect(all.filter(r=>r.conversationId===CHAT).map(r=>r.kind).sort()).toEqual(['learned_edit','spotcheck_improve','spotcheck_issue','spotcheck_pass']);
  const first=await tx(t=>readAssistantActivity(t,B,{size:1})),again=await tx(t=>readAssistantActivity(t,B,{size:1}));expect(first.rows[0]?.id).toBe(again.rows[0]?.id);
 });
 it('honors row security and explicit tenant scope and works inside a read-only transaction',async()=>{
  await tx(async t=>{await sql`set transaction read only`.execute(t);
   for(const read of [readKnowledgeProductsPage,readKnowledgeFactsPage,readKnowledgeReadingsPage,readAssistantActivity]){expect((await read(t,OTHER,{})).total).toBe(0);expect((await read(t,B,{})).total).toBeGreaterThan(0);}
  });
 });
});
