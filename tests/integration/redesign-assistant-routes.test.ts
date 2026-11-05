import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import Fastify from 'fastify';
import {randomUUID} from 'node:crypto';
import {sql} from 'kysely';
import {createDb,withTenantTx,type Db} from '../../src/db/client.js';
import {parseBusinessId} from '../../src/core/types/ids.js';
import {seedRunTenant} from './tenant.js';
const d=process.env['DATABASE_URL']&&process.env['MIGRATE_DATABASE_URL']?describe:describe.skip;
const B=randomUUID(),missing=randomUUID(),FORM={'content-type':'application/x-www-form-urlencoded'};
d('Approved daily Assistant destinations preserve grants and commands',()=>{
 let db:Db,app:ReturnType<typeof Fastify>,owner='',staff='',accountant='',calls=0;
 const get=(url:string,cookie=owner)=>app.inject({method:'GET',url,headers:{cookie}});
 const post=(url:string,body:Record<string,string>={},cookie=owner)=>app.inject({method:'POST',url,payload:new URLSearchParams(body).toString(),headers:{cookie,...FORM}});
 beforeAll(async()=>{
  await seedRunTenant();db=createDb(process.env['DATABASE_URL']!);const b=parseBusinessId(B);if(!b.ok)throw Error('fixture');
  await withTenantTx(db,b.value,async tx=>{await sql`insert into businesses(id,name,country,currency,owner_locale,books_area) values(${B}::uuid,'Assistant route business','US','USD','en',true)`.execute(tx);});
  const {registerWebApp}=await import('../../src/api/web/app.js');app=Fastify({logger:false});const secret='area-six-isolated-session-secret-at-least-thirty-two';registerWebApp(app,{db,businessId:B,accessCode:'assistant-route-owner',sessionSecret:secret,employeeName:'Lily',avatar:'L',provider:'disabled',secureCookie:false,messagingEnabled:false,factsTtlMs:0,kickOutbound:async()=>{calls++;},kickDrive:async()=>{calls++;}} as unknown as Parameters<typeof registerWebApp>[1]);await app.ready();
  const login=async(code:string)=>String((await post('/login',{code},'')).headers['set-cookie']??'').split(';')[0]!;owner=await login('assistant-route-owner');const {addPerson}=await import('../../src/api/web/people.js');const one=await addPerson(db,B,secret,'Assistant staff','team'),two=await addPerson(db,B,secret,'Assistant accountant','accountant');if(one.code!=='added'||two.code!=='added')throw Error('people');staff=await login(one.accessCode);accountant=await login(two.accessCode);
 },60_000);
 afterAll(async()=>{await app?.close();await db?.destroy();});
 it('redirects all mapped old GETs with their queries and intended anchors',async()=>{
  const pairs=[['/app/advisor','/app/assistant/ask'],['/app/advisor/earlier','/app/assistant/ask/history'],['/app/advisor/c/'+missing,'/app/assistant/ask/'+missing],['/app/knowledge','/app/assistant/knowledge'],['/app/knowledge/'+missing,'/app/assistant/knowledge/products/'+missing],['/app/knowledge/from-page/'+missing,'/app/assistant/knowledge/readings/'+missing],['/app/knowledge/from-page/'+missing+'/again','/app/assistant/knowledge/readings/'+missing+'/again'],['/app/settings/assistant/checks','/app/assistant/review'],['/app/settings/assistant/history','/app/assistant/activity'],['/app/settings/assistant/learning','/app/assistant/knowledge?view=needs-answer'],['/app/settings/assistant/talk','/app/assistant/knowledge#sources'],['/app/onboarding/practice','/app/assistant/practice#checklist'],['/app/ready','/app/assistant/practice#readiness'],['/app/sandbox','/app/assistant/practice']];
  for(const [old,canonical] of pairs){const r=await get(old!+'?ask=kept%20question&before=old');const target=new URL(canonical!,'http://localhost');const query=new URLSearchParams('ask=kept+question&before=old');for(const [key,value] of target.searchParams)query.set(key,value);expect([r.statusCode,r.headers.location],old).toEqual([302,target.pathname+'?'+query.toString()+target.hash]);expect((await get(old!,'')).headers.location,old).toBe('/login');}
 });
 it('offers daily pages to owner and staff, keeps accountant in Books, and opens without a model or send',async()=>{
  for(const path of ['/app/assistant','/app/assistant/knowledge','/app/assistant/knowledge?view=products','/app/assistant/knowledge?view=readings','/app/assistant/practice','/app/assistant/review','/app/assistant/activity','/app/assistant/ask','/app/assistant/ask/history']){
   for(const cookie of [owner,staff]){const r=await get(path,cookie);expect(r.statusCode,path).toBe(200);expect(r.body,path).toContain('data-nav="assistant" aria-current="page"');expect(r.body.match(/<h1\b/g)?.length,path).toBe(1);}
   expect((await get(path,accountant)).headers.location,path).toBe('/app/books');
  }
  expect(calls).toBe(0);
 });
 it('keeps refused teaching fields in the native form and preserves the filtered return',async()=>{
  const from='/app/assistant/knowledge?view=facts&q=shipping&page=2#teach';
  const r=await post('/app/knowledge/teach',{from,kind:'faq',label:'Shipping <two>',content:'   '});
  expect(r.statusCode).toBe(422);expect(r.body).toContain('value="Shipping &lt;two&gt;"');expect(r.body).toContain('>   </textarea>');expect(r.body).toContain('value="faq" selected');expect(r.body).toContain('role="alert"');expect(r.body).toContain('action="/app/knowledge/teach"');expect(r.body).toContain('name="from"');
  const legacy=await post('/app/knowledge/teach',{kind:'faq',label:'Shipping',content:''});expect(legacy.statusCode).toBe(302);
  const corrected=await post('/app/knowledge/correct',{from,id:missing,content:'   '});expect(corrected.statusCode).toBe(422);expect(corrected.body).toContain('>   </textarea>');expect(corrected.body).toContain('action="/app/knowledge/correct"');
  const external=await post('/app/knowledge/teach',{from:'https://example.test',kind:'faq',label:'Kept',content:''});expect(external.headers.location).toBe('/app/assistant/knowledge?view=facts');
 });
 it('keeps Settings authority controls separate and returns old employee GETs directly',async()=>{
  const settings=await get('/app/settings/assistant');expect(settings.statusCode).toBe(200);expect(settings.body).toContain('data-nav="settings" aria-current="page"');expect(settings.body).toContain('action="/app/settings/assistant/autonomy"');
  const overview=await get('/app/assistant');expect(overview.body).not.toContain('action="/app/settings/assistant/autonomy"');
  expect((await get('/app/employee/checks?q=kept')).headers.location).toBe('/app/assistant/review?q=kept');
  expect((await post('/app/employee/spot-check/'+missing,{answer:'好'})).statusCode).toBe(308);
  const answer=await post('/app/settings/assistant/spot-check/'+missing,{answer:'好'},staff);expect(answer.headers.location).toBe('/app/assistant/review');
 });
});
