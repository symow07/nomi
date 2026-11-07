import { esc, deeper } from './layout.js';
import { t } from './say.js';
import { fieldRow } from './rows.js';
import { flashBanner, type Flash } from './flash.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import { STEP_MAX, STEPS_MAX, TITLE_MAX } from '../../core/owner/procedures.js';
import type { ProcedureRow } from '../../db/procedures.js';

/**
 * PROCEDURES, THE PAGE (Block 3 PR 2; 0229) — `/app/assistant/knowledge/procedures`: each procedure with its steps,
 * the hand-off step marked; Remove (confirmed) and the form for a new one, for the owner only. Anyone signed in reads.
 * The settings idiom: `fieldRow`, `.btn send`, the knowledge page's own classes; no new CSS.
 */
export function renderProceduresPage(locale: Locale, owner: boolean, rows: readonly ProcedureRow[], flash: Flash | null): string {
  const text = (k: Parameters<typeof t>[1], p?: Record<string, string | number>) => esc(t(locale, k, p));
  const list = rows.length === 0 ? `<p class="muted">${text('procedures.none')}</p>` : `<ul class="scard kmenu">${rows.map((p) => `<li class="setrow"><div class="fr-l"><span class="fr-name"><bdi>${esc(p.title)}</bdi></span></div>
    <ol class="fr-c">${p.steps.map((s, i) => `<li><bdi>${esc(s.text)}</bdi>${s.kind === 'handoff' ? ` <span class="pill">${text('procedures.handsOff')}</span>` : ''}</li>`).join('')}</ol>
    ${owner ? `<form method="post" action="/app/assistant/knowledge/procedures/${esc(p.id)}/archive" class="inline"><button class="btn ghost" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${text('procedures.removeAsk')}">${text('procedures.remove')}</button></form>` : ''}</li>`).join('')}</ul>`;
  const form = !owner ? '' : `<section class="block" id="new-procedure"><h2>${text('procedures.add')}</h2><form method="post" action="/app/assistant/knowledge/procedures" class="pform">
    ${fieldRow({ label: t(locale, 'procedures.field.title'), forId: 'proc-title', desc: t(locale, 'procedures.field.title.hint'),
      control: `<input id="proc-title" name="title" required maxlength="${TITLE_MAX}" />` })}
    ${fieldRow({ label: t(locale, 'procedures.field.steps'), forId: 'proc-steps', desc: t(locale, 'procedures.field.steps.hint'),
      control: `<textarea id="proc-steps" name="steps" rows="${STEPS_MAX}" required maxlength="${(STEP_MAX + 4) * STEPS_MAX}"></textarea>` })}
    <button class="btn send" type="submit">${text('procedures.save')}</button></form></section>`;
  return `<div class="assistant-knowledge"><h1 class="page">${text('procedures.title')}</h1>${flashBanner(flash)}<p class="muted">${text('procedures.lede')}</p>
    <p>${deeper('/app/assistant/knowledge', t(locale, 'nav.knowledge'))}</p>${list}${form}</div>`;
}
