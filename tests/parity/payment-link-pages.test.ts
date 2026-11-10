import { describe,it,expect } from 'vitest';
import { renderStripePayments,renderInvoicePaymentDoor } from '../../src/api/web/stripePayments.js';
import type { StripePage } from '../../src/db/stripePage.js';
import { buttonsAndDoors } from './buttons-and-doors.js';
import { unisolatedFigures } from './isolates.js';

const page:StripePage={country:'GB',practice:false,configured:true,live:false,connection:{id:'connection',account:'acct_example',country:'GB',currency:'GBP',live:false,ready:true,active:true},mapping:null,
  accounts:[{id:'clearing',code:'1030',name:'Stripe clearing',kind:'asset'},{id:'transit',code:'1040',name:'Payouts in transit',kind:'asset'},{id:'fee',code:'5020',name:'Processing fees',kind:'expense'}],
  banks:[{id:'bank',code:'1000',name:'Bank current account'}],journals:[{id:'journal',code:'GJ',name:'General'}],attempts:[],movements:[],payouts:[],statements:[],events:[]};
describe('payment-link owner pages',()=>{
  it.each(['en','ar'] as const)('%s: semantic no-script forms, isolated values, one main action and no raw key',locale=>{
    const html=renderStripePayments(page,locale,null);
    expect(html).toContain('Payment links');expect(html).toContain('method="post"');expect(html).not.toContain('<script');
    expect(html).toContain('action="/app/payments/stripe/accounts"');expect(html).toContain('name="bankId"');
    const bank=html.match(/<select[^>]*name="bankId"[\s\S]*?<\/select>/)?.[0]??'';
    expect(bank).toContain('value="" selected');expect(bank).not.toContain('value="bank" selected');
    expect(buttonsAndDoors(html)).toEqual([]);expect(unisolatedFigures(html)).toEqual([]);
    expect(html).not.toMatch(/>paymentLinks\./);expect(html.match(/class="btn send"/g)).toHaveLength(1);
  });
  it('Morocco and Practice have no connect, account or sending forms',()=>{
    for(const model of [{...page,country:'MA'},{...page,practice:true},{...page,configured:false}]){
      const html=renderStripePayments(model,'en',null);expect(html).not.toContain('<form');
    }
    expect(renderStripePayments({...page,country:'MA'},'en',null)).toContain('not available in your country');
  });
  it('draws the invoice door only for an owner and an issued invoice, without adding a second main button',()=>{
    expect(renderInvoicePaymentDoor('invoice','en',true,true,true)).toContain('Send payment link');
    for(const flags of [[false,true,true],[true,false,true],[true,true,false]])expect(renderInvoicePaymentDoor('invoice','ar',...flags as [boolean,boolean,boolean])).toBe('');
    expect(buttonsAndDoors(renderInvoicePaymentDoor('invoice','en',true,true,true))).toEqual([]);
  });
  it.each(['en','ar'] as const)('%s: an invoice a link paid more than it owed says what is owed back and lists every payment and how it came; a link still open is said, never silent',locale=>{
    const over={over:{owedBack:'40',currency:'GBP',payments:[{date:'2026-10-12',amount:'40',currency:'GBP',how:'hand' as const},{date:'2026-10-14',amount:'100',currency:'GBP',how:'link' as const}]},stillOpen:false};
    const html=renderInvoicePaymentDoor('invoice',locale,true,true,true,over);
    expect(html).toContain('A payment link brought in more than this invoice still owed.');expect(html).toContain('Nothing has been refunded.');
    expect(html).toContain('Owed back to the customer:');expect(html).toContain('Recorded by hand');expect(html).toContain('Through a payment link');
    expect(html.match(/id="paid-over"[\s\S]*?<\/ul>/)![0].match(/<li /g)).toHaveLength(2);
    expect(html).not.toContain('still open');
    const open=renderInvoicePaymentDoor('invoice',locale,true,true,true,{over:null,stillOpen:true});
    expect(open).toContain('Another payment link for this invoice is still open');expect(open).not.toContain('paid-over');
    for(const h of [html,open]){expect(buttonsAndDoors(h)).toEqual([]);expect(unisolatedFigures(h)).toEqual([]);expect(h).not.toMatch(/>paymentLinks\./);expect(h.match(/class="btn send"/g)).toBeNull();}
    expect(renderInvoicePaymentDoor('invoice',locale,true,true,true,{over:null,stillOpen:false})).not.toMatch(/paid-over|still open/);
  });
  it('the payments page names a link Nomi expired because another was paid, and the one that paid more than was owed',()=>{
    const html=renderStripePayments({...page,attempts:[
      {id:'b',invoiceId:'i',key:'F-2026-0001',amount:'100',currency:'GBP',state:'expired',reason:null,expiresAt:new Date('2026-10-11'),url:null,closedFor:'a',paidOver:null},
      {id:'c',invoiceId:'i',key:'F-2026-0001',amount:'100',currency:'GBP',state:'paid',reason:null,expiresAt:new Date('2026-10-11'),url:null,closedFor:null,paidOver:'told'}]},'en',null);
    expect(html).toContain('Expired by Nomi because the invoice was paid through another link.');expect(html).toContain('Paid more than the invoice still owed. The difference is owed back to the customer.');
  });
  it('keeps an unavailable fee, mixed payout and posting exception visible, escaping all external values',()=>{
    const html=renderStripePayments({...page,movements:[{id:'m',kind:'payment',amount:'100',currency:'GBP',date:'2026-10-10',entryId:null,reason:'period',providerId:'ch_<script>'}],
      attempts:[{id:'a',invoiceId:'i',key:'F-2026-0001',amount:'100',currency:'GBP',state:'paid',reason:'fee_pending',expiresAt:new Date('2026-10-11'),url:null}],
      payouts:[{id:'po_1',amount:'120',currency:'GBP',date:'2026-10-11',status:'paid',nomiAmount:'97',entryId:'e',receiptId:null,reason:null}],events:[]},'ar',null);
    expect(html).toContain('Fee pending');expect(html).toContain('not from Nomi — yours to record');expect(html).toContain('closed');
    expect(html).not.toContain('<script>');expect(unisolatedFigures(html)).toEqual([]);
  });
});
