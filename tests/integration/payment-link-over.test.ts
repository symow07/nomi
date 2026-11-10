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
import {draftCreditNote,issueCreditNote} from '../../src/db/booksCreditNotes.js';
import {decimal} from '../../src/core/types/decimal.js';
import {reconcileStripePayments} from '../../src/payments/invoicePayments.js';
import {deliverOwnerAlert} from '../../src/pipeline/notify.js';
import type {NotifyJob} from '../../src/queue/boss.js';
import type {IntentFact} from '../../src/core/payments/paymentLink.js';

/**
 * 5.1 — money that arrived through a payment link is always recorded, and the database's exception is exact (t1r's
 * ruling, 2026-11-10). One rule for a link that brings in more than its invoice still owes — the owner recorded part by
 * hand, a credit note, another link paid: recorded whole, the excess owed back, the invoice says so and lists every
 * payment, the owner told once, nothing refunded. Before it, a link paid after a payment by hand stayed `processing`
 * (too_much) and never reached the books, the invoice or the owner. And NB019's exception named no attempt: any Stripe
 * 'in' over what was owed passed once any link of the invoice was paid. Now a payment over what is owed must be the paid
 * payment of a link attempt of THIS invoice, for exactly its amount, once.
 *
 * Every payment event arrives through the signed connected-account webhook; the provider is a fake.
 */
const d=process.env['DATABASE_URL']&&process.env['MIGRATE_DATABASE_URL']?describe:describe.skip;
const bid=randomUUID() as BusinessId;
const ACCOUNT=`acct_${bid.replaceAll('-','')}`;
const BILLING_SECRET='test-billing-webhook-secret-0000';
const noBillingCall=async()=>{throw new Error('Unexpected billing provider call');};
const billing={createCustomer:noBillingCall,setupCheckout:noBillingCall,setupIntentPaymentMethod:noBillingCall,setDefaultPaymentMethod:noBillingCall,createSubscription:noBillingCall,price:noBillingCall,portal:noBillingCall};
const BASE='/app/payments/stripe',SECRET='test-owner-session-secret-000000000000';
const sec=Math.floor(Date.now()/1000);
const MAIL=`owner-${bid.slice(0,8)}@example.test`;
const OVER='A payment link brought in more than this invoice still owed';

