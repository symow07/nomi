import {describe,it,expect} from 'vitest';
import {decimal} from '../../src/core/types/decimal.js';
import type {BooksOverview,BooksOverviewOptions,OverviewPage,OverviewCashEntry,OverviewProfitEntry,OverviewSupplier,OverviewSupplierEntry} from '../../src/db/booksOverview.js';
import {renderBooksCashReport,renderBooksProfitReport,renderBooksSupplierReport,renderBooksSupplierEntries} from '../../src/api/web/booksOverviewReports.js';
import {renderBooksReportsHome} from '../../src/api/web/booksOverview.js';
import {renderOwnerReport} from '../../src/api/web/booksOwnerReports.js';
import {renderClose,type CloseView} from '../../src/api/web/booksClose.js';
import {renderStartingBalances} from '../../src/api/web/booksSettingsPages.js';
import {renderFec} from '../../src/api/web/booksReports.js';
import {unisolatedFigures} from './isolates.js';
import {LOCALES} from '../../src/core/owner/i18n/locale.js';
/**
 * F25 (UI correction, Block 5) — reports, statements and year end.
 * A report opens a page and a file downloads, and each says which. A statement's rows are one table: each column named
 * once, figures in their own end-aligned columns, the list titled with its period. Year end is a staged review — before
 * locking (the existing checks), lock the month (its scope said first, an ordinary button), close a fiscal year — and
 * opening a year stays in setup (Starting balances), with a door to it. The same forms, targets and conditions as before.
 */
const id='11111111-1111-4111-8111-111111111111',account='22222222-2222-4222-8222-222222222222';
const scope:BooksOverviewOptions={today:'2026-11-06',cashAccountIds:[account],payableAccountIds:[account]};
const overview:BooksOverview={today:scope.today,bookCurrency:'USD',month:{from:'2026-11-01',to:scope.today},fiscalYear:null,needsYou:{overdueInvoices:0,unmatchedLines:0,papers:{unread:0,problem:0,ready:0,draft:0,posted:0,setAside:0,pending:0}},customerOwed:{byCurrency:[]},profit:{amount:decimal('12.01'),from:'2026-01-01',to:scope.today,basis:'calendar'},cashToday:{state:'available',balance:decimal('117'),defaulted:true,byAccount:[{id:account,code:'5141',name:'Bank',balance:decimal('117')}]},cash:{state:'available',defaulted:true,received:decimal('20'),paidOut:decimal('3'),selectedIds:[account],transferIds:[],reviewEntryIds:[],reviewCount:0,excludedTransferCount:0},supplierOwed:{state:'available',owed:decimal('10'),advances:decimal('2'),knownOwed:decimal('10'),knownAdvances:decimal('2'),unassignedOwed:decimal('0'),unassignedAdvances:decimal('0'),selectedIds:[account]}};
const page=<T>(rows:readonly T[]):OverviewPage<T>=>({rows,total:2,from:1,to:2,page:1,pageSize:50,prev:null,next:null});
// Text a reader sees: tags and their attributes (data-label included) left out.
const shown=(html:string)=>html.replace(/<[^>]*>/g,' ');
const count=(s:string,w:string)=>s.split(w).length-1;
const owner={isOwner:true,id:'owner'};const accountant={isOwner:false,id:'acct',kind:'accountant' as const};
const fy=(id:string,startsOn:string,endsOn:string,lockDate:string|null=null)=>({id,startsOn,endsOn,state:'open' as const,lockDate});
const close:CloseView={years:[fy('y26','2026-01-01','2026-12-31'),fy('y25','2025-01-01','2025-12-31','2025-10-31')],history:[],start:{day:'2025-01-01',length:'month',by:'owner',at:'2025-01-01T09:00:00Z'},morocco:false,
 equity:[{id:'eq',code:'1191',name:'Result'}],closingJournals:[{id:'cl',code:'CL',name:'Closing'}],openingJournals:[],
 month:'2026-10',monthEnd:'2026-10-31',checklist:[{item:'draft_entries',n:0},{item:'draft_invoices',n:0},{item:'draft_credit_notes',n:0},{item:'unmatched_statement_lines',n:0}],today:'2026-11-20'};

