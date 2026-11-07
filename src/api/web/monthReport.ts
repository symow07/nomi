import type { Locale } from '../../core/owner/i18n/locale.js';
import { messages, type MessageKey } from '../../core/owner/i18n/messages.js';
import type { MonthReport, MonthPageOptions } from '../../core/report/month.js';
import type { Money } from '../../core/types/money.js';
import { esc, back, deeper } from './layout.js';
import { t } from './say.js';
import * as show from './values.js';
import { withZone } from './zone.js';
import { flashBanner } from './flash.js';

const BASE = '/app/results/month';
const href = (month: string): string => `${BASE}?month=${encodeURIComponent(month)}`;

/** New copy is English; the surrounding rows still follow the page's direction. */
const words = (text: string): string => `<bdi lang="en" dir="ltr">${esc(text)}</bdi>`;
type CountKey = 'monthReport.median.from' | 'monthReport.median.waiting';

/** The fallback's nouns are English (two forms), even on a page with Arabic number formatting. */
const counted = (locale: Locale, key: CountKey, n: number): string =>
  t(locale, `${key}.${n === 1 ? 'one' : 'other'}`, { n: show.count(locale, n) });

const section = (id: string, title: string, body: string): string =>
  `<section class="results-section" aria-labelledby="month-${id}"><h2 id="month-${id}">${words(title)}</h2>${body}</section>`;

function medianTime(locale: Locale, seconds: number): string {
  if (seconds < 60) return t(locale, 'monthReport.duration.underMinute');
  if (seconds < 48 * 3600) return show.timeLeft(locale, seconds * 1000);
  const hours = Math.floor(seconds / 3600);
  const tag = locale === 'ar' ? 'ar-u-nu-latn' : locale;
  const unit = (n: number, kind: 'day' | 'hour') => new Intl.NumberFormat(tag, {
    style: 'unit', unit: kind, unitDisplay: 'long',
  }).format(n);
  return show.isolate(locale, new Intl.ListFormat(tag, { type: 'unit', style: 'long' }).format([
    unit(Math.floor(hours / 24), 'day'), ...(hours % 24 ? [unit(hours % 24, 'hour')] : []),
  ]));
}

