import { stateBlock, stateNext } from './stateBlock.js';
import type {Locale} from '../../core/owner/i18n/locale.js';
import type {MessageKey} from '../../core/owner/i18n/messages.js';
import type {BooksOverview,BooksOverviewOptions,OverviewPage,OverviewCashEntry,OverviewProfitEntry,OverviewSupplier,OverviewSupplierEntry,OverviewBankLine,OverviewState} from '../../db/booksOverview.js';
import type {Decimal} from '../../core/types/decimal.js';
import {esc} from './layout.js';
import {t} from './say.js';
import {booksMoney,booksDay,booksPager,booksHref,booksScope,type ScopeAccount} from './booksOverview.js';
import {tableFrame,cellLabel} from './booksEntries.js';
import * as show from './values.js';
const say=(locale:Locale,key:MessageKey)=>esc(t(locale,key));
const money=(locale:Locale,value:Decimal,currency:string)=>`<bdi>${booksMoney(locale,value,currency)}</bdi>`;
const date=(locale:Locale,value:string)=>`<bdi>${esc(booksDay(locale,value))}</bdi>`;
const entryHref=(id:string,from:string,anchor='entry-'+id)=>`/app/books/advanced/entries/${encodeURIComponent(id)}?from=${encodeURIComponent(from+'#'+anchor)}`;
const rowHead=(locale:Locale,id:string,label:string,day:string,from:string,anchor='entry-'+id)=>`<p><a href="${esc(entryHref(id,from,anchor))}"><bdi>${esc(label)}</bdi></a></p><p class="caption muted">${date(locale,day)}</p>`;
/** F47 — nothing in a report's dates and accounts: its own heading and the one way to widen the view. */
const empty=(locale:Locale,next:string)=>stateBlock('nomatch',{heading:t(locale,'state.report.h'),body:t(locale,'state.report.p'),nextHtml:next});
const widen=(locale:Locale)=>stateNext('#figure-accounts',t(locale,'booksArea.scope'));
const toReports=(locale:Locale)=>stateNext('/app/books/reports',t(locale,'booksArea.reports'));
const frame=(locale:Locale,title:MessageKey,body:string)=>`<section class="ba-overview ba-report"><p><a href="/app/books/reports">${say(locale,'booksArea.reports')}</a></p><h1 class="page">${say(locale,title)}</h1>${body}</section>`;
const scopeNotice=(locale:Locale,state:OverviewState)=>state==='available'?'':`<p>${say(locale,state==='needs_setup'?'booksArea.scopeMissing':state==='needs_review'?'booksArea.reviewHint':'booksArea.notAvailable')}${state==='needs_setup'?` <a href="#figure-accounts">${say(locale,'booksArea.chooseAccounts')}</a>`:''}</p>`;
const metric=(locale:Locale,key:MessageKey,amount:Decimal|null,currency:string)=>`<div><dt>${say(locale,key)}</dt><dd>${amount===null?say(locale,'booksArea.notAvailable'):money(locale,amount,currency)}</dd></div>`;
// F25 (UI correction, Block 5) — a statement's rows in one table: each column named once, its figures end-aligned
// in a column of their own; on a phone each row is a card with its names beside its values. The list says its period.
const cell=(locale:Locale,cls:string,key:MessageKey,inner:string,extra='')=>`<td class="${cls}"${cellLabel(locale,key)}${extra}>${inner}</td>`;
const figure=(locale:Locale,key:MessageKey,amount:Decimal|null,currency:string)=>cell(locale,'num',key,`<span>${amount===null?say(locale,'booksArea.notAvailable'):money(locale,amount,currency)}</span>`);
const entryCell=(locale:Locale,id:string,label:string,from:string,anchor='entry-'+id)=>cell(locale,'bk-text',"bankMatch.entry",`<a href="${esc(entryHref(id,from,anchor))}"><bdi>${esc(label)}</bdi></a>`);
const dayCell=(locale:Locale,day:string)=>cell(locale,'bk-date','books.entry.date',`<span>${date(locale,day)}</span>`);
const th=(locale:Locale,key:MessageKey,num=false)=>`<th scope="col"${num?' class="num"':''}>${say(locale,key)}</th>`;
const statement=(locale:Locale,title:string,head:string,rows:string)=>`${tableFrame(locale,title,'bk-cards bk-stmt')}<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
const rowsFor=(locale:Locale,from:string,to:string)=>t(locale,'booksStmt.rowsFor',{from:show.isolate(locale,booksDay(locale,from)),to:show.isolate(locale,booksDay(locale,to))});
const currencyBasis=(locale:Locale,currency:string)=>`<p class="caption muted"><bdi>${esc(t(locale,'booksReport.currencyBasis',{currency}))}</bdi></p>`;

export function renderBooksCashReport(locale:Locale,o:BooksOverview,scope:BooksOverviewOptions,accounts:readonly ScopeAccount[],p:OverviewPage<OverviewCashEntry>,opts:{readonly state?:'all'|'external'|'transfer'|'review'}={}):string {
 const path='/app/books/reports/cash',state=opts.state??'all';
 const href=(page:number)=>booksHref(path,scope,{...(state==='all'?{}:{state}),...(page===1?{}:{page:String(page)})});
 const here=href(p.page);
 const filters:readonly [typeof state,MessageKey][]=[['all','booksArea.all'],['external','booksReport.external'],['transfer','booksReport.transfers'],['review','booksReport.review']];
 const rows=p.rows.map(r=>`<tr id="entry-${esc(r.id)}">${entryCell(locale,r.id,r.label,here)}${dayCell(locale,r.date)}${cell(locale,'bk-state','books.pack.col.kind',`<span class="pill${r.classification==='review'?' warn':''}">${say(locale,`booksArea.class.${r.classification}`)}</span>`)}${r.classification==='review'?`<td class="bk-note" colspan="2"><p>${say(locale,'booksReport.unclear')}</p></td>`:r.classification==='valuation'||r.classification==='transfer'?`<td class="bk-note" colspan="2"><p class="muted">${say(locale,'booksReport.excluded')}</p></td>`:figure(locale,'booksArea.received',r.received,o.bookCurrency)+figure(locale,'booksArea.paidOut',r.paidOut,o.bookCurrency)}</tr>`).join('');
 const listTitle=rowsFor(locale,o.month.from,o.month.to);
 return frame(locale,'booksReport.cash',`<p>${date(locale,o.month.from)} – ${date(locale,o.month.to)}</p><p>${say(locale,'booksReport.cashDetail')}</p>${currencyBasis(locale,o.bookCurrency)}${scopeNotice(locale,o.cash.state)}<section id="today"><h2>${say(locale,'booksArea.cashToday')}</h2><p class="caption muted"><bdi>${esc(t(locale,'booksArea.cashTodayBasis',{date:booksDay(locale,o.today)}))}</bdi>${o.cashToday.defaulted?` ${say(locale,'booksArea.ownAccounts')}`:''}</p><dl class="ba-money">${metric(locale,'booksArea.cashToday',o.cashToday.balance,o.bookCurrency)}</dl>${o.cashToday.byAccount.length?`<ul class="rows">${o.cashToday.byAccount.map(a=>`<li class="row" id="account-${esc(a.id)}"><span><bdi>${esc(a.code)} · ${esc(a.name)}</bdi></span><b>${money(locale,a.balance,o.bookCurrency)}</b></li>`).join('')}</ul>`:''}</section>${o.cash.state==='needs_review'?`<p>${say(locale,'booksReport.cashPartial')}</p>`:''}<dl class="ba-money">${metric(locale,'booksArea.received',o.cash.received,o.bookCurrency)}${metric(locale,'booksArea.paidOut',o.cash.paidOut,o.bookCurrency)}</dl>${booksScope(locale,accounts,scope,path)}<h2 id="rows">${esc(listTitle)}</h2><nav class="ba-actions" aria-label="${say(locale,'booksReport.filters')}">${filters.map(([value,label])=>`<a href="${esc(booksHref(path,scope,value==='all'?{}:{state:value}))}"${state===value?' aria-current="page"':''}>${say(locale,label)}</a>`).join('')}</nav>${rows?statement(locale,listTitle,th(locale,'bankMatch.entry')+th(locale,'books.entry.date')+th(locale,'books.pack.col.kind')+th(locale,'booksArea.received',true)+th(locale,'booksArea.paidOut',true),rows):empty(locale,widen(locale))}${booksPager(locale,p,href)}`);
}
export function renderBooksProfitReport(locale:Locale,o:BooksOverview,p:OverviewPage<OverviewProfitEntry>):string {
 const href=(page:number)=>'/app/books/reports/profit'+(page>1?'?page='+page:'');
 const rows=p.rows.map(r=>`<tr id="entry-${esc(r.id)}">${entryCell(locale,r.id,r.label,href(p.page))}${dayCell(locale,r.date)}${figure(locale,'booksReport.contribution',r.amount,o.bookCurrency)}</tr>`).join('');
 const listTitle=rowsFor(locale,o.profit.from,o.profit.to);
 return frame(locale,'booksReport.profit',`<p><bdi>${esc(t(locale,'booksArea.profitBasis',{from:booksDay(locale,o.profit.from),to:booksDay(locale,o.profit.to)}))}</bdi></p>${o.profit.basis==='calendar'?`<p>${say(locale,'booksArea.calendarBasis')}</p>`:''}${currencyBasis(locale,o.bookCurrency)}<dl class="ba-money">${metric(locale,'booksArea.profit',o.profit.amount,o.bookCurrency)}</dl><h2 id="rows">${esc(listTitle)}</h2>${rows?statement(locale,listTitle,th(locale,'bankMatch.entry')+th(locale,'books.entry.date')+th(locale,'booksReport.contribution',true),rows):empty(locale,toReports(locale))}${booksPager(locale,p,href)}`);
}
export function renderBooksSupplierReport(locale:Locale,o:BooksOverview,scope:BooksOverviewOptions,accounts:readonly ScopeAccount[],p:OverviewPage<OverviewSupplier>):string {
 const path='/app/books/reports/suppliers',href=(page:number)=>booksHref(path,scope,page>1?{page:String(page)}:{});
 const rows=p.rows.map(r=>{
  const filter={account:r.accountId,...(r.unassigned?{unassigned:'1'}:r.partyId?{party:r.partyId}:{})};
  return `<tr>${cell(locale,'bk-text','books.papers.supplier',`<a href="${esc(booksHref(path+'/entries',scope,filter))}"><bdi>${esc(r.party??t(locale,'booksReport.noSupplier'))}</bdi></a>`)}${cell(locale,'bk-acct','books.entry.account',`<span><bdi>${esc(r.account)}</bdi>${r.unassigned?` · ${say(locale,'booksReport.notSupplier')}`:''}</span>`)}${figure(locale,'booksReport.owed',r.owed,o.bookCurrency)}${figure(locale,'booksReport.advances',r.advance,o.bookCurrency)}</tr>`;
 }).join('');
 return frame(locale,'booksReport.suppliers',`<p><bdi>${esc(t(locale,'booksArea.asOf',{date:booksDay(locale,o.today)}))}</bdi></p>${currencyBasis(locale,o.bookCurrency)}${scopeNotice(locale,o.supplierOwed.state)}<p>${say(locale,'booksReport.advanceBasis')}</p><dl class="ba-money">${o.supplierOwed.state==='needs_review'?metric(locale,'booksReport.assigned',o.supplierOwed.knownOwed,o.bookCurrency)+metric(locale,'booksReport.advances',o.supplierOwed.knownAdvances,o.bookCurrency)+metric(locale,'booksReport.unassigned',o.supplierOwed.unassignedOwed,o.bookCurrency)+metric(locale,'booksReport.unassignedAdvance',o.supplierOwed.unassignedAdvances,o.bookCurrency):metric(locale,'booksReport.owed',o.supplierOwed.owed,o.bookCurrency)+metric(locale,'booksReport.advances',o.supplierOwed.advances,o.bookCurrency)}</dl>${booksScope(locale,accounts,scope,path)}${rows?statement(locale,t(locale,'booksArea.asOf',{date:booksDay(locale,o.today)}),th(locale,'books.papers.supplier')+th(locale,'books.entry.account')+th(locale,'booksReport.owed',true)+th(locale,'booksReport.advances',true),rows):empty(locale,widen(locale))}${booksPager(locale,p,href)}`);
}
export function renderBooksSupplierEntries(locale:Locale,o:BooksOverview,scope:BooksOverviewOptions,p:OverviewPage<OverviewSupplierEntry>,opts:{readonly partyId?:string|null;readonly accountId?:string;readonly unassigned?:boolean}={}):string {
 const extra={...(opts.partyId?{party:opts.partyId}:{}),...(opts.accountId?{account:opts.accountId}:{}),...(opts.unassigned?{unassigned:'1'}:{})};
 const href=(page:number)=>booksHref('/app/books/reports/suppliers/entries',scope,{...extra,...(page>1?{page:String(page)}:{})});
 const rows=p.rows.map(r=>`<tr id="line-${esc(r.id)}">${entryCell(locale,r.entryId,r.label,href(p.page),'line-'+r.id)}${dayCell(locale,r.date)}${cell(locale,'bk-acct','books.papers.supplier',`<span><bdi>${esc(r.party??t(locale,'booksReport.noSupplier'))}</bdi> · <bdi>${esc(r.account)}</bdi></span>`)}${figure(locale,'booksReport.debit',r.bookDebit,o.bookCurrency)}${figure(locale,'booksReport.credit',r.bookCredit,o.bookCurrency)}</tr>`).join('');
 return frame(locale,'booksReport.supplierEntries',`<p><a href="${esc(booksHref('/app/books/reports/suppliers',scope))}">${say(locale,'booksReport.suppliers')}</a></p><p><bdi>${esc(t(locale,'booksArea.asOf',{date:booksDay(locale,o.today)}))}</bdi></p><p>${say(locale,'booksReport.entriesHint')}</p>${currencyBasis(locale,o.bookCurrency)}${scopeNotice(locale,o.supplierOwed.state)}${rows?statement(locale,t(locale,'booksArea.asOf',{date:booksDay(locale,o.today)}),th(locale,'bankMatch.entry')+th(locale,'books.entry.date')+th(locale,'books.papers.supplier')+th(locale,'booksReport.debit',true)+th(locale,'booksReport.credit',true),rows):empty(locale,toReports(locale))}${booksPager(locale,p,href)}`);
}
export function renderBooksUnmatched(locale:Locale,scope:BooksOverviewOptions,p:OverviewPage<OverviewBankLine>):string {
 const href=(page:number)=>booksHref('/app/books/bank',scope,{view:'unmatched',...(page>1?{page:String(page)}:{})});
 const rows=p.rows.map(r=>`<li class="row" id="bank-line-${esc(r.id)}"><div><p><bdi>${esc(r.wording??t(locale,'booksReport.noDescription'))}</bdi></p><p class="caption"><bdi>${esc(r.account)}</bdi> · ${date(locale,r.bookedOn)}</p><p>${money(locale,r.amount,r.currency)}</p>${r.reference?`<p>${say(locale,'booksReport.reference')}: <bdi>${esc(r.reference)}</bdi></p>`:''}<a href="${esc(booksHref('/app/books/bank',scope,{account:r.accountId,line:r.id})+'#bank-line-'+r.id)}">${say(locale,'booksReport.reviewLine')}</a></div></li>`).join('');
 return frame(locale,'booksReport.bank',`<p>${say(locale,'booksReport.bankHint')}</p>${rows?`<ul class="rows">${rows}</ul>`:stateBlock('empty',{heading:t(locale,'state.bank.h'),body:t(locale,'state.bank.p'),nextHtml:stateNext('/app/books/bank',t(locale,'state.bank.next'))})}${booksPager(locale,p,href)}`);
}
