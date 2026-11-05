import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import pg from 'pg';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { createDb, withTenantTx, type Db, type Tx } from '../../src/db/client.js';
import { parseBusinessId } from '../../src/core/types/ids.js';
import { seedRunTenant } from './tenant.js';

const d = process.env['DATABASE_URL'] && process.env['MIGRATE_DATABASE_URL'] ? describe : describe.skip;
const B = randomUUID(), other = randomUUID(), customer = randomUUID(), noChat = randomUUID(), testCustomer = randomUUID(), foreign = randomUUID();
const conversation = randomUUID(), second = randomUUID(), testChat = randomUUID(), foreignChat = randomUUID(), order = randomUUID(), product = randomUUID(), label = randomUUID();
const SECRET = 'area-three-local-session-secret-at-least-thirty-two';
const FORM = {'content-type':'application/x-www-form-urlencoded'};
const tools = [
  ['/app/labels','/app/customers/labels'],['/app/surveys','/app/customers/feedback'],
  ['/app/contacts','/app/customers/outreach'],['/app/contacts/suppress','/app/customers/outreach/suppress'],
  ['/app/contacts/write','/app/customers/outreach/write'],['/app/prospects','/app/customers/outreach/find'],
  ['/app/sequences','/app/customers/outreach/sequences'],['/app/sequences/'+randomUUID(),'/app/customers/outreach/sequences/'],
] as const;

