import {afterAll,beforeAll,describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {sql} from 'kysely';
import {createDb,withTenantTx,type Db} from '../../src/db/client.js';
import {parseBusinessId} from '../../src/core/types/ids.js';
import {lockedCommentReplyFacts,claimCommentPrivateReply,recordCommentPrivateReply} from '../../src/db/commentPrivateReplies.js';
const suite=process.env['DATABASE_URL']&&process.env['MIGRATE_DATABASE_URL']?describe:describe.skip;
suite('comment reply claims · locked, one attempt, and never resurrected',()=>{
 let admin:pg.Client,db:Db;const business=randomUUID(),account=randomUUID(),client=randomUUID(),conversation=randomUUID();
 const parsed=parseBusinessId(business);if(!parsed.ok)throw Error();const bid=parsed.value;
 const ig='123456789012345',now=new Date('2026-11-09T00:00:00Z');let seq=0;
 beforeAll(async()=>{admin=new pg.Client({connectionString:process.env['MIGRATE_DATABASE_URL']});await admin.connect();db=createDb(process.env['DATABASE_URL']!);
 await admin.query("insert into businesses(id,name) values($1,'Comment claim fixture')",[business]);
 await admin.query("insert into meta_accounts(id,business_id,page_id,page_name,ig_account_id,token_ciphertext,fingerprint,scopes,connected_by) values($1,$2,$3,'Page',$3,'v1.fake-test-ciphertext','000000000000','instagram_manage_comments','owner')",[account,business,ig]);
 await admin.query("insert into ig_comment_settings(business_id,meta_account_id,account_id,enabled,changed_by) values($1,$2,$3,true,'owner')",[business,account,ig]);
 await admin.query('insert into clients(id,business_id) values($1,$2)',[client,business]);
 await admin.query("insert into client_channels(client_id,channel,channel_user_id) values($1,'instagram','67890')",[client]);
 await admin.query("insert into conversations(id,business_id,client_id,channel) values($1,$2,$3,'instagram')",[conversation,business,client]);
 });
 afterAll(async()=>{await db?.destroy();await admin?.end();});
 const fresh=async(age:number|null=3600000)=>{const comment=randomUUID(),outbound=randomUUID(),external=String(++seq+10000);
 await admin.query("insert into ig_comments(id,business_id,meta_account_id,account_id,comment_id,identity,words,media_id,asking,created_at,conversation_id,client_id) values($1,$2,$3,$4,$5,'67890','Price?','99999',true,$6,$7,$8)",[comment,business,account,ig,external,age===null?null:new Date(now.getTime()-age),conversation,client]);
 await admin.query("insert into outbound_messages(id,business_id,conversation_id,seq,body,channel,kind,origin,approved,to_wa_id) values($1,$2,$3,$4,'Owner reply','instagram','comment_private_reply','owner',true,'67890')",[outbound,business,conversation,seq]);
 await admin.query("insert into ig_comment_replies(business_id,comment_id,outbound_id,owner_id,public_requested) values($1,$2,$3,'owner',true)",[business,comment,outbound]);return{comment,outbound,external};};
 for(const [age,allowed] of [[7*86400000-1,true],[7*86400000,false],[7*86400000+1,false],[-1,false],[null,false]] as const)it(`claims only a known creation younger than seven days: ${age}`,async()=>{
 const r=await fresh(age);expect(await withTenantTx(db,bid,tx=>claimCommentPrivateReply(tx,business,r.outbound,now))).toBe(allowed?r.external:null);
 });
 it('two concurrent prepare claims commit one usable comment id; a used claim remains used',async()=>{
 const r=await fresh();const claims=await Promise.all([1,2].map(()=>withTenantTx(db,bid,tx=>claimCommentPrivateReply(tx,business,r.outbound,now))));expect(claims.filter(Boolean)).toEqual([r.external]);
 const facts=await withTenantTx(db,bid,tx=>lockedCommentReplyFacts(tx,business,conversation,[r.outbound]));expect(facts[r.outbound]).toMatchObject({claim:'used',accountBound:true});
 });
 for(const [name,change,restore] of [
 ['off','update ig_comment_settings set enabled=false where business_id=$1','update ig_comment_settings set enabled=true where business_id=$1'],
 ['revoked',"update meta_accounts set last_error='revoked' where business_id=$1",'update meta_accounts set last_error=null where business_id=$1'],
 ] as const)it(name+' leaves the claim unused',async()=>{const r=await fresh();await admin.query(change,[business]);try{expect(await withTenantTx(db,bid,tx=>claimCommentPrivateReply(tx,business,r.outbound,now))).toBeNull();}finally{await admin.query(restore,[business]);}expect((await admin.query('select attempted_at from ig_comment_replies where comment_id=$1',[r.comment])).rows[0].attempted_at).toBeNull();});
 for(const change of ["origin='employee'",'approved=false',"kind='text'",'asking=false'])it('refuses forged row '+change,async()=>{const r=await fresh();await admin.query(`update ${change.startsWith('asking')?'ig_comments':'outbound_messages'} set ${change} where id=$1`,[change.startsWith('asking')?r.comment:r.outbound]);expect(await withTenantTx(db,bid,tx=>claimCommentPrivateReply(tx,business,r.outbound,now))).toBeNull();});
 for(const result of [{ok:false,retryable:true,error:'meta 500'},{ok:false,retryable:false,uncertain:true,error:'timeout'}] as const)it('failed or uncertain acceptance never queues public work: '+result.error,async()=>{const r=await fresh();await withTenantTx(db,bid,tx=>claimCommentPrivateReply(tx,business,r.outbound,now));expect(await withTenantTx(db,bid,tx=>recordCommentPrivateReply(tx,business,r.outbound,result,now))).toBeNull();expect(await withTenantTx(db,bid,tx=>claimCommentPrivateReply(tx,business,r.outbound,now))).toBeNull();});
 it('acceptance queues once and records both provider ids; erasure cannot resurrect it',async()=>{
 const r=await fresh();await withTenantTx(db,bid,tx=>claimCommentPrivateReply(tx,business,r.outbound,now));const result={ok:true as const,providerMessageId:'mid.accepted',recipientId:'67890'};
 expect(await withTenantTx(db,bid,tx=>recordCommentPrivateReply(tx,business,r.outbound,result,now))).toBe(r.comment);
 expect(await withTenantTx(db,bid,tx=>recordCommentPrivateReply(tx,business,r.outbound,result,now))).toBeNull();
 expect((await admin.query('select recipient_id,provider_message_id,outcome from ig_comment_replies where comment_id=$1',[r.comment])).rows[0]).toEqual({recipient_id:'67890',provider_message_id:'mid.accepted',outcome:'accepted'});
 await withTenantTx(db,bid,tx=>sql`select ig_comment_erase(${r.comment}::uuid,'owner')`.execute(tx));
 expect(await withTenantTx(db,bid,tx=>recordCommentPrivateReply(tx,business,r.outbound,result,now))).toBeNull();
 });
});
