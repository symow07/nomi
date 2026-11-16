import { esc } from './layout.js';
import { t } from './say.js';
import type { Locale } from '../../core/owner/i18n/locale.js';

export type ImportStep = 'upload' | 'map' | 'review' | 'confirm';

/**
 * F27 (Block 4) — where an import is: Upload, Columns (a file or a store's export only), Check, Confirm. The
 * current step is marked for a screen reader too; the line is read, never pressed.
 */
export function importSteps(locale: Locale, current: ImportStep, withMap: boolean): string {
  const steps: ImportStep[] = withMap ? ['upload', 'map', 'review', 'confirm'] : ['upload', 'review', 'confirm'];
  const at = steps.indexOf(current);
  return `<ol class="imp-steps" aria-label="${esc(t(locale, 'import.steps'))}">${steps.map((s, i) =>
    `<li${i === at ? ' aria-current="step"' : i < at ? ' class="done"' : ''}><span class="imp-step-n">${i + 1}</span> ${esc(t(locale, `import.step.${s}`))}</li>`).join('')}</ol>`;
}
