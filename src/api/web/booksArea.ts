import type { Locale } from '../../core/owner/i18n/locale.js';
import type { Viewer } from '../../core/conversation/people.js';

type Who = Viewer & { readonly kind?: 'team' | 'accountant' };
/** The navigation block (2026-11-25): the section sidebar (sections.ts) is the area's one menu; this is the page's frame. */
export function booksArea(body:string,_locale:Locale,_path:string,_viewer:Who):string {
 return `<div class="books-area"><div class="ba-content">${body}</div></div>`;
}
