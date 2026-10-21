import { type Locale } from '../../core/owner/i18n/locale.js';
import { LABEL_MAX } from '../../core/owner/labels.js';
import type { Label } from '../../db/labels.js';
import { t, tn } from './say.js';
import { esc } from './layout.js';

/**
 * S2 (Phase 5, item 19) — THE LABELS' OWN PAGE: each with how many buyers carry it and a door to them on Buyers,
 * renamed in place, archived (asks first) and in use again. A label is put on a buyer from the buyer's panel, never
 * from here.
 */
export function renderLabels(locale: Locale, rows: readonly Label[]): string {
  const row = (l: Label) => `<li class="row"><span>
      <form method="post" action="/app/labels/${esc(l.id)}" class="inline">
        <input name="name" value="${esc(l.name)}" maxlength="${LABEL_MAX}" required dir="auto" aria-label="${esc(t(locale, 'labels.rename', { name: l.name }))}" />
        <button class="btn ghost" type="submit">${esc(t(locale, 'labels.save'))}</button></form>
      ${l.archived ? `<span class="pill warn">${esc(t(locale, 'labels.archived'))}</span>`
        : `<a class="caption" href="/app/inbox?filter=all&amp;label=${esc(l.id)}">${esc(tn(locale, 'labels.buyers', l.buyers))}</a>`}</span>
      <span>${l.archived
        ? `<form method="post" action="/app/labels/${esc(l.id)}/restore" class="inline"><button class="btn ghost" type="submit">${esc(t(locale, 'labels.restore'))}</button></form>`
        : `<form method="post" action="/app/labels/${esc(l.id)}/archive" class="inline"><button class="btn ghost" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, 'labels.archiveAsk', { name: l.name }))}">${esc(t(locale, 'labels.archive'))}</button></form>`}</span></li>`;
  return `<h1 class="page">${esc(t(locale, 'labels.pageTitle'))}</h1>
    <p class="lede">${esc(t(locale, 'labels.lede'))}</p>
    ${rows.length === 0 ? `<p class="muted">${esc(t(locale, 'labels.noneYet'))}</p>` : `<ul class="rows">${rows.map(row).join('')}</ul>`}`;
}
