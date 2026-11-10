import {describe,it,expect} from 'vitest';
import type {MetaConnectDeps} from '../../src/channels/meta/connect.js';
import {META_LOGIN_SCOPES,META_PAGE_FIELDS,metaDialogUrl} from '../../src/channels/meta/connect.js';
import {commentsConfigId,commentDialogUrl,readCommentsGrant} from '../../src/channels/meta/commentConnect.js';
const login={appId:'123456',appSecret:'fake-app-secret',configId:'456789'};
const redirectUri='https://shop.invalid/app/channels/instagram/comments/callback';
const pageId='234567',accountId='345678';
function port(change:Record<string,unknown>={}){
 const calls:{url:string;method:string;body:unknown}[]=[];
 const deps={login,graphVersion:'v23.0',fetchImpl:async(url:string,init:{method:string;body?:string})=>{
  const u=new URL(url);calls.push({url,method:init.method,body:init.body});
  const answers:Record<string,unknown>={
   '/oauth/access_token':{access_token:'fake-user-secret'},
   '/me/accounts':{data:[{id:pageId,name:'Shop',access_token:'fake-page-secret',instagram_business_account:{id:accountId}}]},
   '/debug_token':{data:{app_id:login.appId,is_valid:true,scopes:[...META_LOGIN_SCOPES,'instagram_manage_comments']}},
   [`/${pageId}/subscribed_apps:GET`]:{data:[{id:login.appId,subscribed_fields:[...META_PAGE_FIELDS.split(','),'feed']}]},
   [`/${pageId}/subscribed_apps:POST`]:{success:true},
  };
  const key=u.pathname.replace('/v23.0','');const specific=key.includes('subscribed_apps')?key+':'+init.method:key;
  return {status:200,text:async()=>JSON.stringify(specific in change?change[specific]:answers[specific])};
 }} as Pick<MetaConnectDeps,'login'|'graphVersion'|'fetchImpl'>;
 return {deps,calls};
}
describe('comments are a separate incremental Meta permission',()=>{
 it('does not change the base login and needs a separate configured id',()=>{
  expect(commentsConfigId({})).toBeNull();expect(commentsConfigId({META_COMMENTS_LOGIN_CONFIG_ID:'no'})).toBeNull();
  expect(commentsConfigId({META_COMMENTS_LOGIN_CONFIG_ID:' 567890 '})).toBe('567890');
  const base=metaDialogUrl(login,{redirectUri,state:'n',graphVersion:'v23.0'});
  const next=new URL(commentDialogUrl(login,'567890',redirectUri,'nonce','v23.0'));
  expect(next.searchParams.get('config_id')).toBe('567890');expect(next.searchParams.get('auth_type')).toBe('rerequest');
  expect(next.searchParams.get('state')).toBe('nonce');expect(base).not.toContain('567890');expect(META_LOGIN_SCOPES).not.toContain('instagram_manage_comments');
 });
 it('validates the account and scopes before adding comments to existing subscribed fields',async()=>{
  const {deps,calls}=port();expect(await readCommentsGrant(deps,{code:'fake-code',redirectUri,pageId,accountId})).toEqual({ok:true,token:'fake-page-secret'});
  const subscribe=calls.find(x=>x.method==='POST')!;const fields=new URL(subscribe.url).searchParams.get('subscribed_fields')!.split(',');
  expect(fields).toEqual(expect.arrayContaining([...META_PAGE_FIELDS.split(','),'feed','comments']));
  expect(calls.filter(x=>x.method==='POST')).toHaveLength(1);
 });
 for(const [label,change] of Object.entries({
  wrongAccount:{'/me/accounts':{data:[{id:pageId,name:'Shop',access_token:'fake-page-secret',instagram_business_account:{id:'999999'}}]}},
  missingComments:{'/debug_token':{data:{app_id:login.appId,is_valid:true,scopes:META_LOGIN_SCOPES}}},
  wrongApp:{'/debug_token':{data:{app_id:'999999',is_valid:true,scopes:[...META_LOGIN_SCOPES,'instagram_manage_comments']}}},
  missingBase:{'/debug_token':{data:{app_id:login.appId,is_valid:true,scopes:['instagram_manage_comments']}}},
 }))it(`${label} refuses without changing subscriptions`,async()=>{
  const {deps,calls}=port(change);expect(await readCommentsGrant(deps,{code:'fake-code',redirectUri,pageId,accountId})).toEqual({ok:false});expect(calls.some(x=>x.method==='POST')).toBe(false);
 });
 it('does not call a success:false subscription ready',async()=>{
  const {deps}=port({[`/${pageId}/subscribed_apps:POST`]:{success:false}});expect(await readCommentsGrant(deps,{code:'fake-code',redirectUri,pageId,accountId})).toEqual({ok:false});
 });
});
