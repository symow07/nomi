import {describe,it,expect} from 'vitest';
import {decimal} from '../../src/core/types/decimal.js';
import type {BooksOverview,BooksOverviewOptions,OverviewPage,OverviewCashEntry,OverviewProfitEntry,OverviewSupplier,OverviewSupplierEntry,OverviewBankLine} from '../../src/db/booksOverview.js';
import {renderBooksCashReport,renderBooksProfitReport,renderBooksSupplierReport,renderBooksSupplierEntries,renderBooksUnmatched} from '../../src/api/web/booksOverviewReports.js';
const id='11111111-1111-4111-8111-111111111111',account='22222222-2222-4222-8222-222222222222';
const scope:BooksOverviewOptions={today:'2026-11-06',cashAccountIds:[account],payableAccountIds:[account]};
const overview:BooksOverview={today:scope.today,bookCurrency:'USD',month:{from:'2026-11-01',to:scope.today},fiscalYear:null,needsYou:{overdueInvoices:0,unmatchedLines:0,papers:{unread:0,problem:0,ready:0,draft:0,posted:0,setAside:0,pending:0}},customerOwed:{byCurrency:[]},profit:{amount:decimal('12.01'),from:'2026-01-01',to:scope.today,basis:'calendar'},cashToday:{state:'available',balance:decimal('117'),defaulted:true,byAccount:[{id:account,code:'5141',name:'Bank',balance:decimal('117')}]},cash:{state:'available',defaulted:true,received:decimal('20'),paidOut:decimal('3'),selectedIds:[account],transferIds:[],reviewEntryIds:[],reviewCount:0,excludedTransferCount:0},supplierOwed:{state:'available',owed:decimal('10'),advances:decimal('2'),knownOwed:decimal('10'),knownAdvances:decimal('2'),unassignedOwed:decimal('0'),unassignedAdvances:decimal('0'),selectedIds:[account]}};
const page=<T>(rows:readonly T[]):OverviewPage<T>=>({rows,total:101,from:51,to:100,page:2,pageSize:50,prev:1,next:3});
describe('Books overview supporting report presentation',()=>{
 it('explains review amounts without invented zero and keeps scope, filters and page links',()=>{
  const o={...overview,cash:{...overview.cash,state:'needs_review' as const,received:null,paidOut:null,reviewCount:3}};
  const rows=page<OverviewCashEntry>([{id,date:scope.today,label:'<private>',classification:'review',received:decimal('0'),paidOut:decimal('0'),reason:'mixed_transfer'}]);
  const html=renderBooksCashReport('en',o,scope,[],rows,{state:'review'});
  expect(html).toContain('Some movements cannot be separated reliably');expect(html).not.toContain('$0.00');expect(html).toContain('&lt;private&gt;');expect(html).toContain('state=review');expect(html).toContain('page=3');expect(html).toContain('cash='+account);
  expect(html).toContain('/app/books/advanced/entries/'+id);expect(html).toContain('from=');expect(html.match(/<h1\b/g)).toHaveLength(1);
 });
 it('distinguishes configured zero and missing scope, and shows transfer fees separately',()=>{
  const fee:OverviewCashEntry={id,date:scope.today,label:'Transfer fee',classification:'transfer_fee',received:decimal('0'),paidOut:decimal('3'),reason:null};
  const html=renderBooksCashReport('en',overview,scope,[],page([fee]));expect(html).toContain('Transfer fee');expect(html).toContain('$3.00');expect(html).toContain('Transfers');
  const missing=renderBooksCashReport('en',{...overview,cash:{...overview.cash,state:'needs_setup',received:null,paidOut:null}},scope,[],page([]));expect(missing).toContain('Choose accounts');expect(missing).not.toContain('$0.00');
 });
 it('shows exact fiscal basis and entry contributions with an honest calendar fallback',()=>{
  const html=renderBooksProfitReport('en',overview,page<OverviewProfitEntry>([{id,date:scope.today,label:'Unpaid sale',amount:decimal('12.01')}]));expect(html).toContain('$12.01');expect(html).toContain('calendar year');expect(html).toContain('Unpaid sales can be included');expect(html).toContain('/app/books/advanced/entries/'+id);expect(html).toContain('page=3');
 });
 it('keeps advances and unassigned balances distinct and opens their actual entry filters',()=>{
  const o={...overview,supplierOwed:{...overview.supplierOwed,state:'needs_review' as const,owed:null,advances:null,unassignedOwed:decimal('8')}};
  const html=renderBooksSupplierReport('en',o,scope,[],page<OverviewSupplier>([{id:'unassigned:'+account,partyId:null,party:null,accountId:account,account:'Payable',owed:decimal('8'),advance:decimal('0'),unassigned:true}]));
  expect(html).toContain('Supplier advances');expect(html).toContain('Balances without a supplier');expect(html).toContain('unassigned=1');expect(html).toContain('account='+account);expect(html).toContain('payable='+account);expect(html).toContain('$8.00');
 });
 it('links actual supplier entries and preserves identity filters while paging',()=>{
  const html=renderBooksSupplierEntries('en',overview,scope,page<OverviewSupplierEntry>([{id:'line',entryId:id,date:scope.today,label:'Bill',partyId:null,party:null,accountId:account,account:'Payable',bookDebit:decimal('2'),bookCredit:decimal('10')}]),{accountId:account,unassigned:true});
  expect(html).toContain('/app/books/advanced/entries/'+id);expect(html).toContain('unassigned=1');expect(html).toContain('page=3');expect(html).toContain('$10.00');expect(html).toContain('$2.00');
 });
 it('the complete bank queue is a review door, with no match or payment command',()=>{
  const html=renderBooksUnmatched('ar',scope,page<OverviewBankLine>([{id,accountId:account,account:'Bank <one>',bookedOn:scope.today,currency:'EUR',amount:decimal('-9.01'),wording:'Private words',reference:'Ref-22'}]));
  expect(html).toContain('Bank &lt;one&gt;');expect(html).toContain('account='+account);expect(html).toContain('#bank-line-'+id);expect(html).toContain('page=3');expect(html).toContain('<bdi>');expect(html).not.toContain('method="post"');
 });
});
