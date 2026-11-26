import { customerReturnHref } from './customerNavigation.js';
export { customerReturnHref } from './customerNavigation.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import type { CustomersPage, CustomerSelection, CustomerPage } from '../../db/customers.js';
import { OWNER_VIEW, type Viewer } from '../../core/conversation/people.js';
import { renderCustomerFile, type CustomerFile } from './conversations.js';
import { renderCustomerCard, customerValueNote } from './customerCard.js';
import { esc, back, conversationUrl } from './layout.js';
import { filterBar } from './filterBar.js';
import { face } from './faces.js';
import { GO } from './icons.js';
import { channelName } from './inbox.js';
import { t } from './say.js';
import * as show from './values.js';
import { flashBanner, type Flash } from './flash.js';
import { stateBlock, stateNext } from './stateBlock.js';

/** The text audit (2026-11-26): a customer with no order shows a dash where the amount would be, read aloud as "No
 * confirmed orders". The count beside it says 0; the sentence was on every row. An order without an amount still says so. */
const NO_VALUE=(locale:Locale):string=>`—<span class="sr">${esc(t(locale,'customers.noOrders'))}</span>`;
export type CustomerSection = 'all'|'orders'|'outreach'|'labels'|'feedback'|'samples';
/** The navigation block (2026-11-25): the section sidebar (sections.ts) is the area's one menu; this is the page's frame. */
export function customerArea(body:string,_locale:Locale,_current:CustomerSection):string {
 return `<div class="customer-area">${body}</div>`;
}
export function customerPager(page:CustomerPage<unknown>,locale:Locale,href:(direction:'after'|'before',cursor:string)=>string,where?:'above'|'below'):string {
 // The text pass (2026-11-26): a list that fits on one page has no pager ("1–7 of 7" said nothing).
 if(!page.prev&&!page.next) return '';
 return `<nav class="ca-pager${where?` ca-pager-${where}`:''}" aria-label="${esc(where?t(locale,where==='above'?'assistantArea.pagesAbove':'assistantArea.pagesBelow'):t(locale,'customers.pages'))}">${page.prev?`<a href="${esc(href('before',page.prev))}">${esc(t(locale,'customers.previous'))}</a>`:'<span></span>'}<span>${esc(t(locale,'customers.range',{from:show.count(locale,page.from),to:show.count(locale,page.to),total:show.count(locale,page.total)}))}</span>${page.next?`<a href="${esc(href('after',page.next))}">${esc(t(locale,'customers.next'))}</a>`:'<span></span>'}</nav>`;
}
export function renderCustomers(data:CustomersPage,locale:Locale,now:Date,opts:{readonly labels?:readonly {readonly id:string;readonly name:string}[];readonly returnHref?:string}={}):string {
 const query=new URLSearchParams();if(data.q)query.set('q',data.q);if(data.label)query.set('label',data.label);
 const base='/app/customers'+(query.size?`?${query}`:'');const source=customerReturnHref(opts.returnHref??base).split('#')[0]!;
 const labels=opts.labels??[];
 const labelField=labels.length?[{label:t(locale,'customers.labels'),control:`<select name="label"><option value="">${esc(t(locale,'customers.allLabels'))}</option>${data.label&&!labels.some(l=>l.id===data.label)?`<option value="${esc(data.label)}" selected>${esc(t(locale,'customers.labels'))}</option>`:''}${labels.map(l=>`<option value="${esc(l.id)}"${l.id===data.label?' selected':''}>${esc(l.name)}</option>`).join('')}</select>`}]:[];
 const labelHidden=!labels.length&&data.label?`<input type="hidden" name="label" value="${esc(data.label)}">`:'';
 const rows=data.rows.map(c=>{
  const href=`/app/customers/${encodeURIComponent(c.clientId)}?from=${encodeURIComponent(source+'#customer-'+c.clientId)}`;
  return `<li id="customer-${esc(c.clientId)}" class="ca-customer"><a class="ca-person" href="${esc(href)}">${face({clientId:c.clientId,name:c.name,photo:c.photo},'m')}<span><span class="ca-who"><bdi class="ca-name">${esc(c.name??t(locale,'common.buyer'))}</bdi>${c.waiting?`<span class="ca-wait">${esc(t(locale,'inbox.filter.pending'))}</span>`:''}</span><span class="ca-contact"><bdi>${esc(c.channels.map(ch=>channelName(locale,ch)).join(' · ')||c.email||c.phone||t(locale,'customers.noContact'))}</bdi></span></span></a><div class="ca-person-state">${c.labels.map(l=>`<a class="ca-label" href="/app/customers?label=${encodeURIComponent(l.id)}">${esc(l.name)}</a>`).join('')}</div><dl class="ca-row-facts"><div class="ca-f-value"><dt>${esc(t(locale,'customers.orderValue'))}</dt><dd>${c.value.spent||c.value.orders?`<bdi>${esc(c.value.spent?show.money(locale,c.value.spent):t(locale,'customers.noAmount'))}</bdi>`:NO_VALUE(locale)}</dd></div><div class="ca-f-orders"><dt>${esc(t(locale,'customers.standingOrders'))}</dt><dd>${esc(show.count(locale,c.value.orders))}</dd></div><div class="ca-f-last"><dt>${esc(t(locale,'customers.lastContact'))}</dt><dd>${esc(c.lastContactAt?show.when(locale,c.lastContactAt,now):t(locale,'customers.noContact'))}</dd></div></dl>${customerValueNote(c.value,locale)}</li>`;
 }).join('');
 const pageHref=(direction:'after'|'before',cursor:string)=>{const q=new URLSearchParams(query);q.set(direction,cursor);return '/app/customers?'+q;};
 const pager=customerPager(data,locale,pageHref,'below');
 // UI Block 9 (F09): the columns are named once, above the list; each row keeps its keys (read aloud, and shown on a phone).
 const listHead=`<div class="ca-head" aria-hidden="true"><span>${esc(t(locale,'common.buyer'))}</span><span>${esc(t(locale,'customers.labels'))}</span><span class="num">${esc(t(locale,'customers.orderValue'))}</span><span class="num">${esc(t(locale,'customers.standingOrders'))}</span><span>${esc(t(locale,'customers.lastContact'))}</span></div>`;
 return `<section class="customers-page"><header class="ca-heading"><h1>${esc(t(locale,'customers.all'))}</h1></header>${filterBar({locale,action:'/app/customers',cls:'ca-filters',name:t(locale,'customers.search'),hidden:labelHidden,search:{label:t(locale,'customers.search'),cls:'ca-search',control:`<input type="search" name="q" value="${esc(data.q)}" placeholder="${esc(t(locale,'customers.searchHint'))}">`},fields:labelField,submit:t(locale,'customers.show'),clear:data.q||data.label?{href:'/app/customers',label:t(locale,'customers.clear')}:null,active:labels.length&&data.label?1:0})}${rows?`${customerPager(data,locale,pageHref,'above')}${listHead}<ul class="ca-customers">${rows}</ul>${pager}`:data.q||data.label?stateBlock('nomatch',{heading:t(locale,'state.customers.none.h'),body:t(locale,'state.customers.none.p'),nextHtml:stateNext('/app/customers',t(locale,'state.clearFilters'))}):stateBlock('empty',{heading:t(locale,'state.customers.h'),body:t(locale,'state.customers.p'),nextHtml:stateNext('/app/get-started',t(locale,'state.customers.next'))})}</section>`;
}
export function renderCustomerRecord(selection:CustomerSelection,file:CustomerFile|null,locale:Locale,now:Date,viewer:Viewer=OWNER_VIEW,opts:{readonly returnHref?:string;readonly flash?:Flash|null;readonly openedFrom?:string|null}={}):string {
 const card=selection.card;const record='/app/customers/'+encodeURIComponent(card.clientId);
 const selected=selection.conversationId;const valid=file&&file.conversationId===selected&&file.customer?.clientId===card.clientId?file:null;
 const recordQuery=new URLSearchParams();if(selected)recordQuery.set('conversation',selected);if(opts.returnHref)recordQuery.set('from',customerReturnHref(opts.returnHref));
 const recordUrl=record+(recordQuery.size?'?'+recordQuery:'');
 const conversations=selection.conversations.rows.map(c=>`<li${c.id===selected?' class="is-current"':''}><div><a href="${esc(record+'?conversation='+encodeURIComponent(c.id)+(opts.returnHref?'&from='+encodeURIComponent(customerReturnHref(opts.returnHref)):''))}"${c.id===selected?' aria-current="page"':''}><bdi>${esc(channelName(locale,c.channel))}</bdi></a><span>${esc(t(locale,c.active?'customers.active':'customers.closed'))}</span>${c.waiting?`<span class="ca-wait">${esc(t(locale,'inbox.filter.pending'))}</span>`:''}</div><p>${esc(c.lastContactAt?show.when(locale,c.lastContactAt,now):t(locale,'customers.noContact'))}</p><a href="${conversationUrl(c.id)}">${esc(t(locale,'customers.openConversation'))}</a></li>`).join('');
 const pager=customerPager(selection.conversations,locale,(direction,cursor)=>record+'?'+new URLSearchParams({...(selected?{conversation:selected}:{}),[direction]:cursor,...(opts.returnHref?{from:customerReturnHref(opts.returnHref)}:{})}));
 return `<div class="customer-record"><div class="dhead">${back(opts.returnHref?customerReturnHref(opts.returnHref):opts.openedFrom?conversationUrl(opts.openedFrom):'/app/customers',t(locale,opts.openedFrom&&!opts.returnHref?'pcard.back':'customers.back'))}</div>${flashBanner(opts.flash??null)}${renderCustomerCard({...card,conversationId:selected},locale,now,opts.openedFrom??null,{fullRecordHref:recordUrl,overview:true,stage:selection.stage??null,latestOrder:valid?.context.order??null,replyWaits:valid?.needsOwner??false})}${(valid?.context.order?.count??card.value.orders)>1?`<a class="ca-orders-door" href="/app/customers/orders?client=${encodeURIComponent(card.clientId)}">${esc(t(locale,'customers.customerOrders'))}${GO}</a>`:''}<details class="ca-conversations record-section"><summary>${esc(t(locale,'customers.conversations'))}</summary>${conversations?`<ul>${conversations}</ul>${pager}`:`<p>${esc(t(locale,'customers.noConversations'))}</p><p class="muted">${esc(t(locale,'customers.noConversationsHelp'))}</p>`}</details>${selected?`<section class="ca-selected"><h2>${esc(t(locale,'customers.thisConversation'))}</h2>${valid?renderCustomerFile(valid,locale,now,null,viewer,{embedded:true,needSaid:card.waiting&&selected!==(opts.openedFrom??null),...(opts.returnHref?{returnHref:opts.returnHref}:{})}):`<p>${esc(t(locale,'customers.recordUnavailable'))}</p>`}</section>`:''}</div>`;
}
