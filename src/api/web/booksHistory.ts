import type {Locale} from '../../core/owner/i18n/locale.js';
import type {OverviewHistoryPaper,OverviewPage} from '../../db/booksOverview.js';
import {esc} from './layout.js';
import {t} from './say.js';
import {booksDay,booksPager} from './booksOverview.js';
export function renderBooksHistory(locale:Locale,p:OverviewPage<OverviewHistoryPaper>):string {
 const href=(page:number)=>'/app/books/spending?'+new URLSearchParams({state:'history',page:String(page)});
 return `<section class="books-spending"><h1 class="page">${esc(t(locale,'booksArea.historyPapers'))}</h1><p><a href="/app/books/spending">${esc(t(locale,'booksArea.backSpending'))}</a></p>${p.rows.length?`<ul class="bs-list">${p.rows.map(r=>`<li id="paper-${esc(r.id)}"><div><a href="/app/books/spending/${esc(r.id)}?from=${encodeURIComponent(href(p.page)+'#paper-'+r.id)}"><bdi>${esc(r.name)}</bdi></a><p>${esc(t(locale,'books.papers.historyExplain',{n:r.historyEntries,through:booksDay(locale,r.historyThrough)}))}</p><p class="caption muted">${esc(t(locale,'books.papers.keptUntil',{date:booksDay(locale,r.keepUntil)}))}</p></div><span class="pill">${esc(t(locale,'booksSpending.history'))}</span></li>`).join('')}</ul>`:`<p>${esc(t(locale,'booksArea.noRows'))}</p>`}${booksPager(locale,p,href)}</section>`;
}
