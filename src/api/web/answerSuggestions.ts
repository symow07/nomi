import { type Locale } from '../../core/owner/i18n/locale.js';
import { ANSWER_MAX, QUESTION_MAX, type AnswerSuggestion } from '../../core/owner/answerSuggestions.js';
import type { Viewer } from '../../core/conversation/people.js';
import { t, tn } from './say.js';
import { esc } from './layout.js';
import * as show from './values.js';

/**
 * S5 (Phase 5, item 17) — ANSWERS PEOPLE GAVE, on the knowledge page: each question buyers asked that a person
 * answered in their own words, how many asked it, and that answer. The owner teaches it — in the words they leave in
 * the form — or sets it aside for good. Staff see what is offered and that the owner decides; nothing here is ever
 * taught without the owner pressing Teach.
 */
export function renderAnswerSuggestions(locale: Locale, rows: readonly AnswerSuggestion[], viewer: Viewer, now: Date): string {
  const card = (s: AnswerSuggestion) => {
    const head = `<div class="ki-q"><bdi dir="auto">${esc(s.question)}</bdi></div>
      <div class="ki-meta"><span class="muted">${esc(tn(locale, 'knowledge.given.asks', s.asks))}</span>
        <span class="muted">${esc(show.when(locale, s.lastAt, now))}</span></div>`;
    if (!viewer.isOwner) {
      return `<div class="gap">${head}<p class="caption" dir="auto">${esc(s.answer)}</p>
        <p class="caption">${esc(t(locale, 'staff.ownerDecides'))}</p></div>`;
    }
    const q = `<input type="hidden" name="question" value="${esc(s.question)}" />`;
    return `<div class="gap">${head}
      <form method="post" action="/app/knowledge/answers/teach" class="pform teach">${q}
        <label class="pq"><span>${esc(t(locale, 'knowledge.teach.label'))}</span>
          <input type="text" name="label" required maxlength="${QUESTION_MAX}" value="${esc(s.question)}" dir="auto" /></label>
        <label class="pq"><span>${esc(t(locale, 'knowledge.given.answer'))}</span>
          <textarea name="content" rows="3" required maxlength="${ANSWER_MAX}" dir="auto">${esc(s.answer)}</textarea></label>
        <button class="btn send" type="submit">${esc(t(locale, 'knowledge.given.teach'))}</button>
      </form>
      <form method="post" action="/app/knowledge/answers/dismiss" class="inline">${q}
        <button class="btn ghost" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, 'knowledge.given.dismissAsk'))}">${esc(t(locale, 'knowledge.given.dismiss'))}</button>
      </form></div>`;
  };
  return `<div class="block" id="answers-given"><h2>${esc(t(locale, 'knowledge.given.title'))}</h2>
    <p class="fdesc">${esc(t(locale, 'knowledge.given.lede'))}</p>
    ${rows.length ? rows.map(card).join('') : `<div class="empty">${esc(t(locale, 'knowledge.given.none'))}</div>`}
  </div>`;
}
