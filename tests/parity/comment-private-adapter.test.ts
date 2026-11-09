import { describe,it,expect } from 'vitest';
import { metaCommentPrivateReplySender } from '../../src/channels/meta/commentReplies.js';
import { instagramAdapter } from '../../src/channels/instagram/adapter.js';
import type { MetaFetch } from '../../src/channels/meta/messaging.js';
const cfg={accountId:'12345',accessToken:'fake-page-secret',graphVersion:'v23.0'};
describe('the private reply names a comment, never a DM recipient',()=>{
 it('posts to the connected Instagram account, retains both acceptance ids and sends no DM fields',async()=>{
  const calls: {url:string;init:Parameters<MetaFetch>[1]}[]=[];
  const send=metaCommentPrivateReplySender({...cfg,fetchImpl:async(url,init)=>{calls.push({url,init});return{status:200,text:async()=>JSON.stringify({message_id:'mid.accepted',recipient_id:'6789'})};}});
  expect(await send('9876','These are the owner’s words.')).toEqual({ok:true,providerMessageId:'mid.accepted',recipientId:'6789'});
  expect(calls).toHaveLength(1);expect(calls[0]!.url).toBe('https://graph.facebook.com/v23.0/12345/messages');
  expect(JSON.parse(calls[0]!.init.body!)).toEqual({recipient:{comment_id:'9876'},message:{text:'These are the owner’s words.'}});
  expect(calls[0]!.init.headers.Authorization).toBe('Bearer fake-page-secret');expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
 });
 for(const body of [{message_id:'mid.only'},{recipient_id:'6789'},{message_id:'',recipient_id:'6789'},{}])it('an incomplete acceptance is uncertain '+JSON.stringify(body),async()=>{
  expect(await metaCommentPrivateReplySender({...cfg,fetchImpl:async()=>({status:200,text:async()=>JSON.stringify(body)})})('9876','Reply')).toMatchObject({ok:false,retryable:false,uncertain:true});
 });
 it('refuses invalid ids locally and makes failures safe to display',async()=>{
  let calls=0;const send=metaCommentPrivateReplySender({...cfg,fetchImpl:async()=>{calls++;return{status:401,text:async()=>'{"error":{"message":"private customer words"}}'};}});
  expect(await send('../messages','Reply')).toMatchObject({ok:false,retryable:false});expect(calls).toBe(0);
  expect(await send('9876','Reply')).toEqual({ok:false,retryable:false,error:'meta 401'});
 });
 it('a lost response never invites a retry',async()=>{
  expect(await metaCommentPrivateReplySender({...cfg,fetchImpl:async()=>{throw new Error('timeout');}})('9876','Reply')).toMatchObject({ok:false,retryable:false,uncertain:true});
 });
 it('the installation adapter has no private method, while a connected adapter keeps the DM endpoint unchanged',async()=>{
  const urls:string[]=[];const props={pageId:'1111',accessToken:cfg.accessToken,appSecret:'fake-app-secret',graphVersion:cfg.graphVersion,fetchImpl:async(url:string)=>{urls.push(url);return{status:200,text:async()=>'{"message_id":"mid.accepted","recipient_id":"6789"}'};}};
  expect(instagramAdapter(props).sendCommentPrivateReply).toBeUndefined();
  const connected=instagramAdapter({...props,igAccountId:'12345'});expect(connected.commentPrivateReplyAccountId).toBe('12345');
  await connected.sendCommentPrivateReply!('9876','Reply');await connected.sendText('6789','DM');
  expect(urls).toEqual(['https://graph.facebook.com/v23.0/12345/messages','https://graph.facebook.com/v23.0/1111/messages']);
 });
});
