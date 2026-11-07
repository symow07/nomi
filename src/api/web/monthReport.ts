// TEMPORARY STUB (backend, Block 4.3 B3) — NOT THE PAGE. The frontend's src/api/web/monthReport.ts replaces this file
// whole: on merge, take loop/frontend's version of this path and drop this one. It exists only so the route
// (GET /app/results/month in app.ts) builds and is tested on loop/backend. It draws the page's one h1 and the notice.
import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MonthPageOptions, MonthReport } from '../../core/report/month.js';
import { flashBanner } from './flash.js';
import { esc } from './layout.js';
import { t } from './say.js';

export function renderMonthReport(_report: MonthReport, locale: Locale, options: MonthPageOptions): string {
  return `<h1 class="page">${esc(t(locale, 'monthMail.tab'))}</h1>${flashBanner(options.flash)}`;
}
