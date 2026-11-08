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
  it('keeps an unavailable fee, mixed payout and posting exception visible, escaping all external values',()=>{
    const html=renderStripePayments({...page,movements:[{id:'m',kind:'payment',amount:'100',currency:'GBP',date:'2026-10-10',entryId:null,reason:'period',providerId:'ch_<script>'}],
      attempts:[{id:'a',invoiceId:'i',key:'F-2026-0001',amount:'100',currency:'GBP',state:'paid',reason:'fee_pending',expiresAt:new Date('2026-10-11'),url:null}],
      payouts:[{id:'po_1',amount:'120',currency:'GBP',date:'2026-10-11',status:'paid',nomiAmount:'97',entryId:'e',receiptId:null,reason:null}],events:[]},'ar',null);
    expect(html).toContain('Fee pending');expect(html).toContain('not from Nomi — yours to record');expect(html).toContain('closed');
    expect(html).not.toContain('<script>');expect(unisolatedFigures(html)).toEqual([]);
  });
});
