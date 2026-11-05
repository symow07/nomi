import { describe,it,expect } from 'vitest';
import { renderInvoices,renderInvoice,renderNewInvoice,renderNewCreditNote,renderCreditNote,invoiceReturnHref,type InvoiceChoices } from '../../src/api/web/booksInvoices.js';
import type { InvoiceView } from '../../src/db/booksInvoices.js';
import type { CreditNoteView,CreditableLine } from '../../src/db/booksCreditNotes.js';
import { decimal } from '../../src/core/types/decimal.js';
const d=decimal;
const owner={isOwner:true};const accountant={isOwner:false,kind:'accountant' as const};
const billedTo={code:'C1',name:'Customer <One>',address:'10 Customer Street',country:'GB',ice:null,taxNumber:null,registry:null,siret:null,registro:null,asIssued:true};
const invoice:InvoiceView={id:'invoice',key:'F-2026-0001',party:billedTo.name,issueDate:'2026-11-01',dueDate:'2026-11-30',currency:'GBP',total:d('120'),credited:d('0'),paid:d('30'),status:'partly_paid',label:'November order',entryId:'entry',billedTo,lines:[{lineNo:1,label:'Two items',quantity:'2',unitPrice:'50',account:'SALES',taxCode:'VAT20',net:d('100'),tax:d('20')}],payments:[],creditNotes:[]};
const note:CreditNoteView={id:'credit',key:'A-2026-0001',state:'issued',issueDate:'2026-11-02',reason:'Price adjustment',currency:'GBP',invoiceId:invoice.id,invoiceKey:invoice.key!,entryId:'credit-entry',billedTo,total:d('12'),lines:[{invoiceLineNo:1,label:'Two items',quantity:d('0'),net:d('10'),tax:d('2')}]};
const choices:InvoiceChoices={parties:[{id:'customer',code:'C1',name:'Customer One'}],accounts:[{id:'sales',code:'S1',name:'Sales'}],taxCodes:[{id:'vat',code:'VAT20',label:'VAT 20%'}],bookCurrency:'GBP',salesAccountId:'sales'};
const issuer={name:'Store <Two>',postalAddress:'20 Shop Street',contactEmail:'shop@example.test',contactPhone:null,identifiers:null};
// #427 — the payment and refund forms are drawn only when the chart has a bank or cash account: the fixture gives one.
const pay={journals:[],accounts:[{id:'bank',code:'5141',name:'Bank'}]};
describe('Books invoice and credit-note presentation',()=>{
 it('carries only the exact local invoice list filters and row anchor',()=>{
  const from='/app/books/invoices?q=Atlas&state=overdue&page=4#invoice-11111111-1111-4111-8111-111111111111';
  expect(invoiceReturnHref(from)).toBe(from);
  for(const bad of ['https://evil.test/app/books/invoices','//evil.test/app/books/invoices','/app/books/invoices/invoice/issue','/app/books/invoices?'+ 'x'.repeat(4097)]) expect(invoiceReturnHref(bad)).toBe('/app/books/invoices');
  expect(invoiceReturnHref('/app/books/invoices?state=unknown&page=-4&post=issue#pay')).toBe('/app/books/invoices');
  const html=renderInvoices('en',owner,[{...invoice,id:'11111111-1111-4111-8111-111111111111'}],{q:'Atlas',state:'overdue',returnHref:from,page:{from:151,to:151,total:151,next:null,prev:'/app/books/invoices?q=Atlas&state=overdue&page=3'}});
  expect(html).toContain('151–151 of 151');expect(html).toContain('?from='+encodeURIComponent(from));
  expect(html).toContain('value="overdue" selected');expect(html).toContain('name="q" value="Atlas"');
  const doc=renderInvoice('en',owner,invoice,pay,'2026-11-06',{returnHref:from});
  expect(doc).toContain('name="from" value="/app/books/invoices?q=Atlas&amp;state=overdue&amp;page=4#invoice-');
  expect(doc).toContain('/credit-notes/new?from='+encodeURIComponent(from));
 });
 it('offers no payment or edit action on a discarded invoice',()=>{
  const html=renderInvoice('en',owner,{...invoice,status:'discarded'},pay,'2026-11-06');
  expect(html).not.toContain('<form');expect(html).not.toContain('/invoice/edit');expect(html).not.toContain('Still owed');
 });
 it('keeps totals, outstanding amount and state in each phone-readable list row',()=>{
  const html=renderInvoices('en',owner,[invoice,{...invoice,id:'draft',key:null,status:'draft'}]);
  expect(html).not.toContain('<table');expect(html).toContain('class="bd-invoice-row"');
  const row=html.match(/<li class="bd-invoice-row"[\s\S]*?<\/li>/)?.[0]??'';
  expect(row).toContain('£120.00');expect(row).toContain('£90.00');expect(row).toContain('Partly paid');
  expect(row).toContain('Customer &lt;One&gt;');expect(row).toContain('/app/books/invoices/invoice');
  expect(renderInvoices('en',accountant,[invoice])).not.toContain('/invoices/new');
 });
 it('keeps actions outside the printable invoice, with real issuer and captured recipient details',()=>{
  const html=renderInvoice('en',owner,invoice,pay,'2026-11-06',{issuer});
  const paper=html.match(/<article class="book-document"[\s\S]*?<\/article>/)?.[0]??'';
  expect(paper).toContain('Store &lt;Two&gt;');expect(paper).toContain('20 Shop Street');expect(paper).toContain('Customer &lt;One&gt;');
  expect(paper).toContain('F-2026-0001');expect(paper).toContain('VAT20');expect(paper).toContain('£120.00');
  expect(paper).toContain('Current business details');expect(paper).not.toContain('<form');
  expect(html.indexOf('action="/app/books/invoices/invoice/payments"')).toBeGreaterThan(html.indexOf('</article>'));
  expect(html.match(/<h1 /g)).toHaveLength(1);
 });
 it('preserves draft-only issue/edit and accountant read-only boundaries',()=>{
  const draft=renderInvoice('en',owner,{...invoice,status:'draft'},pay,'2026-11-06');
  expect(draft).toContain('/invoice/edit');expect(draft).toContain('/invoice/issue');expect(draft).toContain('data-confirm=');
  const issued=renderInvoice('en',owner,invoice,pay,'2026-11-06');expect(issued).not.toContain('/invoice/edit');expect(issued).not.toContain('/invoice/issue');
  expect(renderInvoice('en',accountant,invoice,pay,'2026-11-06')).not.toContain('<form');
  const refund=renderInvoice('en',owner,{...invoice,credited:d('120'),status:'refund_due'},pay,'2026-11-06');
  expect(refund).toContain('/invoice/refunds');expect(refund).toContain('name="amount" inputmode="decimal" value="30"');
 });
 it('keeps every invoice line control and retained value in labelled groups, including later draft lines',()=>{
  const values={label0:'First',quantity0:'1.250',price0:'12.50',tax0:'vat',account0:'sales',label7:'Later line',quantity7:'2',price7:'3',tax7:'vat',account7:'sales'};
  const html=renderNewInvoice('en',choices,values,['Check the quantity.'],'2026-11-06','draft');
  expect(html).not.toContain('<table');expect(html).toContain('<fieldset class="bd-edit-line">');expect(html).toContain('role="alert"');
  expect(html).toContain('action="/app/books/invoices/draft/edit"');
  for(let i=0;i<8;i++)for(const field of ['label','quantity','price','tax','account'])expect(html).toContain(`name="${field}${i}"`);
  expect(html).toContain('value="1.250"');expect(html).toContain('value="Later line"');expect(html).toContain('value="vat" selected');
  expect(html.match(/<form /g)).toHaveLength(2);expect(html).toContain('action="/app/books/parties"');
 });
 it('keeps price-only credit controls and exact source line numbers without a wide table',()=>{
  const lines:CreditableLine[]=[{lineNo:9,label:'Original line',quantity:d('2'),unitPrice:d('50'),left:d('2'),leftNet:d('100'),leftTax:d('20'),rate:d('20')}];
  const html=renderNewCreditNote('en',{id:'invoice',key:invoice.key!,party:invoice.party,currency:'GBP'},lines,{qty9:'0',red9:'7.50',reason:'Adjustment'},['Check this line.'],'2026-11-06','credit');
  expect(html).not.toContain('<table');expect(html).toContain('<fieldset class="bd-edit-line">');
  expect(html).toContain('name="qty9" inputmode="decimal" value="0"');expect(html).toContain('name="red9" inputmode="decimal" value="7.50"');
  expect(html).toContain('action="/app/books/credit-notes/credit/edit"');expect(html).toContain('role="alert"');
 });
 it('prints credit-note facts and price-only credits without mutation controls',()=>{
  const html=renderCreditNote('en',owner,note,{issuer});
  const paper=html.match(/<article class="book-document"[\s\S]*?<\/article>/)?.[0]??'';
  expect(paper).toContain('A-2026-0001');expect(paper).toContain('Store &lt;Two&gt;');expect(paper).toContain('Price adjustment');expect(paper).toContain('£12.00');expect(paper).not.toContain('<form');
  expect(html).not.toContain('/credit/issue');expect(html).toContain('price lowered');
  const draft=renderCreditNote('en',owner,{...note,state:'draft'});expect(draft).toContain('/credit/issue');expect(draft).toContain('/credit/discard');
  expect(renderCreditNote('en',accountant,{...note,state:'draft'})).not.toContain('<form');
 });
});
