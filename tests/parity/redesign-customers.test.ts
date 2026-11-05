import { describe, expect, it } from 'vitest';
import { renderCustomers, renderCustomerRecord, customerArea, customerReturnHref } from '../../src/api/web/customers.js';
import { renderCustomerOrders } from '../../src/api/web/customerOrders.js';
import { renderOrder, type OrderView } from '../../src/api/web/orders.js';
import { moneyFromRow } from '../../src/core/types/money.js';
import type { CustomerSelection, CustomersPage } from '../../src/db/customers.js';
import type { CustomerFile } from '../../src/api/web/conversations.js';
const id='00000000-0000-0000-0000-000000000001', cid='00000000-0000-0000-0000-000000000002';
const now=new Date('2026-11-06T09:00:00Z');
const value={clientId:id,spent:moneyFromRow('50','EUR')!,orders:3,lastOrderAt:now,regular:true,quietSince:null,omittedCurrencyOrders:1,unknownAmountOrders:1};
const page:CustomersPage={rows:[{clientId:id,name:'A <shop>',phone:null,email:null,photo:null,channels:['email'],lastContactAt:null,lastWrote:null,waiting:true,conversationId:null,value,labels:[{id:'label-id',name:'VIP <local>'}]}],total:1,from:1,to:1,next:'next-cursor',prev:null,q:'A & B',label:'label-id'};
const selection:CustomerSelection={card:{clientId:id,name:'A <shop>',photo:null,channels:['email'],lastWrote:null,bought:[],askedAbout:[],value,waiting:true,conversationId:cid},conversationId:cid,conversations:{rows:[{id:cid,channel:'email',active:true,lastContactAt:now,waiting:true}],total:1,from:1,to:1,next:null,prev:null}};
const file:CustomerFile={conversationId:cid,buyer:'A <shop>',country:null,channel:'email',status:{t:'talking'},statusTone:'muted',needsOwner:false,profile:{firstContact:null,products:[],quoteCount:0,orderCount:0},timeline:[],context:{products:[],latestQuote:null,order:null,corrections:[]},customer:{clientId:id,photo:null,value}};
describe('Customers area presents the stored records without changing commands',()=>{
 it('keeps directory search, filter, pagination and row return anchor, and qualifies monetary totals',()=>{
  const html=renderCustomers(page,'en',now,{returnHref:'/app/customers?q=A%20%26%20B&label=label-id&after=previous'});
  expect(html).toContain('A &lt;shop&gt;');expect(html).toContain('VIP &lt;local&gt;');expect(html).toContain(`id="customer-${id}"`);
  expect(html).toContain('name="label"');expect(html).toContain('next-cursor');expect(html).toContain('from=');expect(html).toContain('after%3Dprevious%23customer-');
  expect(html).toContain('other currencies');expect(html).toContain('without a recorded amount');expect(html).toContain('No contact recorded');
  expect(html).not.toContain('method="post"');expect(html).not.toContain('/app/books/');
 });
 it('allows only local customer-list return addresses',()=>{
  expect(customerReturnHref('https://evil.test/app/customers')).toBe('/app/customers');
  expect(customerReturnHref('/app/customers/orders?state=shipped&x=bad#order-00000000-0000-0000-0000-000000000001')).toBe('/app/customers/orders?state=shipped#order-00000000-0000-0000-0000-000000000001');
 });
 it('combines one heading with the existing scoped actions and compact-card contract',()=>{
  const html=renderCustomerRecord(selection,file,'en',now);
  expect(html.match(/<h1\b/g)).toHaveLength(1);expect(html).toContain('data-card-body');expect(html).toContain('This conversation');
  expect(html).toContain(`/app/conversations/${cid}/name`);expect(html).toContain('id="copy"');expect(html).toContain('id="deletion"');
  expect(html).toContain('pc-full');expect(html).toContain('conversation=');
 });
 it('carries only explicit safe list return context through rename and stop-contact forms',()=>{
  const href='/app/customers?q=A&after=cursor#customer-'+id;
  const html=renderCustomerRecord(selection,file,'en',now,undefined,{returnHref:href});
  for(const action of ['name','opt-out/record']) {
   const form=html.split(`action="/app/conversations/${cid}/${action}"`)[1]?.split('</form>')[0];
   expect(form).toContain(`name="from" value="/app/customers?q=A&amp;after=cursor#customer-${id}"`);
  }
  expect(renderCustomerRecord(selection,file,'en',now)).not.toContain('name="from"');
  expect(html.slice(html.indexOf('id="deletion"'))).not.toContain('name="from"');
 });
 it('keeps staff controls scoped and omits owner-only copy and erasure actions',()=>{
  const html=renderCustomerRecord(selection,file,'en',now,{isOwner:false});
  expect(html).not.toContain('id="copy"');expect(html).not.toContain('/erase');
  expect(html).toContain(`/app/conversations/${cid}/opt-out/record`);expect(html).toContain(`/app/conversations/${cid}/name`);
 });
 it('never invents conversation commands or borrows a mismatched file',()=>{
  const none={...selection,conversationId:null,card:{...selection.card,conversationId:null},conversations:{...selection.conversations,rows:[],total:0,from:0,to:0}};
  const html=renderCustomerRecord(none,file,'en',now);
  expect(html).toContain('No conversations yet');expect(html).not.toContain('method="post"');expect(html).not.toContain('id="deletion"');
  expect(renderCustomerRecord(selection,{...file,conversationId:'wrong'},'en',now)).not.toContain('/wrong/name');
 });
 it('keeps outreach absent when unavailable and offers native section selection',()=>{
  const html=customerArea('body','en','all');expect(html).not.toContain('/app/customers/outreach');expect(html).toContain('area-chooser');expect(html).toContain('aria-current="page"');
 });
 it('shows pending confirmation in operational list and detail without adding a writable state',()=>{
  const html=renderCustomerOrders({rows:[{id:'o-1',clientId:id,customerName:'A <shop>',conversationId:cid,reference:'REF-1',productId:null,productName:null,productNameZh:null,quantity:4,unit:'pcs',unitPrice:null,total:null,state:'pending_confirmation',stateAt:now,createdAt:now,confirmedAt:null}],total:1,from:1,to:1,next:null,prev:null,q:'',clientId:null,state:null},'en',now);
  expect(html).toContain('Waiting to be confirmed');expect(html).toContain('Amount not recorded');expect(html).not.toContain('method="post"');
  const order:OrderView={orderId:'o-1',reference:'REF-1',conversationId:cid,buyer:'A',productName:null,productSku:'',quantity:4,unit:'pcs',unitPriceAmount:null,totalAmount:null,currency:'EUR',email:null,paymentTerms:null,sellerName:'Shop',confirmedAt:null,history:[{state:'pending_confirmation',at:now,note:null,trackingReference:null,by:'owner'}]};
  const contextual=renderOrder(order,'en',null,{returnHref:'/app/customers/orders?state=shipped&after=cursor'});
  expect(contextual.split('action="/app/orders/o-1/update"')[1]?.split('</form>')[0]).toContain('name="from" value="/app/customers/orders?state=shipped&amp;after=cursor"');
  const detail=renderOrder(order,'en',null);expect(detail).not.toContain('name="from"');expect(detail).toContain('Waiting to be confirmed');expect(detail).not.toContain('<option value="pending_confirmation"');
  expect(renderOrder({...order,history:[],recordedState:'pending_confirmation',confirmedAt:now},'en',null)).toContain('<p class="stated-now">Waiting to be confirmed');
 });
});
