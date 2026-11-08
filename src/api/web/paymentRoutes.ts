import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import {sql} from 'kysely';
import {withTenantTx,type Db} from '../../db/client.js';
import type {BusinessId} from '../../core/types/ids.js';
import type {Locale} from '../../core/owner/i18n/locale.js';
import type {MessageKey} from '../../core/owner/i18n/messages.js';
import {parseDecimal} from '../../core/types/decimal.js';
import {minorUnits} from '../../core/payments/paymentLink.js';
import {connectAuthorization,verifyConnectEvent,type ConnectConfig,type ConnectClient} from '../../payments/stripeConnect.js';
import {createPaymentLink,expirePaymentLink,reconcileStripePayments} from '../../payments/invoicePayments.js';
import {bindStripe,claimStripeState,newStripeState,saveStripeMapping,storeStripeEvent,stripeBinding} from '../../db/stripePayments.js';
import {confirmStripePayout,receiveStripePayout} from '../../db/stripePosting.js';
import {readStripePage} from '../../db/stripePage.js';
import {invoiceConversation} from '../../outbound/invoiceSend.js';
import {sendPaymentLink} from '../../outbound/paymentLinkSend.js';
import {paymentReason,renderStripePayments} from './stripePayments.js';
import {publicDocument,esc} from './layout.js';
import {t} from './say.js';
import type {Flash} from './flash.js';

