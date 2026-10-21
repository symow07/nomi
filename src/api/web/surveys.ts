import { type Locale } from '../../core/owner/i18n/locale.js';
import { formatList } from '../../core/owner/i18n/format.js';
import type { Viewer } from '../../core/conversation/people.js';
import { SURVEY_LOCALES, SURVEY_SIGNED, surveyText, type SurveyLocale } from '../../core/conversation/survey.js';
import type { SurveyAnswer, SurveyFacts } from '../../db/surveys.js';
import { t, tn } from './say.js';
import { conversationUrl, esc } from './layout.js';
import { languageName } from './inbox.js';
import * as show from './values.js';

/**
 * S6 (Phase 5, item 20) — HOW DID WE DO? The owner's switch, what it does and where, which languages are ready (a
 * sentence a reader signed), the last ninety days, and the latest answers with the buyer each came from. Staff see the
 * same, and that the owner decides.
 */
export function renderSurveys(locale: Locale, f: SurveyFacts, answers: readonly SurveyAnswer[], viewer: Viewer, now: Date): string {
  const ready = SURVEY_LOCALES.filter((l) => SURVEY_SIGNED[l] !== undefined);
  const waiting = SURVEY_LOCALES.filter((l) => SURVEY_SIGNED[l] === undefined);
  const names = (ls: readonly string[]) => formatList(locale, ls.map((l) => languageName(locale, l)));
  const languages = ready.length === 0 ? t(locale, 'surveys.languages.none', { waiting: names(waiting) })
    : waiting.length === 0 ? t(locale, 'surveys.languages.all', { ready: names(ready) })
    : t(locale, 'surveys.languages.some', { ready: names(ready), waiting: names(waiting) });
  const control = viewer.isOwner
    ? `<form method="post" action="/app/surveys" class="inline"><input type="hidden" name="on" value="${f.on ? '0' : '1'}" />
        <button class="btn${f.on ? ' ghost' : ' send'}" type="submit">${esc(t(locale, f.on ? 'surveys.turnOff' : 'surveys.turnOn'))}</button></form>`
    : `<p class="caption">${esc(t(locale, 'staff.ownerDecides'))}</p>`;
  const counts = f.asked === 0 ? `<p class="muted">${esc(t(locale, 'surveys.noneAsked'))}</p>`
    : `<ul class="rows"><li class="row"><span>${esc(t(locale, 'surveys.asked'))}</span><span>${esc(show.count(locale, f.asked))}</span></li>
        <li class="row"><span>${esc(t(locale, 'surveys.answered'))}</span><span>${esc(show.count(locale, f.answered))}</span></li>
        ${f.average === null ? '' : `<li class="row"><span>${esc(t(locale, 'surveys.average'))}</span><span>${esc(show.count(locale, f.average))} / 5</span></li>`}</ul>`;
  const latest = answers.length === 0 ? '' : `<h2>${esc(t(locale, 'surveys.latest'))}</h2>
    <ul class="rows">${answers.map((a) => `<li class="row"><a href="${esc(conversationUrl(a.conversationId))}"><bdi>${esc(a.buyer ?? t(locale, 'common.buyer'))}</bdi></a>
      <span>${esc(tn(locale, 'surveys.score', a.score))} <span class="muted">${esc(show.when(locale, a.answeredAt, now))}</span></span></li>`).join('')}</ul>`;
  return `<h1 class="page">${esc(t(locale, 'surveys.title'))}</h1>
    <p class="lede">${esc(t(locale, 'surveys.lede'))}</p>
    <div class="block"><p><span class="pill${f.on ? ' ok' : ''}">${esc(t(locale, f.on ? 'surveys.on' : 'surveys.off'))}</span></p>
      <p class="fdesc">${esc(languages)}</p>
      <p class="caption">${esc(t(locale, 'surveys.asWritten'))}</p>
      <blockquote dir="auto">${esc(surveyText((SURVEY_LOCALES as readonly string[]).includes(locale) ? locale as SurveyLocale : 'en').split('{business}').join(f.business || '…'))}</blockquote>${control}</div>
    <div class="block"><h2>${esc(t(locale, 'surveys.lastNinety'))}</h2>${counts}${latest}</div>`;
}
