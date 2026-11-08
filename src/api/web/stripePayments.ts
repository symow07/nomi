import {esc} from './layout.js';
import {t} from './say.js';
import {flashBanner,type Flash} from './flash.js';
import type {Locale} from '../../core/owner/i18n/locale.js';
import type {MessageKey} from '../../core/owner/i18n/messages.js';
import {PAYMENT_LINKS_EN} from '../../core/owner/i18n/paymentLinks.js';
import type {StripePage} from '../../db/stripePage.js';
import {decimal,subDecimal,compareDecimal} from '../../core/types/decimal.js';
import {moneyFromRow} from '../../core/types/money.js';
import * as show from './values.js';

const BASE='/app/payments/stripe';
const text=(locale:Locale,key:keyof typeof PAYMENT_LINKS_EN)=>`<bdi lang="en" dir="ltr">${esc(t(locale,key))}</bdi>`;
const value=(v:string)=>`<bdi dir="auto">${esc(v)}</bdi>`;
const money=(locale:Locale,n:string,c:string)=>{const m=moneyFromRow(n,c);return value(m?show.money(locale,m):`${n} ${c}`);};
export function paymentReason(locale:Locale,reason:string):string{
  const key=`paymentLinks.reason.${reason}`;return t(locale,(key in PAYMENT_LINKS_EN?key:'paymentLinks.reason.other') as MessageKey);
}
const reason=(locale:Locale,r:string)=>`<p class="muted"><bdi lang="en" dir="ltr">${esc(paymentReason(locale,r))}</bdi></p>`;
const form=(action:string,label:string,fields='',main=false)=>`<form method="post" action="${esc(action)}" class="pform">${fields}<button class="btn${main?' send':''}" type="submit">${label}</button></form>`;
const select=(locale:Locale,name:string,label:keyof typeof PAYMENT_LINKS_EN,rows:readonly{id:string;code:string;name:string}[])=>`<label class="pq">${text(locale,label)}<select name="${name}" dir="auto"><option value="" selected>${esc(t(locale,'paymentLinks.choose'))}</option>${rows.map(r=>`<option value="${esc(r.id)}" dir="auto">${esc(show.isolate(locale,`${r.code} · ${r.name}`))}</option>`).join('')}</select></label>`;

