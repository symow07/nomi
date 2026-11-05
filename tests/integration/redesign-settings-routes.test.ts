import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import Fastify from 'fastify';
import {randomUUID} from 'node:crypto';
import {sql} from 'kysely';
import {createDb,withTenantTx,type Db} from '../../src/db/client.js';
import {parseBusinessId} from '../../src/core/types/ids.js';
import {seedRunTenant} from './tenant.js';
const d=process.env['DATABASE_URL']&&process.env['MIGRATE_DATABASE_URL']?describe:describe.skip;
const B=randomUUID(),missing=randomUUID(),FORM={'content-type':'application/x-www-form-urlencoded'};
d('Grouped Settings preserve command and permission ownership',()=>{
 let db:Db,app:ReturnType<typeof Fastify>,owner='',staff='',accountant='',calls=0;
 const get=(url:string,cookie=owner)=>app.inject({method:'GET',url,headers:{cookie}});
 const post=(url:string,body:Record<string,string>={},cookie=owner)=>app.inject({method:'POST',url,payload:new URLSearchParams(body).toString(),headers:{cookie,...FORM}});
 beforeAll(async()=>{
  await seedRunTenant();db=createDb(process.env['DATABASE_URL']!);const b=parseBusinessId(B);if(!b.ok)throw Error('fixture');
  await withTenantTx(db,b.value,async tx=>{await sql`insert into businesses(id,name,country,currency,owner_locale,books_area) values(${B}::uuid,'Settings route business','US','USD','en',true)`.execute(tx);});
  const {registerWebApp}=await import('../../src/api/web/app.js');app=Fastify({logger:false});const secret='area-seven-isolated-session-secret-at-least-thirty-two';registerWebApp(app,{db,businessId:B,accessCode:'assistant-route-owner',sessionSecret:secret,employeeName:'Lily',avatar:'L',provider:'disabled',secureCookie:false,messagingEnabled:false,factsTtlMs:0,kickOutbound:async()=>{calls++;},kickDrive:async()=>{calls++;}} as unknown as Parameters<typeof registerWebApp>[1]);await app.ready();
  const login=async(code:string)=>String((await post('/login',{code},'')).headers['set-cookie']??'').split(';')[0]!;owner=await login('assistant-route-owner');const {addPerson}=await import('../../src/api/web/people.js');const one=await addPerson(db,B,secret,'Assistant staff','team'),two=await addPerson(db,B,secret,'Assistant accountant','accountant');if(one.code!=='added'||two.code!=='added')throw Error('people');staff=await login(one.accessCode);accountant=await login(two.accessCode);
 },60_000);
 afterAll(async()=>{await app?.close();await db?.destroy();});
 it('redirects every mapped bookmark after authentication, preserving its query',async()=>{
  const {SETTINGS_MOVES}=await import('../../src/api/web/settingsNavigation.js');
  for(const [old,canonical] of Object.entries(SETTINGS_MOVES)){
   const r=await get(old+'?context=kept');const target=new URL(canonical,'http://localhost');target.searchParams.set('context','kept');
   expect([r.statusCode,r.headers.location],old).toEqual([302,target.pathname+target.search+target.hash]);
   expect((await get(old,'' )).headers.location,old).toBe('/login');
  }
 });
 it('moves dynamic selling bookmarks without loops and preserves original POST question names',async()=>{
  for(const q of ['product_claims','not-a-question','123'])for(const suffix of ['','/confirm']){
   const old='/app/business/selling/'+q+suffix,canonical='/app/settings/business/selling/'+q.replaceAll('_','-')+suffix;
   const r=await get(old+'?context=kept');expect([r.statusCode,r.headers.location],old).toEqual([302,canonical+'?context=kept']);
   expect((await get(old,'')).headers.location).toBe('/login');
  }
  const invalid=await get('/app/settings/business/selling/not-a-question');expect(invalid.headers.location).toBe('/app/business/selling');
  const originalPost=await post('/app/business/selling/product-claims',{answer:'Not an original command name'});
  expect([originalPost.statusCode,originalPost.headers.location]).toEqual([302,'/app/business/selling']);
 });
 it('opens one focused page per subject with the original forms and role boundaries',async()=>{
  const paths=['/app/settings','/app/settings/business','/app/settings/business/profile','/app/settings/business/hours','/app/settings/business/currency','/app/settings/business/terms','/app/settings/business/samples','/app/settings/business/data','/app/settings/channels',...['whatsapp','meta','email','chat','telegram','tiktok'].map(x=>'/app/settings/channels/'+x),'/app/settings/assistant','/app/settings/assistant/name','/app/settings/assistant/words','/app/settings/assistant/history-policy','/app/settings/team','/app/settings/billing','/app/settings/personal','/app/settings/personal/account','/app/settings/personal/language','/app/settings/personal/notifications','/app/settings/personal/advisor-history'];
  for(const path of paths){const r=await get(path);expect(r.statusCode,path).toBe(200);expect(r.body.match(/<h1\b/g)?.length,path).toBe(1);expect(r.body,path).toContain('settings-area');expect(r.body,path).toContain('data-nav="settings" aria-current="page"');}
  expect((await get('/app/settings/team',staff)).statusCode).toBe(302);
  expect((await get('/app/settings/assistant/history-policy',staff)).headers.location).toBe('/app/settings/personal/advisor-history');
  for(const path of ['/app/settings/personal/account','/app/settings/personal/language'])expect((await get(path,accountant)).statusCode,path).toBe(200);
  expect((await get('/app/settings/business/profile',accountant)).headers.location).toBe('/app/books');
  const profile=await get('/app/settings/business/profile');expect(profile.body).toContain('action="/app/settings"');expect(profile.body).toContain('action="/app/settings/business"');
  expect(profile.body).toContain('name="working_hours"');expect(profile.body).toContain('name="postal_address"');
  const team=await get('/app/settings/team');expect(team.body).not.toContain('action="/app/settings/people/assistants"');
  const identity=await get('/app/settings/assistant/name');expect(identity.body).toContain('action="/app/settings/people/assistants"');
  expect(calls).toBe(0);
 });
 it('separates personal history consent from owner workspace controls',async()=>{
  const mine=await get('/app/settings/personal/advisor-history');expect(mine.body).toContain('id="mine"');expect(mine.body).not.toContain('id="workspace"');expect(mine.body).not.toContain('id="team"');
  const policy=await get('/app/settings/assistant/history-policy');expect(policy.body).toContain('id="workspace"');expect(policy.body).toContain('id="team"');expect(policy.body).not.toContain('id="mine"');
  const staffPolicy=await post('/app/settings/advisor-history/workspace',{on:'on'},staff);expect(staffPolicy.statusCode).toBe(302);
 });
 it('keeps invalid profile and business fields, and sends a new access code only to the canonical Team cookie',async()=>{
  const invalid=await post('/app/settings',{name:'Kept business',description:'Keep exact details',location:'Local',working_hours:'Weekdays',contact_email:'bad email',contact_phone:'',postal_address:'Kept address',zone:'UTC',currency:'USD'});
  expect(invalid.statusCode).toBe(200);expect(invalid.body).toContain('Keep exact details');expect(invalid.body).toContain('value="Weekdays"');expect(invalid.body).toContain('Kept address');
  const kind=await post('/app/settings/business',{kind:'agency',country:'US',website:'not a url'});expect(kind.statusCode).toBe(400);expect(kind.body).toContain('value="not a url"');
  const added=await post('/app/settings/people',{name:'New local teammate'});expect(added.statusCode).toBe(302);const cookie=String(added.headers['set-cookie']);expect(cookie).toContain('Path=/app/settings/team');expect(String(added.headers.location)).not.toContain('code=');
 });
 it('keeps trade-only pages hidden and refused on both old and canonical addresses',async()=>{
  const bid=parseBusinessId(B);if(!bid.ok)throw Error('fixture');
  await withTenantTx(db,bid.value,tx=>sql`update businesses set kind='agency' where id=${B}::uuid`.execute(tx));
  try{
   for(const suffix of ['terms','samples'])for(const path of ['/app/settings/'+suffix,'/app/settings/business/'+suffix]){
    expect((await get(path)).statusCode,path).toBe(404);
    expect((await post('/app/settings/'+suffix,{})).statusCode).toBe(404);
   }
   const home=await get('/app/settings/business');expect(home.body).not.toContain('href="/app/settings/business/terms"');expect(home.body).not.toContain('href="/app/settings/business/samples"');
   const selling=await get('/app/settings/business/selling',staff);expect(selling.statusCode).toBe(200);expect(selling.body).not.toContain('href="/app/settings/business/selling/price"');
  }finally{await withTenantTx(db,bid.value,tx=>sql`update businesses set kind=null where id=${B}::uuid`.execute(tx));}
 });

 it('separates sample policy and requests without moving the command endpoints',async()=>{
  const policy=await get('/app/settings/business/samples'),requests=await get('/app/customers/samples');
  expect(policy.statusCode).toBe(200);expect(requests.statusCode).toBe(200);
  expect(policy.body).toContain('action="/app/settings/samples"');expect(policy.body).toContain('href="/app/customers/samples"');
  expect(requests.body).not.toContain('action="/app/settings/samples"');expect(requests.body).toContain('data-nav="customers" aria-current="page"');
  expect((await get('/app/customers/samples',accountant)).headers.location).toBe('/app/books');
 });
 it('keeps Books unavailable when disabled and technical setup restricted to the installation owner',async()=>{
  const bid=parseBusinessId(B);if(!bid.ok)throw Error('fixture');
  await withTenantTx(db,bid.value,tx=>sql`update businesses set books_area=false where id=${B}::uuid`.execute(tx));
  try{expect((await get('/app/settings/books')).statusCode).toBe(404);expect((await get('/app/settings')).body).not.toContain('href="/app/settings/books"');}
  finally{await withTenantTx(db,bid.value,tx=>sql`update businesses set books_area=true where id=${B}::uuid`.execute(tx));}
  expect((await get('/app/settings/channels/technical',staff)).statusCode).not.toBe(200);
  expect((await get('/app/settings/channels/technical',accountant)).headers.location).toBe('/app/books');
  expect(calls).toBe(0);
 });

});