describe('F25 — a report and a download are told apart',()=>{
 it('the hub: reports to open, then files to download, each file with its kind, the download mark and the download attribute',()=>{
  for(const l of LOCALES){
   const html=renderBooksReportsHome(l,false,true);
   const [pages='',files='']=html.split('id="hub-files"');
   expect(files,l).not.toBe('');
   for(const f of ['/app/books/books.csv','/app/books/workbook.xlsx','/app/books/pack.xlsx']){
    expect(pages,l).not.toContain(`href="${f}"`);
    expect(files,l).toMatch(new RegExp(`href="${f.replace(/\./g,'\\.')}" download>`));
   }
   for(const p of ['/app/books/reports/made','/app/books/reports/profit','/app/books/reports/cash','/app/books/reports/suppliers','/app/books/advanced','/app/books/reports/fec']){
    expect(pages,l).toContain(`href="${p}"`);expect(pages,l).not.toMatch(new RegExp(`href="${p}"[^>]*download`));
   }
   expect(files.match(/<li>/g)?.length,l).toBe(3);
   expect(files,l).toContain('.csv');expect(files,l).toContain('.xlsx');
   expect(html,l).not.toMatch(/booksStmt\./);
  }
  expect(renderBooksReportsHome('en',false,false)).not.toContain('/app/books/reports/fec');
  expect(renderBooksReportsHome('en',true)).not.toContain('id="hub-files"');
 });
 it('each year\'s FEC file says what it downloads (not the accountant pack\'s words); its extension reads left to right',()=>{
  const y={id:'y25',startsOn:'2025-01-01',endsOn:'2025-12-31',state:'closed',lines:2,numbering:[],offChart:[]};
  for(const l of LOCALES){const html=renderFec(l,[y]);expect(html,l).toMatch(/href="\/app\/books\/fec\/y25\.txt" download>/);expect(html,l).not.toMatch(/booksStmt\./);}
  const en=renderFec('en',[y]);expect(shown(en)).toContain("Download this year's FEC");expect(shown(en)).not.toContain('Download the accountant pack');
  expect(renderFec('ar',[y])).toContain('<bdi dir="ltr">.txt</bdi>');
 });
 it('an owner report\'s spreadsheet is a download, marked as one',()=>{
  const html=renderOwnerReport('en',{kind:'made',data:{period:{from:'2026-11-01',to:'2026-11-06'},income:decimal('300'),spending:decimal('380'),result:decimal('-80'),rows:[]}},'month','USD');
  expect(html).toMatch(/<a class="dl-get" href="\/app\/books\/reports\/made\.xlsx\?period=month" download>/);
 });
});

describe('F25 — statement rows are aligned and show their period',()=>{
 it('profit: one table, "Contribution to profit" named once, each figure end-aligned, the list titled with its period',()=>{
  const rows=page<OverviewProfitEntry>([{id,date:'2026-11-03',label:'Sale',amount:decimal('12.01')},{id:'33333333-3333-4333-8333-333333333333',date:'2026-11-04',label:'Rent',amount:decimal('-5')}]);
  const html=renderBooksProfitReport('en',overview,rows);
  expect(count(shown(html),'Contribution to profit')).toBe(1);
  expect(html).toMatch(/<th scope="col" class="num">Contribution to profit<\/th>/);
  expect(html.match(/<td class="num"/g)?.length).toBe(2);
  expect(html).toContain(`<tr id="entry-${id}">`);expect(html).toContain('/app/books/advanced/entries/'+id);
  expect(shown(html)).toMatch(/Entries from\s+\S*Thu, Jan 1, 2026\S*\s+to\s+\S*Fri, Nov 6, 2026/);
  expect(html).toContain('$12.01');
 });
 it('cash: Received and Paid out named once over their columns; a row not counted says why across them, never a zero',()=>{
  const rows=page<OverviewCashEntry>([{id,date:scope.today,label:'Sale',classification:'external',received:decimal('20'),paidOut:decimal('0'),reason:null},
   {id:'44444444-4444-4444-8444-444444444444',date:scope.today,label:'Move',classification:'review',received:decimal('0'),paidOut:decimal('0'),reason:'mixed_transfer'}]);
  const html=renderBooksCashReport('en',overview,scope,[],rows);
  const tbl=html.slice(html.indexOf('<table>'));
  expect(count(shown(tbl),'Received')).toBe(1);expect(count(shown(tbl),'Paid out')).toBe(1);
  expect(tbl).toContain('class="bk-note" colspan="2"');expect(tbl.match(/<td class="num"/g)?.length).toBe(2);
  expect(shown(html)).toMatch(/Entries from\s+\S*Sun, Nov 1, 2026\S*\s+to\s+\S*Fri, Nov 6, 2026/);
 });
 it('suppliers and their entries: one table each, every figure name once',()=>{
  const s=renderBooksSupplierReport('en',overview,scope,[],page<OverviewSupplier>([{id:'p',partyId:'p',party:'Clay Co',accountId:account,account:'Payable',owed:decimal('8'),advance:decimal('0'),unassigned:false},{id:'q',partyId:'q',party:'Glaze Co',accountId:account,account:'Payable',owed:decimal('3'),advance:decimal('1'),unassigned:false}]));
  const st=s.slice(s.indexOf('<table>'));expect(st).toMatch(/<th scope="col" class="num">Still owed<\/th>/);expect(st.match(/<td class="num"/g)?.length).toBe(4);
  const e=renderBooksSupplierEntries('en',overview,scope,page<OverviewSupplierEntry>([{id:'line',entryId:id,date:scope.today,label:'Bill',partyId:null,party:'Clay Co',accountId:account,account:'Payable',bookDebit:decimal('2'),bookCredit:decimal('10')}]),{accountId:account});
  const et=e.slice(e.indexOf('<table>'));expect(count(shown(et),'Balance reduced')).toBe(1);expect(count(shown(et),'Balance increased')).toBe(1);expect(et).toContain('<tr id="line-line">');
 });
 it('in Arabic every figure and date in the tables is isolated',()=>{
  const rows=page<OverviewProfitEntry>([{id,date:'2026-11-03',label:'Sale',amount:decimal('12.01')}]);
  expect(unisolatedFigures(renderBooksProfitReport('ar',overview,rows))).toEqual([]);
  expect(unisolatedFigures(renderBooksCashReport('ar',overview,scope,[],page<OverviewCashEntry>([{id,date:scope.today,label:'Sale',classification:'external',received:decimal('20'),paidOut:decimal('0'),reason:null}])))).toEqual([]);
 });
});

