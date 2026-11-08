import {describe,it,expect} from 'vitest';
import {renderInstagramComments,type CommentPage} from '../../src/api/web/instagramComments.js';
import type {InstagramComment} from '../../src/db/instagramComments.js';
import {unisolatedFigures} from './isolates.js';
const now=new Date('2027-01-15T12:00:00Z');
const comment:InstagramComment={id:'11111111-1111-4111-8111-111111111111',business_id:'b',meta_account_id:'a',account_id:'123456',comment_id:'234567',identity:'345678',username:'shopper42',words:'Price for <script> bag 12?',media_id:'456789',received_at:now,created_at:new Date('2027-01-14T12:00:00Z'),asking:true,match_state:'matched',product_id:'p',product_name:'Blue bag 24',post_url:'https://www.instagram.com/p/example/',enriched_at:now,read_failed:false,conversation_id:null,attribution_ambiguous:false};
const page:CommentPage={comments:[comment],enabled:false,configured:true,connected:true,owner:true,now};
describe('Instagram comments · owner and staff pages without script',()=>{
 for(const locale of ['en','ar'] as const)it(`${locale}: safe comments, product and time; one heading and no sending in Part A`,()=>{
  const html=renderInstagramComments(locale,page);
  expect(html).toContain('shopper42');expect(html).toContain('Blue bag 24');expect(html).toContain('&lt;script&gt;');
  expect(html.match(/<h1\b/g)).toHaveLength(1);expect(html).toContain('https://www.instagram.com/p/example/');
  expect(html).not.toMatch(/<script|action="[^"]*\/send|igComments\.[a-z]/);
  expect(html).toContain('name="on" value="1"');expect(html).toContain('method="post"');
  expect(html).toContain('/delete');if(locale==='ar')expect(unisolatedFigures(html)).toEqual([]);
 });
 it('staff have no enabling or deletion controls',()=>{
  const html=renderInstagramComments('en',{...page,owner:false});expect(html).not.toContain('<form');expect(html).not.toContain('/delete');
 });
 it('unavailable, unknown age, expired and ambiguous product stay honest',()=>{
  const html=renderInstagramComments('en',{...page,configured:false,comments:[{...comment,created_at:null,product_name:null,match_state:'several'},{...comment,id:'22222222-2222-4222-8222-222222222222',created_at:new Date(now.getTime()-7*86400000)}]});
  expect(html).toContain('not available');expect(html).toContain('creation time');expect(html).toContain('seven days have passed');expect(html).toContain('No single product');expect(html).not.toContain('<form');
 });
 it('deletion requires a separate confirmation page and names the data being removed',()=>{
  const html=renderInstagramComments('en',{...page,deleting:comment});
  expect(html).toContain('name="confirm" value="delete"');expect(html).toContain('Delete this comment');
  expect(html).toContain('method="post"');expect(html).toContain('Cancel');
 });
});
