import type { Locale } from '../../core/owner/i18n/locale.js';
import { esc, wordsHtml } from './layout.js';
import { t } from './say.js';

/** One tab row for all Results views; English fallback keeps the page's alignment. */
const RESULTS_TABS = ['sales', 'assistant', 'setup', 'month'] as const;
export const renderResultsTabs = (locale: Locale, current: (typeof RESULTS_TABS)[number]) =>
    `<nav class="tabs" aria-label="${esc(t(locale, 'area1.results.views'))}">${
      RESULTS_TABS.map((item) => `<a class="tab${item === current ? ' on' : ''}"${item === current ? ' aria-current="page"' : ''}
        href="${item === 'month' ? '/app/results/month' : `/app/results${item === 'sales' ? '' : `?view=${item}`}`}">${
        wordsHtml(locale, item === 'month' ? 'monthMail.tab' : `area1.results.${item}`)}</a>`).join('')}</nav>`;
