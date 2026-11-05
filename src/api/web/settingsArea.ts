import type {Locale} from '../../core/owner/i18n/locale.js';
import type {MessageKey} from '../../core/owner/i18n/messages.js';
import type {Viewer} from '../../core/conversation/people.js';
import {esc} from './layout.js';
import {GO} from './icons.js';
import {t,booksShown,viewerRole,exportSettingsShown} from './say.js';
import {flashBanner,type Flash} from './flash.js';
import {settingsGroup,settingsHref,type SettingsGroup} from './settingsNavigation.js';
const groups:readonly SettingsGroup[]=['business','channels','assistant','books','team','billing','personal'];
const label=(g:SettingsGroup):MessageKey=>`settingsArea.${g}`;
const shown=(v:Viewer):readonly SettingsGroup[]=>viewerRole()==='accountant'?['personal']:groups.filter(g=>(g!=='books'||booksShown())&&(!['team','billing'].includes(g)||v.isOwner));
const item=(href:string,title:string,description=''):string=>`<li><a href="${esc(href)}"><span>${esc(title)}${description?`<span class="sa-description">${esc(description)}</span>`:''}</span>${GO}</a></li>`;
export function settingsArea(body:string,locale:Locale,path:string,viewer:Viewer):string {
 const current=settingsGroup(path),allowed=shown(viewer);
 const links=allowed.map(g=>`<a href="/app/settings/${g}${viewerRole()==='accountant'?'/account':''}"${g===current?' aria-current="page"':''}>${esc(t(locale,label(g)))}</a>`).join('');
 const index=viewerRole()==='accountant'?`<a class="sa-index" href="/app/books">${esc(t(locale,'nav.books'))}</a>`:`<a class="sa-index" href="/app/settings">${esc(t(locale,'settingsArea.back'))}</a>`;
 return `<div class="settings-area"><nav class="sa-nav" aria-label="${esc(t(locale,'nav.settings'))}">${index}${links}</nav><details class="area-chooser sa-chooser"><summary>${esc(t(locale,current?label(current):'nav.settings'))}${GO}</summary><nav>${index}${links}</nav></details><div class="sa-content">${body}</div></div>`;
}
export function renderSettingsIndex(locale:Locale,flash:Flash|null,viewer:Viewer):string {
 return `<h1 class="page">${esc(t(locale,'nav.settings'))}</h1>${flashBanner(flash)}<p class="lede">${esc(t(locale,'settingsArea.intro'))}</p><ul class="sa-index-list">${shown(viewer).map(g=>item('/app/settings/'+g,t(locale,label(g)),t(locale,`settingsArea.${g}Hint`))).join('')}</ul><form method="post" action="/logout" class="sa-logout"><button class="btn" type="submit">${esc(t(locale,'header.logout'))}</button></form>`;
}
export const SETTINGS_PAGES:Readonly<Partial<Record<SettingsGroup,readonly [string,MessageKey][]>>>={
 business:[['profile','settingsArea.profile'],['selling','settingsArea.selling'],['hours','settingsArea.hours'],['terms','settingsArea.terms'],['currency','settingsArea.currency'],['samples','settingsArea.samples'],['data','settingsArea.data']],
 assistant:[['','settingsArea.permissions'],['name','settingsArea.identity'],['promises','settingsArea.promises'],['ready','settingsArea.ready'],['words','settingsArea.words'],['history-policy','settingsArea.historyPolicy']],
 personal:[['account','settingsArea.account'],['notifications','settingsArea.notifications'],['language','settingsArea.language'],['advisor-history','settingsArea.history']],
 books:[['','booksArea.setup'],['connections','booksArea.connections'],['accounts','booksArea.accounts'],['starting-balances','booksArea.opening'],['tax','booksArea.taxDetails'],['fields','booksArea.fields']],
};
export function settingsPageLinks(locale:Locale,group:SettingsGroup,path:string,viewer:Viewer):string {
 const pages=SETTINGS_PAGES[group];if(!pages)return '';
 const current=settingsHref(path).split(/[?#]/)[0]!;
 const isCurrent=(key:string):boolean=>{const href='/app/settings/'+group+(key?'/'+key:'');return current===href||(key!==''&&current.startsWith(href+'/'));};
 if((group==='business'||group==='personal')&&current==='/app/settings/'+group)return '';
 const allowed=pages.filter(([key])=>!['terms','samples'].includes(key)||exportSettingsShown()).filter(([key])=>viewerRole()==='accountant'?['account','language'].includes(key):viewer.isOwner||!['data','history-policy'].includes(key));
 const links=allowed.map(([key,title])=>{const href='/app/settings/'+group+(key?'/'+key:'');return `<a href="${href}"${isCurrent(key)?' aria-current="page"':''}>${esc(t(locale,title))}</a>`;}).join('');
 const selected=allowed.find(([key])=>isCurrent(key));
 return `<nav class="sa-pages" aria-label="${esc(t(locale,label(group)))}">${links}</nav><details class="area-chooser sa-page-chooser"><summary>${esc(t(locale,selected?.[1]??label(group)))}${GO}</summary><nav aria-label="${esc(t(locale,label(group)))}">${links}</nav></details>`;
}
export function renderSettingsGroup(locale:Locale,group:'business'|'personal',viewer:Viewer,flash:Flash|null):string {
 return `<h1 class="page">${esc(t(locale,label(group)))}</h1>${flashBanner(flash)}<p class="lede">${esc(t(locale,`settingsArea.${group}Hint`))}</p><ul class="sa-index-list">${SETTINGS_PAGES[group]!.filter(([key])=>(!['terms','samples'].includes(key)||exportSettingsShown())&&(key!=='data'||viewer.isOwner)).map(([key,title])=>item('/app/settings/'+group+'/'+key,t(locale,title))).join('')}</ul>`;
}