type Owner={businessId:BusinessId;actor:string;session:string};
type Context={
  db:Db;provider?:{config:ConnectConfig;client:ConnectClient}|null|undefined;publicBaseUrl?:string|null|undefined;
  owner:(req:FastifyRequest,reply:FastifyReply)=>Promise<Owner|null>;
  locale:(req:FastifyRequest)=>Locale;
  page:(req:FastifyRequest,body:string)=>string;
  flash:(req:FastifyRequest,reply:FastifyReply)=>Flash|null;
  redirect:(reply:FastifyReply,key:MessageKey,params?:Record<string,string>)=>unknown;
  window:(bid:BusinessId,cid:string)=>Promise<{verdict:string;reopening:boolean}>;
  kickDrive:(bid:string,cid:string)=>Promise<void>;
  kick?:((bid:string)=>Promise<void>)|undefined;
};
const BASE='/app/payments/stripe';
const body=(req:FastifyRequest)=>req.body as Record<string,string>|undefined;
const param=(req:FastifyRequest)=>(req.params as {id:string}).id;
/** Owner identity is supplied by the app's signed-session gate; every write also checks the workspace. */
export function registerPaymentRoutes(app:FastifyInstance,c:Context):void{
  const deps=c.provider?{db:c.db,client:c.provider.client,live:c.provider.config.live,now:()=>new Date(),publicBaseUrl:c.publicBaseUrl}:null;
  const refuse=(req:FastifyRequest,reply:FastifyReply,why:string)=>c.redirect(reply,'paymentLinks.flash.refused',{why:paymentReason(c.locale(req),why)});
  const allowed=async(req:FastifyRequest,reply:FastifyReply)=>{
    const o=await c.owner(req,reply);if(!o)return null;
    const b=await withTenantTx(c.db,o.businessId,async tx=>(await sql<{country:string;practice:boolean;books:boolean}>`select country,practice_of is not null as practice,books_area as books from businesses where id=${o.businessId}::uuid`.execute(tx)).rows[0]);
    if(!b||!b.books||b.practice||!['GB','US'].includes(b.country)||!deps){refuse(req,reply,'country');return null;}
    return o;
  };
  app.get(BASE,async(req,reply)=>{
    const o=await c.owner(req,reply);if(!o)return;
    const d=await withTenantTx(c.db,o.businessId,tx=>readStripePage(tx,o.businessId,Boolean(deps),deps?.live??false));
    return reply.type('text/html; charset=utf-8').send(c.page(req,renderStripePayments(d,c.locale(req),c.flash(req,reply))));
  });
  app.post(`${BASE}/connect`,async(req,reply)=>{
    const o=await allowed(req,reply);if(!o)return;
    if(!c.publicBaseUrl)return refuse(req,reply,'no_address');
    const state=await withTenantTx(c.db,o.businessId,tx=>newStripeState(tx,o.businessId,o.actor,o.session,deps!.live,new Date()));
    return reply.redirect(connectAuthorization(c.provider!.config,state,new URL(`${BASE}/return`,c.publicBaseUrl).href));
  });
  app.get(`${BASE}/return`,async(req,reply)=>{
    const o=await allowed(req,reply);if(!o)return;
    const q=req.query as Record<string,string|undefined>;
    if(!q['state']||!await withTenantTx(c.db,o.businessId,tx=>claimStripeState(tx,o.businessId,q['state']!,o.actor,o.session,deps!.live,new Date())))return refuse(req,reply,'other');
    if(!q['code']||q['error'])return refuse(req,reply,'other');
    const got=await deps!.client.exchange(q['code']);if(!got.ok||got.value.live!==deps!.live)return refuse(req,reply,'other');
    const a=await deps!.client.account(got.value.account);if(!a.ok)return refuse(req,reply,a.reason);
    const bound=await withTenantTx(c.db,o.businessId,tx=>bindStripe(tx,o.businessId,a.value,deps!.live,o.actor));
    return bound.ok?c.redirect(reply,'paymentLinks.flash.connected'):refuse(req,reply,bound.reason);
  });
  app.post(`${BASE}/accounts`,async(req,reply)=>{
    const o=await allowed(req,reply);if(!o)return;
    const b=body(req),r=await withTenantTx(c.db,o.businessId,async tx=>{
      const a=await stripeBinding(tx,o.businessId,deps!.live);if(!a)return {ok:false as const,reason:'disconnected'};
      return saveStripeMapping(tx,o.businessId,a.id,{clearingId:b?.['clearingId']??'',transitId:b?.['transitId']??'',feeId:b?.['feeId']??'',journalId:b?.['journalId']??'',bankId:b?.['bankId']??''},o.actor);
    });return r.ok?c.redirect(reply,'paymentLinks.flash.saved'):refuse(req,reply,r.reason);
  });
  app.post(`${BASE}/invoices/:id/create`,async(req,reply)=>{
    const o=await allowed(req,reply);if(!o)return;const r=await createPaymentLink(deps!,o.businessId,param(req));
    return r.ok?c.redirect(reply,'paymentLinks.flash.made'):refuse(req,reply,r.reason);
  });
  app.post(`${BASE}/invoices/:id/send`,async(req,reply)=>{
    const o=await allowed(req,reply);if(!o)return;
    const cid=await invoiceConversation(c.db,o.businessId,param(req));if(!cid)return refuse(req,reply,'no_conversation');
    const w=await c.window(o.businessId,cid);if(w.verdict!=='ok')return c.redirect(reply,`inbox.blocked.${w.verdict}` as MessageKey);
    if(w.reopening)return c.redirect(reply,'invoice.flash.window');
    const r=await sendPaymentLink({...deps!,kickDrive:c.kickDrive},{businessId:o.businessId,invoiceId:param(req),actor:o.actor});
    return r==='queued'?c.redirect(reply,'paymentLinks.flash.queued'):refuse(req,reply,r);
  });
  app.post(`${BASE}/attempts/:id/expire`,async(req,reply)=>{
    const o=await allowed(req,reply);if(!o)return;const r=await expirePaymentLink(deps!,o.businessId,param(req));
    return r.ok?c.redirect(reply,'paymentLinks.flash.expired'):refuse(req,reply,r.reason);
  });
  app.post(`${BASE}/disconnect`,async(req,reply)=>{
    const o=await allowed(req,reply);if(!o)return;
    const r=await withTenantTx(c.db,o.businessId,async tx=>{
      const a=(await sql<{id:string}>`select id::text from stripe_connections where business_id=${o.businessId}::uuid and live=${deps!.live} and active for update`.execute(tx)).rows[0];if(!a)return true;
      if((await sql`select 1 from stripe_checkout_attempts where business_id=${o.businessId}::uuid and connection_id=${a.id}::uuid and (state in ('creating','open','processing') or reason is not null) limit 1`.execute(tx)).rows.length)return false;
      await sql`update stripe_connections set active=false,ready=false,disconnected_at=now() where business_id=${o.businessId}::uuid and id=${a.id}::uuid`.execute(tx);return true;
    });return r?c.redirect(reply,'paymentLinks.flash.disconnected'):refuse(req,reply,'expire_first');
  });
  app.post(`${BASE}/retry`,async(req,reply)=>{
    const o=await allowed(req,reply);if(!o)return;
    await withTenantTx(c.db,o.businessId,tx=>sql`update stripe_event_inbox e set state='pending' from stripe_connections s where e.connection_id=s.id and e.business_id=${o.businessId}::uuid and s.active and s.live=${deps!.live} and e.state='exception'`.execute(tx));
    await reconcileStripePayments(deps!,o.businessId);return c.redirect(reply,'paymentLinks.flash.checked');
  });
  for(const act of ['confirm','receive'] as const)app.post(`${BASE}/payouts/:id/${act}`,async(req,reply)=>{
    const o=await allowed(req,reply);if(!o)return;
    const raw=body(req)?.['amount']??'',amount=raw.length<=30?parseDecimal(raw):null;
    if(act==='confirm'&&(!amount||minorUnits(amount)===null))return refuse(req,reply,'payout_amount');
    const r=await withTenantTx(c.db,o.businessId,async tx=>{
      const a=await stripeBinding(tx,o.businessId,deps!.live);if(!a)return {state:'exception',reason:'disconnected'};
      return act==='confirm'?confirmStripePayout(tx,o.businessId,a.id,param(req),amount!,o.actor):receiveStripePayout(tx,o.businessId,a.id,param(req),body(req)?.['statement']??'',o.actor);
    });return r.state==='posted'?c.redirect(reply,'paymentLinks.flash.posted'):refuse(req,reply,r.reason??'other');
  });
  app.get('/payment/return',async(req,reply)=>{
    const locale=c.locale(req);return reply.type('text/html; charset=utf-8').send(publicDocument({locale,title:t(locale,'paymentLinks.return.title'),noindex:true,body:`<h1><bdi lang="en" dir="ltr">${esc(t(locale,'paymentLinks.return.title'))}</bdi></h1><p><bdi lang="en" dir="ltr">${esc(t(locale,'paymentLinks.return.text'))}</bdi></p>`}));
  });
  if(c.provider){const provider=c.provider;app.register(async scope=>{
    scope.removeContentTypeParser('application/json');
    scope.addContentTypeParser('application/json',{parseAs:'string'},(_req,b,done)=>done(null,b));
    scope.post('/hooks/stripe/connect',async(req,reply)=>{
      const e=verifyConnectEvent(typeof req.body==='string'?req.body:'',String(req.headers['stripe-signature']??''),provider.config,Math.floor(Date.now()/1000));
      if(!e)return reply.code(400).send({error:'signature'});
      const connection=(await sql<{business_id:BusinessId;connection_id:string}>`select * from stripe_connection_for(${e.account},${e.live})`.execute(c.db)).rows[0];
      if(connection){await withTenantTx(c.db,connection.business_id,tx=>storeStripeEvent(tx,connection.business_id,connection.connection_id,e));
        // The durable inbox is sufficient to acknowledge. The periodic worker recovers a missed queue tick.
        if(c.kick)await c.kick(connection.business_id).catch(()=>{});
      }
      return reply.send({received:true});
    });
  });}
}
