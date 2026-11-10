import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
const d=process.env['DATABASE_URL']&&process.env['MIGRATE_DATABASE_URL']?describe:describe.skip;
d('Instagram comment references · every edge is tenant scoped',()=>{
 let admin:pg.Client,app:pg.Client;
 const a=randomUUID(),b=randomUUID();
 type Rows={account:string;ig:string;comment:string;client:string;conversation:string;outbound:string;product:string};
 let own:Rows,foreign:Rows;
 async function seed(business:string):Promise<Rows>{
  const r={account:randomUUID(),ig:String(Date.now())+Math.random().toString().slice(2),comment:randomUUID(),client:randomUUID(),conversation:randomUUID(),outbound:randomUUID(),product:randomUUID()};
  await admin.query("insert into businesses(id,name) values($1,'Comment reference fixture')",[business]);
  await admin.query("insert into meta_accounts(id,business_id,page_id,page_name,ig_account_id,token_ciphertext,fingerprint,scopes,connected_by) values($1,$2,$3,'Page',$3,'v1.fake-test-ciphertext','000000000000','instagram_manage_comments','owner')",[r.account,business,r.ig]);
  await admin.query("insert into ig_comments(id,business_id,meta_account_id,account_id,comment_id,identity,words,media_id) values($1::uuid,$2,$3,$4,$1::text,'person','Price?','post')",[r.comment,business,r.account,r.ig]);
  await admin.query('insert into clients(id,business_id) values($1,$2)',[r.client,business]);
  await admin.query("insert into conversations(id,business_id,client_id,channel) values($1,$2,$3,'instagram')",[r.conversation,business,r.client]);
  await admin.query("insert into outbound_messages(id,business_id,conversation_id,seq,body,channel) values($1,$2,$3,1,'Fixture','instagram')",[r.outbound,business,r.conversation]);
  await admin.query("insert into products(id,business_id,sku,name) values($1,$2,'P','Product')",[r.product,business]);
  return r;
 }
 beforeAll(async()=>{admin=new pg.Client({connectionString:process.env['MIGRATE_DATABASE_URL']});app=new pg.Client({connectionString:process.env['DATABASE_URL']});await admin.connect();await app.connect();own=await seed(a);foreign=await seed(b);});
 afterAll(async()=>{await app?.end();await admin?.end();});
 const scoped=async(fn:()=>Promise<unknown>)=>{await app.query('begin');try{await app.query("select set_config('app.business_id',$1,true)",[a]);expect((await app.query('select current_user as role,current_business_id()::text as scope')).rows[0]).toEqual({role:'nomi_app',scope:a});const result=await fn();await app.query('commit');return result;}catch(e){await app.query('rollback');throw e;}};
 const edges:{name:string;query:string;params:()=>unknown[]}[]=[
  {name:'settings account',query:'insert into ig_comment_settings(business_id,meta_account_id,account_id,changed_by) values($1,$2,$3,\'owner\')',params:()=>[a,foreign.account,foreign.ig]},
  {name:'login account',query:'insert into ig_comment_login_states(business_id,meta_account_id,nonce_hash,person_id,session_hash,expires_at) values($1,$2,$3,\'owner\',\'fake-hash\',now())',params:()=>[a,foreign.account,randomUUID()]},
  {name:'comment account',query:'update ig_comments set meta_account_id=$2,account_id=$3 where id=$1',params:()=>[own.comment,foreign.account,foreign.ig]},
  ...(['product','client','conversation'] as const).map(key=>({name:'comment '+key,query:`update ig_comments set ${key}_id=$2 where id=$1`,params:()=>[own.comment,foreign[key]]})),
  {name:'reply comment',query:'insert into ig_comment_replies(business_id,comment_id,owner_id) values($1,$2,\'owner\')',params:()=>[a,foreign.comment]},
  {name:'reply outbound',query:'insert into ig_comment_replies(business_id,comment_id,outbound_id,owner_id) values($1,$2,$3,\'owner\')',params:()=>[a,own.comment,foreign.outbound]},
  {name:'public reply comment',query:'insert into ig_comment_public_replies(business_id,comment_id) values($1,$2)',params:()=>[a,foreign.comment]},
  {name:'alert comment',query:'insert into ig_comment_alerts(business_id,comment_id) values($1,$2)',params:()=>[a,foreign.comment]},
 ];
 for(const edge of edges)it('refuses a foreign '+edge.name+' as nomi_app scoped to A',async()=>{await expect(scoped(()=>app.query(edge.query,edge.params()))).rejects.toMatchObject({code:expect.stringMatching(/^235(?:03|14)$/)});});
 it('accepts the same-workspace links',async()=>{
  await scoped(async()=>{
   await app.query('update ig_comments set product_id=$2,client_id=$3,conversation_id=$4 where id=$1',[own.comment,own.product,own.client,own.conversation]);
   await app.query("insert into ig_comment_replies(business_id,comment_id,outbound_id,owner_id) values($1,$2,$3,'owner')",[a,own.comment,own.outbound]);
   await app.query('insert into ig_comment_public_replies(business_id,comment_id) values($1,$2)',[a,own.comment]);
   await app.query('insert into ig_comment_alerts(business_id,comment_id) values($1,$2)',[a,own.comment]);
  });
 });
});
