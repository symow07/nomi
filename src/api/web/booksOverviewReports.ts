import type {Locale} from '../../core/owner/i18n/locale.js';
import type {MessageKey} from '../../core/owner/i18n/messages.js';
import type {BooksOverview,BooksOverviewOptions,OverviewPage,OverviewCashEntry,OverviewProfitEntry,OverviewSupplier,OverviewSupplierEntry,OverviewBankLine,OverviewState} from '../../db/booksOverview.js';
import type {Decimal} from '../../core/types/decimal.js';
import {esc} from './layout.js';
import {t} from './say.js';
import {booksMoney,booksDay,booksPager,booksHref,booksScope,type ScopeAccount} from './booksOverview.js';
const say=(locale:Locale,key:MessageKey)=>esc(t(locale,key));
const money=(locale:Locale,value:Decimal,currency:string)=>`<bdi>${booksMoney(locale,value,currency)}</bdi>`;
const date=(locale:Locale,value:string)=>`<bdi>${esc(booksDay(locale,value))}</bdi>`;
const entryHref=(id:string,from:string,anchor='entry-'+id)=>`/app/books/advanced/entries/${encodeURIComponent(id)}?from=${encodeURIComponent(from+'#'+anchor)}`;
const rowHead=(locale:Locale,id:string,label:string,day:string,from:string,anchor='entry-'+id)=>`<p><a href="${esc(entryHref(id,from,anchor))}"><bdi>${esc(label)}</bdi></a></p><p class="caption muted">${date(locale,day)}</p>`;
const empty=(locale:Locale)=>`<p class="muted">${say(locale,'booksArea.noRows')}</p>`;
const frame=(locale:Locale,title:MessageKey,body:string)=>`<section class="ba-overview"><p><a href="/app/books/reports">${say(locale,'booksArea.reports')}</a></p><h1 class="page">${say(locale,title)}</h1>${body}</section>`;
const scopeNotice=(locale:Locale,state:OverviewState)=>state==='available'?'':`<p>${say(locale,state==='needs_setup'?'booksArea.scopeMissing':state==='needs_review'?'booksArea.reviewHint':'booksArea.notAvailable')}${state==='needs_setup'?` <a href="#figure-accounts">${say(locale,'booksArea.chooseAccounts')}</a>`:''}</p>`;
const metric=(locale:Locale,key:MessageKey,amount:Decimal|null,currency:string)=>`<div><dt>${say(locale,key)}</dt><dd>${amount===null?say(locale,'booksArea.notAvailable'):money(locale,amount,currency)}</dd></div>`;
const currencyBasis=(locale:Locale,currency:string)=>`<p class="caption muted"><bdi>${esc(t(locale,'booksReport.currencyBasis',{currency}))}</bdi></p>`;

