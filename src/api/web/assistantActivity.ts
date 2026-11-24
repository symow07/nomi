import type { Locale } from '../../core/owner/i18n/locale.js';
import { capabilityName,languageDisplay,type MessageKey } from '../../core/owner/i18n/messages.js';
import { ACTIVITY_SHOWS,type AssistantActivityRow,type AssistantActivityShow } from '../../db/assistantActivity.js';
import type { AssistantPage } from '../../db/assistantKnowledge.js';
import { esc,conversationUrl } from './layout.js';
import { t } from './say.js';
import * as show from './values.js';
import { dayKey } from '../../core/owner/i18n/format.js';
import { workspaceZone } from './zone.js';
import { assistantName } from './say.js';
/** UI Block 6 (F30, F39) — the same pages above a list and below it; each its own named landmark. */
export function assistantPager<T>(page:AssistantPage<T>,locale:Locale,href:(n:number)=>string,where:'above'|'below'='below'):string {
 return `<nav class="aa-pager aa-pager-${where}" aria-label="${esc(t(locale,where==='above'?'assistantArea.pagesAbove':'assistantArea.pagesBelow'))}">${page.prev?`<a href="${esc(href(page.prev))}">${esc(t(locale,'assistantArea.previous'))}</a>`:''}<span class="caption">${esc(t(locale,'assistantArea.range',{from:page.from,to:page.to,total:page.total}))}</span>${page.next?`<a href="${esc(href(page.next))}">${esc(t(locale,'assistantArea.next'))}</a>`:''}</nav>`;
}
/**
 * UI Block 6 · F39 — COMPACT DATED EVENTS: the day once, then each event on its own row — its time, who did it (your
 * team, or the assistant by name when it went back to waiting on its own), what happened, and its conversation. The
 * filters and the pages sit above the list and below it; a page keeps its filter.
 */
export function renderAssistantActivity(page:AssistantPage<AssistantActivityRow>,locale:Locale,only:AssistantActivityShow='all'):string {
 const base='/app/assistant/activity',href=(n:number)=>`${base}?${only==='all'?'':`show=${only}&`}page=${n}`;
 const filters=`<nav class="aa-filter" aria-label="${esc(t(locale,'aaActivity.filter.label'))}">${ACTIVITY_SHOWS.map(k=>
  `<a href="${k==='all'?base:`${base}?show=${k}`}"${k===only?' aria-current="page"':''}>${esc(t(locale,`aaActivity.filter.${k}` as MessageKey))}</a>`).join('')}</nav>`;
 const zone=workspaceZone();
 const groups:{key:string;at:Date;rows:AssistantActivityRow[]}[]=[];
 for(const g of page.rows){const key=dayKey(g.at,zone);const last=groups.at(-1);if(last&&last.key===key)last.rows.push(g);else groups.push({key,at:g.at,rows:[g]});}
 const row=(g:AssistantActivityRow)=>{
  const cap=capabilityName(locale,g.capability??''),why=t(locale,`demote.why.${g.why??'repeated_corrections'}` as MessageKey);
  const text=g.kind==='self_demote'?t(locale,g.language?'employee.growth.self_demote.inLanguage':'employee.growth.self_demote',{cap,why,...(g.language?{language:languageDisplay(locale,g.language)}:{})}):t(locale,`employee.growth.${g.kind}` as MessageKey,g.capability?{cap}:{});
  const actor=g.kind==='self_demote'?assistantName(locale):t(locale,'aaActivity.actor.team');
  return `<li class="aa-event" id="event-${esc(g.id)}"><time datetime="${esc(g.at.toISOString())}">${esc(show.time(locale,g.at))}</time><div class="aa-body"><span class="aa-actor">${esc(actor)}</span><p class="aa-what">${esc(text)}</p>${g.conversationId?`<a href="${esc(conversationUrl(g.conversationId))}">${esc(t(locale,'assistantArea.conversation'))}</a>`:''}</div></li>`;
 };
 const list=page.rows.length?groups.map(d=>`<section class="aa-dayset"><h2 class="aa-day">${esc(show.dateYear(locale,d.at))}</h2><ol class="aa-events">${d.rows.map(row).join('')}</ol></section>`).join('')
  :`<p>${esc(t(locale,'assistantArea.activityEmpty'))}</p>`;
 return `<h1 class="page">${esc(t(locale,'assistantArea.activity'))}</h1><p class="lede">${esc(t(locale,'assistantArea.activityIntro'))}</p>${filters}${
  page.total>0?assistantPager(page,locale,href,'above'):''}${list}${assistantPager(page,locale,href)}`;
}
