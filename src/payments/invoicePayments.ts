import { sql } from 'kysely';
import { withTenantTx, type Db } from '../db/client.js';
import { paymentAttempt, reservePayment, keepCheckout, stripeBinding, type PaymentAttempt } from '../db/stripePayments.js';
import { postCapturedPayment, postStripeRefund, recordStripePayout, settleUnpaidPayment, type StripePosting } from '../db/stripePosting.js';
import type { ConnectClient } from './stripeConnect.js';
import type { BusinessId } from '../core/types/ids.js';

export type PaymentDeps = { readonly db:Db; readonly client:ConnectClient; readonly live:boolean; readonly now:()=>Date; readonly publicBaseUrl:string|null|undefined;
  /** The owner's alert that an invoice was paid twice (`payment_paid_twice`, e-mail always). Absent, it waits for the worker that has it. */
  readonly alert?:((bid:BusinessId)=>Promise<void>)|undefined };
type LinkResult={readonly ok:true;readonly value:PaymentAttempt}|{readonly ok:false;readonly reason:string};
/** No provider call before the workspace, country and Practice checks. */
async function eligible(deps:PaymentDeps,bid:BusinessId) {
  return withTenantTx(deps.db,bid,async tx=>{
    const b=(await sql<{country:string;practice:boolean}>`select country,practice_of is not null as practice from businesses where id=${bid}::uuid`.execute(tx)).rows[0];
    if(!b||b.practice||!['GB','US'].includes(b.country))return null;
    return stripeBinding(tx,bid,deps.live);
  });
}
export async function createPaymentLink(deps:PaymentDeps,bid:BusinessId,invoiceId:string):Promise<LinkResult> {
  const c=await eligible(deps,bid);if(!c)return {ok:false,reason:'unavailable'};
  if(!deps.publicBaseUrl)return {ok:false,reason:'no_address'};
  let base:URL;try{base=new URL(deps.publicBaseUrl);if(!['https:','http:'].includes(base.protocol))throw new Error('address');}catch{return {ok:false,reason:'no_address'};}
  const account=await deps.client.account(c.account);
  if(!account.ok)return {ok:false,reason:account.reason};
  if(!account.value.ready||account.value.country!==c.country||account.value.currency!==c.currency)return {ok:false,reason:'not_ready'};
  const reserved=await withTenantTx(deps.db,bid,tx=>reservePayment(tx,bid,invoiceId,deps.live,deps.now()));
  if(!reserved.ok)return reserved;const a=reserved.value;
  const session=a.sessionId?await deps.client.checkout(c.account,a.sessionId):await deps.client.createCheckout(c.account,{
    attemptId:a.id,amount:a.amount,currency:a.currency,expiresAt:Math.floor(a.expiresAt.getTime()/1000),
    successUrl:new URL('/payment/return',base).href,cancelUrl:new URL('/payment/return',base).href,
  });
  if(!session.ok)return {ok:false,reason:session.reason};
  const kept=await withTenantTx(deps.db,bid,tx=>keepCheckout(tx,bid,a.id,session.value));
  if(!kept)return {ok:false,reason:'payment_differs'};
  if(session.value.status!=='open')return {ok:false,reason:session.value.status==='expired'?'expired':'processing'};
  return {ok:true,value:(await withTenantTx(deps.db,bid,tx=>paymentAttempt(tx,bid,a.id)))!};
}
export async function expirePaymentLink(deps:PaymentDeps,bid:BusinessId,id:string):Promise<{ok:true}|{ok:false;reason:string}> {
  const c=await eligible(deps,bid),a=await withTenantTx(deps.db,bid,tx=>paymentAttempt(tx,bid,id));
  if(!c||!a||c.id!==a.connectionId)return {ok:false,reason:'unavailable'};
  let s;
  if(!a.sessionId){
    const now=deps.now();
    const found=await deps.client.findCheckout(c.account,a.id,Math.floor(a.createdAt.getTime()/1000)-300,Math.ceil(now.getTime()/1000));
    if(!found.ok)return {ok:false,reason:found.reason};
    if(!found.value){
      // Requests carry the reservation's fixed expires_at. After the maximum session
      // lifetime plus clock margin, a complete scan can safely retire an uncreated link.
      if(now.getTime()<a.createdAt.getTime()+24*3600000+300000)return {ok:false,reason:'recovery_wait'};
      const retired=await withTenantTx(deps.db,bid,async tx=>{
        await sql`select id from stripe_connections where business_id=${bid}::uuid and id=${c.id}::uuid for update`.execute(tx);
        const current=await paymentAttempt(tx,bid,a.id);
        if(current?.state==='expired')return true;
        if(!current||current.sessionId||current.state!=='creating')return false;
        await sql`update stripe_checkout_attempts set state='expired',reason=null where business_id=${bid}::uuid and id=${a.id}::uuid`.execute(tx);return true;
      });
      return retired?{ok:true}:{ok:false,reason:'processing'};
    }
    s=found;
  }else s=await deps.client.checkout(c.account,a.sessionId);
  if(!s.ok)return {ok:false,reason:s.reason};
  if(!s.value)return {ok:false,reason:'unavailable'};
  if(s.value.status==='open')s=await deps.client.expireCheckout(c.account,s.value.id);
  if(!s.ok)return {ok:false,reason:s.reason};
  if(!s.value||!await withTenantTx(deps.db,bid,tx=>keepCheckout(tx,bid,a.id,s.value!)))return {ok:false,reason:'payment_differs'};
  return s.value.status==='expired'?{ok:true}:{ok:false,reason:'processing'};
}

