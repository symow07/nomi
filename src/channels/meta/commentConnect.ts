import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { withTenantTx } from '../../db/client.js';
import type { BusinessId } from '../../core/types/ids.js';
import { liveMetaAccount } from '../../db/metaAccounts.js';
import { credentialFingerprint, encryptSecret } from '../../security/credentials.js';
import { exchangeMetaCode, listMetaPages, metaDialogUrl, META_LOGIN_SCOPES, META_PAGE_FIELDS, CONNECT_TIMEOUT_MS, type MetaConnectDeps, type MetaLogin } from './connect.js';

export function commentsConfigId(env: Record<string, string | undefined>): string | null {
  const id=env['META_COMMENTS_LOGIN_CONFIG_ID']?.trim();return id&&/^[0-9]{5,}$/.test(id)?id:null;
}
export function commentDialogUrl(login:MetaLogin,configId:string,redirectUri:string,state:string,version:string):string {
  const url=new URL(metaDialogUrl({...login,configId},{redirectUri,state,graphVersion:version}));
  url.searchParams.set('auth_type','rerequest');return url.href;
}
const obj=(x:unknown):Record<string,unknown>=>x&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:{};

/** No stored DM credential changes until the same account, all old scopes, the new scope and subscription are confirmed. */
export async function readCommentsGrant(deps:Pick<MetaConnectDeps,'login'|'graphVersion'|'fetchImpl'>,input:{code:string;redirectUri:string;pageId:string;accountId:string}):Promise<{ok:true;token:string}|{ok:false}> {
  if(!deps.login)return {ok:false};
  try {
    const exchanged=await exchangeMetaCode(deps.login,{code:input.code,redirectUri:input.redirectUri,graphVersion:deps.graphVersion},deps.fetchImpl);
    if(!exchanged.ok)return {ok:false};
    const listed=await listMetaPages(exchanged.userToken,deps.graphVersion,deps.fetchImpl);
    const page=listed.ok?listed.pages.find(p=>p.pageId===input.pageId&&p.instagram?.id===input.accountId):null;
    if(!page)return {ok:false};
    const request=async(path:string,query:Record<string,string>,method='GET')=>{
      const response=await deps.fetchImpl(`https://graph.facebook.com/${deps.graphVersion}/${path}?${new URLSearchParams(query)}`,
        {method,headers:{},signal:AbortSignal.timeout(CONNECT_TIMEOUT_MS)});
      if(response.status<200||response.status>=300)throw new Error('Meta refused');
      const raw=await response.text();if(raw.length>200000)throw new Error('Meta answer too long');return obj(JSON.parse(raw));
    };
    const checked=obj((await request('debug_token',{input_token:page.token,access_token:`${deps.login.appId}|${deps.login.appSecret}`}))['data']);
    const scopes=Array.isArray(checked['scopes'])?checked['scopes']:[];
    if(checked['is_valid']!==true||checked['app_id']!==deps.login.appId||![...META_LOGIN_SCOPES,'instagram_manage_comments'].every(s=>scopes.includes(s)))return {ok:false};
    const subscriptions=await request(`${page.pageId}/subscribed_apps`,{access_token:page.token});
    // Never replace another field this app already subscribed to.
    if(!Array.isArray(subscriptions['data'])||obj(subscriptions['paging'])['next'])return {ok:false};
    const current=subscriptions['data'].map(obj).find(a=>a['id']===deps.login!.appId);
    const prior=current?.['subscribed_fields'];
    if(current&&!Array.isArray(prior))return {ok:false};
    const fields=new Set([...META_PAGE_FIELDS.split(','),...(Array.isArray(prior)?prior.filter((x):x is string=>typeof x==='string'):[]),'comments']);
    const subscribed=await request(`${page.pageId}/subscribed_apps`,{access_token:page.token,subscribed_fields:[...fields].join(',')},'POST');
    return subscribed['success']===true?{ok:true,token:page.token}:{ok:false};
  } catch {return {ok:false};}
}

const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
export async function startCommentLogin(deps:MetaConnectDeps,input:{businessId:BusinessId;personId:string;session:string;configId:string;redirectUri:string}):Promise<string|null> {
  if(!deps.login||!deps.credentialKey)return null;
  const nonce=randomBytes(32).toString('base64url');
  const ready=await withTenantTx(deps.db,input.businessId,async tx=>{
    const account=await liveMetaAccount(tx,input.businessId);
    if(!account?.igAccountId||account.needsAttention)return false;
    const business=(await sql<{practice_of:string|null}>`select practice_of from businesses where id=${input.businessId}`.execute(tx)).rows[0];
    if(!business||business.practice_of)return false;
    await sql`insert into ig_comment_login_states(business_id,nonce_hash,meta_account_id,person_id,session_hash,expires_at)
      values(${input.businessId},${hash(nonce)},${account.id}::uuid,${input.personId},${hash(input.session)},now()+interval '10 minutes')`.execute(tx);
    return true;
  });
  return ready?commentDialogUrl(deps.login,input.configId,input.redirectUri,nonce,deps.graphVersion):null;
}
export async function completeCommentLogin(deps:MetaConnectDeps,input:{businessId:BusinessId;personId:string;session:string;state:string;code:string;redirectUri:string}):Promise<boolean> {
  if(!deps.login||!deps.credentialKey)return false;
  const account=await withTenantTx(deps.db,input.businessId,async tx=>{
    const state=(await sql<{meta_account_id:string}>`update ig_comment_login_states set consumed_at=now()
      where nonce_hash=${hash(input.state)} and business_id=${input.businessId} and person_id=${input.personId}
        and session_hash=${hash(input.session)} and consumed_at is null and expires_at>now() returning meta_account_id`.execute(tx)).rows[0];
    if(!state)return null;
    const current=await liveMetaAccount(tx,input.businessId);
    return current?.id===state.meta_account_id&&current.igAccountId&&!current.needsAttention?current:null;
  });
  if(!account?.igAccountId||!input.code)return false;
  const grant=await readCommentsGrant(deps,{code:input.code,redirectUri:input.redirectUri,pageId:account.pageId,accountId:account.igAccountId});
  if(!grant.ok)return false;
  return withTenantTx(deps.db,input.businessId,async tx=>{
    // A disconnect/reconnect while Meta was open cannot transfer permission to the new connection.
    const row=(await sql<{id:string}>`select m.id from meta_accounts m join businesses b on b.id=m.business_id
      where m.business_id=${input.businessId} and m.id=${account.id}::uuid and m.archived_at is null and m.last_error is null
        and m.ig_account_id=${account.igAccountId} and b.practice_of is null
        and exists(select 1 from ig_comment_login_states where nonce_hash=${hash(input.state)} and expires_at>now()) for update of m`.execute(tx)).rows[0];
    if(!row)return false;
    await sql`update meta_accounts set token_ciphertext=${encryptSecret(grant.token,deps.credentialKey!)},fingerprint=${credentialFingerprint(grant.token)},scopes=${[...META_LOGIN_SCOPES,'instagram_manage_comments'].join(' ')} where id=${account.id}::uuid`.execute(tx);
    await sql`insert into ig_comment_settings(business_id,meta_account_id,account_id,enabled,changed_by)
      values(${input.businessId},${account.id}::uuid,${account.igAccountId},true,${input.personId}) on conflict(meta_account_id)
      do update set enabled=true,changed_at=now(),changed_by=excluded.changed_by`.execute(tx);
    return true;
  });
}
