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
import {createPaymentLink,expirePaymentLink,reconcileStripePayments} from '../../src/payments/invoicePayments.js';
import type {IntentFact} from '../../src/core/payments/paymentLink.js';

/**
 * P11 — a delayed payment that fails. Stripe's Checkout fulfillment page (read 2026-11-09, Asia/Shanghai) says a
 * session can complete while its payment is still processing, and `checkout.session.async_payment_failed` is the
 * later outcome. Every event here arrives through the signed connected-account webhook; the provider is a fake.
 */
const d=process.env['DATABASE_URL']&&process.env['MIGRATE_DATABASE_URL']?describe:describe.skip;
const bid=randomUUID() as BusinessId;
const ACCOUNT=`acct_${bid.replaceAll('-','')}`;
const BILLING_SECRET='test-billing-webhook-secret-0000';
const noBillingCall=async()=>{throw new Error('Unexpected billing provider call');};
const billing={createCustomer:noBillingCall,setupCheckout:noBillingCall,setupIntentPaymentMethod:noBillingCall,setDefaultPaymentMethod:noBillingCall,createSubscription:noBillingCall,price:noBillingCall,portal:noBillingCall};
const BASE='/app/payments/stripe',SECRET='test-owner-session-secret-000000000000';
const NOW=new Date();   // the route makes links on the real clock; +49 h is measured from it
const at=(hours:number)=>()=>new Date(NOW.getTime()+hours*3600000);
const sec=Math.floor(NOW.getTime()/1000);

