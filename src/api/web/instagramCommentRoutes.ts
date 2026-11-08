import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import {sql} from 'kysely';
import {withTenantTx,type Db} from '../../db/client.js';
import {parseBusinessId} from '../../core/types/ids.js';
import type {Locale} from '../../core/owner/i18n/locale.js';
import type {MessageKey} from '../../core/owner/i18n/messages.js';
import type {MetaConnectDeps} from '../../channels/meta/connect.js';
import {startCommentLogin,completeCommentLogin} from '../../channels/meta/commentConnect.js';
import {liveMetaAccount} from '../../db/metaAccounts.js';
import {instagramComments,instagramComment,commentsEnabled} from '../../db/instagramComments.js';
import {renderInstagramComments} from './instagramComments.js';
import type {OwnerSession} from './session.js';
import {flashBanner,type Flash} from './flash.js';
import {t} from './say.js';
const ROOT='/app/channels/instagram/comments';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
type Context={
 db:Db;meta:MetaConnectDeps|null;configId:string|null;baseUrl:string|null;
 session(req:FastifyRequest):OwnerSession|null;
 owner(req:FastifyRequest,reply:FastifyReply):Promise<OwnerSession|null>;
 sessionToken(req:FastifyRequest):string;
 locale(req:FastifyRequest):Locale;
 page(req:FastifyRequest,o:{title:string;active:string;bodyHtml:string}):string;
 flash(req:FastifyRequest,reply:FastifyReply):Flash|null;
 redirect(reply:FastifyReply,path:string,key:MessageKey):FastifyReply;
 connectionRefusal(business:string):Promise<MessageKey|null>;
};
export function registerInstagramCommentRoutes(app:FastifyInstance,deps:Context):void {
 const person=(s:OwnerSession)=>s.person?.id??'owner';
 const ready=()=>deps.meta?.login&&deps.meta.credentialKey&&deps.configId&&deps.baseUrl;
 const redirectUri=()=>`${deps.baseUrl!.replace(/\/$/,'')}${ROOT}/callback`;
 const refused=(reply:FastifyReply)=>deps.redirect(reply,ROOT,'igComments.flash.refused');
 const draw=async(req:FastifyRequest,reply:FastifyReply,deletingId?:string)=>{
  const s=deletingId?await deps.owner(req,reply):deps.session(req);if(!s)return reply.sent?reply:reply.redirect('/login');
  const bid=parseBusinessId(s.businessId);if(!bid.ok)return reply.callNotFound();
  const data=await withTenantTx(deps.db,bid.value,async tx=>{
   const account=await liveMetaAccount(tx,bid.value);
   const practice=(await sql<{practice_of:string|null}>`select practice_of from businesses where id=${bid.value}`.execute(tx)).rows[0]?.practice_of;
   return {comments:await instagramComments(tx,bid.value),enabled:account?await commentsEnabled(tx,bid.value,account.id):false,
    connected:!!account?.igAccountId,configured:!!ready()&&!practice,owner:s.person?.isOwner??true,now:new Date(),
    deleting:deletingId?await instagramComment(tx,bid.value,deletingId):null};
  });
  if(deletingId&&!data.deleting)return reply.callNotFound();
  const locale=deps.locale(req);return reply.type('text/html; charset=utf-8').send(deps.page(req,{title:t(locale,'igComments.title'),active:'channels',bodyHtml:flashBanner(deps.flash(req,reply))+renderInstagramComments(locale,data)}));
 };
 app.get(ROOT,(req,reply)=>draw(req,reply));
 app.get(`${ROOT}/:id/delete`,(req,reply)=>{const id=(req.params as {id:string}).id;return UUID.test(id)?draw(req,reply,id):reply.callNotFound();});
 app.post(`${ROOT}/:id/delete`,async(req,reply)=>{
  const s=await deps.owner(req,reply);if(!s)return reply;
  const id=(req.params as {id:string}).id;const bid=parseBusinessId(s.businessId);
  if(!bid.ok||!UUID.test(id))return reply.callNotFound();
  if((req.body as {confirm?:unknown}|undefined)?.confirm!=='delete')return reply.code(400).send();
  const found=await withTenantTx(deps.db,bid.value,async tx=>{
   if(!await instagramComment(tx,bid.value,id))return false;
   await sql`select ig_comment_erase(${id}::uuid,${person(s)})`.execute(tx);return true;
  });
  return found?deps.redirect(reply,ROOT,'igComments.flash.deleted'):reply.callNotFound();
 });
 app.post(`${ROOT}/switch`,async(req,reply)=>{
  const s=await deps.owner(req,reply);if(!s)return reply;
  const bid=parseBusinessId(s.businessId);if(!bid.ok)return reply.callNotFound();
  const on=(req.body as {on?:unknown}|undefined)?.on;if(on!=='1'&&on!=='0')return reply.code(400).send();
  if(on==='0'){
   await withTenantTx(deps.db,bid.value,async tx=>{
    await sql`select id from meta_accounts where business_id=${bid.value} and archived_at is null for update`.execute(tx);
    await sql`update ig_comment_settings set enabled=false,changed_at=now(),changed_by=${person(s)} where business_id=${bid.value}`.execute(tx);
    await sql`update ig_comment_login_states set expires_at=now() where business_id=${bid.value}`.execute(tx);
   });return deps.redirect(reply,ROOT,'igComments.flash.off');
  }
  const stopped=await deps.connectionRefusal(s.businessId);if(stopped)return deps.redirect(reply,ROOT,stopped);
  if(!ready())return refused(reply);
  const url=await startCommentLogin(deps.meta!,{businessId:bid.value,personId:person(s),session:deps.sessionToken(req),configId:deps.configId!,redirectUri:redirectUri()});
  return url?reply.redirect(url):refused(reply);
 });
 app.get(`${ROOT}/callback`,async(req,reply)=>{
  const s=await deps.owner(req,reply);if(!s)return reply;
  const bid=parseBusinessId(s.businessId);if(!bid.ok)return reply.callNotFound();
  const stopped=await deps.connectionRefusal(s.businessId);if(stopped)return deps.redirect(reply,ROOT,stopped);
  if(!ready())return refused(reply);
  const q=req.query as {state?:unknown;code?:unknown;error?:unknown};
  if(typeof q.state!=='string'||q.state.length>128)return refused(reply);
  const ok=await completeCommentLogin(deps.meta!,{businessId:bid.value,personId:person(s),session:deps.sessionToken(req),state:q.state,
   code:typeof q.code==='string'&&q.code.length<=2048&&!q.error?q.code:'',redirectUri:redirectUri()});
  return deps.redirect(reply,ROOT,ok?'igComments.flash.on':'igComments.flash.refused');
 });
}