d('Area 3 canonical Customers routes and legacy command boundaries', () => {
  let db:Db, admin:pg.Client, app:ReturnType<typeof Fastify>, owner='', staff='', accountant='';
  let kicked=0;
  const tx = <T>(fn:(t:Tx)=>Promise<T>,biz=B) => { const b=parseBusinessId(biz); if(!b.ok)throw Error('fixture'); return withTenantTx(db,b.value,fn); };
  const get = (url:string,cookie=owner) => app.inject({method:'GET',url,headers:{cookie}});
  const post = (url:string,payload:string,cookie=owner) => app.inject({method:'POST',url,payload,headers:{cookie,...FORM}});
  beforeAll(async () => {
    await seedRunTenant();
    db=createDb(process.env['DATABASE_URL']!);
    admin=new pg.Client({connectionString:process.env['MIGRATE_DATABASE_URL']});await admin.connect();
    await tx(async t=>{
      await sql`insert into businesses(id,name,owner_locale) values(${B}::uuid,'Customer routes','en')`.execute(t);
      for(const [id,name] of [[customer,'Actual customer'],[noChat,'Recorded without chat'],[testCustomer,'Only a test']])
        await sql`insert into clients(id,business_id,display_name) values(${id}::uuid,${B}::uuid,${name})`.execute(t);
      for(const [id,client,testing,active] of [[conversation,customer,false,true],[second,customer,false,false],[testChat,testCustomer,true,true]] as const)
        await sql`insert into conversations(id,business_id,client_id,channel,owner_testing,is_active,owner_unsent_reply)
          values(${id}::uuid,${B}::uuid,${client}::uuid,'email',${testing},${active},'kept owner words')`.execute(t);
      await sql`insert into messages(conversation_id,direction,text_content) values(${conversation}::uuid,'inbound','Actual conversation words')`.execute(t);
      await sql`insert into client_channels(business_id,client_id,channel,channel_user_id)
        values(${B}::uuid,${customer}::uuid,'email',${customer+'@example.test'})`.execute(t);
      await sql`insert into products(id,business_id,sku,name,unit,moq) values(${product}::uuid,${B}::uuid,'ROUTE','Recorded product','pcs',1)`.execute(t);
      await sql`insert into orders(id,business_id,client_id,conversation_id,product_id,order_reference,quantity,unit,currency,total_value_usd,status)
        values(${order}::uuid,${B}::uuid,${customer}::uuid,${conversation}::uuid,${product}::uuid,${'PI-'+order},10,'pcs','EUR',80,'confirmed')`.execute(t);
      await sql`insert into labels(id,business_id,name,created_by) values(${label}::uuid,${B}::uuid,'Route label','owner')`.execute(t);
    });
    await tx(async t=>{
      await sql`insert into businesses(id,name) values(${other}::uuid,'Other customer routes')`.execute(t);
      await sql`insert into clients(id,business_id,display_name) values(${foreign}::uuid,${other}::uuid,'Foreign secret name')`.execute(t);
      await sql`insert into conversations(id,business_id,client_id,channel) values(${foreignChat}::uuid,${other}::uuid,${foreign}::uuid,'email')`.execute(t);
    },other);
    const {registerWebApp}=await import('../../src/api/web/app.js');
    app=Fastify({logger:false});
    registerWebApp(app,{db,businessId:B,accessCode:'area3-owner',sessionSecret:SECRET,employeeName:'Lily',avatar:'L',provider:'disabled',
      secureCookie:false,messagingEnabled:false,factsTtlMs:0,kickOutbound:async()=>{kicked++;},kickDrive:async()=>{kicked++;}} as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const login=async(code:string)=>String((await post('/login','code='+encodeURIComponent(code),'')).headers['set-cookie']??'').split(';')[0]!;
    owner=await login('area3-owner');
    const {addPerson}=await import('../../src/api/web/people.js');
    const s=await addPerson(db,B,SECRET,'Route staff','team'),a=await addPerson(db,B,SECRET,'Route accountant','accountant');
    if(s.code!=='added'||a.code!=='added')throw Error('people fixture');
    staff=await login(s.accessCode);accountant=await login(a.accessCode);
  },60_000);
  afterAll(async()=>{await app?.close();await db?.destroy();await admin?.end();});

  it('directory is complete, searchable, Customers-active, and read-only',async()=>{
    const r=await get('/app/customers');expect(r.statusCode).toBe(200);
    expect(r.body).toContain('Actual customer');expect(r.body).toContain('Recorded without chat');expect(r.body).not.toContain('Only a test');
    expect(r.body).toMatch(/href="\/app\/customers"[^>]*aria-current="page"/);
    const filtered=await get('/app/customers?q=without');expect(filtered.body).toContain('Recorded without chat');expect(filtered.body).not.toContain('Actual customer');
    const row=await tx(t=>sql<{words:string;opened:Date|null}>`select owner_unsent_reply as words,owner_opened_at as opened from conversations where id=${conversation}::uuid`.execute(t));
    expect(row.rows[0]).toEqual({words:'kept owner words',opened:null});expect(kicked).toBe(0);
  });

  it('record composes overview and selected history, keeps a card fragment and no-chat honesty',async()=>{
    const r=await get(`/app/customers/${customer}?conversation=${conversation}&from=${encodeURIComponent('/app/customers?q=Actual#customer-'+customer)}`);
    expect(r.statusCode).toBe(200);expect(r.body.match(/<h1\b/g)).toHaveLength(1);
    expect(r.body).toContain('data-card-body');expect(r.body).toContain('Actual conversation words');
    expect(r.body).toContain(`action="/app/conversations/${conversation}/name"`);
    for(const anchor of ['copy','deletion','opt-out'])expect(r.body).toContain(`id="${anchor}"`);
    expect(r.body).toContain('/app/customers?q=Actual#customer-'+customer);
    const empty=await get('/app/customers/'+noChat);expect(empty.statusCode).toBe(200);expect(empty.body).toContain('No conversations yet');
    expect(empty.body).not.toMatch(/action="\/app\/conversations\//);
  });

  it('invalid/foreign/test and mismatched selected records have actual 404 without disclosures',async()=>{
    for(const url of ['/app/customers/invalid','/app/customers/'+foreign,'/app/customers/'+testCustomer,
      `/app/customers/${customer}?conversation=${foreignChat}`,`/app/customers/${noChat}?conversation=${conversation}`,
      `/app/customers/${customer}?conversation=invalid`]){
      const r=await get(url);expect(r.statusCode,url).toBe(404);expect(r.body).not.toContain('Foreign secret name');expect(r.body).not.toContain('Actual conversation words');
    }
  });

  it('a card opened from the same conversation suppresses its redundant door and retains the no-script back link',async()=>{
    const r=await app.inject({method:'GET',url:'/app/customers/'+customer,headers:{cookie:owner,host:'local.test',referer:'http://local.test/app/inbox/'+conversation}});
    expect(r.statusCode).toBe(200);expect(r.body).not.toContain('class="deeper pc-open"');
    expect(r.body).toContain(`<a class="back" href="/app/inbox/${conversation}#latest"`);
    const external=await app.inject({method:'GET',url:'/app/customers/'+customer,headers:{cookie:owner,host:'local.test',referer:'https://other.test/app/inbox/'+conversation}});
    expect(external.body).toContain('<a class="back" href="/app/customers"');
  });

  it('old customer GETs redirect with their selected conversation/query; old commands stay POST endpoints',async()=>{
    expect((await get('/app/conversations?q=Actual')).headers['location']).toBe('/app/customers?q=Actual');
    const r=await get(`/app/conversations/${conversation}?from=${encodeURIComponent('/app/customers?q=Actual')}`);
    expect(r.statusCode).toBe(302);const u=new URL(String(r.headers['location']),'http://local');
    expect(u.pathname).toBe('/app/customers/'+customer);expect(u.searchParams.get('conversation')).toBe(conversation);expect(u.searchParams.get('from')).toBe('/app/customers?q=Actual');
    expect((await get('/app/conversations/'+foreignChat)).statusCode).toBe(404);
  });

  it('operational orders filter and return safely, and missing detail is 404',async()=>{
    const r=await get('/app/customers/orders?client='+customer);expect(r.statusCode).toBe(200);expect(r.body).toContain('PI-'+order);
    expect(r.body).not.toContain('draft-invoice');expect(r.body).toContain('/app/orders/'+order);
    const detail=await get(`/app/orders/${order}?from=${encodeURIComponent('/app/customers/orders?client='+customer+'#order-'+order)}`);
    expect(detail.statusCode).toBe(200);expect(detail.body).toContain('/app/customers/orders?client='+customer+'#order-'+order);
    const forged=await get(`/app/orders/${order}?from=https%3A%2F%2Fevil.example`);expect(forged.body).not.toContain('href="https://evil.example');
    for(const id of ['bad',randomUUID()])expect((await get('/app/orders/'+id)).statusCode).toBe(404);
  });

  it('feature-off refuses canonical and legacy outreach GETs/POSTs',async()=>{
    for(const [old,target] of tools.filter(([old])=>!['/app/labels','/app/surveys'].includes(old))){
      const canonical=target.endsWith('/')?target+old.split('/').at(-1):target;
      expect((await get(old)).statusCode,old).toBe(404);expect((await get(canonical)).statusCode,canonical).toBe(404);
    }
    for(const path of ['/app/contacts','/app/contacts/write','/app/sequences'])expect((await post(path,'name=Blocked')).statusCode).toBe(404);
  });

  it('feature-on moves every tool GET without losing query/IDs and still gates accountant access',async()=>{
    await tx(t=>sql`update businesses set outreach_area=true where id=${B}::uuid`.execute(t));
    for(const [old,target] of tools){
      const canonical=target.endsWith('/')?target+old.split('/').at(-1):target;
      const r=await get(old+'?q=hello%20there&page=2&identity=a%2Bb%40example.test');expect(r.statusCode,old).toBe(302);
      const u=new URL(String(r.headers['location']),'http://local');expect(u.pathname).toBe(canonical);expect(u.searchParams.get('identity')).toBe('a+b@example.test');
      const page=await get(canonical);expect(page.statusCode,canonical).toBe(200);expect(page.body).toContain('class="customer-area"');
      expect((await get(canonical,staff)).statusCode,canonical).toBe(200);
      expect((await get(canonical,accountant)).headers['location']).toBe('/app/books');
    }
    expect(kicked).toBe(0);
  });

  it('rename and stop forms keep a filtered, paged list return through commands and the legacy GET alias',async()=>{
    const from=`/app/customers?q=Actual&label=${label}&after=page-cursor#customer-${customer}`;
    const record=await get(`/app/customers/${customer}?conversation=${conversation}&from=${encodeURIComponent(from)}`);
    for(const action of ['name','opt-out/record']){
      const form=new RegExp(`<form[^>]+action="/app/conversations/${conversation}/${action}"[^>]*>([\\s\\S]*?)</form>`).exec(record.body);
      expect(form,action).not.toBeNull();expect(form![1]).toContain('name="from"');
    }
    const renamed=await post(`/app/conversations/${conversation}/name`,new URLSearchParams({name:'Actual customer',from}).toString(),staff);
    const location=new URL(String(renamed.headers['location']),'http://local');
    expect(location.pathname).toBe('/app/conversations/'+conversation);expect(location.searchParams.get('from')).toBe(from);
    const alias=await get(location.pathname+location.search);
    expect(new URL(String(alias.headers['location']),'http://local').searchParams.get('from')).toBe(from);
    const restored=await get(String(alias.headers['location']));expect(restored.body.replaceAll('&amp;','&')).toContain(`href="${from}"`);
    const stop=await post(`/app/conversations/${conversation}/opt-out/record`,new URLSearchParams({from}).toString(),staff);
    const stopReturn=new URL(String(stop.headers['location']),'http://local');expect(stopReturn.searchParams.get('from')).toBe(from);expect(stopReturn.hash).toBe('#opt-out');
    const stopped=await get(`/app/customers/${customer}?conversation=${conversation}&from=${encodeURIComponent(from)}`);
    const liftForm=new RegExp(`<form[^>]+action="/app/conversations/${conversation}/opt-out/lift"[^>]*>([\\s\\S]*?)</form>`).exec(stopped.body);
    expect(liftForm).not.toBeNull();expect(liftForm![1]).toContain('name="from"');
    const refused=await post(`/app/conversations/${conversation}/opt-out/lift`,new URLSearchParams({from}).toString(),staff);
    expect(new URL(String(refused.headers['location']),'http://local').searchParams.get('from')).toBe(from);
    const lifted=await post(`/app/conversations/${conversation}/opt-out/lift`,new URLSearchParams({from}).toString());
    expect(new URL(String(lifted.headers['location']),'http://local').searchParams.get('from')).toBe(from);
  });

  it('order update keeps its list return on success/refusal, rejects external context and preserves absent-context redirects',async()=>{
    const from=`/app/customers/orders?q=PI&client=${customer}&state=confirmed&before=page-cursor#order-${order}`;
    const detail=await get(`/app/orders/${order}?from=${encodeURIComponent(from)}`);
    const form=new RegExp(`<form[^>]+action="/app/orders/${order}/update"[^>]*>([\\s\\S]*?)</form>`).exec(detail.body);
    expect(form).not.toBeNull();expect(form![1]).toContain('name="from"');
    for(const state of ['in_production','not-a-state']){
      const r=await post(`/app/orders/${order}/update`,new URLSearchParams({state,from}).toString());
      const location=new URL(String(r.headers['location']),'http://local');expect(location.pathname).toBe('/app/orders/'+order);expect(location.searchParams.get('from')).toBe(from);
      expect((await get(location.pathname+location.search)).body.replaceAll('&amp;','&')).toContain(`href="${from}"`);
    }
    for(const [path,payload] of [[`/app/conversations/${conversation}/name`,{name:'Actual customer'}],[`/app/orders/${order}/update`,{state:'confirmed'}]] as const){
      const evil=await post(path,new URLSearchParams({...payload,from:'https://evil.example/steal?secret=1'}).toString());
      expect(String(evil.headers['location'])).not.toContain('evil.example');
      expect(new URL(String(evil.headers['location']),'http://local').searchParams.get('from')).toBe('/app/customers');
      const absent=await post(path,new URLSearchParams(payload).toString());
      expect(absent.headers['location']).toBe(path.replace(/\/(name|update)$/,''));
    }
    const bare=await get('/app/orders/'+order);
    expect(bare.body).toContain(`<a class="back" href="/app/inbox/${conversation}#latest"`);
    const bareForm=new RegExp(`<form[^>]+action="/app/orders/${order}/update"[^>]*>([\\s\\S]*?)</form>`).exec(bare.body);
    expect(bareForm![1]).not.toContain('name="from"');
  });

  it('owner/staff access and unchanged POST commands preserve permissions and billing hold',async()=>{
    for(const path of ['/app/customers','/app/customers/'+customer,'/app/customers/orders','/app/orders/'+order]){
      expect((await get(path,'')).headers['location']).toBe('/login');
      expect((await get(path,staff)).statusCode).toBe(200);expect((await get(path,accountant)).headers['location']).toBe('/app/books');
    }
    expect((await post(`/app/labels/${label}`,'name=Changed+label',staff)).statusCode).toBe(302);
    expect((await tx(t=>sql<{name:string}>`select name from labels where id=${label}::uuid`.execute(t))).rows[0]?.name).toBe('Changed label');
    await post('/app/surveys','on=1',staff);
    expect((await tx(t=>sql<{on:boolean}>`select surveys_on as on from businesses where id=${B}::uuid`.execute(t))).rows[0]?.on).toBe(false);
    await admin.query('update businesses set signed_up_at=now() where id=$1',[B]);
    await admin.query("insert into workspace_billing(business_id,status,lapsed_at) values($1,'lapsed',now())",[B]);
    expect((await get('/app/customers')).statusCode).toBe(200);
    await post(`/app/conversations/${conversation}/name`,'name=Must+not+rename');
    expect((await tx(t=>sql<{name:string}>`select display_name as name from clients where id=${customer}::uuid`.execute(t))).rows[0]?.name).toBe('Actual customer');
    expect(kicked).toBe(0);
  });
});
