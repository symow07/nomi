import type { Locale } from '../../core/owner/i18n/locale.js';
import { capabilityName,languageDisplay,type MessageKey } from '../../core/owner/i18n/messages.js';
import type { AssistantActivityRow } from '../../db/assistantActivity.js';
import type { AssistantPage } from '../../db/assistantKnowledge.js';
import { esc,conversationUrl } from './layout.js';
import { t } from './say.js';
import * as show from './values.js';
export function assistantPager<T>(page:AssistantPage<T>,locale:Locale,href:(n:number)=>string):string {
 return `<nav class="aa-pager" aria-label="${esc(t(locale,'nav.sections'))}">${page.prev?`<a href="${esc(href(page.prev))}">${esc(t(locale,'assistantArea.previous'))}</a>`:''}<span class="caption">${esc(t(locale,'assistantArea.range',{from:page.from,to:page.to,total:page.total}))}</span>${page.next?`<a href="${esc(href(page.next))}">${esc(t(locale,'assistantArea.next'))}</a>`:''}</nav>`;
}
export function renderAssistantActivity(page:AssistantPage<AssistantActivityRow>,locale:Locale):string {
 return `<h1 class="page">${esc(t(locale,'assistantArea.activity'))}</h1><p class="lede">${esc(t(locale,'assistantArea.activityIntro'))}</p>${page.rows.length?page.rows.map(g=>{
  const cap=capabilityName(locale,g.capability??''),why=t(locale,`demote.why.${g.why??'repeated_corrections'}` as MessageKey);
  const text=g.kind==='self_demote'?t(locale,g.language?'employee.growth.self_demote.inLanguage':'employee.growth.self_demote',{cap,why,...(g.language?{language:languageDisplay(locale,g.language)}:{})}):t(locale,`employee.growth.${g.kind}` as MessageKey,g.capability?{cap}:{});
  return `<article class="aa-event" id="event-${esc(g.id)}"><p>${esc(text)}</p><p class="caption muted">${esc(show.dateYear(locale,g.at))} · ${esc(show.time(locale,g.at))}</p>${g.conversationId?`<a href="${esc(conversationUrl(g.conversationId))}">${esc(t(locale,'assistantArea.conversation'))}</a>`:''}</article>`;
 }).join(''):`<p>${esc(t(locale,'assistantArea.activityEmpty'))}</p>`}${assistantPager(page,locale,n=>'/app/assistant/activity?page='+n)}`;
}
