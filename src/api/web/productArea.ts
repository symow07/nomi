import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import { OWNER_VIEW, type Viewer } from '../../core/conversation/people.js';
import { esc } from './layout.js';
import { t } from './say.js';

export type ProductSection = 'all' | 'add' | 'limits';
const sections: readonly [ProductSection, string, MessageKey][] = [
  ['all', '/app/products', 'products.all'],
  ['add', '/app/products/add', 'products.add'],
  ['limits', '/app/products/price-limits', 'products.limits'],
];
/** Shared native navigation: the page remains usable with no script. */
export function productArea(body: string, locale: Locale, current: ProductSection, viewer: Viewer = OWNER_VIEW): string {
  const visible = sections.filter(([key]) => viewer.isOwner || key === 'all');
  const selected = visible.find(([key]) => key === current) ?? visible[0]!;
  const links = visible.map(([key, href, label]) => `<a href="${href}"${key === selected[0] ? ' aria-current="page"' : ''}>${esc(t(locale, label))}</a>`).join('');
  return `<div class="product-area"><nav class="pa-nav" aria-label="${esc(t(locale, 'nav.sections'))}">${links}</nav><details class="area-chooser pa-chooser"><summary>${esc(t(locale, selected[2]))}</summary><nav aria-label="${esc(t(locale, 'nav.sections'))}">${links}</nav></details>${body}</div>`;
}