export function renderInvoicePaymentDoor(id:string,locale:Locale,owner:boolean,issued:boolean,enabled:boolean):string{
  if(!owner||!issued||!enabled)return '';
  return `<section class="block" id="payment-link"><h2>${text(locale,'paymentLinks.title')}</h2><p>${text(locale,'paymentLinks.invoiceHint')}</p>${form(`${BASE}/invoices/${id}/create`,text(locale,'paymentLinks.make'))}${form(`${BASE}/invoices/${id}/send`,text(locale,'paymentLinks.send'))}<p><a class="deeper" href="${BASE}">${text(locale,'paymentLinks.title')}</a></p></section>`;
}
export function renderStripePayments(d:StripePage,locale:Locale,flash:Flash|null):string{
  const head=`<div class="stripe-payments"><h1 class="page">${text(locale,'paymentLinks.title')}</h1>${flashBanner(flash?{...flash,text:`\u2066${flash.text}\u2069`}:null)}<p class="lede">${text(locale,'paymentLinks.lede')}</p>`;
  const unavailable=d.country==='MA'||!['GB','US'].includes(d.country??'')?'paymentLinks.country':d.practice?'paymentLinks.practice':!d.configured?'paymentLinks.unavailable':null;
  if(unavailable)return `${head}<p>${text(locale,unavailable)}</p></div>`;
  const mode=`<p class="caption">${text(locale,d.live?'paymentLinks.live':'paymentLinks.test')}</p><p>${text(locale,'paymentLinks.limited')}</p>`;
  const c=d.connection;
  const connect=d.deauthorization?`<section class="block"><h2>${text(locale,'paymentLinks.disconnectPending')}</h2><p>${text(locale,'paymentLinks.reason.deauthorization_pending')}</p><p>${value(d.deauthorization.account)}</p>${form(`${BASE}/disconnect`,text(locale,'paymentLinks.disconnectRetry'),'',true)}</section>`:!c?form(`${BASE}/connect`,text(locale,'paymentLinks.connect'),'',true):`<section class="block"><h2>${text(locale,'paymentLinks.connected')}</h2><p>${value(c.account)} · ${value(c.currency)}</p>${c.ready?'':`<p>${text(locale,'paymentLinks.notReady')}</p>`}<details><summary>${text(locale,'paymentLinks.disconnect')}</summary><p>${text(locale,'paymentLinks.disconnectHint')}</p>${form(`${BASE}/disconnect`,text(locale,'paymentLinks.disconnect'))}</details></section>`;
  const accounts=!c?'':`<section class="block"><h2>${text(locale,'paymentLinks.accounts')}</h2><p>${text(locale,'paymentLinks.accountsHint')}</p>${d.mapping?`<p>${text(locale,'paymentLinks.mappingKept')}</p><dl>${(['clearingId','transitId','feeId','bankId','journalId'] as const).map(k=>{const a=[...d.accounts,...d.banks,...d.journals].find(a=>a.id===d.mapping![k]);return `<dt>${text(locale,`paymentLinks.${{clearingId:'clearing',transitId:'transit',feeId:'fee',bankId:'bank',journalId:'journal'}[k]}` as keyof typeof PAYMENT_LINKS_EN)}</dt><dd>${value(a?`${a.code} · ${a.name}`:'—')}</dd>`;}).join('')}</dl>`:
    form(`${BASE}/accounts`,text(locale,'paymentLinks.save'),select(locale,'clearingId','paymentLinks.clearing',d.accounts.filter(a=>a.kind==='asset'&&!d.banks.some(b=>b.id===a.id)))+select(locale,'transitId','paymentLinks.transit',d.accounts.filter(a=>a.kind==='asset'&&!d.banks.some(b=>b.id===a.id)))+select(locale,'feeId','paymentLinks.fee',d.accounts.filter(a=>a.kind==='expense'))+select(locale,'journalId','paymentLinks.journal',d.journals)+select(locale,'bankId','paymentLinks.bank',d.banks),true)}<p><a class="deeper" href="/app/settings/books/country">${text(locale,'paymentLinks.chart')}</a></p></section>`;
  const links=`<section class="block"><h2>${text(locale,'paymentLinks.links')}</h2>${d.attempts.length?d.attempts.map(a=>`<article class="block"><p><a class="deeper" href="/app/books/invoices/${esc(a.invoiceId)}">${value(a.key)}</a> · ${money(locale,a.amount,a.currency)}</p><p>${text(locale,`paymentLinks.state.${a.state}` in PAYMENT_LINKS_EN?`paymentLinks.state.${a.state}` as keyof typeof PAYMENT_LINKS_EN:'paymentLinks.state.pending')}</p>${a.reason?reason(locale,a.reason):''}${['creating','open'].includes(a.state)&&c?form(`${BASE}/attempts/${a.id}/expire`,text(locale,'paymentLinks.expire')):''}</article>`).join(''):`<p>${text(locale,'paymentLinks.none')}</p>`}<p><a class="deeper" href="/app/books/invoices">${text(locale,'paymentLinks.invoices')}</a></p></section>`;
  const records=`<section class="block"><h2>${text(locale,'paymentLinks.records')}</h2>${d.movements.length?d.movements.map(m=>`<article class="block"><p>${text(locale,`paymentLinks.kind.${m.kind}` in PAYMENT_LINKS_EN?`paymentLinks.kind.${m.kind}` as keyof typeof PAYMENT_LINKS_EN:'paymentLinks.kind.payment')} · ${money(locale,m.amount,m.currency)}</p><p>${value(m.date)} · ${value(m.providerId)}</p>${m.reason?reason(locale,m.reason):''}${m.entryId?`<p><a class="deeper" href="/app/books/advanced/entries/${esc(m.entryId)}">${text(locale,'paymentLinks.entry')}</a></p>`:''}</article>`).join(''):`<p>${text(locale,'paymentLinks.noRecords')}</p>`}</section>`;
  const payouts=`<section class="block"><h2>${text(locale,'paymentLinks.payouts')}</h2>${d.payouts.length?d.payouts.map(p=>{
    const other=p.nomiAmount?subDecimal(decimal(p.amount),decimal(p.nomiAmount)):null;
    const statements=d.statements.filter(s=>s.currency===p.currency&&compareDecimal(decimal(s.amount),decimal(p.amount))===0);
    return `<article class="block"><h3>${value(p.id)}</h3><p>${money(locale,p.amount,p.currency)} · ${value(p.date)}</p><p>${text(locale,p.status==='paid'?'paymentLinks.payoutState.paid':`paymentLinks.state.${p.status}` in PAYMENT_LINKS_EN?`paymentLinks.state.${p.status}` as keyof typeof PAYMENT_LINKS_EN:'paymentLinks.state.pending')}</p>${p.reason?reason(locale,p.reason):''}${p.reversalId?`<p>${text(locale,'paymentLinks.payoutReturned')} · ${value(p.failureDate??'—')}</p><p><a class="deeper" href="/app/books/advanced/entries/${esc(p.reversalId)}">${text(locale,'paymentLinks.entry')}</a></p>`:''}${other&&compareDecimal(other,decimal('0'))>0?`<p>${money(locale,other,p.currency)} — ${text(locale,'paymentLinks.other')}</p><p>${text(locale,'paymentLinks.mixed')}</p>`:''}
      ${!p.entryId&&c&&['paid','in_transit'].includes(p.status)?form(`${BASE}/payouts/${encodeURIComponent(p.id)}/confirm`,text(locale,'paymentLinks.confirm'),`<label class="pq">${text(locale,'paymentLinks.nomiAmount')}<input name="amount" type="text" inputmode="decimal" dir="ltr"></label>`):''}
      ${p.receiptId?`<p>${text(locale,'paymentLinks.received')}</p>`:p.entryId&&p.status==='paid'&&other==='0'&&c&&statements.length?form(`${BASE}/payouts/${encodeURIComponent(p.id)}/receive`,text(locale,'paymentLinks.match'),`<label class="pq">${text(locale,'paymentLinks.bankReceipt')}<select name="statement" dir="ltr"><option value="" selected>${esc(t(locale,'paymentLinks.choose'))}</option>${statements.map(s=>`<option value="${esc(s.id)}" dir="ltr">${esc(show.isolate(locale,`${s.date} · ${s.amount} ${s.currency}`))}</option>`).join('')}</select></label>`):''}
      <p><a class="deeper" href="/app/books/bank">${text(locale,'paymentLinks.bankDoor')}</a></p></article>`;
  }).join(''):`<p>${text(locale,'paymentLinks.noPayouts')}</p>`}</section>`;
  const outstanding=d.events.length?`<section class="block"><h2>${text(locale,'paymentLinks.outstanding')}</h2>${d.events.map(e=>`${reason(locale,e.reason??'processing')}`).join('')}${c?form(`${BASE}/retry`,text(locale,'paymentLinks.retry')):''}</section>`:'';
  return head+mode+connect+accounts+links+records+payouts+outstanding+'</div>';
}
