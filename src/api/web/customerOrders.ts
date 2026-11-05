import type { Locale } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { ORDER_STATES } from '../../core/commerce/orderState.js';
import type { CustomerOrdersPage } from '../../db/customerOrders.js';
import { customerPager, customerReturnHref } from './customers.js';
import { productName } from './inbox.js';
import { unitLabel } from './products.js';
import { esc } from './layout.js';
import { t } from './say.js';
import * as show from './values.js';

export function renderCustomerOrders(data:CustomerOrdersPage,locale:Locale,now:Date,opts:{readonly customerName?:string;readonly returnHref?:string}={}):string {
 const query=new URLSearchParams();if(data.q)query.set('q',data.q);if(data.clientId)query.set('client',data.clientId);if(data.state)query.set('state',data.state);
 const base='/app/customers/orders'+(query.size?'?'+query:'');
 const source=customerReturnHref(opts.returnHref??base).split('#')[0]!;
 const stateName=(state:string)=>t(locale,`order.state.${state}` as MessageKey);
 const rows=data.rows.map(o=>`<li class="ca-order" id="order-${esc(o.id)}"><div class="ca-order-title"><a href="/app/orders/${encodeURIComponent(o.id)}?from=${encodeURIComponent(source+'#order-'+o.id)}">${esc(show.orderNumber(locale,o.reference))}</a><span>${esc(o.state?stateName(o.state):t(locale,'customers.unknownState'))}</span></div><a class="ca-order-customer" href="/app/customers/${encodeURIComponent(o.clientId)}?from=${encodeURIComponent(source+'#order-'+o.id)}"><bdi>${esc(o.customerName??t(locale,'common.buyer'))}</bdi></a><dl class="ca-order-facts"><div><dt>${esc(t(locale,'customers.product'))}</dt><dd><bdi>${esc(productName(locale,{name:o.productName,nameZh:o.productNameZh})??t(locale,'pcard.unnamedProduct'))}</bdi><span>${esc(show.quantityOf(locale,o.quantity,unitLabel(locale,o.unit)))}</span></dd></div><div><dt>${esc(t(locale,'customers.amount'))}</dt><dd><bdi>${esc(o.total?show.money(locale,o.total):t(locale,'customers.noAmount'))}</bdi></dd></div><div><dt>${esc(t(locale,'customers.created'))}</dt><dd>${esc(show.dateYear(locale,o.createdAt))}</dd></div>${o.stateAt?`<div><dt>${esc(t(locale,'customers.stateAt'))}</dt><dd>${esc(show.when(locale,o.stateAt,now))}</dd></div>`:''}</dl></li>`).join('');
 const pager=customerPager(data,locale,(direction,cursor)=>{const q=new URLSearchParams(query);q.set(direction,cursor);return '/app/customers/orders?'+q;});
 return `<section class="customer-orders"><header class="ca-heading"><h1>${esc(t(locale,'customers.orders'))}</h1><p>${esc(t(locale,'customers.ordersIntro'))}</p>${opts.customerName?`<p><bdi>${esc(opts.customerName)}</bdi></p>`:''}</header><form method="get" action="/app/customers/orders" class="ca-filters"><label class="ca-search">${esc(t(locale,'customers.searchOrders'))}<input type="search" name="q" value="${esc(data.q)}" placeholder="${esc(t(locale,'customers.orderSearchHint'))}"></label>${data.clientId?`<input type="hidden" name="client" value="${esc(data.clientId)}">`:''}<label>${esc(t(locale,'customers.state'))}<select name="state"><option value="">${esc(t(locale,'customers.allStates'))}</option>${['pending_confirmation',...ORDER_STATES].map(state=>`<option value="${state}"${state===data.state?' selected':''}>${esc(stateName(state))}</option>`).join('')}</select></label><button class="btn" type="submit">${esc(t(locale,'customers.show'))}</button>${data.q||data.state||data.clientId?`<a href="/app/customers/orders">${esc(t(locale,'customers.clear'))}</a>`:''}</form>${rows?`<ul class="ca-orders">${rows}</ul>${pager}`:`<p class="ca-empty">${esc(t(locale,'customers.ordersEmpty'))}</p>`}</section>`;
}