/** The route validates the month and supplies the Results tabs; this renderer draws its one report. */
export function renderMonthReport(report: MonthReport, locale: Locale, options: MonthPageOptions): string {
  const say = (key: MessageKey, params?: Record<string, string | number>) => t(locale, key, params);
  const paragraph = (key: MessageKey, params?: Record<string, string | number>) =>
    `<p class="caption muted">${words(say(key, params))}</p>`;
  const row = (label: string, value: string, definition?: MessageKey, english = true): string =>
    `<div class="result-row"><dt>${english ? words(label) : `<bdi>${esc(label)}</bdi>`}</dt><dd>${esc(value)}</dd>${
      definition ? `<dd class="mr-definition caption muted">${words(say(definition))}</dd>` : ''}</div>`;
  const countRow = (key: MessageKey, n: number, definition: MessageKey) =>
    row(say(key), show.count(locale, n), definition);
  const list = (rows: string) => `<dl class="result-rows">${rows}</dl>`;
  const moneyRows = (totals: readonly Money[], key: MessageKey) => totals.map((amount) =>
    row(say(key), show.money(locale, amount))).join('');
  const selectedMonth = show.month(locale, report.month);

  const index = options.months.indexOf(report.month);
  const previous = index < 0 ? undefined : options.months[index + 1];
  const next = index > 0 ? options.months[index - 1] : undefined;
  const monthDoor = (month: string, direction: 'previous' | 'next') => {
    const label = show.month(locale, month);
    const attrs = `aria-label="${esc(say(`monthReport.picker.${direction}Name`, { month: label }))}"`;
    return direction === 'previous' ? back(href(month), label, attrs) : deeper(href(month), label, '', attrs);
  };
  const picker = `<div class="mr-picker">${previous ? monthDoor(previous, 'previous') : ''}
    <form method="get" action="${BASE}" class="mr-month-form"><label for="month-report-month">${words(say('monthReport.picker.label'))}</label>
      <div class="mr-month-controls"><select id="month-report-month" name="month">${options.months.map((month) =>
        `<option value="${esc(month)}"${month === report.month ? ' selected' : ''}>${esc(show.month(locale, month))}</option>`).join('')}</select>
      <button class="btn" type="submit">${words(say('monthReport.picker.show'))}</button></div></form>
    ${next ? monthDoor(next, 'next') : ''}</div>`;

  const start = new Intl.DateTimeFormat('en-CA', {
    timeZone: report.zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(options.startedAt);
  const part = (type: Intl.DateTimeFormatPartTypes) => start.find((p) => p.type === type)!.value;
  const firstMonth = `${part('year')}-${part('month')}` === report.month && part('day') !== '01';
  const states = (report.running ? paragraph('monthReport.state.running', { month: selectedMonth }) : '')
    + (firstMonth ? paragraph('monthReport.state.firstMonth', {
      date: withZone(report.zone, () => show.date(locale, options.startedAt)),
    }) : '');
  const head = `<header class="results-header">${back('/app', say('split.title'))}
    <h1 class="page">${words(say('monthReport.title'))}</h1><p class="muted">${words(say('monthReport.intro'))}</p></header>
    ${flashBanner(options.flash)}<section class="mr-month" aria-labelledby="month-period"><h2 id="month-period">${esc(selectedMonth)}</h2>${states}${picker}</section>`;

  const knownReason = (reason: string) => Object.hasOwn(messages.en, `takeover.reason.${reason}`);
  const handed = [...report.handedToYou].sort((a, b) =>
    Number(knownReason(b.reason)) - Number(knownReason(a.reason)) || b.n - a.n || a.reason.localeCompare(b.reason));
  const handedCount = handed.reduce((sum, item) => sum + item.n, 0);
  const hasActivity = report.customersAnswered + report.replies.alone + report.replies.drafted + report.replies.notSent
    + report.firstReply.measured + report.firstReply.waiting + report.orders.confirmed + report.invoicesPaid.count + handedCount > 0;

  let figures: string;
  if (!hasActivity) {
    figures = `<section class="empty results-empty" aria-labelledby="month-empty"><h2 id="month-empty">${words(say('monthReport.empty.title', { month: selectedMonth }))}</h2>
      <p class="muted">${words(say(report.running ? 'monthReport.empty.running' : 'monthReport.empty.past'))}</p>${
      report.running && !options.setupDone ? `<p>${deeper('/app/get-started', say('monthReport.empty.setup'))}</p>` : ''}</section>`;
  } else {
    figures = section('customers', say('monthReport.section.customers'), list(
      countRow('monthReport.n.answered', report.customersAnswered, 'monthReport.def.answered')));
    figures += section('replies', say('monthReport.section.replies'), list(
      countRow('monthReport.n.alone', report.replies.alone, 'monthReport.def.alone')
      + countRow('monthReport.n.asWritten', report.replies.asWritten, 'monthReport.def.asWritten')
      + countRow('monthReport.n.edited', report.replies.edited, 'monthReport.def.edited')
      + countRow('monthReport.replies.notSent', report.replies.notSent, 'monthReport.def.notSent')));
    figures += section('speed', say('monthReport.section.speed'),
      (report.firstReply.medianSeconds === null ? paragraph('monthReport.median.none')
        : list(row(say('monthReport.median.label'), medianTime(locale, report.firstReply.medianSeconds), 'monthReport.def.median'))
          + `<p class="caption muted">${words(counted(locale, 'monthReport.median.from', report.firstReply.measured))}</p>`)
      + (report.firstReply.waiting > 0 ? `<p class="caption muted">${words(counted(locale, 'monthReport.median.waiting', report.firstReply.waiting))}</p>` : ''));
    figures += section('orders', say('monthReport.section.orders'), list(
      countRow('monthReport.n.orders', report.orders.confirmed, 'monthReport.def.orders')
      + moneyRows(report.orders.totals, 'monthReport.orders.value'))
      + (report.orders.confirmed === 0 ? paragraph('monthReport.orders.none') : ''));
    if (options.canSetMinutes) figures += section('invoices', say('monthReport.section.invoices'),
      report.invoicesPaid.booksStarted ? list(
        countRow('monthReport.n.invoicesPaid', report.invoicesPaid.count, 'monthReport.def.invoices')
        + moneyRows(report.invoicesPaid.totals, 'monthReport.invoices.value'))
        + (report.invoicesPaid.count === 0 ? paragraph('monthReport.invoices.none') : '')
        : paragraph('monthReport.invoices.noBooks') + `<p>${deeper('/app/books', say('monthReport.invoices.openBooks'))}</p>`);
    figures += section('handed', say('monthReport.section.handed'), list(
      countRow('monthReport.n.handed', handedCount, 'monthReport.def.handed')
      + handed.map(({ reason, n }) => {
        const key = `takeover.reason.${reason}` as MessageKey;
        const known = Object.hasOwn(messages.en, key);
        const label = known ? say(key) : say('monthReport.handed.other');
        return row(label.charAt(0).toLocaleUpperCase(locale) + label.slice(1), show.count(locale, n), undefined, !known);
      }).join('')) + (handedCount === 0 ? paragraph('monthReport.handed.none') : ''));
  }

  const estimate = report.estimate;
  const savedTime = estimate ? section('estimate', say('monthReport.section.estimate'),
    (estimate.replies === 0 ? paragraph('monthReport.estimate.nothing')
      : `<p class="mr-formula" lang="en" dir="ltr">${esc(say('monthReport.estimate.formula', {
        replies: show.count(locale, estimate.replies), minutes: show.count(locale, estimate.minutesPerReply),
        hours: show.count(locale, Math.round(estimate.minutes / 6) / 10),
      }))}</p>`)
    + paragraph('monthReport.estimate.label') + (options.canSetMinutes ? '' : paragraph('monthReport.estimate.byOwner'))) : '';
  const hiddenMonth = `<input type="hidden" name="month" value="${esc(report.month)}">`;
  const minutes = options.canSetMinutes ? `<details class="mr-minutes"><summary>${words(say(estimate ? 'monthReport.estimate.change' : 'monthReport.estimate.open'))}</summary>
    <form method="post" action="${BASE}/minutes" class="pform">${hiddenMonth}
      <label for="month-report-minutes">${words(say('monthReport.estimate.minutes'))}</label>
      <input id="month-report-minutes" name="minutes" type="text" value="${estimate?.minutesPerReply ?? ''}" inputmode="numeric" aria-describedby="month-minutes-hint">
      <p id="month-minutes-hint" class="caption muted">${words(say('monthReport.estimate.hint'))}</p>
      <button class="btn send" type="submit">${words(say('monthReport.estimate.save'))}</button></form></details>` : '';
  const mail = options.canSetMinutes ? section('mail', say('monthReport.section.mail'),
    paragraph(report.mailOff ? 'monthReport.mail.off' : 'monthReport.mail.on')
    + `<form method="post" action="${BASE}/mail">${hiddenMonth}<button class="btn" type="submit" name="mail" value="${report.mailOff ? 'on' : 'off'}">${
      words(say(report.mailOff ? 'monthReport.mail.start' : 'monthReport.mail.stop'))}</button></form>`) : '';

  return `<div class="results-page month-report">${head}${figures}${savedTime}${minutes}${mail}</div>`;
}
