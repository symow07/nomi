import { type Locale } from '../../core/owner/i18n/locale.js';
import { t } from './say.js';
import { esc } from './layout.js';
import { type Viewer } from '../../core/conversation/people.js';
import type { ApprovalState } from '../../db/connectionApproval.js';
import * as show from './values.js';

/**
 * KS6 (0115) — the Channels page's first card while the workspace's first
 * connection waits for the operator: why, where the business can be seen (the
 * one box), then where the ask stands. Nothing once approved or not needed.
 * Staff see where it stands and that the owner asks; never the form.
 */
export function renderApprovalCard(state: ApprovalState, locale: Locale, viewer: Viewer, contact: string | null): string {
  if (!state.needed) return '';
  const head = `<h2>${esc(t(locale, 'approval.title'))}</h2>
    <p class="muted ch-desc">${esc(t(locale, 'approval.lead'))}</p>`;
  const ask = state.ask;
  const body = ask?.decision === 'refused'
    ? `<p>${esc(t(locale, 'approval.refused'))}</p>${contact ? `<p class="muted">${esc(t(locale, 'approval.refusedContact', { email: contact }))}</p>` : ''}`
    : ask
      ? `<p>${esc(t(locale, 'approval.asked', { when: show.when(locale, ask.askedAt, new Date()) }))}</p>
        <p class="muted">${esc(t(locale, 'approval.where'))} <span dir="ltr">${esc(ask.page)}</span></p>`
      : !viewer.isOwner
        ? `<p class="muted ch-desc">${esc(t(locale, 'staff.ownerDecides'))}</p>`
        : `<form method="post" action="/app/channels/approval" class="ownerform">
            <label for="approval-page">${esc(t(locale, 'approval.page'))}</label>
            <input id="approval-page" name="page" type="text" inputmode="url" autocapitalize="none" spellcheck="false" dir="ltr"
              maxlength="300" required placeholder="facebook.com/yourshop" />
            <div class="hint">${esc(t(locale, 'approval.pageHint'))}</div>
            <button class="btn send" type="submit">${esc(t(locale, 'approval.ask'))}</button>
          </form>`;
  return `<div class="block" id="approval">${head}${body}</div>`;
}
