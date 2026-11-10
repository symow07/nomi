import { describe, it, expect } from 'vitest';
import { FIXTURE_MONTH_REPORT, estimateOf, type MonthReport } from '../../src/core/report/month.js';
import { isEmptyMonth, monthMailOf, reasonLabel, shortDuration } from '../../src/core/report/monthMail.js';
import { MONTH_MAIL_EN } from '../../src/core/owner/i18n/monthMail.js';
import { readMinutesPerReply } from '../../src/db/monthReport.js';
import { monthMailOn } from '../../src/pipeline/monthMail.js';
import { BANNED_OWNER_TERMS } from '../../src/core/owner/vocabulary.js';
import { moneyOf } from '../../src/core/types/money.js';

/**
 * Block 4.3 — the monthly e-mail's words (the design spec §3.2, §4.2), built from the contract's fixture month. The
 * job and the claim are tests/integration/did-for-you.test.ts.
 */
const URL = 'https://app.example.test/app/results/month?month=2026-10';
const mail = (r: MonthReport = FIXTURE_MONTH_REPORT, name: string | null = 'Lily') => monthMailOf(r, { business: 'Atlas Mode', name, url: URL });
const ZERO: MonthReport = {
  ...FIXTURE_MONTH_REPORT,
  customersAnswered: 0, replies: { alone: 0, drafted: 0, asWritten: 0, edited: 0, notSent: 0 },
  firstReply: { medianSeconds: null, measured: 0, waiting: 0 }, orders: { confirmed: 0, totals: [] },
  invoicesPaid: { count: 0, totals: [], booksStarted: true }, handedToYou: [], estimate: null,
};

