import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import { decimal, subDecimal, signOf, type Decimal } from '../../core/types/decimal.js';
import type { XlsxValue } from '../../net/xlsx.js';
import { esc } from './layout.js';
import { t } from './say.js';
import { booksMoney, booksDay } from './booksOverview.js';
import { SPANS, AGE_BUCKETS, type Span, type Made, type Money, type Tax, type Customers, type Unpaid } from '../../db/booksOwnerReports.js';

/**
 * REPORTS IN THE OWNER'S WORDS (Block 2 PR 5) — one page shape for five reports: the period switch (this month, this
 * quarter, this year), the figures (`dl.ba-money`, the home's own), the rows behind them (`ul.rows`), a download. The
 * accountant's pages are untouched. No new CSS: the Books area's classes only.
 */
export type OwnerReportKind = 'made' | 'money' | 'tax' | 'customers' | 'unpaid';
export const OWNER_REPORT_KINDS: readonly OwnerReportKind[] = ['made', 'money', 'tax', 'customers', 'unpaid'];
export type OwnerReport = { kind: 'made'; data: Made } | { kind: 'money'; data: Money } | { kind: 'tax'; data: Tax } | { kind: 'customers'; data: Customers } | { kind: 'unpaid'; data: Unpaid };

const say = (locale: Locale, key: MessageKey, p: Record<string, string | number> = {}) => esc(t(locale, key, p));
const money = (locale: Locale, v: Decimal, cur: string) => booksMoney(locale, v, cur);
const metric = (locale: Locale, key: MessageKey, v: Decimal, cur: string) => `<div><dt>${say(locale, key)}</dt><dd>${money(locale, v, cur)}</dd></div>`;
const entryHref = (id: string, from: string) => `/app/books/advanced/entries/${encodeURIComponent(id)}?from=${encodeURIComponent(from)}`;
const title = (kind: OwnerReportKind): MessageKey => `ownerReport.${kind}` as MessageKey;

function spanSwitch(locale: Locale, kind: OwnerReportKind, span: Span): string {
  return `<nav class="ba-actions" aria-label="${say(locale, 'booksReport.filters')}">${SPANS.map((s) => `<a href="/app/books/reports/${kind}?period=${s}"${s === span ? ' aria-current="page"' : ''}>${say(locale, `ownerReport.span.${s}` as MessageKey)}</a>`).join('')}</nav>`;
}
const periodLine = (locale: Locale, from: string, to: string) => `<p><bdi>${esc(t(locale, 'ownerReport.period', { from: booksDay(locale, from), to: booksDay(locale, to) }))}</bdi></p>`;
const download = (locale: Locale, kind: OwnerReportKind, span: Span) => `<p><a class="deeper" href="/app/books/reports/${kind}.xlsx?period=${span}">${say(locale, 'ownerReport.download')}</a></p>`;
const rows = (locale: Locale, items: string, none: MessageKey) => items ? `<ul class="rows">${items}</ul>` : `<p class="muted">${say(locale, none)}</p>`;