describe('F25 — year end is a staged review, separate from year setup',()=>{
 it('the owner: three stages in order; the lock\'s scope before an ordinary button; the close form under its own stage',()=>{
  const html=renderClose('en',owner,close);
  const a=html.indexOf('id="lock"'),b=html.indexOf('id="lock-month"'),c=html.indexOf('id="close-year"');
  expect(a).toBeGreaterThan(0);expect(b).toBeGreaterThan(a);expect(c).toBeGreaterThan(b);
  expect(html).toMatch(/<ol class="ye-stages">/);
  const stage2=html.slice(b,c);
  expect(stage2.indexOf('id="lock-scope"')).toBeLessThan(stage2.indexOf('action="/app/books/closing/lock"'));
  expect(shown(stage2)).toContain('This lock covers every day from Thu, Jan 1, 2026 to Sat, Oct 31, 2026, in the fiscal year Thu, Jan 1, 2026 – Thu, Dec 31, 2026.');
  expect(stage2).toMatch(/<button class="btn" type="submit" aria-describedby="lock-scope"/);
  expect(html).not.toContain('btn send');
  expect(html.slice(c)).toContain('action="/app/books/closing/year"');
  expect(html).toContain('data-confirm="Lock the books through Sat, Oct 31, 2026?');
 });
 it('opening a year and the opening journal live in setup; Year end keeps the years and a door to Starting balances, for everyone',()=>{
  for(const who of [owner,accountant]){
   const html=renderClose('en',who,close);
   expect(html).not.toContain('action="/app/books/closing/open-year"');expect(html).not.toContain('action="/app/books/closing/opening-journal"');
   expect(html).toMatch(/<ul class="ba-doors"><li><a href="\/app\/settings\/books\/starting-balances">Starting balances/);
   expect(shown(html)).toContain('Thu, Jan 1, 2026 – Thu, Dec 31, 2026');
  }
  // The settings overhaul (rule 104): Starting balances is drawn on the settings template (renderStartingBalances).
  const setup=renderStartingBalances('en',owner,{...close,years:[fy('y26','2026-01-01','2026-12-31')]});
  expect(setup).toContain('action="/app/books/closing/open-year"');expect(setup).toContain('action="/app/books/closing/opening-journal"');
  expect(setup).not.toContain('ye-stages');expect(setup).not.toContain('action="/app/books/closing/year"');
 });
 it('the accountant: the checks and the years, no lock stage and no form; an ended year is named, not offered',()=>{
  const html=renderClose('en',accountant,close);
  expect(html).not.toContain('id="lock-month"');expect(html).not.toContain('method="post"');
  expect(shown(html)).toContain('has ended and can be closed');expect(html).toContain('Before locking');
  const none=renderClose('en',accountant,{...close,years:[fy('y26','2026-01-01','2026-12-31')]});
  expect(shown(none)).toContain('A fiscal year can be closed once its last day has passed.');
 });
 it('every language has the new words; Arabic isolates every date',()=>{
  for(const l of LOCALES){const html=renderClose(l,owner,close);expect(html,l).not.toMatch(/yearEnd\.|booksStmt\./);}
  // a select's options are a form control's own text: left out, as the guard leaves out every form control (Block 4)
  expect(unisolatedFigures(renderClose('ar',owner,close)).filter((x)=>!x.includes('in <option'))).toEqual([]);
 });
});
