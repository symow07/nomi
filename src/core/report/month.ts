import { type Money, moneyOf } from '../types/money.js';

/**
 * Block 4.3 — "WHAT NOMI DID FOR YOU": one month of the workspace, read from the rows it already keeps.
 *
 * This file is the CONTRACT between the loader (`src/db/monthReport.ts`), the page
 * (`src/api/web/monthReport.ts`) and the monthly e-mail. It is pure: no database, no clock.
 *
 * Every figure is a COUNT or a SUM over existing rows, like the Results page (`src/api/web/analytics.ts`) and by
 * its rules: the owner's test conversations count for nothing, a practice copy is another business row, money is
 * one total per currency and never two added together. Nothing is estimated — except `estimate`, which exists
 * only once the owner has typed their own minutes per reply, is shown as its formula and is labelled an estimate.
 */
export type MonthReport = {
  /** The month, "YYYY-MM", in the workspace's own zone. */
  readonly month: string;
  /** The workspace's zone the month was cut in (an IANA name). */
  readonly zone: string;
  /** The month as instants, half open: [from, to). */
  readonly from: Date;
  readonly to: Date;
  /** The month has not ended yet: the figures are so far. */
  readonly running: boolean;
  /** Customers to whom a reply the assistant wrote went out in the month (Home's "handled", by customer). */
  readonly customersAnswered: number;
  /**
   * Replies the assistant wrote that left in the month.
   *   alone      sent without anyone's approval (an `auto_sent` event whose message left);
   *   drafted    drafted, then sent by a person: asWritten + edited;
   *   asWritten  approved with the words unchanged;
   *   edited     changed by a person before it went;
   *   notSent    drafted, and decided in the month without going out: no reply chosen (rejected), overtaken by the
   *              owner's own reply in the channel's app (superseded), or the time to reply ran out (expired).
   *              Never part of `drafted`.
   */
  readonly replies: {
    readonly alone: number; readonly drafted: number; readonly asWritten: number; readonly edited: number; readonly notSent: number;
  };
  /**
   * Time to the first reply. For each customer who wrote in the month, the clock time from their first message of the
   * month to the first message after it that reached them, whoever wrote it (nights and weekends count: business hours
   * are free text). `medianSeconds` is the median over the `measured` customers who had such a reply; null when none
   * did. `waiting` counts those who wrote in the month and have had no reply since: they are left out of the median.
   * measured + waiting is everyone who wrote in the month.
   */
  readonly firstReply: { readonly medianSeconds: number | null; readonly measured: number; readonly waiting: number };
  /** Orders that stand, confirmed in the month, and their value — one total per currency. */
  readonly orders: { readonly confirmed: number; readonly totals: readonly Money[] };
  /**
   * Invoices paid in full in the month, from the books' own payment rows: issued invoices whose last payment, refunds
   * aside, is dated in the month and left nothing owed. The totals are what those invoices were for, one per currency —
   * not the cash received in the month. `booksStarted`: an issued invoice has ever existed in the workspace.
   */
  readonly invoicesPaid: { readonly count: number; readonly totals: readonly Money[]; readonly booksStarted: boolean };
  /**
   * Conversations handed to a person in the month, by the reason recorded with the hand-off (a signal type, as
   * `takeover.reason.<reason>` names it), most first.
   */
  readonly handedToYou: readonly { readonly reason: string; readonly n: number }[];
  /**
   * Only when the owner set minutes per reply: that figure × the replies counted (sent alone + drafts sent as
   * written; edited drafts are not counted). Null otherwise.
   */
  readonly estimate: null | { readonly minutesPerReply: number; readonly replies: number; readonly minutes: number };
  /** The owner stopped the monthly e-mail on the month page (`businesses.month_report_mail_off_at` is set). */
  readonly mailOff: boolean;
};

/**
 * What the month page is drawn with besides the report (`renderMonthReport(report, locale, options)`,
 * src/api/web/monthReport.ts). `flash` has the shape of the web layer's `Flash` (src/api/web/flash.ts), declared here
 * so this file stays pure; draw it with `flashBanner`.
 */
export type MonthPageOptions = {
  /** The viewer is the owner: the minutes form, the e-mail switch and the invoices are drawn. Staff: none of them. */
  readonly canSetMinutes: boolean;
  /** Every month the picker offers, "YYYY-MM", newest first: the current month down to the workspace's first. */
  readonly months: readonly string[];
  readonly flash: { readonly text: string; readonly bad: boolean } | null;
  readonly now: Date;
  /** When the workspace began: `signed_up_at`, else `created_at` ("Counted from {date}" on its first month). */
  readonly startedAt: Date;
  /** Getting started is complete (the empty current month offers a door to it while it is not). */
  readonly setupDone: boolean;
};

/** The minutes per reply the owner may set (`businesses.report_minutes_per_reply`, 0231): a whole number, 1–60. */
export const MINUTES_PER_REPLY_MIN = 1;
export const MINUTES_PER_REPLY_MAX = 60;

/** A month as the page and the route take it: "YYYY-MM", month 01–12, year 2000–2999. */
export function isMonth(raw: unknown): raw is string {
  return typeof raw === 'string' && /^2\d{3}-(0[1-9]|1[0-2])$/.test(raw);
}

/**
 * The estimate, or null. It exists only when the owner typed a whole number of minutes from 1 to 60: anything else
 * (nothing set, a figure outside the range) is no estimate at all, never a default. The replies counted are the ones
 * the owner did not have to write: sent alone, and drafts sent as written. A draft the owner edited is not counted —
 * they wrote part of it (the design spec, docs/design/block4/month-report.md §2.2). Shown as its formula:
 * minutesPerReply × replies = minutes; the page writes the minutes as hours.
 */
export function estimateOf(
  minutesPerReply: number | null | undefined,
  replies: MonthReport['replies'],
): MonthReport['estimate'] {
  if (minutesPerReply === null || minutesPerReply === undefined) return null;
  if (!Number.isInteger(minutesPerReply) || minutesPerReply < MINUTES_PER_REPLY_MIN || minutesPerReply > MINUTES_PER_REPLY_MAX) return null;
  const n = replies.alone + replies.asWritten;
  return { minutesPerReply, replies: n, minutes: minutesPerReply * n };
}

const FIXTURE_REPLIES = { alone: 61, drafted: 37, asWritten: 29, edited: 8, notSent: 5 } as const;

/**
 * A finished month, every field filled, for the page's and the e-mail's tests and for designing against. The zone
 * crosses a clock change inside the month (London leaves summer time on 25 October 2026), so `from` and `to` are
 * not a whole number of 24-hour days apart.
 */
export const FIXTURE_MONTH_REPORT: MonthReport = {
  month: '2026-10',
  zone: 'Europe/London',
  from: new Date('2026-09-30T23:00:00.000Z'),
  to: new Date('2026-11-01T00:00:00.000Z'),
  running: false,
  customersAnswered: 42,
  replies: FIXTURE_REPLIES,
  firstReply: { medianSeconds: 94, measured: 40, waiting: 3 },
  orders: { confirmed: 7, totals: [moneyOf('1840.00', 'USD')] },
  invoicesPaid: { count: 5, totals: [moneyOf('1210.50', 'USD')], booksStarted: true },
  handedToYou: [
    { reason: 'human_requested', n: 4 },
    { reason: 'price_to_owner', n: 2 },
    { reason: 'stock_asked', n: 1 },
  ],
  estimate: estimateOf(3, FIXTURE_REPLIES),
  mailOff: false,
};