export function renderOwnerReport(locale: Locale, r: OwnerReport, span: Span, cur: string): string {
  const here = `/app/books/reports/${r.kind}?period=${span}`;
  const head = `<section class="ba-overview"><p><a href="/app/books/reports">${say(locale, 'booksArea.reports')}</a></p><h1 class="page">${say(locale, title(r.kind))}</h1><p class="lede">${say(locale, `ownerReport.${r.kind}.hint` as MessageKey)}</p>`;
  let body: string;
  switch (r.kind) {
    case 'made': {
      const d = r.data, loss = signOf(d.result) < 0;
      body = spanSwitch(locale, r.kind, span) + periodLine(locale, d.period.from, d.period.to)
        + `<dl class="ba-money">${metric(locale, 'ownerReport.income', d.income, cur)}${metric(locale, 'ownerReport.spending', d.spending, cur)}${metric(locale, loss ? 'ownerReport.loss' : 'ownerReport.result', d.result, cur)}</dl>`
        + rows(locale, d.rows.map((x) => `<li class="row"><span><bdi>${esc(x.code)} · ${esc(x.name)}</bdi> <span class="caption muted">${say(locale, x.kind === 'income' ? 'ownerReport.income' : 'ownerReport.spending')}</span></span><b>${money(locale, x.amount, cur)}</b></li>`).join(''), 'ownerReport.none');
      break;
    }
    case 'money': {
      const d = r.data;
      body = spanSwitch(locale, r.kind, span) + periodLine(locale, d.period.from, d.period.to)
        + (d.state === 'needs_setup' ? `<p>${say(locale, 'ownerReport.noMoneyAccounts')} <a href="/app/settings/books/accounts">${say(locale, 'booksArea.chooseAccounts')}</a></p>`
          : `<dl class="ba-money">${metric(locale, 'ownerReport.in', d.in, cur)}${metric(locale, 'ownerReport.out', d.out, cur)}${metric(locale, 'ownerReport.net', subDecimal(d.in, d.out), cur)}</dl>`
            + (signOf(d.opening) !== 0 ? `<p class="caption muted"><bdi>${esc(t(locale, 'ownerReport.opening', { amount: booksMoney(locale, d.opening, cur).replace(/<\/?bdi>/g, '') }))}</bdi></p>` : '')
            + rows(locale, d.rows.map((x) => `<li class="row"><span><a href="${esc(entryHref(x.id, here))}"><bdi>${esc(x.label)}</bdi></a> <span class="caption muted">${esc(booksDay(locale, x.date))}</span></span><b>${signOf(x.in) !== 0 ? money(locale, x.in, cur) : ''}${signOf(x.out) !== 0 ? `−${money(locale, x.out, cur)}` : ''}</b></li>`).join(''), 'ownerReport.none'));
      break;
    }
    case 'tax': {
      const d = r.data, refund = signOf(d.owed) < 0;
      body = spanSwitch(locale, r.kind, span) + periodLine(locale, d.period.from, d.period.to)
        + `<dl class="ba-money">${metric(locale, 'ownerReport.collected', d.collected, cur)}${metric(locale, 'ownerReport.deductible', d.deductible, cur)}${metric(locale, refund ? 'ownerReport.refund' : 'ownerReport.owed', refund ? decimal(d.owed.slice(1)) : d.owed, cur)}</dl>`
        + rows(locale, d.rows.map((x) => `<li class="row"><span><bdi>${esc(x.code)} · ${esc(x.label)}</bdi> <span class="caption muted">${say(locale, 'ownerReport.rate', { rate: x.rate })} · ${esc(t(locale, 'ownerReport.base', { amount: booksMoney(locale, x.base, cur).replace(/<\/?bdi>/g, '') }))}</span></span><b>${money(locale, x.tax, cur)}</b></li>`).join(''), 'ownerReport.none');
      break;
    }
    case 'customers': {
      const d = r.data;
      body = spanSwitch(locale, r.kind, span) + periodLine(locale, d.period.from, d.period.to)
        + `<dl class="ba-money">${metric(locale, 'ownerReport.total', d.total, cur)}</dl>`
        + rows(locale, d.rows.map((x) => `<li class="row"><span><a href="/app/books/invoices?q=${encodeURIComponent(x.name)}"><bdi>${esc(x.name)}</bdi></a> <span class="caption muted">${x.invoices === 1 ? say(locale, 'ownerReport.oneInvoice') : say(locale, 'ownerReport.invoices', { n: x.invoices })}</span></span><b>${money(locale, x.billed, x.currency)}</b></li>`).join('')
          + (d.others ? `<li class="row"><span class="muted">${esc(t(locale, 'ownerReport.others', { n: d.others.customers, amount: booksMoney(locale, d.others.billed, cur).replace(/<\/?bdi>/g, '') }))}</span></li>` : ''), 'ownerReport.none');
      break;
    }
    case 'unpaid': {
      const d = r.data;
      body = `<p class="muted">${say(locale, 'ownerReport.asOf', { date: booksDay(locale, d.today) })}</p>`
        + `<dl class="ba-money">${metric(locale, 'ownerReport.total', d.total, cur)}${AGE_BUCKETS.filter((b) => signOf(d.byBucket[b]) !== 0).map((b) => metric(locale, `ownerReport.bucket.${b}` as MessageKey, d.byBucket[b], cur)).join('')}</dl>`
        + rows(locale, d.rows.map((x) => `<li class="row"><span><a href="/app/books/invoices/${esc(x.id)}"><bdi>${esc(x.key)} · ${esc(x.name)}</bdi></a> <span class="caption muted">${x.dueDate ? say(locale, 'ownerReport.due', { date: booksDay(locale, x.dueDate) }) : say(locale, 'ownerReport.noDue')}${x.daysPastDue && x.daysPastDue > 0 ? ` · ${say(locale, 'ownerReport.late', { n: x.daysPastDue })}` : ''}</span></span><b>${money(locale, x.owed, x.currency)}</b></li>`).join(''), 'ownerReport.noneUnpaid');
      break;
    }
  }
  return head + body + download(locale, r.kind, span) + '</section>';
}

