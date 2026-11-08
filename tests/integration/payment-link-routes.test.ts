import {ensureConversation} from '../../src/db/channels.js';
import {setInvoiceSending} from '../../src/db/invoiceSending.js';
import {draftInvoiceFromOrder} from '../../src/db/booksOrders.js';
import {recordOptOut} from '../../src/db/optOuts.js';
import {makeSessionCodec} from '../../src/api/web/session.js';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {createHmac,randomUUID} from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import {sql} from 'kysely';
import {createDb,withTenantTx,type Db} from '../../src/db/client.js';
import type {BusinessId} from '../../src/core/types/ids.js';
import {registerWebApp} from '../../src/api/web/app.js';
import {paymentProvider} from '../fixtures/paymentProvider.js';
import {CONNECT_CONFIG} from '../fixtures/stripeConnect.js';
import {loadCountryPack} from '../../src/db/booksCountry.js';
import {COUNTRY_PACKS} from '../../src/core/books/countryPacks.js';
import {draftInvoice,issueInvoice} from '../../src/db/booksInvoices.js';
import {decimal} from '../../src/core/types/decimal.js';
import {unisolatedFigures} from '../parity/isolates.js';
import {buttonsAndDoors} from '../parity/buttons-and-doors.js';

const d=process.env['DATABASE_URL']&&process.env['MIGRATE_DATABASE_URL']?describe:describe.skip;
const bid=randomUUID() as BusinessId,ma=randomUUID() as BusinessId;
const BASE='/app/payments/stripe',SECRET='test-owner-session-secret-000000000000';
d('payment links · owner routes and signed receipt boundary',{timeout:120_000},()=>{
  let db:Db,admin:pg.Client,app:ReturnType<typeof Fastify>,owner='',invoice='',ids:Record<string,string>;
  const p=paymentProvider({id:`acct_${bid.replaceAll('-','')}`,country:'GB',currency:'GBP',ready:true});
  const form=(url:string,body:Record<string,string>={},cookie=owner)=>app.inject({method:'POST',url,headers:{cookie,'content-type':'application/x-www-form-urlencoded'},payload:new URLSearchParams(body).toString()});
  const get=(url:string,cookie=owner)=>app.inject({method:'GET',url,headers:{cookie}});
  beforeAll(async()=>{
    admin=new pg.Client({connectionString:process.env['MIGRATE_DATABASE_URL']});await admin.connect();db=createDb(process.env['DATABASE_URL']!);
    for(const [id,country,currency] of [[bid,'GB','GBP'],[ma,'MA','MAD']])await admin.query("insert into businesses(id,name,engine,country,currency,books_area,timezone) values($1,'Route fixture','service',$2,$3,true,'UTC')",[id,country,currency]);
    app=Fastify({logger:false});registerWebApp(app,{db,businessId:bid,accessCode:'test-owner-access',sessionSecret:SECRET,employeeName:'Lily',provider:'disabled',messagingEnabled:true,secureCookie:false,factsTtlMs:0,kickOutbound:async()=>{},kickDrive:async()=>{},publicBaseUrl:'https://nomi.example',stripeConnect:{config:CONNECT_CONFIG,client:p.client}} as unknown as Parameters<typeof registerWebApp>[1]);await app.ready();
    const login=await form('/login',{code:'test-owner-access'},'');owner=String(login.headers['set-cookie']).split(';')[0]!;
    await withTenantTx(db,bid,async tx=>{
      await loadCountryPack(tx,bid,COUNTRY_PACKS.GB,'2026-01-01');
      await sql`insert into fiscal_years(business_id,starts_on,ends_on) values(${bid}::uuid,'2026-01-01','2026-12-31')`.execute(tx);
      ids=Object.fromEntries((await sql<{id:string;code:string}>`select id::text,code from accounts union all select id::text,code from journals`.execute(tx)).rows.map(r=>[r.code,r.id]));
      const party=(await sql<{id:string}>`insert into parties(business_id,code,name,kind) values(${bid}::uuid,'C1','Fixture buyer','customer') returning id::text`.execute(tx)).rows[0]!.id;
      const i=await draftInvoice(tx,bid,'owner',{partyId:party,issueDate:'2026-10-10',dueDate:null,currency:'GBP',label:null,lines:[{label:'Goods',quantity:decimal('1'),unitPrice:decimal('100'),accountId:ids['4000']!,taxCodeId:null}]});if(i.kind!=='drafted')throw new Error(i.reason);invoice=i.id;expect((await issueInvoice(tx,bid,invoice,'owner')).kind).toBe('issued');
    });
  });
  // This fixture includes conversation history and orders. The isolated runner owns its database cleanup.
  afterAll(async()=>{await app?.close();await db?.destroy();await admin?.end();});
  it('opens the owner page in both languages; unsigned readers go to sign-in',async()=>{
    expect((await get(BASE,'')).statusCode).toBe(302);
    for(const locale of ['en','ar']){const r=await get(BASE,owner+`; yf_locale=${locale}`);expect(r.statusCode).toBe(200);expect(r.body).toContain(`<html lang="${locale}"`);expect(r.body).toContain('Connect your Stripe account');expect(unisolatedFigures(r.body)).toEqual([]);expect(buttonsAndDoors(r.body)).toEqual([]);}
  });
  it('binds only a matching one-use owner state, never a replay',async()=>{
    const start=await form(`${BASE}/connect`);expect(start.statusCode).toBe(302);
    const u=new URL(String(start.headers.location));expect(u.hostname).toBe('connect.stripe.com');const state=u.searchParams.get('state')!;
    const calls=p.calls.length;expect((await get(`${BASE}/return?state=wrong&code=one-use`)).statusCode).toBe(302);expect(p.calls).toHaveLength(calls);
    expect((await get(`${BASE}/return?state=${state}&code=one-use`)).statusCode).toBe(302);
    const after=p.calls.length;await get(`${BASE}/return?state=${state}&code=one-use`);expect(p.calls).toHaveLength(after);
    expect((await get(BASE)).body).toContain('Connected account');
  });
  it('accepts explicit account choices, creates one usable link, and never accepts a success-query payment',async()=>{
    expect((await form(`${BASE}/accounts`,{clearingId:ids['1030']!,transitId:ids['1040']!,feeId:ids['5020']!,journalId:ids['GJ']!,bankId:ids['1000']!})).statusCode).toBe(302);
    expect((await form(`${BASE}/invoices/${invoice}/create`)).statusCode).toBe(302);
    expect(p.created()).toBe(1);
    const returned=await get('/payment/return?paid=true&invoice='+invoice,'');expect(returned.statusCode).toBe(200);
    expect((await withTenantTx(db,bid,tx=>sql`select * from invoice_payments where invoice_id=${invoice}::uuid`.execute(tx))).rows).toHaveLength(0);
    expect((await get(`/app/books/invoices/${invoice}`)).body).toContain('Send payment link');
  });
  it('checks raw signature and mode before accepting durable identifiers, with no provider request during receipt',async()=>{
    const object=[...p.sessions.values()][0]!;
    const raw=JSON.stringify({id:'evt_route',type:'checkout.session.completed',account:p.client?`acct_${bid.replaceAll('-','')}`:'',livemode:false,created:Math.floor(Date.now()/1000),data:{object:{id:object.id,payment_intent:null,customer_email:'must-not-be-kept@example.test'}}});
    const time=Math.floor(Date.now()/1000),sig=`t=${time},v1=${createHmac('sha256',CONNECT_CONFIG.webhookSecret).update(`${time}.${raw}`).digest('hex')}`;
    const hook=(body:string,signature:string)=>app.inject({method:'POST',url:'/hooks/stripe/connect',headers:{'content-type':'application/json','stripe-signature':signature},payload:body});
    expect((await hook(raw+' ',sig)).statusCode).toBe(400);
    const signed=(b:string,at=time,key:string=CONNECT_CONFIG.webhookSecret)=>`t=${at},v1=${createHmac('sha256',key).update(`${at}.${b}`).digest('hex')}`;
    expect((await hook(raw,signed(raw,time-1000))).statusCode).toBe(400);
    expect((await hook(raw,signed(raw,time,'different-test-secret'))).statusCode).toBe(400);
    for(const change of [{livemode:true},{account:undefined}]){const b=JSON.stringify({...JSON.parse(raw),...change});expect((await hook(b,signed(b))).statusCode).toBe(400);}
    const calls=p.calls.length;
    expect((await hook(raw,sig)).statusCode).toBe(200);expect((await hook(raw,sig)).statusCode).toBe(200);expect(p.calls).toHaveLength(calls);
    const rows=(await withTenantTx(db,bid,tx=>sql`select * from stripe_event_inbox where event_id='evt_route'`.execute(tx))).rows;
    expect(rows).toHaveLength(1);expect(JSON.stringify(rows)).not.toContain('must-not-be-kept');
  });
  it('refuses staff and accountants on every write and keeps their pages free of payment controls',async()=>{
    for(const kind of ['team','accountant'] as const){
      const cookie='yf_session='+makeSessionCodec(SECRET).sign({businessId:bid,exp:Date.now()+60000,person:{id:'test-'+kind,name:'Fixture member',isOwner:false,kind}});
      const calls=p.calls.length;
      for(const path of ['connect','accounts',`invoices/${invoice}/create`,`invoices/${invoice}/send`,'attempts/not-mine/expire','disconnect','retry','payouts/po_other/confirm','payouts/po_other/receive']){
        const r=await form(`${BASE}/${path}`,{},cookie);expect(r.statusCode,path).toBe(302);
      }
      expect((await get(BASE,cookie)).statusCode).toBe(302);expect(p.calls).toHaveLength(calls);
    }
  });
  it('refuses forged Morocco requests before any provider call and isolates cross-tenant invoice ids',async()=>{
    const cookie='yf_session='+makeSessionCodec(SECRET).sign({businessId:ma,exp:Date.now()+60000});
    expect((await get(BASE,cookie)).body).toContain('not available in your country');
    const calls=p.calls.length;
    for(const path of ['connect',`invoices/${invoice}/create`,`invoices/${invoice}/send`])expect((await form(`${BASE}/${path}`,{},cookie)).statusCode).toBe(302);
    expect(p.calls).toHaveLength(calls);
    await form(`${BASE}/invoices/${randomUUID()}/create`);expect(p.created()).toBe(1);
  });
  it('will not disconnect while a usable external link remains',async()=>{
    await form(`${BASE}/disconnect`);
    expect((await withTenantTx(db,bid,tx=>sql<{active:boolean}>`select active from stripe_connections`.execute(tx))).rows[0]!.active).toBe(true);
  });

  it('has no binding or provider access in a Practice copy',async()=>{
    const copy=randomUUID();await admin.query("insert into businesses(id,name,engine,country,currency,books_area,practice_of) values($1,'Practice fixture','service','GB','GBP',true,$2)",[copy,bid]);
    const cookie='yf_session='+makeSessionCodec(SECRET).sign({businessId:copy,exp:Date.now()+60000});
    const calls=p.calls.length;expect((await get(BASE,cookie)).body).toContain('Practice has no payment connection');
    for(const path of ['connect',`invoices/${invoice}/create`,`invoices/${invoice}/send`])await form(`${BASE}/${path}`,{},cookie);
    expect(p.calls).toHaveLength(calls);
  });
  it('queues only an explicit owner send on the existing path and keeps the opt-out refusal',async()=>{
    const f=await withTenantTx(db,bid,async tx=>{
      const c=await ensureConversation(tx,bid,'payment-fixture@example.test','Payment fixture','email');
      await sql`update client_channels set last_inbound_at=now() where client_id=${c.clientId}::uuid`.execute(tx);
      const product=randomUUID(),order=randomUUID();
      await sql`insert into products(id,business_id,sku,name,unit,is_active) values(${product}::uuid,${bid}::uuid,'PAYMENT-FIXTURE','Fixture product','item',true)`.execute(tx);
      await sql`insert into orders(id,order_reference,business_id,client_id,conversation_id,product_id,quantity,unit,status,agreed_unit_price_usd,total_value_usd,currency,confirmed_at)
        values(${order}::uuid,'PAYMENT-FIXTURE',${bid}::uuid,${c.clientId}::uuid,${c.conversationId}::uuid,${product}::uuid,1,'item','confirmed',100,100,'GBP',now())`.execute(tx);
      const party=(await sql<{id:string}>`select id::text from parties where business_id=${bid}::uuid and code='C1'`.execute(tx)).rows[0]!.id;
      const inv=await draftInvoiceFromOrder(tx,bid,order,party,null,'owner');if(inv.kind!=='drafted')throw new Error(JSON.stringify(inv));
      expect((await issueInvoice(tx,bid,inv.id,'owner')).kind).toBe('issued');
      await setInvoiceSending(tx,bid,true);return {...c,invoice:inv.id,order};
    });
    await form(`${BASE}/invoices/${f.invoice}/create`);
    const created=p.created();expect(created).toBe(2);
    const sent=await form(`${BASE}/invoices/${f.invoice}/send`);expect(sent.statusCode).toBe(302);
    const rows=()=>withTenantTx(db,bid,tx=>sql<{body:string;origin:string;approved:boolean;status:string}>`select body,origin,approved,status from outbound_messages where conversation_id=${f.conversationId}::uuid`.execute(tx));
    expect((await rows()).rows).toMatchObject([{origin:'owner',approved:true,status:'queued'}]);
    expect((await rows()).rows[0]!.body).toContain('https://checkout.stripe.com/');expect(p.created()).toBe(created);
    expect((await withTenantTx(db,bid,tx=>sql`select * from stripe_link_sends where conversation_id=${f.conversationId}::uuid`.execute(tx))).rows).toHaveLength(1);
    await withTenantTx(db,bid,tx=>recordOptOut(tx,bid,{conversationId:f.conversationId,by:'buyer',now:new Date()}));
    const calls=p.calls.length;await form(`${BASE}/invoices/${f.invoice}/send`);expect(p.calls).toHaveLength(calls);
    expect((await rows()).rows).toHaveLength(1);expect((await rows()).rows[0]!.status).toBe('canceled');
    expect((await withTenantTx(db,bid,tx=>sql<{status:string}>`select status from orders where id=${f.order}::uuid`.execute(tx))).rows[0]!.status).toBe('confirmed');
  });

});
