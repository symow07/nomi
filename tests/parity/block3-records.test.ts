import { describe, expect, it } from 'vitest';
import { renderCustomerRecord } from '../../src/api/web/customers.js';
import { renderOrder, type OrderView } from '../../src/api/web/orders.js';
import type { CustomerSelection } from '../../src/db/customers.js';
import type { CustomerFile } from '../../src/api/web/conversations.js';
import { decimal } from '../../src/core/types/decimal.js';
import { moneyFromRow } from '../../src/core/types/money.js';

const clientId='00000000-0000-0000-0000-000000000001', conversationId='00000000-0000-0000-0000-000000000002';
const now=new Date('2026-11-16T08:00:00Z');
const value={clientId,spent:moneyFromRow('120','EUR'),orders:1,lastOrderAt:now,regular:false,quietSince:null,omittedCurrencyOrders:1,unknownAmountOrders:1};
const selection:CustomerSelection={card:{clientId,name:'نور <Co>',photo:null,channels:['email'],lastWrote:now,bought:[{name:'Canvas bag',nameZh:'帆布袋',quantity:10,unit:'pcs'}],askedAbout:[],value,waiting:true,conversationId},conversationId,conversations:{rows:[{id:conversationId,channel:'email',active:true,lastContactAt:now,waiting:true}],total:1,from:1,to:1,next:null,prev:null}};
const file:CustomerFile={conversationId,buyer:'نور <Co>',country:null,channel:'email',status:{t:'talking'},statusTone:'muted',needsOwner:true,profile:{firstContact:now,products:[],quoteCount:1,orderCount:1},timeline:[],context:{products:[],latestQuote:null,order:null,corrections:[]},customer:{clientId,photo:null,value}};
const order:OrderView={orderId:'order-1',reference:'ORDER-2026-1',conversationId,buyer:'نور <Co>',clientId,productName:'Canvas bag',productSku:'BAG-01',quantity:10,unit:'pcs',unitPriceAmount:decimal('12'),totalAmount:decimal('120'),currency:'EUR',email:null,paymentTerms:'Before dispatch',incoterm:'DAP',sellerName:'Example shop',confirmedAt:now,history:[{state:'shipped',at:now,note:'Keep this note',trackingReference:'TRACK-123',by:'owner'}]};

describe('Block 3 F15 — compact records retain their scoped work',()=>{
 it('shows the selected conversation stage, without guessing from an unrelated customer order',()=>{
  const html=renderCustomerRecord({...selection,stage:{stage:'price',value:null,product:null,thumb:null}},file,'en',now);
  expect(html).toContain('This conversation: <b>Price given</b>');
  expect(html).not.toContain('This conversation: <b>Order</b>');
 });
 it('keeps profile editing closed on arrival, with all fields and commands available without script',()=>{
  const html=renderCustomerRecord(selection,file,'en',now);
  expect(html).toMatch(/<details\b[^>]*id="record-profile"[^>]*>/);
  expect(html).not.toMatch(/<details\b[^>]*id="record-profile"[^>]*\bopen\b/);
  expect(html).toContain(`action="/app/conversations/${conversationId}/name"`);
  expect(html).toContain('name="name" maxlength="80"');
  expect(html).toContain('id="record-activity"');
  expect(html).toContain(`/app/customers/orders?client=${clientId}`);
  expect(html).toContain('other currencies');
  expect(html).toContain('without a recorded amount');
  expect(html.match(/<h1\b/g)).toHaveLength(1);
 });
 it('keeps a waiting deletion request open and preserves the owner/staff distinction',()=>{
  const asked={...file,deletionAsk:{id:'ask-1',askedAt:now,asks:1,conversationId,buyer:file.buyer,words:'Delete my details'}};
  const owner=renderCustomerRecord(selection,asked,'en',now);
  expect(owner).toMatch(/<details\b[^>]*id="record-privacy"[^>]*\bopen\b/);
  expect(owner).toContain('Delete my details');
  expect(owner).toContain('/deletion/erase');expect(owner).toContain('/deletion/dismiss');
  const staff=renderCustomerRecord(selection,asked,'en',now,{isOwner:false});
  expect(staff).not.toContain('/deletion/erase');expect(staff).not.toContain('/copy.csv');
  expect(staff).toContain('/opt-out/record');expect(staff).toContain('Delete my details');
 });
 it('keeps the order editor and proforma on request, with the same update and document controls',()=>{
  const html=renderOrder(order,'en',null);
  expect(html).toMatch(/<details\b[^>]*id="order-update"[^>]*>/);
  expect(html).not.toMatch(/<details\b[^>]*id="order-update"[^>]*\bopen\b/);
  expect(html).toContain('action="/app/orders/order-1/update"');
  for(const name of ['state','tracking','note'])expect(html).toContain(`name="${name}"`);
  expect(html).toContain('maxlength="200"');
  expect(html).toContain('id="order-document"');
  expect(html).toContain('/app/orders/order-1/proforma.txt');
  expect(html).toContain('/app/orders/order-1/proforma-link');
  expect(html).toContain('TRACK-123');expect(html).toContain('Keep this note');
  expect(html).not.toContain('<option value="pending_confirmation"');
  const progression=html.match(/<ol class="order-progress"[\s\S]*?<\/ol>/)?.[0]??'';
  expect(progression).toContain('Confirmed');expect(progression).toContain('Shipped');
  expect(progression).not.toContain('Being prepared');
 });
});
