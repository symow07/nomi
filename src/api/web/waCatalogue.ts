import type { Locale } from '../../core/owner/i18n/locale.js';
import type { CatalogueRow,CatalogueReview } from '../../db/waCatalogue.js';
import type { Flash } from './flash.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import { esc } from './layout.js';
import { t } from './say.js';
import { flashBanner } from './flash.js';
import { moneyFromRow } from '../../core/types/money.js';
import * as show from './values.js';
import { WA_CATALOGUE_EN } from '../../core/owner/i18n/waCatalogue.js';
const words=(locale:Locale,key:MessageKey)=>`<bdi lang="en" dir="ltr" class="wc-words">${esc(t(locale,key))}</bdi>`;
/** Each line its own field: the app's form reader keeps one value per name, so one shared name lost every tick but the last. */
export const LINE='line:';
/** The value a ticked box posts: the form draws it on every box, and only this value counts as a tick. */
export const TICKED='on';
/** An English sentence of this area, its {n} a whole number (isolated, as every figure is, on a right-to-left page). */
const ENGLISH=Object.values(WA_CATALOGUE_EN).map(v=>new RegExp('^'+v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace('\\{n\\}','\\u2068?[0-9]+\\u2069?')+'$'));
const banner=(f:Flash|null)=>f?flashBanner(f).replace(esc(f.text),ENGLISH.some(v=>v.test(f.text))
  ?`<bdi lang="en" dir="ltr" class="wc-words">${esc(f.text)}</bdi>`:`<bdi dir="auto">${esc(f.text)}</bdi>`):'';
const errorWords=(locale:Locale,error:string):string=>{
  const key=({image_expired:'waCatalog.imageExpired',changed:'waCatalog.flash.changed',unknown:'waCatalog.unknown',
    not_accepted:'waCatalog.itemRefused',not_ingested:'waCatalog.flash.failed',connection:'waCatalog.flash.connection',
    too_large:'waCatalog.flash.tooLarge',empty:'waCatalog.flash.empty'} as Record<string,MessageKey>)[error];
  return key?words(locale,key):`${words(locale,'waCatalog.metaSaid')}: <bdi dir="auto">${esc(error)}</bdi>`;
};
const field=(locale:Locale,key:MessageKey,name:string,value:string,max:number,type='text')=>`<label class="pq">${words(locale,key)}<input type="${type}" name="${name}" value="${esc(value)}" maxlength="${max}" dir="auto"></label>`;
const price=(locale:Locale,p:CatalogueRow)=>{const m=p.amount===null?null:moneyFromRow(p.amount,p.currency);return m?show.money(locale,m):'';};
const reasons=(locale:Locale,p:CatalogueRow)=>p.reasons.map(r=>`<li>${words(locale,`waCatalog.reason.${r}` as MessageKey)}</li>`).join('');
const status=(p:CatalogueRow):MessageKey=>p.state==='pending'?'waCatalog.pending':p.state==='unknown'?'waCatalog.unknown':
  p.acceptedFingerprint&&p.reasons.length?'waCatalog.removal':p.acceptedFingerprint&&(p.fingerprint!==p.acceptedFingerprint||p.state!=='synced')?'waCatalog.changed':
    p.state==='synced'?'waCatalog.synced':p.state==='error'?'waCatalog.error':p.state==='removed'?'waCatalog.removed':p.reasons.length?'waCatalog.notPushed':'waCatalog.ready';
