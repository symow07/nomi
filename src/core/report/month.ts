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
   *   edited     changed by a person before it went.
   */
  readonly replies: { readonly alone: number; readonly drafted: number; readonly asWritten: number; readonly edited: number };
  /**
   * Time to the first reply, per conversation whose first customer message fell in the month: the median, in
   * seconds, over the `measured` conversations that were answered. Null when none was.
   */
  readonly firstReply: { readonly medianSeconds: number | null; readonly measured: number };
  /** Orders that stand, confirmed in the month, and their value — one total per currency. */
  readonly orders: { readonly confirmed: number; readonly totals: readonly Money[] };
  /** Invoices paid in the month, from the books' own payment rows — one total per currency. */
  readonly invoicesPaid: { readonly count: number; readonly totals: readonly Money[] };
  /**
   * Conversations handed to a person in the month, by the reason recorded with the hand-off (a signal type, as
   * `takeover.reason.<reason>` names it), most first.
   */
  readonly handedToYou: readonly { readonly reason: string; readonly n: number }[];
  /** Only when the owner set minutes per reply: that figure × the replies the assistant wrote. Null otherwise. */
  readonly estimate: null | { readonly minutesPerReply: number; readonly replies: number; readonly minutes: number };
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
 * the assistant wrote that left — sent alone, or drafted and sent by a person — because those are the replies the
 * owner did not have to write from nothing. Shown as its formula: minutesPerReply × replies = minutes.
 */
export function estimateOf(
  minutesPerReply: number | null | undefined,
  replies: MonthReport['replies'],
): MonthReport['estimate'] {
  if (minutesPerReply === null || minutesPerReply === undefined) return null;
  if (!Number.isInteger(minutesPerReply) || minutesPerReply < MINUTES_PER_REPLY_MIN || minutesPerReply > MINUTES_PER_REPLY_MAX) return null;
  const n = replies.alone + replies.drafted;
  return { minutesPerReply, replies: n, minutes: minutesPerReply * n };
}

const FIXTURE_REPLIES = { alone: 61, drafted: 37, asWritten: 29, edited: 8 } as const;

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
  firstReply: { medianSeconds: 94, measured: 40 },
  orders: { confirmed: 7, totals: [moneyOf('1840.00', 'USD')] },
  invoicesPaid: { count: 5, totals: [moneyOf('1210.50', 'USD')] },
  handedToYou: [
    { reason: 'human_requested', n: 4 },
    { reason: 'price_to_owner', n: 2 },
    { reason: 'stock_asked', n: 1 },
  ],
  estimate: estimateOf(3, FIXTURE_REPLIES),
};
