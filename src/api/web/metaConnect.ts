import { t } from './say.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import { esc } from './layout.js';

/**
 * C10 — when she manages more than one Facebook Page, Meta's dialog cannot
 * tell us which one this business is; she does, here. One press per Page,
 * and the Instagram account each carries is named so she is not choosing
 * blind. The token she just granted travels in the signed, encrypted state
 * the form posts back — never in this page.
 */
export function renderMetaPagePicker(
  pages: readonly { readonly pageId: string; readonly name: string; readonly instagram: string | null }[],
  state: string, locale: Locale,
): string {
  return `<h1 class="page">${esc(t(locale, 'connect.meta.choose.title'))}</h1>
  <div class="block">
    <p class="muted">${esc(t(locale, 'connect.meta.choose.body'))}</p>
    <ul class="pages">${pages.map((p) => `
      <li class="page-row">
        <div>
          <b>${esc(p.name)}</b>
          <div class="muted">${p.instagram
            ? esc(t(locale, 'connect.meta.choose.instagram', { handle: p.instagram.startsWith('@') ? p.instagram : `@${p.instagram}` }))
            : esc(t(locale, 'connect.meta.choose.noInstagram'))}</div>
        </div>
        <form method="post" action="/app/connect/meta/choose" class="inline">
          <input type="hidden" name="page_id" value="${esc(p.pageId)}">
          <input type="hidden" name="state" value="${esc(state)}">
          <button class="btn send" type="submit">${esc(t(locale, 'connect.meta.choose.button'))}</button>
        </form>
      </li>`).join('')}</ul>
    <p><a href="/app/channels">${esc(t(locale, 'connect.meta.choose.back'))}</a></p>
  </div>
  <style>
    .pages { list-style:none; margin:var(--space-12) 0 0; padding:0; }
    .page-row { display:flex; align-items:center; justify-content:space-between; gap:var(--space-12);
                padding:12px 0; border-bottom:1px solid var(--color-border); }
    .page-row:last-child { border-bottom:none; }
  </style>`;
}
