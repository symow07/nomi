import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import { type Viewer, booksMay } from '../../core/conversation/people.js';
import { esc } from './layout.js';
import { t } from './say.js';

type Who = Viewer & { readonly kind?: 'team' | 'accountant' };
type Section = 'overview'|'getPaid'|'spending'|'bank'|'reports'|'yearEnd'|'advanced';
const sections:readonly [Section,string,MessageKey][] = [
 ['overview','/app/books','booksArea.overview'], ['getPaid','/app/books/invoices','booksArea.getPaid'],
 ['spending','/app/books/spending','booksArea.spending'], ['bank','/app/books/bank','booksArea.bank'],
 ['reports','/app/books/reports','booksArea.reports'], ['yearEnd','/app/books/year-end','booksArea.yearEnd'],
 ['advanced','/app/books/advanced','booksArea.advanced'],
];
export function booksSection(path:string):Section {
 const p=path.split(/[?#]/)[0]!;
 if(/^\/app\/books\/(?:invoices|credit-notes|orders)(?:\/|$)/.test(p))return 'getPaid';
 if(/^\/app\/books\/(?:spending|papers)(?:\/|$)/.test(p))return 'spending';
 if(p.startsWith('/app/books/bank'))return 'bank';
 if(/^\/app\/books\/(?:reports|fec)(?:\/|$)/.test(p))return 'reports';
 if(/^\/app\/books\/(?:year-end|closing)(?:\/|$)/.test(p))return 'yearEnd';
 if(/^\/app\/books\/(?:advanced|entries|trial-balance)(?:\/|$)/.test(p))return 'advanced';
 return 'overview';
}
export function booksArea(body:string,locale:Locale,path:string,viewer:Who):string {
 const current=booksSection(path);
 const links=sections.map(([key,href,label])=>`<a href="${href}"${key===current?' aria-current="page"':''}${key==='advanced'?' class="ba-advanced"':''}>${esc(t(locale,label))}</a>`).join('');
 const settings=booksMay({id:viewer.id??'',name:'',...viewer},'post')?`<a class="ba-settings" href="/app/settings/books">${esc(t(locale,'booksArea.settings'))}</a>`:'';
 return `<div class="books-area"><nav class="ba-nav" aria-label="${esc(t(locale,'nav.sections'))}">${links}${settings}</nav><details class="area-chooser ba-chooser"><summary>${esc(t(locale,sections.find(([key])=>key===current)![2]))}</summary><nav aria-label="${esc(t(locale,'nav.sections'))}">${links}${settings}</nav></details><div class="ba-content">${body}</div></div>`;
}
