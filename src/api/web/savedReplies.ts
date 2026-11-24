import { type Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import { SAVED_REPLY_LANGUAGES, SAVED_REPLY_TEXT_MAX, SAVED_REPLY_TITLE_MAX, savedReplyFor, type SavedReplyTexts } from '../../core/owner/savedReplies.js';
import type { SavedReply } from '../../db/savedReplies.js';
import { t } from './say.js';
import { esc, back, deeper } from './layout.js';
import { filterBar } from './filterBar.js';
import { GO } from './icons.js';

/** Saved replies retain their existing POST contracts. These pages prepare words; insertion and Send stay in the conversation. */
const langName = (locale: Locale, l: string) => t(locale, `savedReplies.lang.${l}` as MessageKey);

function form(locale: Locale, action: string, r: { readonly title: string; readonly texts: SavedReplyTexts } | null): string {
  const hasWords = SAVED_REPLY_LANGUAGES.some((l) => Boolean(r?.texts[l]));
  return `<form id="saved-reply-form" method="post" action="${esc(action)}" class="pform saved-reply-form">
      <label class="pq"><span>${esc(t(locale, 'savedReplies.titleField'))}</span><input name="title" required maxlength="${SAVED_REPLY_TITLE_MAX}" value="${esc(r?.title ?? '')}" dir="auto" /></label>
      <fieldset class="saved-languages"><legend>${esc(t(locale, 'area2.saved.languages'))}</legend>
        <p class="caption muted">${esc(t(locale, 'savedReplies.textsHint'))}</p>
        ${SAVED_REPLY_LANGUAGES.map((l) => `<details class="saved-language"${r?.texts[l] || !hasWords && l === locale ? ' open' : ''}>
          <summary>${esc(langName(locale, l))}</summary>
          <textarea name="text_${l}" rows="3" maxlength="${SAVED_REPLY_TEXT_MAX}" lang="${l}" dir="${l === 'ar' ? 'rtl' : 'auto'}" aria-label="${esc(langName(locale, l))}">${esc(r?.texts[l] ?? '')}</textarea>
        </details>`).join('')}
      </fieldset>
    </form>`;
}

function actions(locale: Locale, button: MessageKey, state = ''): string {
  // Native form association keeps Save and the separate archive command together, including without script.
  return `<div class="saved-editor-actions"><button class="btn send" type="submit" form="saved-reply-form">${esc(t(locale, button))}</button><a href="/app/inbox/replies">${esc(t(locale, 'common.cancel'))}</a>${state}</div>`;
}

export function renderSavedReplies(locale: Locale, rows: readonly SavedReply[], opts: { readonly query?: string; readonly create?: boolean } = {}): string {
  if (opts.create) return `<div class="saved-replies-page saved-reply-focus">${back('/app/inbox/replies', t(locale, 'savedReplies.title'))}<header class="saved-replies-header"><h1 class="page">${esc(t(locale, 'savedReplies.add'))}</h1></header><section class="saved-reply-editor" id="new-reply"><p class="saved-scope">${esc(t(locale, 'savedReplies.saveScope'))}</p>${form(locale, '/app/replies', null)}${actions(locale, 'savedReplies.add')}</section></div>`;
  const query = (opts.query ?? '').trim().slice(0, 200);
  const needle = query.toLocaleLowerCase(locale);
  const matched = rows.filter((r) => [r.title, ...Object.values(r.texts)].some((text) => text?.toLocaleLowerCase(locale).includes(needle))).sort((a, b) => a.title.localeCompare(b.title, locale, { numeric: true }));
  const inUse = matched.filter((r) => !r.archived);
  const archived = matched.filter((r) => r.archived);
  const row = (r: SavedReply) => {
    const preview = savedReplyFor(r.texts, null, locale)?.text ?? '';
    const excerpt = Array.from(preview).slice(0, 150).join('');
    return `<li><a class="saved-reply-row" href="/app/inbox/replies/${esc(r.id)}">
      <span class="saved-reply-copy"><bdi class="saved-reply-title">${esc(r.title)}</bdi><span class="saved-reply-preview" dir="auto">${esc(excerpt)}${excerpt.length < preview.length ? '…' : ''}</span></span>
      <span class="saved-reply-languages">${SAVED_REPLY_LANGUAGES.every((l) => r.texts[l]) ? esc(t(locale, 'savedReplies.allLanguages')) : SAVED_REPLY_LANGUAGES.filter((l) => r.texts[l]).map((l) => esc(langName(locale, l))).join(' · ')}</span>${GO}</a></li>`;
  };
  return `<div class="saved-replies-page">${back('/app/inbox', t(locale, 'nav.inbox'))}
    <header class="saved-replies-header"><h1 class="page">${esc(t(locale, 'savedReplies.title'))}</h1><span id="new-reply">${deeper('/app/inbox/replies?new=1', t(locale, 'savedReplies.add'))}</span></header>
    <p class="saved-replies-intro">${esc(t(locale, 'savedReplies.lede'))}</p>
    ${filterBar({ locale, action: '/app/inbox/replies', cls: 'saved-search', name: t(locale, 'savedReplies.search'), search: { label: t(locale, 'savedReplies.search'), control: `<input type="search" name="q" value="${esc(query)}" maxlength="200">` }, submit: t(locale, 'savedReplies.search'), clear: query ? { href: '/app/inbox/replies', label: t(locale, 'savedReplies.clearSearch') } : null })}
    <section aria-labelledby="saved-in-use"><h2 id="saved-in-use">${esc(t(locale, 'area2.saved.inUse'))}</h2>
      ${inUse.length === 0 ? `<p class="muted">${esc(t(locale, query ? 'savedReplies.noMatch' : 'savedReplies.none'))}</p>` : `<ul class="saved-reply-rows">${inUse.map(row).join('')}</ul>`}</section>
    ${archived.length === 0 ? '' : `<details class="saved-archive"${query ? ' open' : ''}><summary>${esc(t(locale, 'savedReplies.archivedTitle'))}</summary><ul class="saved-reply-rows">${archived.map(row).join('')}</ul></details>`}
  </div>`;
}

export function renderSavedReply(locale: Locale, r: SavedReply): string {
  const state = r.archived
    ? `<form method="post" action="/app/replies/${esc(r.id)}/restore" class="saved-reply-state"><button class="btn" type="submit">${esc(t(locale, 'savedReplies.restore'))}</button></form>`
    : `<form method="post" action="/app/replies/${esc(r.id)}/archive" class="saved-reply-state">
        <button class="btn danger" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, 'savedReplies.archiveAsk'))}">${esc(t(locale, 'savedReplies.archive'))}</button></form>`;
  return `<div class="saved-replies-page saved-reply-focus">${back('/app/inbox/replies', t(locale, 'savedReplies.title'))}
    <header class="saved-replies-header"><h1 class="page"><bdi>${esc(r.title)}</bdi></h1>${r.archived ? `<p role="status"><span class="pill">${esc(t(locale, 'savedReplies.archived'))}</span></p>` : ''}</header>
    <section class="saved-reply-editor" aria-labelledby="saved-edit"><h2 id="saved-edit">${esc(t(locale, 'area2.saved.edit'))}</h2><p class="saved-scope">${esc(t(locale, 'savedReplies.saveScope'))}${r.archived ? ` ${esc(t(locale, 'savedReplies.archivedScope'))}` : ''}</p>${form(locale, `/app/replies/${r.id}`, r)}${actions(locale, 'savedReplies.save', state)}</section>
  </div>`;
}