describe('Block 4.3 · the monthly e-mail', () => {
  it('says the fixture month line by line, as the spec writes it', () => {
    const m = mail();
    expect(m.subject).toBe('Atlas Mode · What Nomi did for you in October 2026');
    expect(m.text).toBe([
      'Here is October 2026 at Atlas Mode.',
      '',
      'Customers answered: 42',
      'Replies Lily sent alone: 61',
      'Drafts you sent as written: 29',
      'Drafts you edited, then sent: 8',
      'Drafts not sent: 5',
      'Median time to first reply: 2 min, from 40 customers',
      'Orders confirmed: 7 ($1,840.00)',
      'Invoices paid in full: 5 ($1,210.50)',
      'Hand-offs to you: 7',
      '  The customer asked for a person: 4',
      '  A price question — your prices go to you: 2',
      '  A stock question — only you know what is on the shelf: 1',
      'Time saved, an estimate: 90 replies × 3 min = 4.5 h',
      '',
      `See the month in Nomi: ${URL}`,
      '',
      'This e-mail comes on the 1st of each month. You can stop it at the foot of that page.',
    ].join('\n'));
  });

  it('holds exactly one address, the month page, in the text and in the HTML', () => {
    const m = mail();
    expect(m.text.match(/https?:\/\/\S+/g)).toEqual([URL]);
    expect([...m.html.matchAll(/href="([^"]+)"/g)].map((x) => x[1])).toEqual([URL]);
    expect(m.html).toContain('<li>Replies Lily sent alone: 61</li>');
    expect(mail({ ...FIXTURE_MONTH_REPORT, handedToYou: [{ reason: '<b>', n: 1 }] }).html).not.toContain('<b>');
  });

  it('a count of 0 is said; an amount that is not there is not; the books only once started; the estimate only when set', () => {
    const m = mail(ZERO, null);
    expect(m.text).toContain('Customers answered: 0\nReplies your assistant sent alone: 0\n');
    expect(m.text).toContain('\nOrders confirmed: 0\nInvoices paid in full: 0\nHand-offs to you: 0\n\nSee the month');
    expect(m.text).toContain('Median time to first reply: no first replies to measure');
    expect(m.text).not.toMatch(/\(\$|Time saved|  [A-Z]/);
    expect(mail({ ...ZERO, invoicesPaid: { count: 0, totals: [], booksStarted: false } }).text).not.toContain('Invoices');
    expect(mail({ ...ZERO, firstReply: { medianSeconds: 30, measured: 1, waiting: 2 } }).text)
      .toContain('Median time to first reply: 30 sec, from 1 customer\n');
    const none = { ...ZERO, replies: { ...ZERO.replies } };
    expect(mail({ ...none, estimate: estimateOf(5, none.replies) }).text).toContain('Time saved, an estimate: 0 replies × 5 min = 0 h');
    expect(mail({ ...FIXTURE_MONTH_REPORT, estimate: estimateOf(5, { alone: 12, drafted: 6, asWritten: 6, edited: 0, notSent: 0 }) }).text)
      .toContain('Time saved, an estimate: 18 replies × 5 min = 1.5 h');
  });

  it('two currencies are two totals, never added', () => {
    const r: MonthReport = { ...FIXTURE_MONTH_REPORT, orders: { confirmed: 3, totals: [moneyOf('300.00', 'AED'), moneyOf('200.00', 'USD')] } };
    expect(mail(r).text).toContain('Orders confirmed: 3 (AED 300.00 · $200.00)');
  });

  it('a reason without words of its own is "Another reason"', () => {
    expect(reasonLabel('human_requested')).toBe('The customer asked for a person');
    expect(reasonLabel('other')).toBe('Another reason');
    expect(reasonLabel('no_such_reason')).toBe('Another reason');
  });

  it('a length, short: seconds under a minute, hours and minutes, then days and hours past 48 hours', () => {
    expect([45, 94, 360, 600, 3600, 4800, 10800, 47 * 3600, 3 * 86400 + 4 * 3600, 2 * 86400].map(shortDuration))
      .toEqual(['45 sec', '2 min', '6 min', '10 min', '1 hr', '1 hr, 20 min', '3 hr', '47 hr', '3 days, 4 hr', '2 days']);
  });

  it('an empty month is one with nothing at all; any one thing makes it a month to send', () => {
    expect(isEmptyMonth({ ...ZERO, invoicesPaid: { count: 0, totals: [], booksStarted: false } })).toBe(true);
    for (const r of [
      { ...ZERO, customersAnswered: 1 }, { ...ZERO, replies: { ...ZERO.replies, alone: 1 } },
      { ...ZERO, replies: { ...ZERO.replies, notSent: 1 } }, { ...ZERO, replies: { ...ZERO.replies, drafted: 1, asWritten: 1 } },
      { ...ZERO, firstReply: { medianSeconds: null, measured: 0, waiting: 1 } }, { ...ZERO, handedToYou: [{ reason: 'complaint', n: 1 }] },
      { ...ZERO, orders: { confirmed: 1, totals: [] } }, { ...ZERO, invoicesPaid: { count: 1, totals: [], booksStarted: true } },
    ] as MonthReport[]) expect(isEmptyMonth(r)).toBe(false);
  });

  it('its words pass the owner-copy checks: no banned term, no "buyer", no "free", no gendered pronoun', () => {
    for (const [key, words] of Object.entries(MONTH_MAIL_EN)) {
      const lower = words.toLowerCase();
      for (const term of BANNED_OWNER_TERMS) expect([key, term, lower.split(/[^\p{L}\p{N}]+/u).join(' ').includes(` ${term.toLowerCase()} `) || ` ${lower} `.includes(` ${term.toLowerCase()} `)]).toEqual([key, term, false]);
      // "It" here is the e-mail (monthMail.off); the assistant is {name} and nothing else (rule 6).
      expect([key, /\b(buyer|free|she|her|hers|he|him|his)\b/.test(lower)]).toEqual([key, false]);
    }
  });

  it('MONTH_REPORT_MAIL must say on; minutes per reply are a whole number from 1 to 60, or empty', () => {
    expect([monthMailOn({ MONTH_REPORT_MAIL: 'on' }), monthMailOn({}), monthMailOn({ MONTH_REPORT_MAIL: '1' })]).toEqual([true, false, false]);
    expect(['1', '60', ' 7 ', '05', '', undefined].map((v) => readMinutesPerReply(v)))
      .toEqual([1, 60, 7, 5, null, null].map((minutes) => ({ ok: true, minutes })));
    for (const bad of ['0', '61', '5.5', '-3', 'five', '1 0', '005', '1e1', '٥', '+5', ['5']]) expect([bad, readMinutesPerReply(bad).ok]).toEqual([bad, false]);
  });
});
