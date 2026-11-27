import {icon, GO} from './icons.js';
import {formatDateYear} from '../../core/owner/i18n/format.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import type { Viewer } from '../../core/conversation/people.js';
import type { BooksOverview, BooksOverviewOptions, OverviewPage } from '../../db/booksOverview.js';
import type { EntryRow } from '../../db/booksEntries.js';
import { moneyFromRow } from '../../core/types/money.js';
import { decimal, type Decimal } from '../../core/types/decimal.js';
import { esc } from './layout.js';
import { t } from './say.js';
import * as show from './values.js';
import { booksSetupCard, type BooksSetupState } from './booksSetup.js';

export type ScopeAccount={readonly id:string;readonly code:string;readonly name:string;readonly kind:string;readonly active:boolean};
export const booksMoney=(locale:Locale,value:Decimal,currency:string):string=>{const money=moneyFromRow(value,currency);return `<bdi>${money?esc(show.money(locale,money)):`${esc(value)} ${esc(currency)}`}</bdi>`;};
export const booksDay=(locale:Locale,date:string):string=>formatDateYear(locale,new Date(`${date}T12:00:00Z`),'UTC');
export function booksScopeQuery(o:BooksOverviewOptions):URLSearchParams {const q=new URLSearchParams();for(const [key,ids] of [['cash',o.cashAccountIds],['payable',o.payableAccountIds],['transfer',o.transferAccountIds]] as const)for(const id of ids??[])q.append(key,id);return q;}
export function booksHref(path:string,o:BooksOverviewOptions,extra:Record<string,string>={}):string {const q=booksScopeQuery(o);for(const [k,v] of Object.entries(extra))q.set(k,v);return path+(q.size?'?'+q.toString():'');}
export function booksPager(locale:Locale,p:Pick<OverviewPage<unknown>,'from'|'to'|'total'|'next'|'prev'>,href:(page:number)=>string):string {
 // F47 — "0–0 of 0" under nothing is not a range: with no row there is no pager
 // The text pass (2026-11-26): a list that fits on one page has no pager ("1–7 of 7" said nothing).
 if(p.total===0||(!p.prev&&!p.next))return '';
 return `<nav class="ba-pager" aria-label="${esc(t(locale,'booksArea.support'))}">${p.prev?`<a rel="prev" href="${esc(href(p.prev))}">${esc(t(locale,'booksArea.previous'))}</a>`:'<span></span>'}<span class="caption"><bdi>${esc(t(locale,'booksArea.range',{from:p.from,to:p.to,total:p.total}))}</bdi></span>${p.next?`<a rel="next" href="${esc(href(p.next))}">${esc(t(locale,'booksArea.next'))}</a>`:'<span></span>'}</nav>`;
}
export function booksScope(locale:Locale,accounts:readonly ScopeAccount[],o:BooksOverviewOptions,action='/app/books'):string {
 const group=(name:string,key:MessageKey,kinds:readonly string[],ids:readonly string[])=>{const rows=accounts.filter(a=>kinds.includes(a.kind));return `<fieldset><legend>${esc(t(locale,key))}</legend>${rows.length?rows.map(a=>`<label><input type="checkbox" name="${name}" value="${esc(a.id)}"${ids.includes(a.id)?' checked':''}><span><bdi>${esc(a.code)} · ${esc(a.name)}</bdi>${a.active?'':` · ${esc(t(locale,'booksArea.inactive'))}`}</span></label>`).join(''):`<p>${esc(t(locale,'booksArea.scopeEmpty'))}</p>`}</fieldset>`;};
 return `<details class="ba-scope" id="figure-accounts"><summary>${esc(t(locale,'booksArea.scope'))}</summary><p>${esc(t(locale,'booksArea.scopeHint'))}</p><form method="get" action="${esc(action)}">${group('cash','booksArea.cashAccounts',['asset'],o.cashAccountIds??[])}${group('payable','booksArea.payableAccounts',['liability'],o.payableAccountIds??[])}${group('transfer','booksArea.transferAccounts',['asset','liability'],o.transferAccountIds??[])}<p class="caption muted">${esc(t(locale,'booksArea.currentScope'))}</p><button class="btn" type="submit">${esc(t(locale,'booksArea.show'))}</button></form></details>`;
}
export function booksDoors(locale:Locale,links:readonly [string,MessageKey][]):string {return `<ul class="ba-doors">${links.map(([href,key])=>`<li><a href="${esc(href)}">${esc(t(locale,key))}${icon('go','ni flips')}</a></li>`).join('')}</ul>`;}
/** Reports and Advanced remain separate destinations; country-specific exports stay conditional. */
export function renderBooksReportsHome(locale:Locale,advanced=false,moroccanBooks=false):string {
 const links:[string,MessageKey][]=advanced
  ? [['/app/books/advanced/entries','books.entries.title'],['/app/books/advanced/trial-balance','books.trial.title']]
  : [['/app/books/reports/made','ownerReport.made'],['/app/books/reports/money','ownerReport.money'],['/app/books/reports/tax','ownerReport.tax'],['/app/books/reports/customers','ownerReport.customers'],['/app/books/reports/unpaid','ownerReport.unpaid'],['/app/books/reports/profit','booksArea.profitDetails'],['/app/books/reports/cash','booksArea.cashDetails'],['/app/books/reports/suppliers','booksArea.supplierDetails'],['/app/books/books.csv','booksArea.fullDownload'],['/app/books/workbook.xlsx','booksArea.workbook'],['/app/books/pack.xlsx','booksArea.pack'],['/app/books/advanced','booksArea.advanced']];
 if(!advanced&&moroccanBooks)links.push(['/app/books/reports/fec','books.fec.title']);
 const head=`<h1 class="page">${esc(t(locale,advanced?'booksArea.advanced':'booksArea.reports'))}</h1><p class="lede">${esc(t(locale,advanced?'booksArea.advancedHint':'booksArea.reportsHint'))}</p>`;
 if(advanced)return head+booksDoors(locale,links);
 // F25 (UI correction, Block 5) — a report opens a page (an arrow); a file downloads (its kind said, a download mark).
 const FILE:Record<string,MessageKey>={'/app/books/books.csv':'booksStmt.csv','/app/books/workbook.xlsx':'booksStmt.xlsx','/app/books/pack.xlsx':'booksStmt.xlsx'};
 const pages=links.filter(([href])=>!FILE[href]),files=links.filter(([href])=>FILE[href]);
 return head+`<section class="ba-hub" aria-labelledby="hub-pages"><h2 id="hub-pages">${esc(t(locale,'booksStmt.pages'))}</h2>${booksDoors(locale,pages)}</section>`
  +`<section class="ba-hub" aria-labelledby="hub-files"><h2 id="hub-files">${esc(t(locale,'booksStmt.files'))}</h2><ul class="ba-doors ba-files">${files.map(([href,key])=>`<li><a href="${esc(href)}" download><span class="ba-file"><span>${esc(t(locale,key))}</span><span class="caption muted">${esc(t(locale,FILE[href]!)).replace(/\.(csv|xlsx)/,'<bdi dir="ltr">.$1</bdi>')}</span></span>${icon('download')}</a></li>`).join('')}</ul></section>`;
}

