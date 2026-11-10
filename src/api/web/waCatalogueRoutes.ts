import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId, type BusinessId } from '../../core/types/ids.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import type { Viewer } from '../../core/conversation/people.js';
import type { OwnerSession } from './session.js';
import type { Flash } from './flash.js';
import { saidFlash } from './flash.js';
import { liveWhatsAppAccount, type WhatsAppAccount } from '../../db/whatsappAccounts.js';
import { whatsAppAccountToken } from '../../channels/whatsapp/connect.js';
import { catalogueClient as makeClient, type CatalogueClient } from '../../net/waCatalogue.js';
import { catalogueProducts, catalogueReview, saveCatalogueProduct, previewCatalogue, submitCatalogue, checkCatalogue, catalogueImage, type CatalogueDeps } from '../../db/waCatalogue.js';
import { renderCatalogue, renderCatalogueReview } from './waCatalogue.js';
import { productArea } from './productArea.js';
import { t } from './say.js';

type Draw={title:string;bodyHtml:string};
type Render=(s:OwnerSession,req:FastifyRequest,locale:Locale,reply:FastifyReply)=>Promise<Draw>;
type Helpers={
  authed:(render:Render)=>(req:FastifyRequest,reply:FastifyReply)=>Promise<FastifyReply>;
  owner:(req:FastifyRequest,reply:FastifyReply)=>Promise<OwnerSession|null>;
  viewer:(s:OwnerSession)=>Viewer & {id:string};
  flash:(reply:FastifyReply,to:string,key:MessageKey)=>FastifyReply;
  takeFlash:(req:FastifyRequest,reply:FastifyReply)=>Flash|null;
  locale:(req:FastifyRequest)=>Locale;
  page:(req:FastifyRequest,draw:Draw)=>string;
};
export type CatalogueWebDeps={db:Db;publicBaseUrl?:string|null;credentialKey?:Buffer;
  catalogueClient?:(account:WhatsAppAccount)=>CatalogueClient;catalogueNow?:()=>Date};
const HOME='/app/products/whatsapp';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notice=(reason:string):MessageKey=>({
  changed:'waCatalog.flash.changed',connection:'waCatalog.flash.connection',no_catalogue:'waCatalog.flash.noCatalogue',
  unknown:'waCatalog.flash.unknown',pending:'waCatalog.flash.pending',finished:'waCatalog.flash.finished',empty:'waCatalog.flash.empty',
  image_address:'waCatalog.flash.imageAddress',too_large:'waCatalog.flash.tooLarge',changed_catalogue:'waCatalog.flash.changedCatalogue',
}[reason]??'waCatalog.flash.failed') as MessageKey;

