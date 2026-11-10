import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import { OWNER_VIEW, type Viewer } from '../../core/conversation/people.js';
import { esc } from './layout.js';
import { t } from './say.js';

export type ProductSection = 'all' | 'add' | 'limits' | 'whatsapp';
const sections: readonly [ProductSection, string, MessageKey][] = [
  ['all', '/app/products', 'products.all'],
  ['add', '/app/products/add', 'products.add'],
  ['limits', '/app/products/price-limits', 'products.limits'],
  ['whatsapp', '/app/products/whatsapp', 'waCatalog.title'],
];
/** Shared native navigation: the page remains usable with no script. */
export function productArea(body: string, locale: Locale, current: ProductSection, viewer: Viewer = OWNER_VIEW): string {
  const visible = sections.filter(([key]) => viewer.isOwner || key === 'all' || key === 'whatsapp');
  const selected = visible.find(([key]) => key === current) ?? visible[0]!;
  const labelHtml = (key:MessageKey) => key === 'waCatalog.title' ? `<bdi lang="en" dir="ltr">${esc(t(locale,key))}</bdi>` : esc(t(locale,key));
  const links = visible.map(([key, href, label]) => `<a href="${href}"${key === selected[0] ? ' aria-current="page"' : ''}>${labelHtml(label)}</a>`).join('');
  return `<div class="product-area"><nav class="pa-nav" aria-label="${esc(t(locale, 'nav.sections'))}">${links}</nav><details class="area-chooser pa-chooser"><summary>${labelHtml(selected[2])}</summary><nav aria-label="${esc(t(locale, 'nav.sections'))}">${links}</nav></details>${body}</div>`;
}
