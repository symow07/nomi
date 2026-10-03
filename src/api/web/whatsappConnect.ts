import { t } from './say.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import { esc } from './layout.js';

/**
 * WA — when the WhatsApp Business Account the owner shared holds more than
 * one number, the owner says which one customers write to. The business
 * token travels in the signed, encrypted state the form posts back — never in
 * this page.
 */
export function renderWhatsAppNumberPicker(
  numbers: readonly { readonly id: string; readonly display: string | null; readonly verifiedName: string | null }[],
  state: string, wabaId: string, locale: Locale,
): string {
  return `<h1 class="page">${esc(t(locale, 'connect.wa.choose.title'))}</h1>
  <div class="block">
    <p class="muted">${esc(t(locale, 'connect.wa.choose.body'))}</p>
    <ul class="rows">${numbers.map((n) => `
      <li class="row">
        <div>
          <b dir="ltr"><bdi>${esc(n.display ?? n.id)}</bdi></b>
          ${n.verifiedName ? `<div class="muted" dir="auto">${esc(n.verifiedName)}</div>` : ''}
        </div>
        <form method="post" action="/app/connect/whatsapp/choose" class="inline">
          <input type="hidden" name="number_id" value="${esc(n.id)}">
          <input type="hidden" name="waba_id" value="${esc(wabaId)}">
          <input type="hidden" name="state" value="${esc(state)}">
          <button class="btn send" type="submit">${esc(t(locale, 'connect.wa.choose.button'))}</button>
        </form>
      </li>`).join('')}</ul>
    <p><a href="/app/channels/whatsapp">${esc(t(locale, 'connect.meta.choose.back'))}</a></p>
  </div>`;
}