/** Local authority ends before the external request. A failed revoke remains durable work. */
export async function disconnectStripe(deps:PaymentDeps,bid:BusinessId):Promise<{ok:true}|{ok:false;reason:string}> {
  const pending=await withTenantTx(deps.db,bid,async tx=>{
    await sql`select id from businesses where id=${bid}::uuid for update`.execute(tx);
    const c=(await sql<{id:string;account:string}>`select id::text,account from stripe_connections where business_id=${bid}::uuid and live=${deps.live} and (active or deauthorization_state='pending') order by active desc for update`.execute(tx)).rows[0];
    if(!c)return {ok:true as const,value:null};
    if((await sql`select 1 from stripe_checkout_attempts where business_id=${bid}::uuid and connection_id=${c.id}::uuid and (state in ('creating','open','processing') or reason is not null) limit 1`.execute(tx)).rows.length)return {ok:false as const,reason:'expire_first'};
    await sql`update stripe_connections set active=false,ready=false,disconnected_at=coalesce(disconnected_at,${deps.now()}),deauthorization_state='pending' where business_id=${bid}::uuid and id=${c.id}::uuid`.execute(tx);
    return {ok:true as const,value:c};
  });
  if(!pending.ok)return pending;if(!pending.value)return {ok:true};
  const c=pending.value,result=await deps.client.deauthorize(c.account);
  await withTenantTx(deps.db,bid,tx=>sql`update stripe_connections set deauthorization_state=${result.ok?'done':'pending'},deauthorization_reason=${result.ok?null:result.reason}
    where business_id=${bid}::uuid and id=${c.id}::uuid and not active and deauthorization_state='pending'`.execute(tx));
  return result.ok?{ok:true}:{ok:false,reason:'deauthorization_pending'};
}

type Pending={connection:string;account:string;active:boolean;id:string;type:string;object:string;intent:string|null};
/** Process durable ids against CURRENT facts, outside database transactions for every provider request. */
export async function reconcileStripePayments(deps:PaymentDeps,bid:BusinessId):Promise<void> {
  const events=(await withTenantTx(deps.db,bid,tx=>sql<Pending>`select e.connection_id::text as connection,c.account,c.active,e.event_id as id,e.event_type as type,e.object_id as object,e.intent_id as intent
    from stripe_event_inbox e join stripe_connections c on c.id=e.connection_id where e.business_id=${bid}::uuid and c.live=${deps.live} and e.state='pending' order by e.processed_at nulls first,e.received_at,e.event_id limit 50`.execute(tx))).rows;
  for(const e of events){
    let out:StripePosting;
    if(e.type==='account.application.deauthorized'){
      await withTenantTx(deps.db,bid,tx=>sql`update stripe_connections set active=false,ready=false,disconnected_at=now() where business_id=${bid}::uuid and id=${e.connection}::uuid`.execute(tx));out={state:'posted'};
    }else if(!e.active){out={state:'exception',reason:'disconnected'};}
    else if(e.type==='account.updated'){
      const a=await deps.client.account(e.account);
      if(a.ok){await withTenantTx(deps.db,bid,tx=>sql`update stripe_connections set ready=${a.value.ready} and country=${a.value.country} and currency=${a.value.currency} where business_id=${bid}::uuid and id=${e.connection}::uuid`.execute(tx));out={state:'posted'};}
      else out={state:a.retryable?'pending':'exception',reason:a.reason};
    }else if(e.type.startsWith('payout.')){
      const p=await deps.client.payout(e.account,e.object);
      out=p.ok?await withTenantTx(deps.db,bid,tx=>recordStripePayout(tx,bid,e.connection,p.value)):{state:p.retryable?'pending':'exception',reason:p.reason};
      if(out.state==='pending'&&p.ok)out={state:'posted'}; // receipt of a payout is done; confirmation is an owner's separate act
    }else if(e.type.startsWith('refund.')){
      const r=await deps.client.refund(e.account,e.object);
      out=r.ok?await withTenantTx(deps.db,bid,tx=>postStripeRefund(tx,bid,e.connection,r.value)):{state:r.retryable?'pending':'exception',reason:r.reason};
      if(out.reason==='unknown_payment')out={state:'posted'}; // a refund of a sale outside Nomi is never allocated to an invoice
    }else if(e.type.startsWith('charge.dispute.')||e.type==='charge.refunded'){
      out={state:'exception',reason:e.type==='charge.refunded'?'refund_review':'dispute_review'};
    }else if(e.type.startsWith('checkout.session.')||e.type.startsWith('payment_intent.')||e.type.startsWith('charge.')){
      let intent=e.type.startsWith('payment_intent.')?e.object:e.intent;
      let attempt:string|null=null,failed=false;
      if(e.type.startsWith('checkout.session.')){
        const s=await deps.client.checkout(e.account,e.object);
        if(!s.ok){out={state:s.retryable?'pending':'exception',reason:s.reason};await mark(deps,bid,e,out);continue;}
        attempt=s.value.attemptId;intent=s.value.intentId;
        if(attempt)await withTenantTx(deps.db,bid,tx=>keepCheckout(tx,bid,attempt!,s.value));
        if(s.value.status==='expired'&&!intent){await mark(deps,bid,e,{state:'posted'});continue;}
        // Stripe's documented later outcome of a delayed payment (Checkout fulfillment), held to the current session.
        failed=e.type==='checkout.session.async_payment_failed'&&s.value.status==='complete'&&!s.value.paid;
      }
      if(!intent){out={state:'pending',reason:'payment_pending'};}
      else{
        const p=await deps.client.intent(e.account,intent);
        if(!p.ok)out={state:p.retryable?'pending':'exception',reason:p.reason};
        else{
          attempt=attempt??p.value.attemptId??(await withTenantTx(deps.db,bid,tx=>sql<{id:string}>`select id::text from stripe_checkout_attempts where business_id=${bid}::uuid and connection_id=${e.connection}::uuid and intent_id=${intent}`.execute(tx))).rows[0]?.id??null;
          const known=attempt?await withTenantTx(deps.db,bid,tx=>paymentAttempt(tx,bid,attempt!)):null;
          out=known?.connectionId===e.connection?await withTenantTx(deps.db,bid,tx=>p.value.succeeded?postCapturedPayment(tx,bid,known.id,p.value):settleUnpaidPayment(tx,bid,known.id,p.value,failed)):{state:'posted'};
          // The invoice is paid through this link: no other link of it may stay payable. Before the mark, so a fault
          // here leaves the event to be read again; a link that cannot be expired is shown on the invoice.
          if(known?.connectionId===e.connection&&p.value.succeeded&&(out.state==='posted'||out.state==='fee_pending'))await closeOtherLinks(deps,bid,known.id);
        }
      }
    }else out={state:'posted'};
    await mark(deps,bid,e,out);
  }
  await tellPaidTwice(deps,bid);
}

