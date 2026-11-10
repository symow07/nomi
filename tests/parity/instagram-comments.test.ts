import { describe, it, expect } from 'vitest';
import { parseInstagramComments } from '../../src/channels/meta/comments.js';
import { parseMetaMessaging } from '../../src/channels/meta/messaging.js';
const value = { comment_id: 'comment-1', from: { id: 'customer-1', username: 'a.customer' }, text: 'Price please', media: { id: 'post-1' } };
const payload = (v: unknown = value, field = 'comments') => ({ object: 'instagram', entry: [{ id: 'account-1', time: 1800000000, changes: [{ field, value: v }] }] });
describe('Instagram comment envelopes are not messages', () => {
  it('reads the Facebook Login envelope and keeps notification time separate from unknown creation', () => {
    expect(parseInstagramComments(payload())).toEqual([expect.objectContaining({ kind: 'comment', eventId: 'comment-1', phoneNumberId: 'account-1', authorId: 'customer-1', mediaId: 'post-1', text: 'Price please', createdAt: null, occurredAt: new Date(1800000000000) })]);
  });
  it('accepts the documented list and alternate id without accepting conflicting identities', () => {
    expect(parseInstagramComments([payload()])).toHaveLength(1);
    expect(parseInstagramComments(payload({ ...value, comment_id: undefined, id: 'comment-1' }))).toHaveLength(1);
    expect(parseInstagramComments(payload({ ...value, id: 'different' }))).toEqual([]);
  });
  it('takes only an explicit valid creation timestamp, not receipt or notification time', () => {
    expect(parseInstagramComments(payload({ ...value, timestamp: '2027-01-14T00:00:00+0000' }))[0]?.createdAt).toEqual(new Date('2027-01-14T00:00:00Z'));
    expect(parseInstagramComments(payload({ ...value, timestamp: 'nonsense' }))[0]?.createdAt).toBeNull();
  });
  it('ignores self, Live, wrong objects and malformed required fields without throwing', () => {
    for (const p of [null, [], 'bad', { object: 'page', entry: payload().entry }, payload(value, 'live_comments'), payload({ ...value, from: { id: 'account-1' } }), payload({ ...value, media: {} }), payload({ ...value, from: {} }), { object: 'instagram', entry: [null, { changes: [null] }] }]) expect(parseInstagramComments(p)).toEqual([]);
  });
  it('does not convert comments to DMs or disturb adjacent message parsing', () => {
    const p = payload();
    expect(parseMetaMessaging('instagram', p)).toEqual([]);
    const dm = { sender: { id: 'customer-1' }, recipient: { id: 'account-1' }, timestamp: 1800000000000, message: { mid: 'mid-1', text: 'hello' } };
    const mixed = { ...p, entry: [{ ...p.entry[0], messaging: [dm] }] };
    expect(parseMetaMessaging('instagram', mixed)).toEqual(parseMetaMessaging('instagram', { object: 'instagram', entry: [{ messaging: [dm] }] }));
    expect(parseInstagramComments(mixed)).toHaveLength(1);
  });
  it('keeps optional text/handle absent and makes account-scoped dedup keys', () => {
    const first = parseInstagramComments(payload({ ...value, text: undefined, from: { id: 'customer-1' } }))[0]!;
    expect(first.text).toBe(''); expect(first.username).toBeNull();
    const other = parseInstagramComments({ object: 'instagram', entry: [{ ...payload().entry[0], id: 'account-2' }] })[0]!;
    expect(first.dedupKey).not.toBe(other.dedupKey);
  });
});

import { readInstagramComment } from '../../src/channels/meta/commentReader.js';
it('reads creation and caption with the exact account and refuses changed media/author/owner', async () => {
  const calls: {url:string;authorization:string|undefined}[]=[];
  const read = (owner='account-1',author='customer-1') => readInstagramComment({ accountId:'account-1',token:'fake-page-secret',graphVersion:'v23.0',fetchImpl:async (url,init) => {
    calls.push({url,authorization:init.headers['Authorization']});
    const body=url.includes('/comment-1?') ? {id:'comment-1',timestamp:'2027-01-14T00:00:00Z',from:{id:author},media:{id:'123451'}}
      : url.includes('fields=caption') ? {caption:'Blue bag'} : {id:'123451',owner:{id:owner},permalink:'https://www.instagram.com/p/example/',media_product_type:'FEED'};
    return {status:200,text:async()=>JSON.stringify(body)};
  } },{commentId:'comment-1',authorId:'customer-1',mediaId:'123451'});
  expect(await read()).toMatchObject({createdAt:new Date('2027-01-14T00:00:00Z'),caption:'Blue bag',failed:false});
  expect(calls).toHaveLength(3);
  expect(calls.every(call=>call.authorization==='Bearer fake-page-secret'&&!new URL(call.url).searchParams.has('access_token'))).toBe(true);
  expect(await read('other')).toMatchObject({failed:true,caption:null});
  expect(await read('account-1','other')).toMatchObject({failed:true,caption:null});
});

import { withoutInstagramComments } from '../../src/channels/meta/comments.js';
it('does not retain comment words inside a neighbouring DM event payload',()=>{
 const message={sender:{id:'sender'},recipient:{id:'account'},timestamp:1700000000000,message:{mid:'dm',text:'ordinary DM'}};
 const original={object:'instagram',entry:[{id:'account',messaging:[message],changes:[{field:'comments',value:{text:'erase-these-comment-words'}},{field:'other',value:{safe:true}}]}]};
 const clean=withoutInstagramComments(original);
 expect(JSON.stringify(clean)).not.toContain('erase-these-comment-words');
 expect(parseMetaMessaging('instagram',clean)).toEqual(parseMetaMessaging('instagram',original));
 expect(JSON.stringify(original)).toContain('erase-these-comment-words');
 const ordinary={object:'instagram',entry:[{messaging:[message]}]};expect(withoutInstagramComments(ordinary)).toEqual(ordinary);
 expect(JSON.stringify(withoutInstagramComments([original]))).not.toContain('erase-these-comment-words');
});
