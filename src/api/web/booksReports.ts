import { type Locale } from '../../core/owner/i18n/locale.js';
import type { Decimal } from '../../core/types/decimal.js';
import { moneyFromRow } from '../../core/types/money.js';
import type { Sides, TrialBalance } from '../../core/books/trialBalance.js';
import type { Period } from '../../db/booksReports.js';
import { FEC_FILENAME_DEFAULT, fecFileName } from '../../core/books/fec.js';
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

/**
 * D4 (Avis 24) — THE MOROCCAN FEC on a page: each fiscal year, its check program's verdict (the numbers of each
 * journal, no gap, no repeat), the accounts whose number does not begin as the CGNC's do, and its file.
 */
export type FecYearView = {
  readonly id: string; readonly startsOn: string; readonly endsOn: string; readonly state: string; readonly lines: number;
  readonly numbering: readonly { journal: string; missing: number[]; repeated: number[] }[];
  readonly offChart: readonly { code: string; name: string }[];
};

/** E2 (0206) — which of the business's identifiers the file still goes without, said with the door to where they are given. */
export type FecIdentityGaps = readonly ('ice' | 'taxId' | 'rc')[];

/**
 * R2 (0209) — the file's name: Nomi's default convention, the workspace's to change. Said as a default, in the words
 * docs/PHASE-5.md records (`books.fec.filename.note`) — never "required", "official" or the DGI's. Changed by the
 * owner only (`business_identifiers`); anyone else reads it.
 */
export type FecFileNaming = { readonly pattern: string; readonly ice: string | null; readonly canChange: boolean };

function fecFileNaming(locale: Locale, f: FecFileNaming): string {
  const tokens = { ice: '{ICE}', date: '{YYYYMMDD}' };
  return `<div class="block" id="file-name">
      <h2>${esc(t(locale, 'books.fec.filename.label'))}</h2>
      <p>${esc(t(locale, 'books.fec.filename.note'))}</p>
      ${f.canChange ? `<form method="post" action="/app/books/fec/filename" class="pform">
        <label class="pq"><span>${esc(t(locale, 'books.fec.filename.label'))}</span><input name="pattern" value="${esc(f.pattern)}" maxlength="80" dir="ltr" required /></label>
        <p class="caption muted">${esc(t(locale, 'books.fec.filename.help', tokens))}</p>
        <button class="btn" type="submit">${esc(t(locale, 'books.fec.filename.save'))}</button></form>`
        : `<p><bdi dir="ltr">${esc(f.pattern)}</bdi></p><p class="caption muted">${esc(t(locale, 'books.fec.filename.help', tokens))}</p>`}
    </div>`;
}

export function renderFec(locale: Locale, years: readonly FecYearView[], gaps: FecIdentityGaps = [],
  file: FecFileNaming = { pattern: FEC_FILENAME_DEFAULT, ice: null, canChange: false }): string {
  const d = (iso: string) => esc(show.dateYear(locale, new Date(`${iso}T12:00:00Z`)));
  const name = { ice: 'settings.ids.ice', taxId: 'settings.ids.if', rc: 'settings.ids.rc' } as const;
  return `<h1 class="page">${esc(t(locale, 'books.fec.title'))}</h1>
    <p class="lede">${esc(t(locale, 'books.fec.lede'))}</p>
    ${gaps.length === 0 ? '' : `<p role="status"><span class="pill warn">${esc(t(locale, 'books.fec.identityMissing', { which: gaps.map((g) => t(locale, name[g])).join(' · ') }))}</span>
      <a class="deeper" href="/app/settings/profile#identifiers">${esc(t(locale, 'settings.ids.title'))}</a></p>`}
    ${years.length === 0 ? `<p class="muted">${esc(t(locale, 'books.close.noYear'))}</p>` : years.map((y) => `<div class="block">
      <h2>${d(y.startsOn)} – ${d(y.endsOn)}</h2>
      <p>${y.state === 'open' ? `<span class="pill warn">${esc(t(locale, 'books.fec.open'))}</span>` : `<span class="pill ok">${esc(t(locale, 'books.close.year.closed'))}</span>`}</p>
      <p role="status">${y.numbering.length === 0 ? `<span class="pill ok">${esc(t(locale, 'books.fec.numberingOk'))}</span>`
        : y.numbering.map((n) => `<span class="pill stop">${esc(t(locale, 'books.fec.numberingBad', { journal: n.journal, missing: n.missing.join(', ') || '—', repeated: n.repeated.join(', ') || '—' }))}</span>`).join(' ')}</p>
      ${y.offChart.length === 0 ? '' : `<p role="alert">${esc(t(locale, 'books.fec.offChart'))}</p><ul class="rows">${y.offChart.map((a) =>
        `<li class="row"><span><bdi>${esc(a.code)}</bdi> · <bdi>${esc(a.name)}</bdi></span></li>`).join('')}</ul>`}
      ${y.lines === 0 ? `<p class="muted">${esc(t(locale, 'books.trial.none'))}</p>` : `<ul class="scard dl-files"><li class="row"><span>${esc(t(locale, 'books.fec.file', { n: y.lines }))}
        · <bdi dir="ltr">${esc(fecFileName(file.pattern, { ice: file.ice, closesOn: y.endsOn }))}</bdi></span>
        <a class="dl-get" href="/app/books/fec/${esc(y.id)}.txt" download>${icon('download')}<span>${esc(t(locale, 'books.pack.download'))}</span></a></li></ul>`}
    </div>`).join('')}
    ${fecFileNaming(locale, file)}
    <p class="caption muted">${esc(t(locale, 'books.fec.envelope'))}</p>
    <p><a class="deeper" href="/app/books">${esc(t(locale, 'books.workbook.again'))}</a></p>`;
}
