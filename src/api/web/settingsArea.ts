import type {Locale} from '../../core/owner/i18n/locale.js';
import type {MessageKey} from '../../core/owner/i18n/messages.js';
import type {Viewer} from '../../core/conversation/people.js';
import {esc} from './layout.js';
import {GO} from './icons.js';
import {t,viewerRole,exportSettingsShown,booksShown} from './say.js';
import {flashBanner,type Flash} from './flash.js';
import {settingsGroup,settingsHref,type SettingsGroup} from './settingsNavigation.js';
/** The navigation block (the owner's decision, 2026-11-25): Settings keeps only the workspace. The assistant's settings
 * moved to Assistant and the books' to Books; their addresses did not move. */
const groups:readonly SettingsGroup[]=['business','channels','team','billing','personal'];
const label=(g:SettingsGroup):MessageKey=>`settingsArea.${g}`;
const shown=(v:Viewer):readonly SettingsGroup[]=>viewerRole()==='accountant'?['personal']:groups.filter(g=>!['team','billing'].includes(g)||v.isOwner);
const item=(href:string,title:string,description=''):string=>`<li><a href="${esc(href)}"><span>${esc(title)}${description?`<span class="sa-description">${esc(description)}</span>`:''}</span>${GO}</a></li>`;
/** The navigation block (2026-11-25): the section sidebar (sections.ts) is Settings' one menu; this is the page's frame. */
export function settingsArea(body:string,_locale:Locale,_path:string,_viewer:Viewer):string {
 return `<div class="settings-area"><div class="sa-content">${body}</div></div>`;
}
export function renderSettingsIndex(locale:Locale,flash:Flash|null,viewer:Viewer):string {
 return `<h1 class="page">${esc(t(locale,'nav.settings'))}</h1>${flashBanner(flash)}<ul class="sa-index-list">${shown(viewer).map(g=>item('/app/settings/'+g,t(locale,label(g)),t(locale,`settingsArea.${g}Hint`))).join('')}</ul><form method="post" action="/logout" class="sa-logout"><button class="btn" type="submit">${esc(t(locale,'header.logout'))}</button></form>`;
}
export const SETTINGS_PAGES:Readonly<Partial<Record<SettingsGroup,readonly [string,MessageKey][]>>>={
 business:[['profile','settingsArea.profile'],['selling','settingsArea.selling'],['hours','settingsArea.hours'],['terms','settingsArea.terms'],['currency','settingsArea.currency'],['samples','settingsArea.samples'],['data','settingsArea.data']],
 assistant:[['','settingsArea.permissions'],['name','settingsArea.identity'],['promises','settingsArea.promises'],['ready','settingsArea.ready'],['words','settingsArea.words'],['history-policy','settingsArea.historyPolicy']],
 personal:[['account','settingsArea.account'],['notifications','settingsArea.notifications'],['language','settingsArea.language'],['advisor-history','settingsArea.history']],
 books:[['','booksArea.setup'],['country','books.country.nav'],['starting-balances','booksArea.opening'],['accounts','booksArea.accounts'],['tax','booksArea.taxDetails'],['connections','booksArea.connections'],['fields','booksArea.fields']],
};
/** The navigation block: a group's pages are listed in the section sidebar, so the page draws no row of tabs. */
export function settingsPageLinks(_locale:Locale,_group:SettingsGroup,_path:string,_viewer:Viewer):string {
 return '';
}
export function renderSettingsGroup(locale:Locale,group:'business'|'personal',viewer:Viewer,flash:Flash|null):string {
 return `<h1 class="page">${esc(t(locale,label(group)))}</h1>${flashBanner(flash)}<p class="lede">${esc(t(locale,`settingsArea.${group}Hint`))}</p><ul class="sa-index-list">${SETTINGS_PAGES[group]!.filter(([key])=>(!['terms','samples'].includes(key)||exportSettingsShown())&&(key!=='data'||viewer.isOwner)).map(([key,title])=>item('/app/settings/'+group+'/'+key,t(locale,title))).join('')}</ul>`;
}
