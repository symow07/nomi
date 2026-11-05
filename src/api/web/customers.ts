import { customerReturnHref } from './customerNavigation.js';
export { customerReturnHref } from './customerNavigation.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import type { CustomersPage, CustomerSelection, CustomerPage } from '../../db/customers.js';
import { OWNER_VIEW, type Viewer } from '../../core/conversation/people.js';
import { renderCustomerFile, type CustomerFile } from './conversations.js';
import { renderCustomerCard, customerValueNote } from './customerCard.js';
import { esc, back, conversationUrl } from './layout.js';
import { face } from './faces.js';
import { channelName } from './inbox.js';
import { t, outreachShown, exportSettingsShown } from './say.js';
import * as show from './values.js';
import { flashBanner, type Flash } from './flash.js';

export type CustomerSection = 'all'|'orders'|'outreach'|'labels'|'feedback'|'samples';
const sections:readonly [CustomerSection,string,MessageKey][] = [
 ['all','/app/customers','customers.all'], ['orders','/app/customers/orders','customers.orders'],
 ['samples','/app/customers/samples','settingsArea.sampleRequests'],
 ['outreach','/app/customers/outreach','customers.followups'], ['labels','/app/customers/labels','customers.labels'], ['feedback','/app/customers/feedback','customers.feedback'],
];
export function customerArea(body:string,locale:Locale,current:CustomerSection):string {
 const visible=sections.filter(([key])=>(key!=='outreach'||outreachShown())&&(key!=='samples'||exportSettingsShown()));
 const links=visible.map(([key,href,label])=>`<a href="${href}"${key===current?' aria-current="page"':''}>${esc(t(locale,label))}</a>`).join('');
 const selected=visible.find(([key])=>key===current)??visible[0]!;
 return `<div class="customer-area"><nav class="ca-nav" aria-label="${esc(t(locale,'nav.sections'))}">${links}</nav><details class="area-chooser ca-chooser"><summary>${esc(t(locale,selected[2]))}</summary><nav aria-label="${esc(t(locale,'nav.sections'))}">${links}</nav></details>${body}</div>`;
}
export function customerPager(page:CustomerPage<unknown>,locale:Locale,href:(direction:'after'|'before',cursor:string)=>string):string {
 return `<nav class="ca-pager" aria-label="${esc(t(locale,'customers.pages'))}">${page.prev?`<a href="${esc(href('before',page.prev))}">${esc(t(locale,'customers.previous'))}</a>`:'<span></span>'}<span>${esc(t(locale,'customers.range',{from:show.count(locale,page.from),to:show.count(locale,page.to),total:show.count(locale,page.total)}))}</span>${page.next?`<a href="${esc(href('after',page.next))}">${esc(t(locale,'customers.next'))}</a>`:'<span></span>'}</nav>`;
}
export function renderCustomers(data:CustomersPage,locale:Locale,now:Date,opts:{readonly labels?:readonly {readonly id:string;readonly name:string}[];readonly returnHref?:string}={}):string {
 const query=new URLSearchParams();if(data.q)query.set('q',data.q);if(data.label)query.set('label',data.label);
 const base='/app/customers'+(query.size?`?${query}`:'');const source=customerReturnHref(opts.returnHref??base).split('#')[0]!;
 const labels=opts.labels??[];
 const labelField=labels.length?`<label>${esc(t(locale,'customers.labels'))}<select name="label"><option value="">${esc(t(locale,'customers.allLabels'))}</option>${data.label&&!labels.some(l=>l.id===data.label)?`<option value="${esc(data.label)}" selected>${esc(t(locale,'customers.labels'))}</option>`:''}${labels.map(l=>`<option value="${esc(l.id)}"${l.id===data.label?' selected':''}>${esc(l.name)}</option>`).join('')}</select></label>`:data.label?`<input type="hidden" name="label" value="${esc(data.label)}">`:'';
 const rows=data.rows.map(c=>{
  const href=`/app/customers/${encodeURIComponent(c.clientId)}?from=${encodeURIComponent(source+'#customer-'+c.clientId)}`;
  return `<li id="customer-${esc(c.clientId)}" class="ca-customer"><a class="ca-person" href="${esc(href)}">${face({clientId:c.clientId,name:c.name,photo:c.photo},'m')}<span><bdi class="ca-name">${esc(c.name??t(locale,'common.buyer'))}</bdi><span class="ca-contact"><bdi>${esc(c.channels.map(ch=>channelName(locale,ch)).join(' · ')||c.email||c.phone||t(locale,'customers.noContact'))}</bdi></span></span></a><div class="ca-person-state">${c.waiting?`<span class="ca-wait">${esc(t(locale,'inbox.filter.pending'))}</span>`:''}${c.labels.map(l=>`<a class="ca-label" href="/app/customers?label=${encodeURIComponent(l.id)}">${esc(l.name)}</a>`).join('')}</div><dl class="ca-row-facts"><div><dt>${esc(t(locale,'customers.orderValue'))}</dt><dd><bdi>${esc(c.value.spent?show.money(locale,c.value.spent):t(locale,c.value.orders?'customers.noAmount':'customers.noOrders'))}</bdi></dd></div><div><dt>${esc(t(locale,'customers.standingOrders'))}</dt><dd>${esc(show.count(locale,c.value.orders))}</dd></div><div><dt>${esc(t(locale,'customers.lastContact'))}</dt><dd>${esc(c.lastContactAt?show.when(locale,c.lastContactAt,now):t(locale,'customers.noContact'))}</dd></div></dl>${customerValueNote(c.value,locale)}</li>`;
 }).join('');
 const pager=customerPager(data,locale,(direction,cursor)=>{const q=new URLSearchParams(query);q.set(direction,cursor);return '/app/customers?'+q;});
 return `<section class="customers-page"><header class="ca-heading"><h1>${esc(t(locale,'customers.all'))}</h1><p>${esc(t(locale,'customers.intro'))}</p></header><form method="get" action="/app/customers" class="ca-filters"><label class="ca-search">${esc(t(locale,'customers.search'))}<input type="search" name="q" value="${esc(data.q)}" placeholder="${esc(t(locale,'customers.searchHint'))}"></label>${labelField}<button class="btn" type="submit">${esc(t(locale,'customers.show'))}</button>${data.q||data.label?`<a href="/app/customers">${esc(t(locale,'customers.clear'))}</a>`:''}</form>${rows?`<p class="ca-basis">${esc(t(locale,'customers.valueBasis'))}</p><ul class="ca-customers">${rows}</ul>${pager}`:`<div class="ca-empty"><h2>${esc(t(locale,data.q||data.label?'customers.noMatch':'customers.empty'))}</h2><p>${esc(t(locale,'customers.emptyHelp'))}</p>${!data.q&&!data.label?`<a href="/app/get-started">${esc(t(locale,'customers.emptyAction'))}</a>`:''}</div>`}</section>`;
}
export function renderCustomerRecord(selection:CustomerSelection,file:CustomerFile|null,locale:Locale,now:Date,viewer:Viewer=OWNER_VIEW,opts:{readonly returnHref?:string;readonly flash?:Flash|null;readonly openedFrom?:string|null}={}):string {
 const card=selection.card;const record='/app/customers/'+encodeURIComponent(card.clientId);
 const selected=selection.conversationId;const valid=file&&file.conversationId===selected&&file.customer?.clientId===card.clientId?file:null;
 const recordQuery=new URLSearchParams();if(selected)recordQuery.set('conversation',selected);if(opts.returnHref)recordQuery.set('from',customerReturnHref(opts.returnHref));
 const recordUrl=record+(recordQuery.size?'?'+recordQuery:'');
 const conversations=selection.conversations.rows.map(c=>`<li${c.id===selected?' class="is-current"':''}><div><a href="${esc(record+'?conversation='+encodeURIComponent(c.id)+(opts.returnHref?'&from='+encodeURIComponent(customerReturnHref(opts.returnHref)):''))}"${c.id===selected?' aria-current="page"':''}><bdi>${esc(channelName(locale,c.channel))}</bdi></a><span>${esc(t(locale,c.active?'customers.active':'customers.closed'))}</span>${c.waiting?`<span class="ca-wait">${esc(t(locale,'inbox.filter.pending'))}</span>`:''}</div><p>${esc(c.lastContactAt?show.when(locale,c.lastContactAt,now):t(locale,'customers.noContact'))}</p><a href="${conversationUrl(c.id)}">${esc(t(locale,'customers.openConversation'))}</a></li>`).join('');
 const pager=customerPager(selection.conversations,locale,(direction,cursor)=>record+'?'+new URLSearchParams({...(selected?{conversation:selected}:{}),[direction]:cursor,...(opts.returnHref?{from:customerReturnHref(opts.returnHref)}:{})}));
 return `<div class="customer-record"><div class="dhead">${back(opts.returnHref?customerReturnHref(opts.returnHref):opts.openedFrom?conversationUrl(opts.openedFrom):'/app/customers',t(locale,opts.openedFrom&&!opts.returnHref?'pcard.back':'customers.back'))}</div>${flashBanner(opts.flash??null)}${renderCustomerCard({...card,conversationId:selected},locale,now,opts.openedFrom??null,{fullRecordHref:recordUrl,overview:true})}<a class="ca-orders-door" href="/app/customers/orders?client=${encodeURIComponent(card.clientId)}">${esc(t(locale,'customers.customerOrders'))}</a><section class="ca-conversations"><h2>${esc(t(locale,'customers.conversations'))}</h2>${conversations?`<ul>${conversations}</ul>${pager}`:`<p>${esc(t(locale,'customers.noConversations'))}</p><p class="muted">${esc(t(locale,'customers.noConversationsHelp'))}</p>`}</section>${selected?`<section class="ca-selected"><h2>${esc(t(locale,'customers.thisConversation'))}</h2><p class="ca-scope">${esc(t(locale,'customers.scope'))}</p><p class="ca-scope">${esc(t(locale,'customers.recentHistory'))}</p>${valid?renderCustomerFile(valid,locale,now,null,viewer,{embedded:true,...(opts.returnHref?{returnHref:opts.returnHref}:{})}):`<p>${esc(t(locale,'customers.recordUnavailable'))}</p>`}</section>`:''}</div>`;
}