d('payment links · an asynchronous payment failure ends the attempt (signed webhook, fake provider)',{timeout:120_000},()=>{
  let db:Db,admin:pg.Client,app:ReturnType<typeof Fastify>,owner='',ids:Record<string,string>,party='';
  const p=paymentProvider({id:ACCOUNT,country:'GB',currency:'GBP',ready:true});
  const deps=(now=at(0))=>({db,client:p.client,live:false,now,publicBaseUrl:'https://nomi.example'});
  const form=(url:string,body:Record<string,string>={},cookie=owner)=>app.inject({method:'POST',url,headers:{cookie,'content-type':'application/x-www-form-urlencoded'},payload:new URLSearchParams(body).toString()});
  const get=(url:string,cookie=owner)=>app.inject({method:'GET',url,headers:{cookie}});
  const q=async<T>(text:string,values:unknown[]=[])=>(await admin.query(text,values)).rows as T[];
  /** The raw body Stripe signs, then the signed POST — the same path production receives. */
  const deliver=async(type:string,object:Record<string,unknown>)=>{
    const id=`evt_${randomUUID().replaceAll('-','')}`;
    const raw=JSON.stringify({id,type,account:ACCOUNT,livemode:false,created:Math.floor(Date.now()/1000),data:{object}});
    const t=Math.floor(Date.now()/1000),sig=`t=${t},v1=${createHmac('sha256',CONNECT_CONFIG.webhookSecret).update(`${t}.${raw}`).digest('hex')}`;
    const r=await app.inject({method:'POST',url:'/hooks/stripe/connect',headers:{'content-type':'application/json','stripe-signature':sig},payload:raw});
    expect(r.statusCode).toBe(200);
    return id;
  };
  const invoice=async()=>withTenantTx(db,bid,async tx=>{
    const i=await draftInvoice(tx,bid,'owner',{partyId:party,issueDate:'2026-10-10',dueDate:null,currency:'GBP',label:null,lines:[{label:'Goods',quantity:decimal('1'),unitPrice:decimal('100'),accountId:ids['4000']!,taxCodeId:null}]});
    if(i.kind!=='drafted')throw new Error(i.reason);expect((await issueInvoice(tx,bid,i.id,'owner')).kind).toBe('issued');return i.id;
  });
  /** An invoice whose link the customer completed with a delayed payment: complete, unpaid, its intent not succeeded. */
  const completedUnpaid=async()=>{
    const inv=await invoice();
    expect((await form(`${BASE}/invoices/${inv}/create`)).statusCode).toBe(302);
    const a=(await q<{id:string}>('select id::text from stripe_checkout_attempts where invoice_id=$1',[inv]))[0]!.id;
    const s=p.sessions.get(a)!,pi=`pi_${a.replaceAll('-','')}`;
    p.sessions.set(a,{...s,status:'complete',paid:false,intentId:pi,url:null});
    p.intents.set(pi,{id:pi,attemptId:a,succeeded:false,charge:null});
    const completed=await deliver('checkout.session.completed',{id:s.id,payment_intent:pi});
    await reconcileStripePayments(deps(),bid);
    expect((await state(a)).state).toBe('processing');
    return {inv,a,session:s.id,pi,completed};
  };
  const state=async(a:string)=>(await q<{state:string;reason:string|null}>('select state,reason from stripe_checkout_attempts where id=$1',[a]))[0]!;
  const inbox=async(ids:readonly string[])=>q<{event_id:string;state:string}>('select event_id,state from stripe_event_inbox where event_id=any($1) order by event_id',[ids]);
  const paid=async(inv:string)=>q<{amount:string}>('select amount::text from invoice_payments where invoice_id=$1',[inv]);
  const succeeded=(id:string,attemptId:string):IntentFact=>({id,attemptId,succeeded:true,charge:{id:`ch_${id.slice(3)}`,amount:decimal('100'),currency:'GBP',created:sec,paid:true,captured:true,
    balance:{id:`txn_${id.slice(3)}`,gross:decimal('100'),fee:decimal('3'),net:decimal('97'),currency:'GBP',created:sec}}});

  beforeAll(async()=>{
    admin=new pg.Client({connectionString:process.env['MIGRATE_DATABASE_URL']});await admin.connect();db=createDb(process.env['DATABASE_URL']!);
    await admin.query("insert into businesses(id,name,engine,country,currency,books_area,timezone) values($1,'Async failure fixture','service','GB','GBP',true,'UTC')",[bid]);
    app=Fastify({logger:false});registerWebApp(app,{db,businessId:bid,accessCode:'test-owner-access',sessionSecret:SECRET,employeeName:'Lily',provider:'disabled',messagingEnabled:true,secureCookie:false,factsTtlMs:0,kickOutbound:async()=>{},kickDrive:async()=>{},publicBaseUrl:'https://nomi.example',stripeConnect:{config:CONNECT_CONFIG,client:p.client},stripe:{client:billing,webhookSecret:BILLING_SECRET}} as unknown as Parameters<typeof registerWebApp>[1]);await app.ready();
    owner=String((await form('/login',{code:'test-owner-access'},'')).headers['set-cookie']).split(';')[0]!;
    await withTenantTx(db,bid,async tx=>{
      await loadCountryPack(tx,bid,COUNTRY_PACKS.GB,'2026-01-01');
      await sql`insert into fiscal_years(business_id,starts_on,ends_on) values(${bid}::uuid,'2026-01-01','2026-12-31')`.execute(tx);
      ids=Object.fromEntries((await sql<{id:string;code:string}>`select id::text,code from accounts union all select id::text,code from journals`.execute(tx)).rows.map(r=>[r.code,r.id]));
      party=(await sql<{id:string}>`insert into parties(business_id,code,name,kind) values(${bid}::uuid,'C1','Fixture buyer','customer') returning id::text`.execute(tx)).rows[0]!.id;
    });
    const state=new URL(String((await form(`${BASE}/connect`)).headers.location)).searchParams.get('state')!;
    expect((await get(`${BASE}/return?state=${state}&code=one-use`)).statusCode).toBe(302);
    expect((await form(`${BASE}/accounts`,{clearingId:ids['1030']!,transitId:ids['1040']!,feeId:ids['5020']!,journalId:ids['GJ']!,bankId:ids['1000']!})).statusCode).toBe(302);
  });
  afterAll(async()=>{await app?.close();await db?.destroy();await admin?.end();});

  it('THE FAILURE: async_payment_failed ends the attempt as failed, its events are done, a new link is allowed, and the owner sees it', async()=>{
    const f=await completedUnpaid();
    const failure=await deliver('checkout.session.async_payment_failed',{id:f.session,payment_intent:f.pi});
    const intentFailed=await deliver('payment_intent.payment_failed',{id:f.pi});
    for(let n=0;n<3;n++)await reconcileStripePayments(deps(),bid);
    expect(await state(f.a)).toEqual({state:'failed',reason:null});
    expect((await inbox([f.completed,failure,intentFailed])).map(r=>r.state)).toEqual(['done','done','done']);
    expect(await paid(f.inv)).toEqual([]);                                             // nothing settled, nothing invented
    expect(await q('select 1 from stripe_movements where attempt_id=$1',[f.a])).toEqual([]);
    // The owner sees that the payment did not complete — the page's own words for a failed attempt.
    const page=await get(BASE);expect(page.statusCode).toBe(200);expect(page.body).toContain('Payment did not complete');
    // A new link for the same invoice is allowed, now and at +49 h.
    const made=await createPaymentLink(deps(at(49)),bid,f.inv);
    expect(made.ok).toBe(true);
    if(made.ok){expect(made.value.id).not.toBe(f.a);expect(made.value.state).toBe('open');}
    expect((await state(f.a)).state).toBe('failed');                                  // a later look at the old session keeps it failed
    await reconcileStripePayments(deps(at(49)),bid);
    expect((await state(f.a)).state).toBe('failed');
  });

  it('CONTROL — still processing, with no failure: the attempt stays processing, cannot be expired even at +49 h, and no new link is made', async()=>{
    const f=await completedUnpaid();
    for(let n=0;n<3;n++)await reconcileStripePayments(deps(at(49)),bid);
    expect((await state(f.a)).state).toBe('processing');
    expect((await inbox([f.completed]))[0]!.state).toBe('pending');
    expect(await expirePaymentLink(deps(at(49)),bid,f.a)).toEqual({ok:false,reason:'processing'});
    expect(await createPaymentLink(deps(at(49)),bid,f.inv)).toEqual({ok:false,reason:'expire_first'});
    // A payment_intent.payment_failed alone is not Checkout's failure: a card can be tried again on an open session.
    const intentFailed=await deliver('payment_intent.payment_failed',{id:f.pi});
    await reconcileStripePayments(deps(),bid);
    expect((await state(f.a)).state).toBe('processing');
    expect((await inbox([intentFailed]))[0]!.state).toBe('pending');
  });

  it('CONTROL — a succeeded payment is unchanged by a failure event: paid once, its events done', async()=>{
    const f=await completedUnpaid();
    p.sessions.set(f.a,{...p.sessions.get(f.a)!,paid:true});
    p.intents.set(f.pi,succeeded(f.pi,f.a));
    const ok=await deliver('checkout.session.async_payment_succeeded',{id:f.session,payment_intent:f.pi});
    for(let n=0;n<3;n++)await reconcileStripePayments(deps(),bid);
    expect((await state(f.a)).state).toBe('paid');
    expect(await paid(f.inv)).toEqual([{amount:'100.00'}]);
    const stray=await deliver('checkout.session.async_payment_failed',{id:f.session,payment_intent:f.pi});
    for(let n=0;n<3;n++)await reconcileStripePayments(deps(),bid);
    expect((await state(f.a)).state).toBe('paid');
    expect(await paid(f.inv)).toEqual([{amount:'100.00'}]);
    expect((await inbox([f.completed,ok,stray])).map(r=>r.state)).toEqual(['done','done','done']);
  });

  it('A LATER SUCCESS after a recorded failure is still posted: the money that arrives is never dropped', async()=>{
    const f=await completedUnpaid();
    await deliver('checkout.session.async_payment_failed',{id:f.session,payment_intent:f.pi});
    await reconcileStripePayments(deps(),bid);
    expect((await state(f.a)).state).toBe('failed');
    p.intents.set(f.pi,succeeded(f.pi,f.a));
    await deliver('payment_intent.succeeded',{id:f.pi});
    for(let n=0;n<3;n++)await reconcileStripePayments(deps(),bid);
    expect((await state(f.a)).state).toBe('paid');
    expect(await paid(f.inv)).toEqual([{amount:'100.00'}]);
  });
});
