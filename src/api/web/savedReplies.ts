import { type Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import { SAVED_REPLY_LANGUAGES, SAVED_REPLY_TEXT_MAX, SAVED_REPLY_TITLE_MAX, savedReplyFor, type SavedReplyTexts } from '../../core/owner/savedReplies.js';
import type { SavedReply } from '../../db/savedReplies.js';
import { t } from './say.js';
import { esc, back, deeper } from './layout.js';
import { GO } from './icons.js';

/** Saved replies retain their existing POST contracts. These pages prepare words; insertion and Send stay in the conversation. */
const langName = (locale: Locale, l: string) => t(locale, `savedReplies.lang.${l}` as MessageKey);

function form(locale: Locale, action: string, r: { readonly title: string; readonly texts: SavedReplyTexts } | null, button: MessageKey): string {
  const hasWords = SAVED_REPLY_LANGUAGES.some((l) => Boolean(r?.texts[l]));
  return `<form method="post" action="${esc(action)}" class="pform saved-reply-form">
      <label class="pq"><span>${esc(t(locale, 'savedReplies.titleField'))}</span><input name="title" required maxlength="${SAVED_REPLY_TITLE_MAX}" value="${esc(r?.title ?? '')}" dir="auto" /></label>
      <fieldset class="saved-languages"><legend>${esc(t(locale, 'area2.saved.languages'))}</legend>
        <p class="caption muted">${esc(t(locale, 'savedReplies.textsHint'))}</p>
        ${SAVED_REPLY_LANGUAGES.map((l) => `<details class="saved-language"${r?.texts[l] || !hasWords && l === locale ? ' open' : ''}>
          <summary>${esc(langName(locale, l))}</summary>
          <textarea name="text_${l}" rows="3" maxlength="${SAVED_REPLY_TEXT_MAX}" lang="${l}" dir="${l === 'ar' ? 'rtl' : 'auto'}" aria-label="${esc(langName(locale, l))}">${esc(r?.texts[l] ?? '')}</textarea>
        </details>`).join('')}
      </fieldset>
      <button class="btn send" type="submit">${esc(t(locale, button))}</button>
    </form>`;
}

export function renderSavedReplies(locale: Locale, rows: readonly SavedReply[]): string {
  const inUse = rows.filter((r) => !r.archived);
  const archived = rows.filter((r) => r.archived);
  const row = (r: SavedReply) => {
    const preview = savedReplyFor(r.texts, null, locale)?.text ?? '';
    const excerpt = Array.from(preview).slice(0, 150).join('');
    return `<li><a class="saved-reply-row" href="/app/inbox/replies/${esc(r.id)}">
      <span class="saved-reply-copy"><bdi class="saved-reply-title">${esc(r.title)}</bdi><span class="saved-reply-preview" dir="auto">${esc(excerpt)}${excerpt.length < preview.length ? '…' : ''}</span></span>
      <span class="saved-reply-languages">${SAVED_REPLY_LANGUAGES.filter((l) => r.texts[l]).map((l) => esc(langName(locale, l))).join(' · ')}</span>${GO}</a></li>`;
  };
  return `<div class="saved-replies-page">${back('/app/inbox', t(locale, 'nav.inbox'))}
    <header class="saved-replies-header"><h1 class="page">${esc(t(locale, 'savedReplies.title'))}</h1>${deeper('#new-reply', t(locale, 'savedReplies.add'))}</header>
    <p class="saved-replies-intro">${esc(t(locale, 'savedReplies.lede'))}</p>
    <section aria-labelledby="saved-in-use"><h2 id="saved-in-use">${esc(t(locale, 'area2.saved.inUse'))}</h2>
      ${inUse.length === 0 ? `<p class="muted">${esc(t(locale, 'savedReplies.none'))}</p>` : `<ul class="saved-reply-rows">${inUse.map(row).join('')}</ul>`}</section>
    ${archived.length === 0 ? '' : `<details class="saved-archive"><summary>${esc(t(locale, 'savedReplies.archivedTitle'))}</summary><ul class="saved-reply-rows">${archived.map(row).join('')}</ul></details>`}
    <section class="saved-reply-editor" id="new-reply" aria-labelledby="saved-new"><h2 id="saved-new">${esc(t(locale, 'savedReplies.add'))}</h2>${form(locale, '/app/replies', null, 'savedReplies.add')}</section>
  </div>`;
}

export function renderSavedReply(locale: Locale, r: SavedReply): string {
  const state = r.archived
    ? `<p role="status"><span class="pill">${esc(t(locale, 'savedReplies.archived'))}</span></p>
       <form method="post" action="/app/replies/${esc(r.id)}/restore" class="saved-reply-state"><button class="btn" type="submit">${esc(t(locale, 'savedReplies.restore'))}</button></form>`
    : `<form method="post" action="/app/replies/${esc(r.id)}/archive" class="saved-reply-state">
        <button class="btn" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, 'savedReplies.archiveAsk'))}">${esc(t(locale, 'savedReplies.archive'))}</button></form>`;
  return `<div class="saved-replies-page">${back('/app/inbox/replies', t(locale, 'savedReplies.title'))}
    <header class="saved-replies-header"><h1 class="page"><bdi>${esc(r.title)}</bdi></h1>${state}</header>
    <section class="saved-reply-editor" aria-labelledby="saved-edit"><h2 id="saved-edit">${esc(t(locale, 'area2.saved.edit'))}</h2>${form(locale, `/app/replies/${r.id}`, r, 'savedReplies.save')}</section>
  </div>`;
}
