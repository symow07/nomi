import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {createHmac,randomUUID} from 'node:crypto';
import pg from 'pg';
import {sql} from 'kysely';
import {withTenantTx} from '../../src/db/client.js';
import {parseBusinessId} from '../../src/core/types/ids.js';
import {connectMetaAccount,linkMetaCredentials} from '../../src/db/metaAccounts.js';
import {encryptSecret,deriveKey} from '../../src/security/credentials.js';
import {META_LOGIN_SCOPES} from '../../src/channels/meta/connect.js';
import {makeSessionCodec} from '../../src/api/web/session.js';
import {deliverOwnerAlert} from '../../src/pipeline/notify.js';
import {offlineModels} from '../pipeline/fakes.js';
import {dropQueuedWork} from './tenant.js';
import {unisolatedLatin} from '../parity/isolates.js';
import {GO} from '../../src/api/web/icons.js';
const suite=process.env['DATABASE_URL']&&process.env['MIGRATE_DATABASE_URL']?describe:describe.skip;
const ROOT='/app/channels/instagram/comments';
suite('Instagram comments · actual signed ingress, incremental login, owner routes and zero customer sends',()=>{
 let prod:import('../../src/main.js').Production;let admin:pg.Client;let account:string;let cookie:string;let staffCookie:string;
 const business=randomUUID();const key='c'.repeat(64);const appSecret='fake-comment-app-secret';
 const secret=createHmac('sha256',key).update('yf-web-session').digest('hex');
 const ig=String(Date.now())+'61',page=String(Date.now())+'62',appId='123456789';
 const b=parseBusinessId(business);if(!b.ok)throw new Error('fixture');const bid=b.value;
 const tx=<T>(fn:(x:import('../../src/db/client.js').Tx)=>Promise<T>)=>withTenantTx(prod.db,bid,fn);
 const calls:{url:string;method:string}[]=[];const facts=new Map<string,{media:string;author:string;caption:string;created:string}>();
 let scopes:readonly string[]=[...META_LOGIN_SCOPES,'instagram_manage_comments'];
 const metaFetch:import('../../src/channels/meta/messaging.js').MetaFetch=async(url,init)=>{
  calls.push({url,method:init.method});const u=new URL(url);const id=u.pathname.split('/').at(-1)!;
  let body:unknown={};let status=200;
  if(id==='access_token')body={access_token:'fake-comment-user-secret'};
  else if(id==='accounts')body={data:[{id:page,name:'Comment shop',access_token:'fake-comment-page-secret',instagram_business_account:{id:ig}}]};
  else if(id==='debug_token')body={data:{is_valid:true,app_id:appId,scopes}};
  else if(id==='subscribed_apps')body=init.method==='GET'?{data:[{id:appId,subscribed_fields:['messages','feed']}]}:{success:true};
  else if(facts.has(id)){const c=facts.get(id)!;body={id,timestamp:c.created,from:{id:c.author},media:{id:c.media}};}
  else {const c=[...facts.values()].find(c=>c.media===id);if(c)body=u.searchParams.get('fields')==='caption'?{caption:c.caption}:{id,owner:{id:ig},permalink:'https://www.instagram.com/p/example/',media_product_type:'FEED'};else status=400;}
  return {status,text:async()=>JSON.stringify(body)};
 };
 const get=(url:string,who=cookie)=>prod.app.inject({method:'GET',url,headers:{cookie:who}});
 const post=(url:string,fields:Record<string,string>,who=cookie)=>prod.app.inject({method:'POST',url,headers:{cookie:who,'content-type':'application/x-www-form-urlencoded'},payload:new URLSearchParams(fields).toString()});
 const field=(id:string)=>({comment_id:id,from:{id:'comment-person'},text:'Price please?',media:{id:facts.get(id)!.media,media_product_type:'FEED'}});
 const envelope=(id:string)=>({object:'instagram',entry:[{id:ig,time:Math.floor(Date.now()/1000),changes:[{field:'comments',value:field(id)}]}]});
 const hook=(payload:unknown,signature=true)=>{const body=JSON.stringify(payload);return prod.app.inject({method:'POST',url:'/webhook/instagram',payload:body,headers:{'content-type':'application/json','x-hub-signature-256':signature?'sha256='+createHmac('sha256',appSecret).update(body).digest('hex'):'sha256=bad'}});};
 const addFact=(caption='Blue bag',created=new Date().toISOString())=>{const id=randomUUID();facts.set(id,{media:String(Date.now())+String(facts.size+100),author:'comment-person',caption,created});return id;};
 const count=async(table:string)=>(await admin.query(`select count(*)::int n from ${table} where business_id=$1`,[business])).rows[0].n as number;
 const counters=async()=>{const values:number[]=[];for(const name of ['clients','conversations','outbound_messages','channel_events'])values.push(await count(name));return values;};
 beforeAll(async()=>{
  process.env['PILOT_BUSINESS_ID']=business;process.env['OWNER_ACCESS_CODE']='fake-ig-owner-code';
  process.env['META_SOCIAL_APP_SECRET']=appSecret;process.env['META_SOCIAL_APP_ID']=appId;
  process.env['META_LOGIN_CONFIG_ID']='456789012';process.env['META_COMMENTS_LOGIN_CONFIG_ID']='567890123';
  delete process.env['META_PAGE_ACCESS_TOKEN'];delete process.env['META_PAGE_ID'];delete process.env['META_IG_ACCOUNT_ID'];
  const {buildProduction}=await import('../../src/main.js');
  prod=await buildProduction({provider:'disabled',DATABASE_URL:process.env['DATABASE_URL']!,ANTHROPIC_API_KEY:'test-key-not-real-just-shape-valid',META_GRAPH_API_VERSION:'v23.0',WEBHOOK_VERIFY_TOKEN:'fake-ig-verify',CREDENTIAL_KEY:key,PORT:0,PUBLIC_BASE_URL:'https://nomi.test'}, {models:offlineModels(),logger:false,metaFetch});
  admin=new pg.Client({connectionString:process.env['MIGRATE_DATABASE_URL']});await admin.connect();
  await admin.query("insert into businesses(id,name) values($1,'Comment shop') on conflict(id) do nothing",[business]);
  await tx(async x=>{const a=await connectMetaAccount(x,bid,{pageId:page,pageName:'Comment shop',igAccountId:ig,igUsername:'commentshop',ciphertext:encryptSecret('fake-comment-page-secret',deriveKey(key)),fingerprint:'000000000000',scopes:META_LOGIN_SCOPES.join(' '),by:'owner'});if(!a.ok)throw new Error(a.reason);account=a.id;await linkMetaCredentials(x,bid,{accountId:account,pageId:page,igAccountId:ig,actor:'owner'});});
  const codec=makeSessionCodec(secret);cookie='yf_session='+codec.sign({businessId:business,exp:Date.now()+3600000});
  const staff=randomUUID();await admin.query("insert into people(id,business_id,name,is_owner) values($1,$2,'Staff',false)",[staff,business]);
  staffCookie='yf_session='+codec.sign({businessId:business,exp:Date.now()+3600000,person:{id:staff,name:'Staff',isOwner:false}});
  await admin.query("insert into products(business_id,sku,name) values($1,'CBLUE','Blue bag'),($1,'CGREEN','Green scarf')",[business]);
 },90000);
 afterAll(async()=>{if(prod)await dropQueuedWork(prod,[business]);await prod?.close();await admin?.end();});
 it('OFF ignores even a signed comment and the base login never asks the extra permission',async()=>{
  const id=addFact();expect((await hook(envelope(id))).statusCode).toBe(200);expect(await count('ig_comments')).toBe(0);
  for(const table of ['ig_comment_replies','ig_comment_public_replies','ig_comment_alerts'])expect(await count(table)).toBe(0);
  expect((await admin.query("select count(*)::int n from pgboss.job where data->>'businessId'=$1",[business])).rows[0].n).toBe(0);
  const html=(await get(ROOT)).body;expect(html).toContain('value="1"');expect(html).toContain('Nothing is sent');
  expect((await get('/app/settings/channels/meta')).body).toContain(ROOT);
  // I12 — the door to Comments on the Arabic Meta page is the English fallback set apart as English, as the Comments
  // page's own words are (sayOnPage); the English page's door is unchanged.
  // A door is its words and its arrow (rule 25), drawn as the page's other doors are (`deeper`'s GO).
  const door=(html:string)=>new RegExp(`<a class="deeper" href="${ROOT}">[\\s\\S]*?</a>`).exec(html)?.[0]??'';
  const enPage=(await get('/app/settings/channels/meta')).body,enDoor=door(enPage);
  expect(enDoor).toBe(`<a class="deeper" href="${ROOT}">Instagram comments${GO}</a>`);
  const helpDoor=/<a class="deeper" href="[^"]*help[^"]*">[\s\S]*?<\/a>/.exec(enPage)?.[0]??'';
  expect(helpDoor).toContain(GO);
  const arDoor=door((await get('/app/settings/channels/meta',`${cookie}; yf_locale=ar`)).body);
  expect(arDoor).toBe(`<a class="deeper" href="${ROOT}"><bdi lang="en" dir="ltr">Instagram comments</bdi>${GO}</a>`);
  expect(unisolatedLatin(arDoor)).toEqual([]);
  const base=await get('/app/connect/meta/start');expect(String(base.headers.location)).toContain('456789012');expect(String(base.headers.location)).not.toContain('567890123');
 });
 it('staff and invalid switch values are refused with zero provider calls',async()=>{
  const n=calls.length;expect((await post(ROOT+'/switch',{on:'1'},staffCookie)).statusCode).toBe(302);
  expect((await post(ROOT+'/switch',{on:'maybe'})).statusCode).toBe(400);expect(calls).toHaveLength(n);
 });
 it('denial and missing permission leave the old DM connection intact; callback state is session-bound and used once',async()=>{
  const before=(await admin.query('select token_ciphertext,scopes from meta_accounts where id=$1',[account])).rows[0];
  const start=await post(ROOT+'/switch',{on:'1'});const state=new URL(String(start.headers.location)).searchParams.get('state')!;
  const alien='yf_session='+makeSessionCodec(secret).sign({businessId:business,exp:Date.now()+7200000});
  const n=calls.length;await get(ROOT+`/callback?state=${state}&code=fake`,alien);expect(calls).toHaveLength(n);
  scopes=META_LOGIN_SCOPES;await get(ROOT+`/callback?state=${state}&code=fake`);scopes=[...META_LOGIN_SCOPES,'instagram_manage_comments'];
  expect((await admin.query('select token_ciphertext,scopes from meta_accounts where id=$1',[account])).rows[0]).toEqual(before);
  const after=calls.length;await get(ROOT+`/callback?state=${state}&code=fake`);expect(calls).toHaveLength(after);
  const denied=await post(ROOT+'/switch',{on:'1'});const decline=new URL(String(denied.headers.location)).searchParams.get('state')!;
  await get(ROOT+`/callback?state=${decline}&error=access_denied`);expect(calls).toHaveLength(after);
 });
 it('enabling binds the same account; concurrent replays create one comment and one alert, no DM or turn',async()=>{
  const start=await post(ROOT+'/switch',{on:'1'});const state=new URL(String(start.headers.location)).searchParams.get('state')!;
  expect((await get(ROOT+`/callback?state=${state}&code=fake`)).statusCode).toBe(302);
  expect((await admin.query('select enabled from ig_comment_settings where meta_account_id=$1',[account])).rows[0]?.enabled).toBe(true);
  const counts=await counters();
  const id=addFact();const requests=await Promise.all(Array.from({length:20},()=>hook(envelope(id))));expect(requests.every(r=>r.statusCode===200)).toBe(true);
  await expect.poll(async()=> (await admin.query('select enriched_at from ig_comments where business_id=$1 and comment_id=$2',[business,id])).rows[0]?.enriched_at,{timeout:10000}).toBeTruthy();
  const row=(await admin.query('select * from ig_comments where business_id=$1 and comment_id=$2',[business,id])).rows[0];expect(row.match_state).toBe('matched');
  expect((await admin.query('select count(*)::int n from ig_comment_alerts where comment_id=$1',[row.id])).rows[0].n).toBe(1);
  expect(await counters()).toEqual(counts);
  expect(calls.filter(c=>c.url.includes('/messages')||c.url.includes('/comments'))).toHaveLength(0);
 });
 it('one, none, several and an expired comment appear without guessing',async()=>{
  for(const [caption,match] of [['No catalogue name','none'],['Blue bag and Green scarf','several']] as const){
   const id=addFact(caption);await hook(envelope(id));await expect.poll(async()=>(await admin.query('select match_state from ig_comments where business_id=$1 and comment_id=$2 and enriched_at is not null',[business,id])).rows[0]?.match_state,{timeout:10000}).toBe(match);
  }
  const expired=addFact('Blue bag',new Date(Date.now()-8*86400000).toISOString());await hook(envelope(expired));
  await expect.poll(async()=>(await get(ROOT)).body,{timeout:10000}).toContain('seven days have passed');
  expect((await get(ROOT)).body).toContain('No single product');expect((await get(ROOT,staffCookie)).body).not.toContain('/delete');
 },15000);
 it('invalid signatures, Live and self comments never enter the list',async()=>{
  const n=await count('ig_comments');const id=addFact();expect((await hook(envelope(id),false)).statusCode).toBeGreaterThanOrEqual(400);
  const self=envelope(id);self.entry[0]!.changes[0]!.value.from.id=ig;await hook(self);
  const live=envelope(id);live.entry[0]!.changes[0]!.field='live_comments';await hook(live);expect(await count('ig_comments')).toBe(n);
 });
 it('one logical alert reaches the fake owner mail once, and an OFF switch blocks a queued alert',async()=>{
  const owner=randomUUID();await admin.query("insert into people(id,business_id,name,is_owner) values($1,$2,'Owner',true)",[owner,business]);
  await admin.query("insert into logins(business_id,person_id,email,password_hash) values($1,$2,$3,'scrypt$fake-test-only')",[business,owner,owner+'@example.invalid']);
  const id=addFact();await hook(envelope(id));await expect.poll(async()=>(await admin.query('select enriched_at from ig_comments where business_id=$1 and comment_id=$2',[business,id])).rows[0]?.enriched_at,{timeout:10000}).toBeTruthy();
  const internal=(await admin.query('select id from ig_comments where business_id=$1 and comment_id=$2',[business,id])).rows[0].id;
  const mail:string[]=[];const deps={db:prod.db,adapter:{sendText:async()=>{throw new Error('No phone is live');}},mail:{send:async(o:{text:string})=>{mail.push(o.text);return {ok:true as const};}},publicBaseUrl:'https://nomi.test'};
  const job={businessId:business,kind:'comment_asking' as const,conversationId:null,commentId:internal};
  const outcomes=await Promise.all(Array.from({length:5},()=>deliverOwnerAlert(deps,job)));
  expect(outcomes.filter(x=>x==='sent')).toHaveLength(1);expect(mail).toHaveLength(1);expect(mail[0]).toContain(ROOT);
  await post(ROOT+'/switch',{on:'0'});
  expect(await deliverOwnerAlert(deps,job)).toBe('skipped_quiet');expect(mail).toHaveLength(1);
  const before=calls.length;const off=addFact();await hook(envelope(off));expect(calls).toHaveLength(before);
  expect((await admin.query('select id from ig_comments where business_id=$1 and comment_id=$2',[business,off])).rowCount).toBe(0);
  await admin.query('update ig_comment_settings set enabled=true where meta_account_id=$1',[account]);
 });
 it('a mixed DM webhook stores no comment words in the DM event payload',async()=>{
  const id=addFact();const mixed={...envelope(id),entry:[{...envelope(id).entry[0],messaging:[{sender:{id:'mixed-person'},recipient:{id:ig},timestamp:Date.now(),message:{mid:'mixed-'+randomUUID(),text:'Ordinary DM'}}]}]};
  mixed.entry[0]!.changes![0]!.value.text='Price please? unique-comment-erasure-marker';
  expect((await hook(mixed)).statusCode).toBe(200);
  const rows=(await admin.query("select payload from channel_events where business_id=$1 and event_type='message.inbound'",[business])).rows;
  expect(rows).toHaveLength(1);expect(JSON.stringify(rows)).toContain('Ordinary DM');expect(JSON.stringify(rows)).not.toContain('unique-comment-erasure-marker');
 });
 it('owner deletion confirms, removes the details and blocks replay and stale alerts',async()=>{
  const id=addFact();await hook(envelope(id));await expect.poll(async()=>(await admin.query('select enriched_at from ig_comments where business_id=$1 and comment_id=$2',[business,id])).rows[0]?.enriched_at,{timeout:10000}).toBeTruthy();
  const internal=(await admin.query('select id from ig_comments where business_id=$1 and comment_id=$2',[business,id])).rows[0].id;
  expect((await get(`${ROOT}/${internal}/delete`)).body).toContain('name="confirm"');
  expect((await post(`${ROOT}/${internal}/delete`,{})).statusCode).toBe(400);
  expect((await post(`${ROOT}/${internal}/delete`,{confirm:'delete'},staffCookie)).statusCode).toBe(302);
  await post(`${ROOT}/${internal}/delete`,{confirm:'delete'});await hook(envelope(id));
  expect((await admin.query('select id from ig_comments where business_id=$1 and comment_id=$2',[business,id])).rowCount).toBe(0);
  const outcome=await deliverOwnerAlert({db:prod.db,adapter:{sendText:async()=>{throw new Error('must not send');}},mail:{send:async()=>{throw new Error('must not mail');}}},{businessId:business,kind:'comment_asking',conversationId:null,commentId:internal});
  expect(outcome).toBe('skipped_quiet');
 });
 it.each(['instagram','messenger'] as const)('%s DM-only payload is stored byte-identically to main’s JSONB representation',async channel=>{
  const mid='unchanged-'+randomUUID();const recipient=channel==='instagram'?ig:page;
  const payload={object:channel==='instagram'?'instagram':'page',extra:{kept:'Spacing  and Unicode ✓'},entry:[{id:recipient,time:Math.floor(Date.now()/1000),
   changes:[{field:'other',value:{kept:['one','two']}}],messaging:[{sender:{id:'plain-'+randomUUID()},recipient:{id:recipient},timestamp:Date.now(),message:{mid,text:'Ordinary direct message'}}]}]};
  const raw=JSON.stringify(payload);
  const response=await prod.app.inject({method:'POST',url:'/webhook/'+channel,payload:raw,headers:{'content-type':'application/json','x-hub-signature-256':'sha256='+createHmac('sha256',appSecret).update(raw).digest('hex')}});
  expect(response.statusCode).toBe(200);
  // Main writes JSON.stringify(rawPayload)::jsonb. Compare exact database text, including every field.
  const stored=(await admin.query("select payload::text as actual,$3::jsonb::text as main from channel_events where business_id=$1 and channel=$2 and payload #>> '{entry,0,messaging,0,message,mid}'=$4",[business,channel,raw,mid])).rows;
  expect(stored).toHaveLength(1);expect(stored[0].actual).toBe(stored[0].main);
 });

});
