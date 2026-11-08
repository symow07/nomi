import type { ConnectClient } from '../../src/payments/stripeConnect.js';
import type { Checkout, ConnectedAccount, IntentFact, PayoutFact, RefundFact } from '../../src/core/payments/paymentLink.js';

/** A stateful, account-scoped provider stand-in. No HTTP implementation exists in this fixture. */
export function paymentProvider(account: ConnectedAccount) {
  const sessions=new Map<string,Checkout>(),intents=new Map<string,IntentFact>(),refunds=new Map<string,RefundFact>(),payouts=new Map<string,PayoutFact>();
  const calls:string[]=[];let creates=0;let failCreateAfterKeeping=false;
  const checked=(a:string)=>{if(a!==account.id)throw new Error('Wrong connected account');};
  const missing={ok:false as const,reason:'refused' as const,retryable:false};
  const client:ConnectClient={
    exchange:async code=>{calls.push('exchange');return code==='one-use'?{ok:true,value:{account:account.id,live:false}}:missing;},
    account:async a=>{checked(a);calls.push('account');return {ok:true,value:account};},
    createCheckout:async(a,i)=>{checked(a);calls.push('create');let v=sessions.get(i.attemptId);if(!v){creates++;v={id:`cs_test_${i.attemptId.replaceAll('-','')}`,attemptId:i.attemptId,status:'open',paid:false,amount:i.amount,currency:i.currency,url:`https://checkout.stripe.com/c/pay/${i.attemptId}`,intentId:null,expiresAt:i.expiresAt};sessions.set(i.attemptId,v);}
      if(failCreateAfterKeeping){failCreateAfterKeeping=false;return {ok:false,reason:'unavailable',retryable:true};}return {ok:true,value:v};},
    checkout:async(a,id)=>{checked(a);calls.push('checkout');const v=[...sessions.values()].find(x=>x.id===id);return v?{ok:true,value:v}:missing;},
    expireCheckout:async(a,id)=>{checked(a);calls.push('expire');const v=[...sessions.values()].find(x=>x.id===id);if(!v||v.status!=='open')return missing;const expired={...v,status:'expired' as const,url:null};sessions.set(v.attemptId!,expired);return {ok:true,value:expired};},
    intent:async(a,id)=>{checked(a);calls.push('intent');const v=intents.get(id);return v?{ok:true,value:v}:missing;},
    refund:async(a,id)=>{checked(a);calls.push('refund');const v=refunds.get(id);return v?{ok:true,value:v}:missing;},
    payout:async(a,id)=>{checked(a);calls.push('payout');const v=payouts.get(id);return v?{ok:true,value:v}:missing;},
  };
  return {client,calls,sessions,intents,refunds,payouts,created:()=>creates,ambiguousNextCreate:()=>{failCreateAfterKeeping=true;}};
}
