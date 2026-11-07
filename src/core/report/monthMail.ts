import { messages, t } from '../owner/i18n/messages.js';
import { formatMoney, formatMonth } from '../owner/i18n/format.js';
import type { Money } from '../types/money.js';
import type { MonthReport } from './month.js';

/**
 * Block 4.3 — THE MONTHLY E-MAIL, built from the same MonthReport the page draws (the design spec §3.2). Pure: the
 * job (src/pipeline/monthMail.ts) and the preview (tools/month-report.mjs) hand it a report and three words.
 *
 * Plain text, like the alerts, for the senders this installation has (`SystemMail` carries text); `html` is the same
 * lines as a simple page, for the preview and for a sender that carries HTML. English for every owner, with English
 * dates and money. It NAMES NO CUSTOMER — counts only, as the morning summary — and holds ONE address, the month's
 * page. A count of 0 is said; an amount that is not there is not ("Orders confirmed: 0", never "($0.00)"); the reason
 * lines are the reasons that occurred; the invoices line only once the books were started; the estimate only when
 * the owner set minutes.
 */
export type MonthMail = { readonly subject: string; readonly text: string; readonly html: string };

/**
 * No activity at all (the design spec §1.6): no customer wrote, the assistant sent nothing, no draft was decided,
 * nothing was handed over, no order was confirmed and no invoice was paid in full. Such a month sends no e-mail, and
 * the page draws its empty block instead of the sections.
 */
export function isEmptyMonth(r: MonthReport): boolean {
  return r.firstReply.measured + r.firstReply.waiting === 0
    && r.customersAnswered === 0 && r.replies.alone === 0
    && r.replies.drafted + r.replies.notSent === 0
    && r.handedToYou.length === 0
    && r.orders.confirmed === 0
    && r.invoicesPaid.count === 0;
}

const count = (n: number) => new Intl.NumberFormat('en-US').format(n);
const totalsOf = (ms: readonly Money[]) => ms.map(formatMoney).join(' · ');

/**
 * A length of time, short: "45 sec", "6 min", "3 hr, 20 min", and past 48 hours days and hours ("3 days, 4 hr").
 * Intl units joined by Intl.ListFormat, as `formatTimeLeft` does (Node 22 has no Intl.DurationFormat).
 */
export function shortDuration(seconds: number): string {
  const unit = (n: number, u: 'second' | 'minute' | 'hour' | 'day') =>
    new Intl.NumberFormat('en-US', { style: 'unit', unit: u, unitDisplay: 'short' }).format(n);
  const join = (parts: readonly string[]) => new Intl.ListFormat('en-US', { type: 'unit', style: 'long' }).format(parts);
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return unit(s, 'second');
  if (s < 48 * 3600) {
    const minutes = Math.round(s / 60);
    const [h, m] = [Math.floor(minutes / 60), minutes % 60];
    return join([...(h ? [unit(h, 'hour')] : []), ...(m || !h ? [unit(m, 'minute')] : [])]);
  }
  const hours = Math.round(s / 3600);
  const [d, h] = [Math.floor(hours / 24), hours % 24];
  return join([unit(d, 'day'), ...(h ? [unit(h, 'hour')] : [])]);
}

/** A hand-off's reason, as the owner's pages say it (`takeover.reason.<reason>`), capitalised for a line's label. */
export function reasonLabel(reason: string): string {
  const said = (messages.en as Record<string, string>)[`takeover.reason.${reason}`] ?? t('en', 'monthMail.handedOther');
  return said.charAt(0).toLocaleUpperCase('en') + said.slice(1);
}

/** The estimate's hours: N × M ÷ 60, to one decimal place ("1.5", "12", "0"). */
const hoursOf = (minutes: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(Math.round(minutes / 6) / 10);

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The e-mail for one month. `business` is the workspace's name; `name` the main assistant's chosen name, or null
 * (then "your assistant", rule 7); `url` the month's page, `PUBLIC_BASE_URL` + /app/results/month?month=YYYY-MM.
 */
export function monthMailOf(r: MonthReport, o: { readonly business: string; readonly name: string | null; readonly url: string }): MonthMail {
  const month = formatMonth('en', `${r.month}-01`);
  const named = o.name === null ? {} : { name: o.name };
  const figures: string[] = [
    t('en', 'monthMail.answered', { n: count(r.customersAnswered) }),
    t('en', 'monthMail.alone', { n: count(r.replies.alone), ...named }),
    t('en', 'monthMail.asWritten', { n: count(r.replies.asWritten) }),
    t('en', 'monthMail.edited', { n: count(r.replies.edited) }),
    t('en', 'monthMail.notSent', { n: count(r.replies.notSent) }),
    r.firstReply.medianSeconds === null ? t('en', 'monthMail.medianNone')
      : r.firstReply.measured === 1 ? t('en', 'monthMail.medianOne', { time: shortDuration(r.firstReply.medianSeconds) })
      : t('en', 'monthMail.median', { time: shortDuration(r.firstReply.medianSeconds), n: count(r.firstReply.measured) }),
    r.orders.totals.length > 0 ? t('en', 'monthMail.orders', { n: count(r.orders.confirmed), totals: totalsOf(r.orders.totals) })
      : t('en', 'monthMail.ordersBare', { n: count(r.orders.confirmed) }),
    ...(!r.invoicesPaid.booksStarted ? []
      : [r.invoicesPaid.totals.length > 0 ? t('en', 'monthMail.invoices', { n: count(r.invoicesPaid.count), totals: totalsOf(r.invoicesPaid.totals) })
        : t('en', 'monthMail.invoicesBare', { n: count(r.invoicesPaid.count) })]),
    t('en', 'monthMail.handed', { n: count(r.handedToYou.reduce((n, h) => n + h.n, 0)) }),
  ];
  const reasons = r.handedToYou.map((h) => t('en', 'monthMail.handedReason', { reason: reasonLabel(h.reason), n: count(h.n) }));
  const estimate = r.estimate === null ? null : t('en', 'monthMail.estimate', {
    replies: count(r.estimate.replies), minutes: count(r.estimate.minutesPerReply), hours: hoursOf(r.estimate.minutes),
  });
  const opening = t('en', 'monthMail.opening', { month, business: o.business });
  const open = t('en', 'monthMail.open', { url: o.url });
  const off = t('en', 'monthMail.off');
  const text = [
    opening, '',
    ...figures, ...reasons.map((l) => `  ${l}`), ...(estimate === null ? [] : [estimate]), '',
    open, '', off,
  ].join('\n');
  const li = (l: string) => `<li>${escHtml(l)}</li>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escHtml(month)}</title></head><body>`
    + `<p>${escHtml(opening)}</p><ul>${figures.map(li).join('')}${reasons.length ? `<li><ul>${reasons.map(li).join('')}</ul></li>` : ''}`
    + `${estimate === null ? '' : li(estimate)}</ul>`
    + `<p>${escHtml(open.slice(0, open.length - o.url.length))}<a href="${escHtml(o.url)}">${escHtml(o.url)}</a></p>`
    + `<p>${escHtml(off)}</p></body></html>`;
  return { subject: t('en', 'monthMail.subject', { business: o.business, month }), text, html };
}