/** The same report as a spreadsheet: one sheet, the figures first, then the rows. Numbers as numbers. */
export function ownerReportSheet(locale: Locale, r: OwnerReport, cur: string): { readonly name: string; readonly rows: readonly (readonly XlsxValue[])[] } {
  const w = (key: MessageKey, p: Record<string, string | number> = {}) => t(locale, key, p);
  const n = (v: Decimal | string): XlsxValue => ({ number: String(v) });
  const out: XlsxValue[][] = [[w(title(r.kind))], [w('ownerReport.sheet.about')]];
  switch (r.kind) {
    case 'made': {
      const d = r.data;
      out.push([w('ownerReport.period', { from: d.period.from, to: d.period.to }), cur], [], [w('ownerReport.income'), n(d.income)], [w('ownerReport.spending'), n(d.spending)], [w('ownerReport.result'), n(d.result)], [],
        [w('ownerReport.col.account'), '', w('ownerReport.col.amount')], ...d.rows.map((x): XlsxValue[] => [x.code, x.name, n(x.amount)]));
      break;
    }
    case 'money': {
      const d = r.data;
      out.push([w('ownerReport.period', { from: d.period.from, to: d.period.to }), cur], [], [w('ownerReport.in'), n(d.in)], [w('ownerReport.out'), n(d.out)], [w('ownerReport.net'), n(subDecimal(d.in, d.out))],
        ...(signOf(d.opening) !== 0 ? [[w('ownerReport.opening', { amount: d.opening })] as XlsxValue[]] : []), [],
        [w('ownerReport.col.date'), w('ownerReport.col.entry'), w('ownerReport.in'), w('ownerReport.out')], ...d.rows.map((x): XlsxValue[] => [x.date, x.label, n(x.in), n(x.out)]));
      break;
    }
    case 'tax': {
      const d = r.data;
      out.push([w('ownerReport.period', { from: d.period.from, to: d.period.to }), cur], [], [w('ownerReport.collected'), n(d.collected)], [w('ownerReport.deductible'), n(d.deductible)], [w('ownerReport.owed'), n(d.owed)], [],
        [w('ownerReport.col.code'), '', w('ownerReport.rate', { rate: '' }).trim(), w('ownerReport.col.amount'), w('ownerReport.owed')], ...d.rows.map((x): XlsxValue[] => [x.code, x.label, n(x.rate), n(x.base), n(x.tax)]));
      break;
    }
    case 'customers': {
      const d = r.data;
      out.push([w('ownerReport.period', { from: d.period.from, to: d.period.to }), cur], [], [w('ownerReport.total'), n(d.total)], [],
        [w('ownerReport.col.customer'), w('ownerReport.col.invoice'), w('ownerReport.col.amount')], ...d.rows.map((x): XlsxValue[] => [x.name, n(String(x.invoices)), n(x.billed)]),
        ...(d.others ? [[w('ownerReport.others', { n: d.others.customers, amount: d.others.billed })] as XlsxValue[]] : []));
      break;
    }
    case 'unpaid': {
      const d = r.data;
      out.push([w('ownerReport.asOf', { date: d.today }), cur], [], [w('ownerReport.total'), n(d.total)], ...AGE_BUCKETS.map((b): XlsxValue[] => [w(`ownerReport.bucket.${b}` as MessageKey), n(d.byBucket[b])]), [],
        [w('ownerReport.col.invoice'), w('ownerReport.col.customer'), w('ownerReport.col.date'), w('ownerReport.col.age'), w('ownerReport.col.amount')],
        ...d.rows.map((x): XlsxValue[] => [x.key, x.name, x.dueDate ?? '', x.daysPastDue === null ? '' : n(String(x.daysPastDue)), n(x.owed)]));
      break;
    }
  }
  return { name: w(title(r.kind)).slice(0, 31), rows: out };
}
