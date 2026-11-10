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
import {reconcileStripePayments} from '../../src/payments/invoicePayments.js';
import {deliverOwnerAlert,goesByMail} from '../../src/pipeline/notify.js';
import type {NotifyJob} from '../../src/queue/boss.js';
import type {IntentFact} from '../../src/core/payments/paymentLink.js';

/**
 * 5.1 — a late payment on an old attempt must not leave a second link open (t1r's ruling, 2026-11-10). After a delayed
 * payment fails and a new link is made, the OLD intent can still succeed. Then every other payable link of the invoice
 * is expired through the one expiry path and recorded; one the provider will not expire is said on the invoice; and if
 * both are paid anyway, both are posted, the invoice says it was paid twice and the owner is told once — nothing is
 * refunded or reversed. Before this, the new link stayed open.
 *
 * Background, from P11 — a delayed payment that fails. Stripe's Checkout fulfillment page (read 2026-11-09, Asia/Shanghai) says a
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

d('payment links · a payment on one link closes the others (signed webhook, fake provider)',{timeout:120_000},()=>{
  let db:Db,admin:pg.Client,app:ReturnType<typeof Fastify>,owner='',ids:Record<string,string>,party='';
  const p=paymentProvider({id:ACCOUNT,country:'GB',currency:'GBP',ready:true});
  const alerts:NotifyJob[]=[];
  // The worker's alert (src/main.ts) queues exactly this job; here it is recorded.
  const deps=(now=at(0))=>({db,client:p.client,live:false,now,publicBaseUrl:'https://nomi.example',alert:async(b:BusinessId)=>{alerts.push({businessId:b,kind:'payment_paid_over',conversationId:null});}});
  const form=(url:string,body:Record<string,string>={},cookie=owner)=>app.inject({method:'POST',url,headers:{cookie,'content-type':'application/x-www-form-urlencoded'},payload:new URLSearchParams(body).toString()});
  const get=(url:string,cookie=owner)=>app.inject({method:'GET',url,headers:{cookie}});
  const q=async<T>(text:string,values:unknown[]=[])=>(await admin.query(text,values)).rows as T[];
  const deliver=async(type:string,object:Record<string,unknown>)=>{
    const id=`evt_${randomUUID().replaceAll('-','')}`;
    const raw=JSON.stringify({id,type,account:ACCOUNT,livemode:false,created:Math.floor(Date.now()/1000),data:{object}});
    const t=Math.floor(Date.now()/1000),sig=`t=${t},v1=${createHmac('sha256',CONNECT_CONFIG.webhookSecret).update(`${t}.${raw}`).digest('hex')}`;
    const r=await app.inject({method:'POST',url:'/hooks/stripe/connect',headers:{'content-type':'application/json','stripe-signature':sig},payload:raw});
    expect(r.statusCode).toBe(200);
    return id;
  };
  const reconcile=async(times=3)=>{for(let n=0;n<times;n++)await reconcileStripePayments(deps(),bid);};
  const invoice=async()=>withTenantTx(db,bid,async tx=>{
    const i=await draftInvoice(tx,bid,'owner',{partyId:party,issueDate:'2026-10-10',dueDate:null,currency:'GBP',label:null,lines:[{label:'Goods',quantity:decimal('1'),unitPrice:decimal('100'),accountId:ids['4000']!,taxCodeId:null}]});
    if(i.kind!=='drafted')throw new Error(i.reason);expect((await issueInvoice(tx,bid,i.id,'owner')).kind).toBe('issued');return i.id;
  });
  const attempts=async(inv:string)=>q<{id:string;state:string;closed_for:string|null;paid_over:string|null}>('select id::text,state,closed_for::text,paid_over from stripe_checkout_attempts where invoice_id=$1 order by created_at',[inv]);
  const state=async(a:string)=>(await q<{state:string}>('select state from stripe_checkout_attempts where id=$1',[a]))[0]!.state;
  const payments=async(inv:string)=>q<{amount:string;kind:string}>('select amount::text,kind from invoice_payments where invoice_id=$1 order by created_at',[inv]);
  const owed=async(inv:string)=>(await q<{owed:string}>('select (invoice_total(id)-invoice_credited(id)-invoice_paid(id))::text as owed from invoices where id=$1',[inv]))[0]!.owed;
  const expiries=()=>p.calls.filter(c=>c==='expire').length;
  const succeeded=(id:string,attemptId:string):IntentFact=>({id,attemptId,succeeded:true,charge:{id:`ch_${id.slice(3)}`,amount:decimal('100'),currency:'GBP',created:sec,paid:true,captured:true,
    balance:{id:`txn_${id.slice(3)}`,gross:decimal('100'),fee:decimal('3'),net:decimal('97'),currency:'GBP',created:sec}}});
  const make=async(inv:string)=>{
    expect((await form(`${BASE}/invoices/${inv}/create`)).statusCode).toBe(302);
    return (await q<{id:string}>("select id::text from stripe_checkout_attempts where invoice_id=$1 and state='open'",[inv]))[0]!.id;
  };
  /** A delayed payment that Stripe then reports failed, and the new link the owner made after it — the observation's start. */
  const failedThenNew=async()=>{
    const inv=await invoice();
    const a=await make(inv);
    const s=p.sessions.get(a)!,pi=`pi_${a.replaceAll('-','')}`;
    p.sessions.set(a,{...s,status:'complete',paid:false,intentId:pi,url:null});
    p.intents.set(pi,{id:pi,attemptId:a,succeeded:false,charge:null});
    await deliver('checkout.session.completed',{id:s.id,payment_intent:pi});
    await deliver('checkout.session.async_payment_failed',{id:s.id,payment_intent:pi});
    await reconcile();
    expect(await state(a)).toBe('failed');
    const b=await make(inv);
    expect(b).not.toBe(a);
    return {inv,a,pi,b};
  };
  /** The OLD intent succeeds after all, through the signed webhook. */
  const oldSucceeds=async(f:{a:string;pi:string})=>{
    p.intents.set(f.pi,succeeded(f.pi,f.a));
    return deliver('payment_intent.succeeded',{id:f.pi});
  };
  /** The customer pays the NEW link. */
  const newPaid=async(b:string)=>{
    const s=p.sessions.get(b)!,pi=`pi_${b.replaceAll('-','')}`;
    p.sessions.set(b,{...s,status:'complete',paid:true,intentId:pi,url:null});
    p.intents.set(pi,succeeded(pi,b));
    return deliver('checkout.session.completed',{id:s.id,payment_intent:pi});
  };
  const invoicePage=async(inv:string)=>{const r=await get(`/app/books/invoices/${inv}`);expect(r.statusCode).toBe(200);return r.body;};
  const STILL_OPEN='Another payment link for this invoice is still open',TWICE='A payment link brought in more than this invoice still owed';

  beforeAll(async()=>{
    admin=new pg.Client({connectionString:process.env['MIGRATE_DATABASE_URL']});await admin.connect();db=createDb(process.env['DATABASE_URL']!);
    await admin.query("insert into businesses(id,name,engine,country,currency,books_area,timezone) values($1,'Sibling links fixture','service','GB','GBP',true,'UTC')",[bid]);
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

  it('THE OBSERVATION: the old attempt succeeds after the failure — posted once, and the new link is expired through the provider and recorded', async()=>{
    const f=await failedThenNew();
    const before=expiries();alerts.length=0;
    await oldSucceeds(f);await reconcile();
    expect(await state(f.a)).toBe('paid');
    expect(await state(f.b)).toBe('expired');                                  // before the fix: 'open', payable a second time
    expect(expiries()).toBe(before+1);                                         // the provider's own expiry, once
    expect(p.sessions.get(f.b)!.status).toBe('expired');
    expect(await payments(f.inv)).toEqual([{amount:'100.00',kind:'in'}]);
    expect(await owed(f.inv)).toBe('0.00');
    expect((await attempts(f.inv)).find(r=>r.id===f.b)!.closed_for).toBe(f.a);  // recorded: closed because the old link paid
    expect(alerts).toEqual([]);
    const page=await invoicePage(f.inv);
    expect(page).not.toContain(STILL_OPEN);expect(page).not.toContain(TWICE);
    expect((await get(BASE)).body).toContain('Expired by Nomi because the invoice was paid through another link.');
  });

  it('THE PROVIDER REFUSES the expiry: the link stays open and the invoice says so; posted once', async()=>{
    const f=await failedThenNew();
    alerts.length=0;p.refuseNextExpire();
    await oldSucceeds(f);await reconcile();
    expect(await state(f.a)).toBe('paid');
    expect(await state(f.b)).toBe('open');
    expect(await payments(f.inv)).toEqual([{amount:'100.00',kind:'in'}]);
    expect(await invoicePage(f.inv)).toContain(STILL_OPEN);                    // never silently left
    expect((await attempts(f.inv)).find(r=>r.id===f.b)!.closed_for).toBeNull();
    // The owner expires it by hand; the invoice stops saying so.
    expect((await form(`${BASE}/attempts/${f.b}/expire`)).statusCode).toBe(302);
    expect(await state(f.b)).toBe('expired');
    expect(await invoicePage(f.inv)).not.toContain(STILL_OPEN);
    expect(alerts).toEqual([]);
  });

  it('ALREADY PROCESSING: a link with a payment pending is not expired, and the invoice says another link is still open', async()=>{
    const f=await failedThenNew();
    alerts.length=0;
    const s=p.sessions.get(f.b)!,pi2=`pi_${f.b.replaceAll('-','')}`;
    p.sessions.set(f.b,{...s,status:'complete',paid:false,intentId:pi2,url:null});
    p.intents.set(pi2,{id:pi2,attemptId:f.b,succeeded:false,charge:null});
    await deliver('checkout.session.completed',{id:s.id,payment_intent:pi2});
    await reconcile();
    expect(await state(f.b)).toBe('processing');
    const before=expiries();
    await oldSucceeds(f);await reconcile();
    expect(await state(f.a)).toBe('paid');
    expect(await state(f.b)).toBe('processing');
    expect(expiries()).toBe(before);                                           // a complete session is never asked to expire
    expect(await invoicePage(f.inv)).toContain(STILL_OPEN);
  });

  it('BOTH PAID: both payments posted, the invoice shows it was paid more than it owed, the owner is told once by e-mail, nothing refunded', async()=>{
    const f=await failedThenNew();
    alerts.length=0;
    const paidNew=await newPaid(f.b);await reconcile();
    expect(await state(f.b)).toBe('paid');
    expect(await payments(f.inv)).toEqual([{amount:'100.00',kind:'in'}]);
    expect(alerts).toEqual([]);
    const paidOld=await oldSucceeds(f);await reconcile();
    expect(await state(f.a)).toBe('paid');                                     // before the fix: an exception, 'too_much'
    expect(await payments(f.inv)).toEqual([{amount:'100.00',kind:'in'},{amount:'100.00',kind:'in'}]);
    expect(await owed(f.inv)).toBe('-100.00');                                 // owed back to the customer, not refunded
    expect((await q<{state:string}>('select state from stripe_event_inbox where event_id=any($1)',[[paidNew,paidOld]])).map(r=>r.state)).toEqual(['done','done']);
    expect(alerts).toEqual([{businessId:bid,kind:'payment_paid_over',conversationId:null}]);
    expect((await attempts(f.inv)).find(r=>r.id===f.a)!.paid_over).toBe('told');
    // Told once: the same event again, another event, and more reconciles change nothing.
    await oldSucceeds(f);await reconcile();
    expect(alerts).toHaveLength(1);
    expect(await payments(f.inv)).toHaveLength(2);
    // Nothing refunded or reversed: no refund asked of the provider, no refund recorded anywhere.
    expect(p.calls.some(c=>c.includes('refund'))).toBe(false);
    expect(await q("select 1 from invoice_payments where invoice_id=$1 and kind<>'in'",[f.inv])).toEqual([]);
    expect(await q("select 1 from stripe_movements m join stripe_checkout_attempts a on a.id=m.attempt_id where a.invoice_id=$1 and m.kind not in ('payment','fee')",[f.inv])).toEqual([]);
    const page=await invoicePage(f.inv);
    expect(page).toContain(TWICE);expect(page).toContain('Nothing has been refunded.');
    expect(page.match(/id="paid-over"[\s\S]*?<\/ul>/)![0].match(/<li /g)).toHaveLength(2);
    // The alert's path: e-mail always.
    expect(goesByMail('payment_paid_over')).toBe(true);
    const person=(await q<{id:string}>('select id::text from people where business_id=$1 and is_owner and archived_at is null',[bid]))[0]?.id
      ??(await q<{id:string}>("insert into people(business_id,name,is_owner) values($1,'Owner',true) returning id::text",[bid]))[0]!.id;
    await admin.query("insert into logins(business_id,person_id,email,password_hash) values($1,$2,'owner@example.test','scrypt$never-used')",[bid,person]);
    const mails:{to:string;subject:string;text:string}[]=[];
    const out=await deliverOwnerAlert({db,adapter:{sendText:async()=>{throw new Error('no WhatsApp here');}},mail:{send:async m=>{mails.push(m);return {ok:true};}},publicBaseUrl:'https://nomi.example'},alerts[0]!);
    expect(out).toBe('sent');
    expect(mails).toEqual([expect.objectContaining({to:'owner@example.test',subject:'A customer paid more than an invoice owed'})]);
    expect(mails[0]!.text).toContain('https://nomi.example/app/payments/stripe');
  });

  it('CONTROL — the plain success path is unchanged: paid once, nothing expired, nothing told', async()=>{
    const inv=await invoice();
    const b=await make(inv);
    const before=expiries();alerts.length=0;
    await newPaid(b);await reconcile();
    expect(await state(b)).toBe('paid');
    expect(await payments(inv)).toEqual([{amount:'100.00',kind:'in'}]);
    expect(await owed(inv)).toBe('0.00');
    expect(expiries()).toBe(before);
    expect(await q('select id::text,state from stripe_checkout_attempts where invoice_id=$1',[inv])).toEqual([{id:b,state:'paid'}]);
    expect(alerts).toEqual([]);
    const page=await invoicePage(inv);
    expect(page).not.toContain(STILL_OPEN);expect(page).not.toContain(TWICE);
  });
});