/**
 * When one attempt of an invoice is paid, every other link of that invoice still payable (making or open) is expired
 * through the one expiry path, and the expiry is recorded on it (`closed_for`). A link the provider will not expire, or
 * one already processing a payment, stays as it is and the invoice page says another link is still open
 * (`invoiceLinkState`). Nothing is refunded or reversed here.
 */
export async function closeOtherLinks(deps:PaymentDeps,bid:BusinessId,paidId:string):Promise<void>{
  const others=(await withTenantTx(deps.db,bid,tx=>sql<{id:string}>`select o.id::text from stripe_checkout_attempts a join stripe_checkout_attempts o
    on o.business_id=a.business_id and o.invoice_id=a.invoice_id and o.id<>a.id
    where a.business_id=${bid}::uuid and a.id=${paidId}::uuid and a.state='paid' and o.state in ('creating','open') order by o.created_at`.execute(tx))).rows;
  for(const o of others){
    const r=await expirePaymentLink(deps,bid,o.id);
    if(r.ok)await withTenantTx(deps.db,bid,tx=>sql`update stripe_checkout_attempts set closed_for=${paidId}::uuid
      where business_id=${bid}::uuid and id=${o.id}::uuid and state='expired' and closed_for is null`.execute(tx));
  }
}

/** The owner is told once of each attempt that paid an invoice a second time: claimed first, handed back if the alert could not be queued. */
async function tellPaidTwice(deps:PaymentDeps,bid:BusinessId):Promise<void>{
  if(!deps.alert)return;
  const claimed=(await withTenantTx(deps.db,bid,tx=>sql<{id:string}>`update stripe_checkout_attempts set paid_twice='told'
    where business_id=${bid}::uuid and paid_twice='untold' returning id::text`.execute(tx))).rows;
  for(let n=0;n<claimed.length;n++){
    try{await deps.alert(bid);}
    catch(err){
      const back=claimed.slice(n).map(c=>c.id);
      await withTenantTx(deps.db,bid,tx=>sql`update stripe_checkout_attempts set paid_twice='untold' where business_id=${bid}::uuid and id=any(${back}::uuid[])`.execute(tx));
      throw err;
    }
  }
}
async function mark(deps:PaymentDeps,bid:BusinessId,e:Pending,out:StripePosting):Promise<void>{
  await withTenantTx(deps.db,bid,tx=>sql`update stripe_event_inbox set state=${out.state==='posted'?'done':out.state==='exception'?'exception':'pending'},reason=${out.reason??(out.state==='fee_pending'?'fee_pending':null)},processed_at=${deps.now()}
    where business_id=${bid}::uuid and connection_id=${e.connection}::uuid and event_id=${e.id} and state='pending'`.execute(tx));
}
