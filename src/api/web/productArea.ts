import type { Locale } from '../../core/owner/i18n/locale.js';
import { OWNER_VIEW, type Viewer } from '../../core/conversation/people.js';

export type ProductSection = 'all' | 'add' | 'limits' | 'whatsapp';
/** The navigation block (2026-11-25): the section sidebar (sections.ts) is the area's one menu; this is the page's frame. */
export function productArea(body: string, _locale: Locale, _current: ProductSection, _viewer: Viewer = OWNER_VIEW): string {
  return `<div class="product-area">${body}</div>`;
}