export function renderBooksCashReport(locale:Locale,o:BooksOverview,scope:BooksOverviewOptions,accounts:readonly ScopeAccount[],p:OverviewPage<OverviewCashEntry>,opts:{readonly state?:'all'|'external'|'transfer'|'review'}={}):string {
 const path='/app/books/reports/cash',state=opts.state??'all';
 const href=(page:number)=>booksHref(path,scope,{...(state==='all'?{}:{state}),...(page===1?{}:{page:String(page)})});
 const here=href(p.page);
 const filters:readonly [typeof state,MessageKey][]=[['all','booksArea.all'],['external','booksReport.external'],['transfer','booksReport.transfers'],['review','booksReport.review']];
 const rows=p.rows.map(r=>`<li class="row" id="entry-${esc(r.id)}"><div>${rowHead(locale,r.id,r.label,r.date,here)}<p><span class="pill${r.classification==='review'?' warn':''}">${say(locale,`booksArea.class.${r.classification}`)}</span></p>${r.classification==='review'?`<p>${say(locale,'booksReport.unclear')}</p>`:r.classification==='valuation'||r.classification==='transfer'?`<p class="muted">${say(locale,'booksReport.excluded')}</p>`:`<dl class="ba-money">${metric(locale,'booksArea.received',r.received,o.bookCurrency)}${metric(locale,'booksArea.paidOut',r.paidOut,o.bookCurrency)}</dl>`}</div></li>`).join('');
 return frame(locale,'booksReport.cash',`<p>${date(locale,o.month.from)} – ${date(locale,o.month.to)}</p><p>${say(locale,'booksReport.cashDetail')}</p>${currencyBasis(locale,o.bookCurrency)}${scopeNotice(locale,o.cash.state)}${o.cash.state==='needs_review'?`<p>${say(locale,'booksReport.cashPartial')}</p>`:''}<dl class="ba-money">${metric(locale,'booksArea.received',o.cash.received,o.bookCurrency)}${metric(locale,'booksArea.paidOut',o.cash.paidOut,o.bookCurrency)}</dl>${booksScope(locale,accounts,scope,path)}<nav class="ba-actions" aria-label="${say(locale,'booksReport.filters')}">${filters.map(([value,label])=>`<a href="${esc(booksHref(path,scope,value==='all'?{}:{state:value}))}"${state===value?' aria-current="page"':''}>${say(locale,label)}</a>`).join('')}</nav>${rows?`<ul class="rows">${rows}</ul>`:empty(locale)}${booksPager(locale,p,href)}`);
}
export function renderBooksProfitReport(locale:Locale,o:BooksOverview,p:OverviewPage<OverviewProfitEntry>):string {
 const href=(page:number)=>'/app/books/reports/profit'+(page>1?'?page='+page:'');
 const rows=p.rows.map(r=>`<li class="row" id="entry-${esc(r.id)}"><div>${rowHead(locale,r.id,r.label,r.date,href(p.page))}<dl>${metric(locale,'booksReport.contribution',r.amount,o.bookCurrency)}</dl></div></li>`).join('');
 return frame(locale,'booksReport.profit',`<p><bdi>${esc(t(locale,'booksArea.profitBasis',{from:booksDay(locale,o.profit.from),to:booksDay(locale,o.profit.to)}))}</bdi></p>${o.profit.basis==='calendar'?`<p>${say(locale,'booksArea.calendarBasis')}</p>`:''}${currencyBasis(locale,o.bookCurrency)}<dl class="ba-money">${metric(locale,'booksArea.profit',o.profit.amount,o.bookCurrency)}</dl>${rows?`<ul class="rows">${rows}</ul>`:empty(locale)}${booksPager(locale,p,href)}`);
}
export function renderBooksSupplierReport(locale:Locale,o:BooksOverview,scope:BooksOverviewOptions,accounts:readonly ScopeAccount[],p:OverviewPage<OverviewSupplier>):string {
 const path='/app/books/reports/suppliers',href=(page:number)=>booksHref(path,scope,page>1?{page:String(page)}:{});
 const rows=p.rows.map(r=>{
  const filter={account:r.accountId,...(r.unassigned?{unassigned:'1'}:r.partyId?{party:r.partyId}:{})};
  return `<li class="row"><div><p><a href="${esc(booksHref(path+'/entries',scope,filter))}"><bdi>${esc(r.party??t(locale,'booksReport.noSupplier'))}</bdi></a></p><p class="caption muted"><bdi>${esc(r.account)}</bdi>${r.unassigned?` · ${say(locale,'booksReport.notSupplier')}`:''}</p><dl class="ba-money">${metric(locale,'booksReport.owed',r.owed,o.bookCurrency)}${metric(locale,'booksReport.advances',r.advance,o.bookCurrency)}</dl></div></li>`;
 }).join('');
 return frame(locale,'booksReport.suppliers',`<p><bdi>${esc(t(locale,'booksArea.asOf',{date:booksDay(locale,o.today)}))}</bdi></p>${currencyBasis(locale,o.bookCurrency)}${scopeNotice(locale,o.supplierOwed.state)}<p>${say(locale,'booksReport.advanceBasis')}</p><dl class="ba-money">${o.supplierOwed.state==='needs_review'?metric(locale,'booksReport.assigned',o.supplierOwed.knownOwed,o.bookCurrency)+metric(locale,'booksReport.advances',o.supplierOwed.knownAdvances,o.bookCurrency)+metric(locale,'booksReport.unassigned',o.supplierOwed.unassignedOwed,o.bookCurrency)+metric(locale,'booksReport.unassignedAdvance',o.supplierOwed.unassignedAdvances,o.bookCurrency):metric(locale,'booksReport.owed',o.supplierOwed.owed,o.bookCurrency)+metric(locale,'booksReport.advances',o.supplierOwed.advances,o.bookCurrency)}</dl>${booksScope(locale,accounts,scope,path)}${rows?`<ul class="rows">${rows}</ul>`:empty(locale)}${booksPager(locale,p,href)}`);
}
export function renderBooksSupplierEntries(locale:Locale,o:BooksOverview,scope:BooksOverviewOptions,p:OverviewPage<OverviewSupplierEntry>,opts:{readonly partyId?:string|null;readonly accountId?:string;readonly unassigned?:boolean}={}):string {
 const extra={...(opts.partyId?{party:opts.partyId}:{}),...(opts.accountId?{account:opts.accountId}:{}),...(opts.unassigned?{unassigned:'1'}:{})};
 const href=(page:number)=>booksHref('/app/books/reports/suppliers/entries',scope,{...extra,...(page>1?{page:String(page)}:{})});
 const rows=p.rows.map(r=>`<li class="row" id="line-${esc(r.id)}"><div>${rowHead(locale,r.entryId,r.label,r.date,href(p.page),'line-'+r.id)}<p><bdi>${esc(r.party??t(locale,'booksReport.noSupplier'))}</bdi> · <bdi>${esc(r.account)}</bdi></p><dl class="ba-money">${metric(locale,'booksReport.debit',r.bookDebit,o.bookCurrency)}${metric(locale,'booksReport.credit',r.bookCredit,o.bookCurrency)}</dl></div></li>`).join('');
 return frame(locale,'booksReport.supplierEntries',`<p><a href="${esc(booksHref('/app/books/reports/suppliers',scope))}">${say(locale,'booksReport.suppliers')}</a></p><p><bdi>${esc(t(locale,'booksArea.asOf',{date:booksDay(locale,o.today)}))}</bdi></p><p>${say(locale,'booksReport.entriesHint')}</p>${currencyBasis(locale,o.bookCurrency)}${scopeNotice(locale,o.supplierOwed.state)}${rows?`<ul class="rows">${rows}</ul>`:empty(locale)}${booksPager(locale,p,href)}`);
}
export function renderBooksUnmatched(locale:Locale,scope:BooksOverviewOptions,p:OverviewPage<OverviewBankLine>):string {
 const href=(page:number)=>booksHref('/app/books/bank',scope,{view:'unmatched',...(page>1?{page:String(page)}:{})});
 const rows=p.rows.map(r=>`<li class="row" id="bank-line-${esc(r.id)}"><div><p><bdi>${esc(r.wording??t(locale,'booksReport.noDescription'))}</bdi></p><p class="caption"><bdi>${esc(r.account)}</bdi> · ${date(locale,r.bookedOn)}</p><p>${money(locale,r.amount,r.currency)}</p>${r.reference?`<p>${say(locale,'booksReport.reference')}: <bdi>${esc(r.reference)}</bdi></p>`:''}<a href="${esc(booksHref('/app/books/bank',scope,{account:r.accountId,line:r.id})+'#bank-line-'+r.id)}">${say(locale,'booksReport.reviewLine')}</a></div></li>`).join('');
 return frame(locale,'booksReport.bank',`<p>${say(locale,'booksReport.bankHint')}</p>${rows?`<ul class="rows">${rows}</ul>`:empty(locale)}${booksPager(locale,p,href)}`);
}
