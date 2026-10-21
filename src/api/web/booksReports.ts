import { type Locale } from '../../core/owner/i18n/locale.js';
import type { Decimal } from '../../core/types/decimal.js';
import { moneyFromRow } from '../../core/types/money.js';
import type { Sides, TrialBalance } from '../../core/books/trialBalance.js';
import type { Period } from '../../db/booksReports.js';
import { t } from './say.js';
import { esc } from './layout.js';
import * as show from './values.js';
import { icon } from './icons.js';

/**
 * D1 (Phase 5, item 1) — THE TRIAL BALANCE on a page: a period chosen, each account opened / moved / closed, debit
 * and credit side by side, the totals, and whether they agree — said plainly, and by how much if they ever do not.
 */
const money = (locale: Locale, d: Decimal, currency: string) => {
  if (d === '0' || /^0(\.0+)?$/.test(d)) return '';
  const m = moneyFromRow(d, currency); return m ? esc(show.money(locale, m)) : esc(d);
};
const cells = (locale: Locale, s: Sides, cur: string) => `<td class="num">${money(locale, s.debit, cur)}</td><td class="num">${money(locale, s.credit, cur)}</td>`;

export function renderTrialBalance(locale: Locale, p: Period, tb: TrialBalance, currency: string, madeAt: Date, problem: boolean): string {
  const head = (k: 'books.trial.opening' | 'books.trial.period' | 'books.trial.closing') => `<th scope="colgroup" colspan="2">${esc(t(locale, k))}</th>`;
  const side = `<th scope="col">${esc(t(locale, 'books.entry.debit'))}</th><th scope="col">${esc(t(locale, 'books.entry.credit'))}</th>`;
  const verdict = tb.balanced
    ? `<p role="status"><span class="pill ok">${esc(t(locale, 'books.trial.balanced'))}</span></p>`
    : `<p role="alert"><span class="pill stop">${esc(t(locale, 'books.trial.notBalanced', { opening: tb.difference.opening, period: tb.difference.period, closing: tb.difference.closing }))}</span></p>`;
  return `<h1 class="page">${esc(t(locale, 'books.trial.title'))}</h1>
    <p class="lede">${esc(t(locale, 'books.trial.lede', { currency }))}</p>
    ${problem ? `<p class="perr" role="alert">${esc(t(locale, 'books.trial.badPeriod'))}</p>` : ''}
    <form method="get" action="/app/books/trial-balance" class="pform">
      <label class="pq"><span>${esc(t(locale, 'books.trial.from'))}</span><input type="date" name="from" value="${esc(p.from)}" required /></label>
      <label class="pq"><span>${esc(t(locale, 'books.trial.to'))}</span><input type="date" name="to" value="${esc(p.to)}" required /></label>
      <button class="btn ghost" type="submit">${esc(t(locale, 'books.bank.show'))}</button>
    </form>
    <p class="caption muted">${esc(t(locale, 'books.trial.made', { from: show.dateYear(locale, new Date(`${p.from}T12:00:00Z`)), to: show.dateYear(locale, new Date(`${p.to}T12:00:00Z`)),
      when: show.dateYear(locale, madeAt) }))}</p>
    ${tb.rows.length === 0 ? `<p class="muted">${esc(t(locale, 'books.trial.none'))}</p>` : `${verdict}<div class="imp-table"><table>
      <thead><tr><th scope="col" rowspan="2">${esc(t(locale, 'books.entry.account'))}</th>${head('books.trial.opening')}${head('books.trial.period')}${head('books.trial.closing')}</tr>
        <tr>${side}${side}${side}</tr></thead>
      <tbody>${tb.rows.map((r) => `<tr><th scope="row">${r.kind === 'earlier_result' ? esc(t(locale, 'books.trial.earlier'))
        : `<bdi>${esc(r.code!)}</bdi> · <bdi>${esc(r.name!)}</bdi>`}</th>${cells(locale, r.opening, currency)}${cells(locale, r.period, currency)}${cells(locale, r.closing, currency)}</tr>`).join('')}</tbody>
      <tfoot><tr><th scope="row">${esc(t(locale, 'books.entry.total'))}</th>${cells(locale, tb.totals.opening, currency)}${cells(locale, tb.totals.period, currency)}${cells(locale, tb.totals.closing, currency)}</tr></tfoot>
    </table></div>`}
    ${tb.rows.length === 0 ? '' : `<div class="block" id="pack"><p>${esc(t(locale, 'books.pack.explain'))}</p>
      <ul class="scard dl-files"><li class="row"><span>${esc(t(locale, 'books.pack.file'))}</span>
        <a class="dl-get" href="/app/books/pack.xlsx?from=${esc(p.from)}&amp;to=${esc(p.to)}" download>${icon('download')}<span>${esc(t(locale, 'books.pack.download'))}</span></a></li></ul></div>`}
    <p><a class="deeper" href="/app/books">${esc(t(locale, 'books.workbook.again'))}</a></p>`;
}