export function renderCatalogue(locale:Locale,rows:CatalogueRow[],owner:boolean,practice:boolean,flash:Flash|null,latest?:string):string {
  const editable=owner&&!practice;
  return `<div class="wa-catalogue"><h1 class="page">${words(locale,'waCatalog.title')}</h1>${banner(flash)}
    <p>${words(locale,'waCatalog.intro')}</p>${practice?`<p>${words(locale,'waCatalog.practice')}</p>`:owner?'':`<p>${words(locale,'waCatalog.staff')}</p>`}
    ${editable?`<form method="post" action="/app/products/whatsapp/preview"><button class="btn send" type="submit">${words(locale,'waCatalog.update')}</button></form>`:''}
    ${latest?`<p><a href="/app/products/whatsapp/review/${esc(latest)}">${words(locale,'waCatalog.latest')}</a></p>`:''}
    ${!rows.length?`<p class="pa-empty">${words(locale,'waCatalog.empty')}</p>`:rows.map(p=>`<section class="wc-item"><h2><bdi>${esc(p.name)}</bdi></h2>
      <p>${price(locale,p)}</p><p>${words(locale,status(p))}</p>${p.reasons.length?`<ul>${reasons(locale,p)}</ul>`:''}
      ${p.error?`<p>${errorWords(locale,p.error)}</p>`:''}
      <p><a href="/app/products/${esc(p.id)}">${words(locale,'waCatalog.product')}</a></p>
      ${editable?`<details><summary>${words(locale,'waCatalog.details')}</summary><form class="wc-form" method="post" action="/app/products/${esc(p.id)}/whatsapp">
        <label class="pq">${words(locale,'waCatalog.description')}<textarea name="description" rows="3" maxlength="5000" dir="auto">${esc(p.description)}</textarea></label>
        ${field(locale,'waCatalog.link','link',p.link,2000,'url')}${field(locale,'waCatalog.brand','brand',p.brand,100)}
        <label class="pq">${words(locale,'waCatalog.availability')}<select name="availability" lang="en" dir="ltr">${[
          ['','waCatalog.choose'],['in stock','waCatalog.available'],['out of stock','waCatalog.unavailable'],['available for order','waCatalog.toOrder'],['discontinued','waCatalog.discontinued'],
        ].map(([value,key])=>`<option value="${value}"${p.availability===value?' selected':''}>${esc(t(locale,key as MessageKey))}</option>`).join('')}</select></label>
        <label class="pq">${words(locale,'waCatalog.condition')}<select name="condition" lang="en" dir="ltr">${['new','refurbished','used'].map(value=>`<option value="${value}"${p.condition===value?' selected':''}>${esc(t(locale,`waCatalog.${value}` as MessageKey))}</option>`).join('')}</select></label>
        ${p.photoId?`${p.photoToken?`<img class="pa-thumb" src="/media/${esc(p.photoToken)}" alt="${esc(p.name)}" width="56" height="56">`:''}<label class="wc-check"><input type="checkbox" name="imageId" value="${esc(p.photoId)}"${p.imageId===p.photoId?' checked':''}>${words(locale,'waCatalog.photo')}</label>`:`<p>${words(locale,'waCatalog.photoNeeded')}</p>`}
        <button class="btn" type="submit">${words(locale,'waCatalog.save')}</button></form></details>`:''}</section>`).join('')}</div>`;
}
export function renderCatalogueReview(locale:Locale,review:CatalogueReview,owner:boolean,flash:Flash|null=null):string {
  const preview=review.state==='preview',lines=review.items.filter(i=>preview||i.selected);
  const rows=lines.map(row=>`<div class="wc-review-row">${preview&&owner?`<label class="wc-check"><input type="checkbox" name="${LINE}${esc(row.id)}" value="${TICKED}"><bdi>${esc(row.snapshot.name)}</bdi></label>`:`<h2><bdi>${esc(row.snapshot.name)}</bdi></h2>`}
    <p>${words(locale,row.operation==='CREATE'?'waCatalog.create':row.operation==='UPDATE'?'waCatalog.updateItem':'waCatalog.delete')} · ${price(locale,row.snapshot)}</p>
    ${row.snapshot.reasons.length?`<ul>${reasons(locale,row.snapshot)}</ul>`:''}
    ${row.result==='synced'?`<p>${words(locale,'waCatalog.synced')}</p>`:row.error?`<p>${errorWords(locale,row.error)}</p>`:''}
    ${row.warning?`<p>${words(locale,'waCatalog.metaSaid')}: <bdi dir="auto">${esc(row.warning)}</bdi></p>`:''}</div>`).join('');
  return `<div class="wa-catalogue"><h1 class="page">${words(locale,'waCatalog.review')}</h1>${banner(flash)}
    <p><a href="/app/products/whatsapp">${words(locale,'waCatalog.back')}</a></p>
    ${!lines.length?`<p>${words(locale,'waCatalog.noChanges')}</p>`:preview?`<p>${words(locale,'waCatalog.tick')}</p><p>${words(locale,'waCatalog.photoNotice')}</p>`:
      review.state==='pending'||review.state==='submitting'?`<p>${words(locale,'waCatalog.pending')}</p>`:review.state==='unknown'?`<p>${words(locale,'waCatalog.unknown')}</p>`:''}
    ${preview&&owner&&lines.length?`<form method="post" action="/app/products/whatsapp/review/${esc(review.id)}">${rows}<button class="btn send" type="submit">${words(locale,'waCatalog.confirm')}</button></form>`:rows}
    ${owner&&review.handle&&['pending','unknown'].includes(review.state)?`<form method="post" action="/app/products/whatsapp/batches/${esc(review.id)}/check"><button class="btn" type="submit">${words(locale,'waCatalog.check')}</button></form>`:''}</div>`;
}