/**
 * F17 (Block 5) — the Books home, in the order the day's work asks for it: what needs you (one compact line each),
 * the three things an owner starts from here, the one setup step still missing, then the money in three groups —
 * cash, what is owed, profit — each figure with its period and the report it comes from. Cash and profit are never
 * one group: profit says it is not cash. A figure the records cannot give is its "choose / check / not available"
 * link, never a zero. Each figure's full basis is kept word for word under "How these figures are worked out".
 */
export function renderBooksOverview(locale:Locale,viewer:Viewer & {readonly kind?:'team'|'accountant'},o:BooksOverview,scope:BooksOverviewOptions,accounts:readonly ScopeAccount[],recent:readonly EntryRow[],setup:{year:boolean;accounts:boolean},checklist:BooksSetupState|null=null):string {
 const text=(key:MessageKey,p:Record<string,string|number>={})=>esc(t(locale,key,p));
 const asOf=booksDay(locale,o.today),from=booksDay(locale,o.month.from),to=booksDay(locale,o.month.to);
 const missing=(state:BooksOverview['cash']['state'],href:string)=>`<a href="${esc(state==='needs_setup'?'#figure-accounts':href)}">${text(state==='needs_setup'?'booksArea.chooseAccounts':state==='needs_review'?'booksArea.reviewNeeded':'booksArea.notAvailable')}</a>`;
 const cashHref=booksHref('/app/books/reports/cash',scope),supplierHref=booksHref('/app/books/reports/suppliers',scope);
 const profitFrom=booksDay(locale,o.profit.from),profitTo=booksDay(locale,o.profit.to);
 // One figure: its name, its value, then its period and the report it is read from (the source, a door).
 // The text pass (2026-11-26) — the day is said once, under the title; a figure says a period only when it has one of
 // its own ("This month", the year's span); and a source three figures share is linked once, under them.
 const sourceLink=(href:string,source:MessageKey)=>`<p class="ba-source"><a class="deeper" href="${esc(href)}">${text(source)}${GO}</a></p>`;
 const figure=(key:MessageKey,value:string,period:string|null,source:readonly [href:string,key:MessageKey]|null,note='',hover='')=>`<div class="ba-fig"><dt${hover?` title="${hover}" tabindex="0"`:''}>${text(key)}</dt><dd>${value}</dd>${period===null?'':`<p class="ba-period">${period}</p>`}${note}${source?sourceLink(source[0],source[1]):''}</div>`;
 // Before the books have a year, nothing can be saved to them: a figure with nothing behind it is "Not on record",
 // never a zero that reads as a real one. A figure that HAS something behind it (an issued invoice) is still shown.
 const isZero=(amount:string)=>Number(amount)===0;
 const amountOf=(amount:Decimal)=>!setup.year&&isZero(String(amount))?`<span class="ba-none">${text('askPicture.notOnRecord')}</span>`:booksMoney(locale,amount,o.bookCurrency);
 // A period said short: "Nov 1 to Nov 19, 2026" (the first day's year only when it is not the last's).
 const span=(a:string,b:string)=>text('booksHome.span',{from:a.slice(0,4)===b.slice(0,4)?show.dayMonth(locale,a):show.dayMonthYear(locale,a),to:show.dayMonthYear(locale,b)});
 const month=text('booksArea.month');
 const needs:readonly [number,string,MessageKey][]=[[o.needsYou.overdueInvoices,'/app/books/invoices?state=overdue','booksArea.overdue'],[o.needsYou.unmatchedLines,'/app/books/bank?view=unmatched','booksArea.unmatched'],[o.needsYou.papers.pending,'/app/books/spending?state=pending','booksArea.receipts']];
 const owed=o.customerOwed.byCurrency.length?o.customerOwed.byCurrency.map(r=>`<div>${booksMoney(locale,r.owed,r.currency)}${r.refundDue!=='0'?`<p>${text('booksArea.refundDue',{amount:(moneyFromRow(r.refundDue,r.currency)?show.money(locale,moneyFromRow(r.refundDue,r.currency)!):r.refundDue+' '+r.currency)})}</p>`:''}</div>`).join(''):amountOf(decimal('0'));
 const setupRows: [string,MessageKey][]=[];if(!setup.year)setupRows.push(['/app/settings/books/starting-balances','booksArea.setupYear']);if(!setup.accounts)setupRows.push(['/app/settings/books/accounts','booksArea.setupAccounts']);
 // One setup notice: the first step still missing, as a door. The rest wait in Books settings.
 // Rule 104: where the route gives the checklist (the owner's), the whole of it is drawn as a card until its five steps
 // are done, and the one-line notice is not said twice.
 const setupNotice=viewer.isOwner&&checklist?booksSetupCard(locale,checklist):viewer.isOwner&&setupRows.length?`<p class="ba-setup"><strong>${text('booksArea.setup')}</strong> <a href="${esc(setupRows[0]![0])}">${text(setupRows[0]![1])}</a></p>`:'';
 const actions=viewer.isOwner?`<div class="ba-actions" role="group" aria-label="${text('booksHome.actions')}"><a class="btn" data-books-action href="/app/books/invoices/new">${text('booksArea.newInvoice')}</a><a class="btn" data-books-action href="/app/books/spending#receipt-upload">${text('booksArea.addReceipt')}</a><a class="btn" data-books-action href="/app/books/bank#read-statement">${text('booksArea.readStatement')}</a></div>`:'';
 const cash=`<section class="ba-group" aria-labelledby="ba-cash"><h2 id="ba-cash">${text('booksHome.cash')}</h2><dl>${
  figure('booksArea.cashToday',o.cashToday.balance===null?missing(o.cashToday.state,cashHref):amountOf(o.cashToday.balance),null,null)}${
  figure('booksArea.received',o.cash.received===null?missing(o.cash.state,cashHref):amountOf(o.cash.received),month,null)}${
  figure('booksArea.paidOut',o.cash.paidOut===null?missing(o.cash.state,cashHref):amountOf(o.cash.paidOut),month,null)}</dl>${sourceLink(cashHref,'booksArea.cashDetails')}</section>`;
 const owedGroup=`<section class="ba-group" aria-labelledby="ba-owed"><h2 id="ba-owed">${text('booksHome.owed')}</h2><dl>${
  figure('booksArea.customerOwed',owed,null,['/app/books/invoices?state=unpaid','booksHome.srcUnpaid'])}${
  figure('booksArea.supplierOwed',o.supplierOwed.owed===null?missing(o.supplierOwed.state,supplierHref):amountOf(o.supplierOwed.owed),null,[supplierHref,'booksArea.supplierDetails'])}</dl></section>`;
 const profit=`<section class="ba-group" aria-labelledby="ba-profit"><h2 id="ba-profit">${text('booksHome.profit')}</h2><dl>${
  figure('booksArea.profit',amountOf(o.profit.amount),span(o.profit.from,o.profit.to),['/app/books/reports/profit','booksArea.profitDetails'],`<p class="ba-period ba-note">${text('booksHome.notCash')}</p>`,text('booksHome.notCash'))}</dl></section>`;
 // The tester's pass (2026-11-26): "not cash received" is the figure's hover and a reader's line; in sight it is said once,
 // in the figure's basis under "How these figures are worked out" (booksArea.profitBasis), which a finger opens.
 // The basis of each figure, word for word as before (t1r, 2026-11-18): kept, behind one disclosure.
 const basis:readonly [MessageKey,string][]=[
  ['booksArea.cashToday',text('booksArea.cashTodayBasis',{date:asOf})+(o.cashToday.defaulted?` ${text('booksArea.ownAccounts')}`:'')],
  ['booksArea.received',text('booksArea.cashBasis',{from,to})],['booksArea.paidOut',text('booksArea.cashBasis',{from,to})],
  ['booksArea.customerOwed',text('booksArea.owedBasis',{date:asOf})],['booksArea.supplierOwed',text('booksArea.supplierBasis',{date:asOf})],
  ['booksArea.profit',text('booksArea.profitBasis',{from:profitFrom,to:profitTo})+(o.profit.basis==='calendar'?` ${text('booksArea.calendarBasis')}`:'')]];
 const how=`<details class="ba-how"><summary>${text('booksHome.how')}</summary><dl>${basis.map(([k,b])=>`<div><dt>${text(k)}</dt><dd>${b}</dd></div>`).join('')}</dl></details>`;
 return `<div class="ba-overview"><h1 class="page">${text('books.home.title')}</h1>${viewer.kind==='accountant'?`<p class="lede">${text('books.home.accountant')}</p>`:''}<p class="muted ba-asof">${text('booksArea.asOf',{date:asOf})}</p>${needs.some(([n])=>n>0)?`<section class="ba-work" aria-labelledby="ba-waiting"><div class="ba-work-head"><h2 id="ba-waiting">${text('booksArea.needsYou')}</h2></div><ul class="ba-waiting">${needs.filter(([n])=>n>0).map(([n,href,key])=>`<li><a href="${href}">${text(key)}<span class="pill warn">${show.count(locale,n)}</span></a></li>`).join('')}</ul></section>`:''}${actions}${setupNotice}<div class="ba-sum">${cash}${owedGroup}${profit}</div>${how}${booksScope(locale,accounts,scope)}<section><h2>${text('booksArea.recent')}</h2>${recent.length?`<ul class="rows">${recent.slice(0,5).map(r=>`<li class="row"><a href="/app/books/advanced/entries/${esc(r.id)}"><bdi>${esc(r.label)}</bdi><span class="caption muted"> · <bdi>${esc(booksDay(locale,r.date))}</bdi></span></a><span class="pill ${r.state==='posted'?'ok':''}">${text(r.state==='posted'?'booksArea.saved':r.state==='draft'?'booksArea.draft':'booksArea.paper.set_aside')}</span></li>`).join('')}</ul>`:`<p>${text('booksArea.noActivity')}</p>`}</section>${viewer.isOwner?`<p class="caption"><a href="/app/settings/books/connections">${text('booksArea.settingsMoved')}</a></p>`:''}</div>${viewer.isOwner?BOOKS_LEGACY_HASH:''}`;
}

/** Known bookmark fragments from the former all-in-one Books home. No arbitrary URL is accepted. */
const BOOKS_LEGACY_HASH=String.raw`<script>(function(){var h=location.hash;var paths={workbook:'/app/settings/books/connections',sheets:'/app/settings/books/connections',odoo:'/app/settings/books/connections',xero:'/app/settings/books/connections',quickbooks:'/app/settings/books/connections',accounts:'/app/settings/books/accounts',chart:'/app/settings/books/accounts','tax-start':'/app/settings/books/country','morocco-start':'/app/settings/books/starting-balances'};var key=h.slice(1);if(Object.prototype.hasOwnProperty.call(paths,key))location.replace(paths[key]+location.search+h);})();</script>`;