/** All mutations reuse price_rules authorization; no send path is reachable from these routes. */
export function registerCatalogueRoutes(app:FastifyInstance,deps:CatalogueWebDeps,h:Helpers):void {
  const now=deps.catalogueNow??(()=>new Date());
  const context=async(business:BusinessId):Promise<CatalogueDeps|null>=>{
    const account=await withTenantTx(deps.db,business,tx=>liveWhatsAppAccount(tx,business));
    if(!account||account.needsAttention)return null;
    const token=deps.credentialKey?whatsAppAccountToken(account,deps.credentialKey):null;
    const client=deps.catalogueClient?.(account)??(token?makeClient({token}):null);
    return client?{db:deps.db,client,accountId:account.id,now,publicBaseUrl:deps.publicBaseUrl??''}:null;
  };
  app.get('/catalogue-media/:token',async(req,reply)=>{
    const token=String((req.params as {token:string}).token);
    const image=await catalogueImage(deps.db,token,now());
    reply.header('cache-control','private, no-store').header('x-robots-tag','noindex, nofollow, noarchive')
      .header('x-content-type-options','nosniff').header('referrer-policy','no-referrer');
    return image?reply.type(image.mediaType).send(image.bytes):reply.code(404).type('text/plain').send('Not found');
  });
  app.get(HOME,h.authed(async(s,req,locale,reply)=>{
    const bid=parseBusinessId(s.businessId);if(!bid.ok)throw Error('Invalid session business');
    const data=await withTenantTx(deps.db,bid.value,async tx=>({rows:await catalogueProducts(tx,bid.value),
      practice:(await sql<{practice:boolean}>`select practice_of is not null as practice from businesses where id=${bid.value}::uuid`.execute(tx)).rows[0]?.practice===true,
      latest:(await sql<{id:string}>`select id from wa_catalogue_batches where business_id=${bid.value}::uuid order by created_at desc,id desc limit 1`.execute(tx)).rows[0]?.id,
    }));
    return {title:t(locale,'waCatalog.title'),bodyHtml:productArea(renderCatalogue(locale,data.rows,h.viewer(s).isOwner,data.practice,h.takeFlash(req,reply),data.latest),locale,'whatsapp',h.viewer(s))};
  }));
  app.get(HOME+'/review/:batchId',h.authed(async(s,req,locale,reply)=>{
    const bid=parseBusinessId(s.businessId),id=(req.params as {batchId:string}).batchId;
    const review=bid.ok&&UUID.test(id)?await withTenantTx(deps.db,bid.value,tx=>catalogueReview(tx,bid.value,id)):null;
    if(!review)reply.code(404);
    return {title:t(locale,'waCatalog.review'),bodyHtml:productArea(review?renderCatalogueReview(locale,review,h.viewer(s).isOwner,h.takeFlash(req,reply)):
      renderCatalogue(locale,[],false,false,saidFlash(locale,'waCatalog.flash.changed')),locale,'whatsapp',h.viewer(s))};
  }));
  app.post('/app/products/:productId/whatsapp',async(req,reply)=>{
    const s=await h.owner(req,reply);if(!s)return reply;
    const bid=parseBusinessId(s.businessId),id=(req.params as {productId:string}).productId;
    if(!bid.ok||!UUID.test(id))return h.flash(reply,HOME,'waCatalog.flash.changed');
    const body=(req.body??{}) as Record<string,unknown>,value=(key:string)=>typeof body[key]==='string'?body[key] as string:'';
    const image=value('imageId'),config={description:value('description'),link:value('link'),availability:value('availability'),brand:value('brand'),condition:value('condition'),imageId:UUID.test(image)?image:null};
    const saved=await withTenantTx(deps.db,bid.value,tx=>saveCatalogueProduct(tx,bid.value,id,config));
    if(!saved){
      const locale=h.locale(req),rows=await withTenantTx(deps.db,bid.value,tx=>catalogueProducts(tx,bid.value));
      const kept=rows.map(p=>p.id===id?{...p,...config}:p);
      return reply.code(400).type('text/html').send(h.page(req,{title:t(locale,'waCatalog.title'),bodyHtml:productArea(
        renderCatalogue(locale,kept,true,rows.some(p=>p.practice),saidFlash(locale,'waCatalog.flash.refused')),locale,'whatsapp',h.viewer(s))}));
    }
    return h.flash(reply,HOME,'waCatalog.flash.saved');
  });
  app.post(HOME+'/preview',async(req,reply)=>{
    const s=await h.owner(req,reply);if(!s)return reply;
    const bid=parseBusinessId(s.businessId),c=bid.ok?await context(bid.value):null;
    if(!c||!bid.ok)return h.flash(reply,HOME,'waCatalog.flash.connection');
    const outcome=await previewCatalogue(c,bid.value,h.viewer(s).id);
    return outcome.ok?reply.redirect(HOME+'/review/'+outcome.batchId):h.flash(reply,HOME,notice(outcome.reason));
  });
  app.post(HOME+'/review/:batchId',async(req,reply)=>{
    const s=await h.owner(req,reply);if(!s)return reply;
    const bid=parseBusinessId(s.businessId),id=(req.params as {batchId:string}).batchId;
    if(!bid.ok||!UUID.test(id))return h.flash(reply,HOME,'waCatalog.flash.changed');
    const c=await context(bid.value);if(!c)return h.flash(reply,HOME,'waCatalog.flash.connection');
    const raw=((req.body??{}) as {selected?:unknown}).selected;
    const checked=raw===undefined?[]:Array.isArray(raw)?raw:[raw];
    if(checked.some(v=>typeof v!=='string'||!UUID.test(v)))return h.flash(reply,HOME,'waCatalog.flash.changed');
    const outcome=await submitCatalogue(c,bid.value,id,checked as string[]);
    return h.flash(reply,HOME+'/review/'+id,notice(outcome.ok?outcome.state:outcome.reason));
  });
  app.post(HOME+'/batches/:batchId/check',async(req,reply)=>{
    const s=await h.owner(req,reply);if(!s)return reply;
    const bid=parseBusinessId(s.businessId),id=(req.params as {batchId:string}).batchId;
    if(!bid.ok||!UUID.test(id))return h.flash(reply,HOME,'waCatalog.flash.changed');
    const c=await context(bid.value);if(!c)return h.flash(reply,HOME,'waCatalog.flash.connection');
    const outcome=await checkCatalogue(c,bid.value,id);
    return h.flash(reply,HOME+'/review/'+id,notice(outcome.ok?outcome.state:outcome.reason));
  });
}