d('payment links · money that arrived through a link is always recorded; the database exception is exact',{timeout:120_000},()=>{
  let db:Db,admin:pg.Client,app:ReturnType<typeof Fastify>,owner='',ids:Record<string,string>,party='';
  const p=paymentProvider({id:ACCOUNT,country:'GB',currency:'GBP',ready:true});
  const alerts:NotifyJob[]=[];
  // The worker's alert (src/main.ts) queues exactly this job; here it is recorded.
  const deps=()=>({db,client:p.client,live:false,now:()=>new Date(),publicBaseUrl:'https://nomi.example',alert:async(b:BusinessId)=>{alerts.push({businessId:b,kind:'payment_paid_over',conversationId:null});}});
  const form=(url:string,body:Record<string,string>={},cookie=owner)=>app.inject({method:'POST',url,headers:{cookie,'content-type':'application/x-www-form-urlencoded'},payload:new URLSearchParams(body).toString()});
  const get=(url:string,cookie=owner)=>app.inject({method:'GET',url,headers:{cookie}});
  const q=async<T>(text:string,values:unknown[]=[])=>(await admin.query(text,values)).rows as T[];
  /** A signed connected-account event; `id` given, the same event delivered again. */
  const deliver=async(type:string,object:Record<string,unknown>,id=`evt_${randomUUID().replaceAll('-','')}`)=>{
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
  const state=async(a:string)=>(await q<{state:string;reason:string|null}>('select state,reason from stripe_checkout_attempts where id=$1',[a]))[0]!;
  const payments=async(inv:string)=>q<{amount:string;kind:string;by:string;attempt:string|null}>("select amount::text,kind,case when created_by='stripe' then 'stripe' else 'hand' end as by,stripe_attempt_id::text as attempt from invoice_payments where invoice_id=$1 order by created_at",[inv]);
  const owed=async(inv:string)=>(await q<{owed:string}>('select (invoice_total(id)-invoice_credited(id)-invoice_paid(id))::text as owed from invoices where id=$1',[inv]))[0]!.owed;
  const succeeded=(id:string,attemptId:string):IntentFact=>({id,attemptId,succeeded:true,charge:{id:`ch_${id.slice(3)}`,amount:decimal('100'),currency:'GBP',created:sec,paid:true,captured:true,
    balance:{id:`txn_${id.slice(3)}`,gross:decimal('100'),fee:decimal('3'),net:decimal('97'),currency:'GBP',created:sec}}});
  const make=async(inv:string)=>{
    expect((await form(`${BASE}/invoices/${inv}/create`)).statusCode).toBe(302);
    return (await q<{id:string}>("select id::text from stripe_checkout_attempts where invoice_id=$1 and state='open'",[inv]))[0]!.id;
  };
  /** The customer pays the link: Checkout completes and its intent succeeds. Returns the event, to deliver it again. */
  const linkPaid=async(a:string)=>{
    const s=p.sessions.get(a)!,pi=`pi_${a.replaceAll('-','')}`;
    p.sessions.set(a,{...s,status:'complete',paid:true,intentId:pi,url:null});
    p.intents.set(pi,succeeded(pi,a));
    const object={id:s.id,payment_intent:pi};
    return {object,event:await deliver('checkout.session.completed',object)};
  };
  /** The owner records a payment by hand on the invoice's own form (the bank journal, the bank account). */
  const byHand=async(inv:string,amount:string)=>{
    const r=await form(`/app/books/invoices/${inv}/payments`,{amount,paidOn:'2026-10-11',journal:ids['BK']!,account:ids['1000']!});
    expect(r.statusCode).toBe(302);expect(String(r.headers.location)).not.toContain('#pay');
  };
  const invoicePage=async(inv:string)=>{const r=await get(`/app/books/invoices/${inv}`);expect(r.statusCode).toBe(200);return r.body;};
  const overBlock=(page:string)=>page.match(/id="paid-over"[\s\S]*?<\/ul>/)?.[0]??'';

  beforeAll(async()=>{
    admin=new pg.Client({connectionString:process.env['MIGRATE_DATABASE_URL']});await admin.connect();db=createDb(process.env['DATABASE_URL']!);
    await admin.query("insert into businesses(id,name,engine,country,currency,books_area,timezone) values($1,'Paid over fixture','service','GB','GBP',true,'UTC')",[bid]);
    app=Fastify({logger:false});registerWebApp(app,{db,businessId:bid,accessCode:'test-owner-access',sessionSecret:SECRET,employeeName:'Lily',provider:'disabled',messagingEnabled:true,secureCookie:false,factsTtlMs:0,kickOutbound:async()=>{},kickDrive:async()=>{},publicBaseUrl:'https://nomi.example',stripeConnect:{config:CONNECT_CONFIG,client:p.client},stripe:{client:billing,webhookSecret:BILLING_SECRET}} as unknown as Parameters<typeof registerWebApp>[1]);await app.ready();
    owner=String((await form('/login',{code:'test-owner-access'},'')).headers['set-cookie']).split(';')[0]!;
    await withTenantTx(db,bid,async tx=>{
      await loadCountryPack(tx,bid,COUNTRY_PACKS.GB,'2026-01-01');
      await sql`insert into fiscal_years(business_id,starts_on,ends_on) values(${bid}::uuid,'2026-01-01','2026-12-31')`.execute(tx);
      ids=Object.fromEntries((await sql<{id:string;code:string}>`select id::text,code from accounts union all select id::text,code from journals`.execute(tx)).rows.map(r=>[r.code,r.id]));
      party=(await sql<{id:string}>`insert into parties(business_id,code,name,kind) values(${bid}::uuid,'C1','Fixture buyer','customer') returning id::text`.execute(tx)).rows[0]!.id;
    });
    const st=new URL(String((await form(`${BASE}/connect`)).headers.location)).searchParams.get('state')!;
    expect((await get(`${BASE}/return?state=${st}&code=one-use`)).statusCode).toBe(302);
    expect((await form(`${BASE}/accounts`,{clearingId:ids['1030']!,transitId:ids['1040']!,feeId:ids['5020']!,journalId:ids['GJ']!,bankId:ids['1000']!})).statusCode).toBe(302);
  });
  afterAll(async()=>{await app?.close();await db?.destroy();await admin?.end();});

  it('40 BY HAND, THEN THE LINK\'S 100: recorded whole — books 140, 40 owed back, the invoice says so and lists both; told once across redelivery; nothing refunded', async()=>{
    const inv=await invoice();
    const a=await make(inv);
    await byHand(inv,'40');
    expect(await owed(inv)).toBe('60.00');
    alerts.length=0;
    const paid=await linkPaid(a);await reconcile();
    expect(await state(a)).toEqual({state:'paid',reason:null});                   // before the fix: 'processing', too_much
    expect(await payments(inv)).toEqual([{amount:'40.00',kind:'in',by:'hand',attempt:null},{amount:'100.00',kind:'in',by:'stripe',attempt:a}]);
    expect(await owed(inv)).toBe('-40.00');                                       // refund due: 40 owed back, not refunded
    // The books: 140 received against the invoice — 40 in the bank, 100 in Stripe clearing — and the fee on its own.
    const bal=async(code:string)=>(await q<{n:string}>('select coalesce(sum(coalesce(l.debit,0)-coalesce(l.credit,0)),0)::text as n from journal_lines l join journal_entries e on e.id=l.entry_id where e.business_id=$1 and e.state=$2 and l.account_id=$3',[bid,'posted',ids[code]]))[0]!.n;
    expect([await bal('1000'),await bal('1030')]).toEqual(['40.00','97.00']);
    expect((await q<{state:string}>('select state from stripe_event_inbox where event_id=$1',[paid.event]))[0]!.state).toBe('done');
    expect((await q<{reason:string|null;entry:string|null}>("select reason,entry_id::text as entry from stripe_movements where attempt_id=$1 and kind='payment'",[a]))[0]).toEqual({reason:null,entry:expect.any(String)});
    expect(alerts).toEqual([{businessId:bid,kind:'payment_paid_over',conversationId:null}]);
    expect((await q<{paid_over:string}>('select paid_over from stripe_checkout_attempts where id=$1',[a]))[0]!.paid_over).toBe('told');
    // Told once: the same event delivered again (one inbox row), another event, more reconciles — nothing more.
    await deliver('checkout.session.completed',paid.object,paid.event);
    await deliver('payment_intent.succeeded',{id:paid.object.payment_intent});
    await reconcile();
    expect(alerts).toHaveLength(1);
    expect(await q('select 1 from stripe_event_inbox where event_id=$1',[paid.event])).toHaveLength(1);
    expect(await payments(inv)).toHaveLength(2);
    expect(p.calls.some(c=>c.includes('refund'))).toBe(false);
    expect(await q("select 1 from invoice_payments where invoice_id=$1 and kind<>'in'",[inv])).toEqual([]);
    // The invoice says so, what is owed back, and every payment and how it came.
    const page=await invoicePage(inv),block=overBlock(page);
    expect(page).toContain(OVER);expect(page).toContain('Nothing has been refunded.');
    expect(block).toContain('Owed back to the customer:');expect(block).toContain('40.00');
    expect(block.match(/<li /g)).toHaveLength(2);
    expect(block).toContain('Recorded by hand');expect(block).toContain('Through a payment link');
    expect((await get(BASE)).body).toContain('Paid more than the invoice still owed.');
    // The letter: e-mail, opening Payment links in its own words.
    const person=(await q<{id:string}>('select id::text from people where business_id=$1 and is_owner and archived_at is null',[bid]))[0]?.id
      ??(await q<{id:string}>("insert into people(business_id,name,is_owner) values($1,'Owner',true) returning id::text",[bid]))[0]!.id;
    await admin.query("insert into logins(business_id,person_id,email,password_hash) values($1,$2,$3,'scrypt$never-used')",[bid,person,MAIL]);
    const mails:{to:string;subject:string;text:string}[]=[];
    expect(await deliverOwnerAlert({db,adapter:{sendText:async()=>{throw new Error('no WhatsApp here');}},mail:{send:async m=>{mails.push(m);return {ok:true};}},publicBaseUrl:'https://nomi.example'},alerts[0]!)).toBe('sent');
    expect(mails).toEqual([expect.objectContaining({to:MAIL,subject:'A customer paid more than an invoice owed'})]);
    expect(mails[0]!.text).toContain('Open Payment links: https://nomi.example/app/payments/stripe');
    expect(mails[0]!.text).not.toContain('Open the conversation');
  });

  it('A CREDIT NOTE, THEN THE LINK: the same one path — recorded whole, owed back, told once', async()=>{
    const inv=await invoice();
    const a=await make(inv);
    await withTenantTx(db,bid,async tx=>{
      const c=await draftCreditNote(tx,bid,'owner',{invoiceId:inv,issueDate:'2026-10-11',reason:'Returned',lines:[{invoiceLineNo:1,quantity:decimal('1')}]});
      if(c.kind!=='drafted')throw new Error(JSON.stringify(c));
      expect((await issueCreditNote(tx,bid,c.id,'owner')).kind).toBe('issued');
    });
    expect(await owed(inv)).toBe('0.00');
    alerts.length=0;
    await linkPaid(a);await reconcile();
    expect((await state(a)).state).toBe('paid');
    expect(await payments(inv)).toEqual([{amount:'100.00',kind:'in',by:'stripe',attempt:a}]);
    expect(await owed(inv)).toBe('-100.00');
    expect(alerts).toHaveLength(1);
    expect(overBlock(await invoicePage(inv)).match(/<li /g)).toHaveLength(1);
  });

  it('CONTROL — the plain success path is unchanged, and its payment names its attempt; nothing said, nobody told', async()=>{
    const inv=await invoice();
    const a=await make(inv);alerts.length=0;
    await linkPaid(a);await reconcile();
    expect(await state(a)).toEqual({state:'paid',reason:null});
    expect(await payments(inv)).toEqual([{amount:'100.00',kind:'in',by:'stripe',attempt:a}]);
    expect(await owed(inv)).toBe('0.00');
    expect(alerts).toEqual([]);
    const page=await invoicePage(inv);
    expect(page).not.toContain(OVER);expect(page).not.toContain('id="paid-over"');
  });

  describe('NB019, as the database itself (admin, each inside a rolled-back transaction)',()=>{
    let inv='',a='',other='',payment='';
    /** One statement sequence in its own transaction, always rolled back: 'accepted', or the refusal's code. */
    const tryAs=async(steps:(c:pg.Client)=>Promise<void>):Promise<string>=>{
      await admin.query('begin');
      try{await steps(admin);return 'accepted';}
      catch(e){return (e as {code?:string}).code??'error';}
      finally{await admin.query('rollback');}
    };
    /** A copy of the link's real payment row, with the fields under test changed. */
    const copy=(c:pg.Client,o:{amount:string;by?:string;attempt?:string|null;invoice?:string})=>c.query(
      `insert into invoice_payments(business_id,invoice_id,paid_on,currency,amount,receivable_book,account_id,entry_id,created_by,kind${o.attempt===undefined?'':',stripe_attempt_id'})
       select business_id,coalesce($2::uuid,invoice_id),paid_on,currency,$3::numeric,receivable_book,account_id,entry_id,$4,'in'${o.attempt===undefined?'':',$5::uuid'}
         from invoice_payments where id=$1`,
      o.attempt===undefined?[payment,o.invoice??null,o.amount,o.by??'stripe']:[payment,o.invoice??null,o.amount,o.by??'stripe',o.attempt]);
    /** Another attempt of the same invoice, in the state given, never posted. */
    const anotherAttempt=async(c:pg.Client,st:'open'|'paid',amount='100')=>(await c.query<{id:string}>(
      `insert into stripe_checkout_attempts(business_id,connection_id,mapping_id,invoice_id,amount,currency,state,expires_at)
       select business_id,connection_id,mapping_id,invoice_id,$2::numeric,currency,$3,expires_at from stripe_checkout_attempts where id=$1 returning id::text`,[a,amount,st])).rows[0]!.id;

    beforeAll(async()=>{
      inv=await invoice();a=await make(inv);await linkPaid(a);
      const inv2=await invoice();other=await make(inv2);await linkPaid(other);
      await reconcile();
      expect([(await state(a)).state,(await state(other)).state]).toEqual(['paid','paid']);
      expect(await owed(inv)).toBe('0.00');
      payment=(await q<{id:string}>('select id::text from invoice_payments where invoice_id=$1',[inv]))[0]!.id;
    });

    it('a Stripe payment over what is owed that names no attempt is refused, though a link of the invoice is paid', async()=>{
      // Before the fix: accepted — the exception was "any attempt of the invoice is paid", the only one being this one's.
      expect(await tryAs(c=>copy(c,{amount:'150'}).then(()=>undefined))).toBe('NB019');
      expect(await tryAs(c=>copy(c,{amount:'100',attempt:null}).then(()=>undefined))).toBe('NB019');
    });
    it('naming another invoice\'s paid attempt is refused', async()=>{
      expect(await tryAs(c=>copy(c,{amount:'100',attempt:other}).then(()=>undefined))).toBe('NB019');
    });
    it('naming an attempt not paid is refused', async()=>{
      expect(await tryAs(async c=>{const open=await anotherAttempt(c,'open');await copy(c,{amount:'100',attempt:open});})).toBe('NB019');
    });
    it('naming a paid attempt for another amount is refused; for exactly its amount it is accepted, even over what is owed', async()=>{
      expect(await tryAs(async c=>{const paid=await anotherAttempt(c,'paid');await copy(c,{amount:'150',attempt:paid});})).toBe('NB019');
      expect(await tryAs(async c=>{const paid=await anotherAttempt(c,'paid');await copy(c,{amount:'90',attempt:paid});})).toBe('NB019');
      expect(await tryAs(async c=>{const paid=await anotherAttempt(c,'paid');await copy(c,{amount:'100',attempt:paid});})).toBe('accepted');
    });
    it('only Stripe names an attempt', async()=>{
      expect(await tryAs(async c=>{const paid=await anotherAttempt(c,'paid');await copy(c,{amount:'100',attempt:paid,by:'owner'});})).toBe('NB019');
    });
    it('the same attempt posted twice is refused — the one already posted, and a fresh one named a second time', async()=>{
      expect(await tryAs(c=>copy(c,{amount:'100',attempt:a}).then(()=>undefined))).toBe('NB019');
      expect(await tryAs(async c=>{const paid=await anotherAttempt(c,'paid');await copy(c,{amount:'100',attempt:paid});await copy(c,{amount:'100',attempt:paid});})).toBe('NB019');
    });
    it('the owner\'s payment over what is owed is refused, as before', async()=>{
      expect(await tryAs(c=>copy(c,{amount:'1',by:'owner'}).then(()=>undefined))).toBe('NB019');
    });
    it('the pointer clears only when its attempt is gone (a closing workspace keeps its books); otherwise a payment never changes', async()=>{
      expect(await tryAs(c=>c.query('update invoice_payments set stripe_attempt_id=null where id=$1',[payment]).then(()=>undefined))).toBe('NB019');
      expect(await tryAs(async c=>{
        await c.query('delete from stripe_movements where attempt_id=$1',[a]);
        await c.query('delete from stripe_link_sends where attempt_id=$1',[a]);
        await c.query('update stripe_checkout_attempts set closed_for=null where closed_for=$1',[a]);
        await c.query('delete from stripe_checkout_attempts where id=$1',[a]);
        const row=(await c.query<{attempt:string|null;amount:string}>('select stripe_attempt_id::text as attempt,amount::text from invoice_payments where id=$1',[payment])).rows[0]!;
        expect(row).toEqual({attempt:null,amount:'100.00'});
      })).toBe('accepted');
    });
  });
});
