import {sql} from 'kysely';
import {withTenantTx,lockConversation} from '../db/client.js';
import {enqueueOutboundRow} from '../db/channels.js';
import {invoiceSendingOn,sendableInvoice} from '../db/invoiceSending.js';
import {reservePayment} from '../db/stripePayments.js';
import {keepCheckout} from '../db/stripePayments.js';
import {paymentLinkText} from '../core/payments/paymentLink.js';
import type {BusinessId} from '../core/types/ids.js';
import type {PaymentDeps} from '../payments/invoicePayments.js';

/** An explicit owner tap queues text on the existing path. All worker send gates remain authoritative. */
export async function sendPaymentLink(deps:PaymentDeps&{kickDrive:(bid:string,cid:string)=>Promise<void>},input:{businessId:BusinessId;invoiceId:string;actor:string}):Promise<string>{
  const {businessId:bid,invoiceId,actor}=input;
  const selected=await withTenantTx(deps.db,bid,async tx=>{
    if(!await invoiceSendingOn(tx,bid))return {ok:false as const,reason:'off'};
    // Reserve only finds an existing link here; no provider creation is made by Send.
    const a=(await sql<{id:string;account:string}>`select a.id::text,c.account from stripe_checkout_attempts a join stripe_connections c on c.id=a.connection_id
      where a.business_id=${bid}::uuid and a.invoice_id::text=${invoiceId} and a.state='open' and c.active and c.live=${deps.live}`.execute(tx)).rows[0];
    if(!a)return {ok:false as const,reason:'expire_first'};
    const r=await reservePayment(tx,bid,invoiceId,deps.live,deps.now());return r.ok?{...r,account:a.account}:r;
  });
  if(!selected.ok)return selected.reason;
  if(!selected.value.sessionId)return 'processing';
  const checked=await deps.client.checkout(selected.account,selected.value.sessionId);if(!checked.ok)return checked.reason;
  if(!await withTenantTx(deps.db,bid,tx=>keepCheckout(tx,bid,selected.value.id,checked.value)))return 'payment_differs';
  if(checked.value.status!=='open'||!checked.value.url)return 'expire_first';
  const result=await withTenantTx(deps.db,bid,async tx=>{
    if(!await invoiceSendingOn(tx,bid))return {outcome:'off'};
    const r=await reservePayment(tx,bid,invoiceId,deps.live,deps.now());if(!r.ok)return {outcome:r.reason};
    const a=r.value;if(a.id!==selected.value.id||a.state!=='open'||!a.url)return {outcome:'expire_first'};
    const inv=await sendableInvoice(tx,bid,invoiceId);if(!inv?.conversationId||!inv.key)return {outcome:'no_conversation'};
    await lockConversation(tx,inv.conversationId);
    const id=await enqueueOutboundRow(tx,bid,inv.conversationId,paymentLinkText(inv.key,a.amount,a.currency,a.url),'owner',inv.channel==='email'?{subject:inv.key}:null,null,null,true,null,false);
    if(!id)return {outcome:'no_channel'};
    await sql`insert into stripe_link_sends(business_id,attempt_id,conversation_id,outbound_id,sent_by,queued_at) values(${bid}::uuid,${a.id}::uuid,${inv.conversationId}::uuid,${id}::uuid,${actor},${deps.now()})`.execute(tx);
    return {outcome:'queued',cid:inv.conversationId};
  });
  if(result.cid)await deps.kickDrive(bid,result.cid);
  return result.outcome;
}
