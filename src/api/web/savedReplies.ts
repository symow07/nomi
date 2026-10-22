import { type Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import { SAVED_REPLY_LANGUAGES, SAVED_REPLY_TEXT_MAX, SAVED_REPLY_TITLE_MAX, type SavedReplyTexts } from '../../core/owner/savedReplies.js';
import type { SavedReply } from '../../db/savedReplies.js';
import { t } from './say.js';
import { esc } from './layout.js';

/**
 * S1 (Phase 5, item 18) — SAVED REPLIES ON THE PAGE: the list, a new one, one changed, archived and back in use.
 * Whoever answers buyers keeps them (owner and staff); the accountant never reaches this page. A saved reply is used
 * from a conversation's reply box, never from here: nothing on this page sends.
 */
const langName = (locale: Locale, l: string) => t(locale, `savedReplies.lang.${l}` as MessageKey);

function form(locale: Locale, action: string, r: { readonly title: string; readonly texts: SavedReplyTexts } | null, button: MessageKey): string {
  return `<form method="post" action="${esc(action)}" class="pform">
      <label class="pq"><span>${esc(t(locale, 'savedReplies.titleField'))}</span><input name="title" required maxlength="${SAVED_REPLY_TITLE_MAX}" value="${esc(r?.title ?? '')}" dir="auto" /></label>
      <p class="caption muted">${esc(t(locale, 'savedReplies.textsHint'))}</p>
      ${SAVED_REPLY_LANGUAGES.map((l) => `<label class="pq"><span>${esc(langName(locale, l))}</span><textarea name="text_${l}" rows="3" maxlength="${SAVED_REPLY_TEXT_MAX}" lang="${l}" dir="${l === 'ar' ? 'rtl' : 'auto'}">${esc(r?.texts[l] ?? '')}</textarea></label>`).join('')}
      <button class="btn" type="submit">${esc(t(locale, button))}</button>
    </form>`;
}

export function renderSavedReplies(locale: Locale, rows: readonly SavedReply[]): string {
  const inUse = rows.filter((r) => !r.archived);
  const archived = rows.filter((r) => r.archived);
  const row = (r: SavedReply) => `<li class="row"><span><a href="/app/replies/${esc(r.id)}"><bdi>${esc(r.title)}</bdi></a>
      <span class="caption muted">${SAVED_REPLY_LANGUAGES.filter((l) => r.texts[l]).map((l) => esc(langName(locale, l))).join(' · ')}</span></span></li>`;
  return `<h1 class="page">${esc(t(locale, 'savedReplies.title'))}</h1>
    <p class="lede">${esc(t(locale, 'savedReplies.lede'))}</p>
    ${inUse.length === 0 ? `<p class="muted">${esc(t(locale, 'savedReplies.none'))}</p>` : `<ul class="rows">${inUse.map(row).join('')}</ul>`}
    <div class="block" id="new-reply"><h2>${esc(t(locale, 'savedReplies.add'))}</h2>${form(locale, '/app/replies', null, 'savedReplies.add')}</div>
    ${archived.length === 0 ? '' : `<div class="block"><h2>${esc(t(locale, 'savedReplies.archivedTitle'))}</h2><ul class="rows">${archived.map(row).join('')}</ul></div>`}`;
}

export function renderSavedReply(locale: Locale, r: SavedReply): string {
  const state = r.archived
    ? `<p role="status"><span class="pill warn">${esc(t(locale, 'savedReplies.archived'))}</span></p>
       <form method="post" action="/app/replies/${esc(r.id)}/restore" class="pform"><button class="btn ghost" type="submit">${esc(t(locale, 'savedReplies.restore'))}</button></form>`
    : `<form method="post" action="/app/replies/${esc(r.id)}/archive" class="pform">
        <button class="btn ghost" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, 'savedReplies.archiveAsk'))}">${esc(t(locale, 'savedReplies.archive'))}</button></form>`;
  return `<h1 class="page"><bdi>${esc(r.title)}</bdi></h1>
    ${state}
    ${form(locale, `/app/replies/${r.id}`, r, 'savedReplies.save')}
    <p><a class="deeper" href="/app/replies">${esc(t(locale, 'savedReplies.title'))}</a></p>`;
}
