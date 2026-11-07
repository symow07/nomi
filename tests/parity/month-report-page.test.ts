import { describe, it, expect } from 'vitest';
import { renderMonthReport } from '../../src/api/web/monthReport.js';
import { FIXTURE_MONTH_REPORT, estimateOf, type MonthReport, type MonthPageOptions } from '../../src/core/report/month.js';
import { moneyOf } from '../../src/core/types/money.js';
import { withAssistantName } from '../../src/api/web/say.js';
import { shell } from '../../src/api/web/layout.js';
import { linkedCss } from './linked-css.js';
import { unisolatedFigures, withoutIsolates } from './isolates.js';
import { buttonsAndDoors } from './buttons-and-doors.js';
import { saidFlash, flashBanner, mintFlash, readFlash } from '../../src/api/web/flash.js';
import type { Locale } from '../../src/core/owner/i18n/locale.js';

const options: MonthPageOptions = {
  canSetMinutes: true, months: ['2026-11', '2026-10', '2026-09'], flash: null,
  now: new Date('2026-11-07T12:00:00Z'), startedAt: new Date('2026-09-14T12:00:00Z'), setupDone: true,
};
const draw = (report: MonthReport = FIXTURE_MONTH_REPORT, locale: Locale = 'en', opts: Partial<MonthPageOptions> = {}) =>
  withAssistantName('Lily', () => renderMonthReport(report, locale, { ...options, ...opts }));
const plain = (html: string) => withoutIsolates(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const section = (html: string, id: string) => html.match(new RegExp(`<section[^>]*aria-labelledby="${id}"[^>]*>([\\s\\S]*?)</section>`))?.[1] ?? '';
const form = (html: string, action: string) => [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)]
  .find((m) => m[1]!.includes(`action="${action}"`))?.[0] ?? '';
const empty: MonthReport = {
  ...FIXTURE_MONTH_REPORT, customersAnswered: 0,
  replies: { alone: 0, drafted: 0, asWritten: 0, edited: 0, notSent: 0 },
  firstReply: { medianSeconds: null, measured: 0, waiting: 0 },
  orders: { confirmed: 0, totals: [] }, invoicesPaid: { count: 0, totals: [], booksStarted: false },
  handedToYou: [], estimate: null,
};

describe('Block 4.3 · the month report page', () => {
  for (const locale of ['en', 'ar'] as const) {
    it(`${locale}: the fixture has semantic rows, one heading, no raw keys and isolated figures`, () => {
      const html = draw(undefined, locale);
      expect(html.match(/<h1\b/g)).toHaveLength(1);
      for (const name of ['customers', 'replies', 'speed', 'orders', 'invoices', 'handed', 'estimate', 'mail']) {
        expect(section(html, `month-${name}`)).not.toBe('');
      }
      const words = plain(html);
      expect(words).toContain('Customers answered 42');
      expect(words).toContain('Replies Lily sent alone 61');
      expect(words).toContain('Drafts you sent as written 29');
      expect(words).toContain('Drafts you edited, then sent 8');
      expect(words).toContain('Drafts not sent 5');
      expect(words).toContain('Measured on 40 customers.');
      expect(words).toContain('3 customers who wrote this month are still waiting');
      expect(words).not.toMatch(/(?:monthReport|monthMail|takeover)\.[a-z]/);
      expect(words).not.toMatch(/\{(?:name|n|month|minutes|hours)\}/);
      expect(buttonsAndDoors(html)).toEqual([]);
      if (locale === 'ar') expect(unisolatedFigures(html)).toEqual([]);
    });
  }

  it('uses a GET picker and adjacent month doors without scripting, respecting both ends', () => {
    const html = draw();
    const picker = form(html, '/app/results/month');
    expect(picker).toContain('method="get"');
    expect(picker).toMatch(/<label[^>]*for="month-report-month"/);
    expect(picker).toMatch(/<select[^>]*id="month-report-month"[^>]*name="month"/);
    expect(picker.match(/<option\b/g)).toHaveLength(3);
    expect(picker).toMatch(/value="2026-10" selected/);
    expect(html).toContain('aria-label="Previous month: September 2026"');
    expect(html).toContain('aria-label="Next month: November 2026"');
    expect(html).not.toMatch(/<script|onchange=|onsubmit=/i);
    expect(draw({ ...empty, month: '2026-09' })).not.toContain('Previous month:');
    expect(draw({ ...empty, month: '2026-11', running: true })).not.toContain('Next month:');
  });

  it('hides the estimate by default and keeps the owner minutes disclosure closed', () => {
    const html = draw({ ...FIXTURE_MONTH_REPORT, estimate: null });
    expect(section(html, 'month-estimate')).toBe('');
    expect(html).not.toContain('×');
    expect(html).toContain('Estimate the time this saved you');
    expect(html).toMatch(/<details(?:\s[^>]*)?>/);
    expect(html).not.toMatch(/<details[^>]*\bopen(?:\s|=|>)/);
    const minutes = form(html, '/app/results/month/minutes');
    expect(minutes).toContain('method="post"');
    expect(minutes).toMatch(/name="month" value="2026-10"/);
    expect(minutes).toMatch(/name="minutes"[^>]*value=""/);
    expect(minutes).toContain('inputmode="numeric"');
  });

  it('shows the explicit estimate formula and the stored minutes, excluding edited drafts', () => {
    const replies = { alone: 12, asWritten: 6, drafted: 15, edited: 9, notSent: 2 };
    const html = draw({ ...FIXTURE_MONTH_REPORT, replies, estimate: estimateOf(5, replies) });
    expect(plain(section(html, 'month-estimate'))).toContain('18 replies × 5 min = 1.5 h');
    expect(plain(html)).toContain('Edited drafts are not counted.');
    expect(form(html, '/app/results/month/minutes')).toMatch(/name="minutes"[^>]*value="5"/);
    const ar = draw({ ...FIXTURE_MONTH_REPORT, replies, estimate: estimateOf(5, replies) }, 'ar');
    expect(ar).toMatch(/<p[^>]*dir="ltr"[^>]*>[\s\S]*?18[\s\S]*?×[\s\S]*?5[\s\S]*?1.5/);
    expect(unisolatedFigures(ar)).toEqual([]);
  });

  it('keeps an existing estimate read-only for staff, and hides invoices and both forms', () => {
    const html = draw(undefined, 'en', { canSetMinutes: false });
    expect(plain(html)).toContain('Set by the owner.');
    expect(section(html, 'month-estimate')).not.toBe('');
    expect(section(html, 'month-invoices')).toBe('');
    expect(section(html, 'month-mail')).toBe('');
    expect(html).not.toContain('<details');
    expect(html).not.toContain('method="post"');
    expect(plain(html)).toContain('Orders confirmed this month that still stand.');
    expect(plain(html)).not.toContain('Orders you confirmed');
    expect(draw({ ...FIXTURE_MONTH_REPORT, estimate: null }, 'ar', { canSetMinutes: false })).not.toContain('month-estimate');
  });

  it('posts the opposite mail state and preserves the selected month', () => {
    for (const off of [false, true]) {
      const html = draw({ ...FIXTURE_MONTH_REPORT, mailOff: off });
      const mail = form(html, '/app/results/month/mail');
      expect(mail).toContain('method="post"');
      expect(mail).toMatch(/name="month" value="2026-10"/);
      expect(mail).toContain(`name="mail" value="${off ? 'on' : 'off'}"`);
      expect(plain(mail)).toContain(off ? 'E-mail me each month' : 'Stop the monthly e-mail');
      expect(mail.match(/<button\b/g)).toHaveLength(1);
      expect(html.lastIndexOf('month-mail')).toBeGreaterThan(html.lastIndexOf('/minutes'));
    }
  });

  it('keeps each currency separate and gives empty commerce honest words', () => {
    const html = draw({ ...FIXTURE_MONTH_REPORT, orders: { confirmed: 2, totals: [moneyOf('1240', 'USD'), moneyOf('300', 'AED')] } });
    const orders = section(html, 'month-orders');
    expect(plain(orders)).toContain('$1,240.00');
    expect(plain(orders)).toContain('AED 300.00');
    expect(orders.match(/<dt\b/g)).toHaveLength(2);
    const none = draw({ ...FIXTURE_MONTH_REPORT, orders: empty.orders, invoicesPaid: { ...empty.invoicesPaid, booksStarted: true } });
    expect(plain(section(none, 'month-orders'))).toContain('No order was confirmed this month.');
    expect(plain(section(none, 'month-invoices'))).toContain('No invoice was paid in full this month.');
    expect(none).not.toContain('$0.00');
    const noBooks = draw({ ...FIXTURE_MONTH_REPORT, invoicesPaid: empty.invoicesPaid });
    expect(section(noBooks, 'month-invoices')).toContain('href="/app/books"');
    expect(plain(noBooks)).toContain('You have not issued an invoice yet');
  });

  for (const locale of ['en', 'ar'] as const) {
    it(`${locale}: groups each set of currency amounts under one label without combining their values`, () => {
      const totals = [moneyOf('1240', 'USD'), moneyOf('300', 'AED')];
      const html = draw({ ...FIXTURE_MONTH_REPORT, orders: { confirmed: 2, totals },
        invoicesPaid: { count: 2, totals, booksStarted: true } }, locale);
      for (const [id, label] of [['orders', 'Value of confirmed orders'], ['invoices', 'Value of invoices paid']] as const) {
        const body = section(html, `month-${id}`);
        expect(plain(body).split(label)).toHaveLength(2);
        const values = body.match(/<dd class="mr-amounts">([\s\S]*?)<\/dd>/)?.[1] ?? '';
        expect(values.match(/<span>/g)).toHaveLength(2);
        expect(plain(values)).toContain('1,240.00');
        expect(plain(values)).toContain('300.00');
        expect(plain(values)).not.toContain('1,540');
      }
      if (locale === 'ar') expect(unisolatedFigures(html)).toEqual([]);
    });

    it(`${locale}: keeps the median's sample and waiting captions within its definition row`, () => {
      const speed = section(draw(undefined, locale), 'month-speed');
      const definition = speed.match(/<dd class="mr-definition caption muted">([\s\S]*?)<\/dd>/)?.[1] ?? '';
      expect(plain(definition)).toContain('Clock time, nights and weekends included');
      expect(plain(definition)).toContain('Measured on 40 customers.');
      expect(plain(definition)).toContain('3 customers who wrote this month are still waiting');
      const afterRows = speed.slice(speed.indexOf('</dl>') + 5);
      expect(plain(afterRows)).toBe('');
    });
  }

  it('orders known hand-off reasons by count then key, with unknown reasons last', () => {
    const html = draw({ ...FIXTURE_MONTH_REPORT, handedToYou: [
      { reason: 'stock_asked', n: 1 }, { reason: 'unknown_future_reason', n: 9 }, { reason: 'human_requested', n: 2 },
    ] });
    const handed = plain(section(html, 'month-handed'));
    expect(handed).toContain('Hand-offs to you 12');
    expect(handed).toContain('Another reason 9');
    expect(handed).not.toContain('unknown_future_reason');
    expect(handed.indexOf('Another reason')).toBeGreaterThan(handed.indexOf('A stock question'));
    const rows = [...section(html, 'month-handed').matchAll(/<div class="result-row mr-subrow">([\s\S]*?)<\/div>/g)];
    expect(rows).toHaveLength(3);
    expect(plain(rows[0]![1]!)).not.toContain('Hand-offs to you');
    expect(plain(rows[2]![1]!)).toContain('Another reason 9');
  });

  it.each([[30, 'under a minute'], [3660, '1 hour, 1 minute'], [176400, '2 days, 1 hour']] as const)(
    'formats a %s-second median without needing DurationFormat', (medianSeconds, said) => {
      expect(plain(draw({ ...FIXTURE_MONTH_REPORT, firstReply: { medianSeconds, measured: 1, waiting: 0 } }))).toContain(said);
      expect(plain(draw({ ...FIXTURE_MONTH_REPORT, firstReply: { medianSeconds, measured: 1, waiting: 0 } }))).toContain('Measured on 1 customer.');
    },
  );

  it('distinguishes a truly empty month from customers who wrote and still wait', () => {
    expect(plain(draw(empty))).toContain('Nothing happened in October 2026');
    expect(section(draw(empty), 'month-customers')).toBe('');
    expect(form(draw(empty), '/app/results/month')).not.toBe('');
    const waiting = draw({ ...empty, firstReply: { medianSeconds: null, measured: 0, waiting: 1 } });
    expect(plain(waiting)).toContain('No customer who wrote this month has had a reply yet.');
    expect(plain(waiting)).toContain('1 customer who wrote this month is still waiting');
    expect(plain(waiting)).not.toContain('Nothing happened');
    expect(plain(draw({ ...empty, replies: { ...empty.replies, notSent: 1 } }))).not.toContain('Nothing happened');
  });

  it('shows running and first-month lines in the workspace zone, with the setup door only when useful', () => {
    const running = { ...empty, month: '2026-11', running: true };
    const html = draw(running, 'en', { setupDone: false, months: ['2026-11'], startedAt: new Date('2026-11-04T14:00:00Z') });
    expect(plain(html)).toContain('November 2026 so far');
    expect(plain(html)).toContain('Counted from');
    expect(html).toContain('href="/app/get-started"');
    expect(draw(running)).not.toContain('href="/app/get-started"');
    expect(draw(empty, 'en', { setupDone: false })).not.toContain('href="/app/get-started"');
    const first = draw({ ...empty, month: '2026-10' }, 'en', { startedAt: new Date('2026-09-30T23:30:00Z') });
    expect(first).not.toContain('Counted from');
  });

  it('uses the shared flash renderer and escapes names and notices', () => {
    const html = withAssistantName('<img src=x onerror=boom>', () => renderMonthReport(FIXTURE_MONTH_REPORT, 'en', {
      ...options, flash: { text: '<strong>Refused</strong>', bad: true },
    }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('&lt;strong&gt;Refused&lt;/strong&gt;');
    expect(html).not.toContain('<img');
  });

  it('marks English fallback flash words without changing the direction of Arabic flashes', () => {
    const flash = saidFlash('ar', 'monthMail.flash.minutesSaved', { minutes: 5 });
    expect(draw(undefined, 'ar', { flash })).toContain('<bdi lang="en" dir="ltr">Saved.');
    const mixed = readFlash('test-secret', mintFlash('test-secret', [
      { key: 'monthMail.flash.minutesSaved', params: { minutes: 5 } }, { key: 'common.undo' },
    ], 100), 'ar', 100);
    expect(flashBanner(mixed)).toContain('<bdi lang="en" dir="ltr">Saved.');
    expect(flashBanner({ text: 'Nomi جاهز.', bad: false })).toBe('<div class="flash" role="status">Nomi جاهز.</div>');
    expect(flashBanner(flash)).not.toContain('dir="auto"');
  });

  it('keeps shared active tabs and month doors magenta despite the owner-shell brand override', () => {
    const css = linkedCss(shell({ title: 'Month', active: 'analytics', path: '/app/results/month', locale: 'en', bodyHtml: draw() }));
    // The shell deliberately maps brand to ink for older controls; change this page only.
    expect(css).toMatch(/\.owner-shell\s*\{\s*--color-brand:var\(--color-ink\)/);
    const rule = css.match(/(?:^|\n)\s*\.tab\.on\s*\{([^}]+)\}/)?.[1] ?? '';
    expect(rule).toContain('color:var(--color-accent)');
    expect(rule).toContain('border-color:var(--color-accent)');
    expect(rule).toContain('inset 0 0 0 1px var(--color-accent)');
    const html = draw();
    expect(html).toMatch(/<a class="back"[^>]*href="\/app\/results\/month\?month=2026-09"/);
    expect(html).toMatch(/<a class="deeper"[^>]*href="\/app\/results\/month\?month=2026-11"/);
    expect(html).not.toContain('mr-month-door');
    expect(css).not.toMatch(/\.tabs:has\(\+ \.month-report\) \.tab\.on/);
  });

  it('uses the same sentence-case row label when its figure is one', () => {
    const html = draw({ ...FIXTURE_MONTH_REPORT, customersAnswered: 1, replies: { ...FIXTURE_MONTH_REPORT.replies, asWritten: 1 } });
    expect(plain(html)).toContain('Customers answered 1');
    expect(plain(html)).toContain('Drafts you sent as written 1');
  });

  it('lets the minutes refusal reach the server for out-of-range or fractional input', () => {
    const input = form(draw(), '/app/results/month/minutes').match(/<input[^>]*id="month-report-minutes"[^>]*>/)?.[0] ?? '';
    expect(input).toContain('type="text"');
    expect(input).toContain('inputmode="numeric"');
    expect(input).not.toMatch(/\b(?:min|max|step|pattern|required)=/);
  });

  it('serves its scoped styles with the shell, preserving a single column and wrapping tabs', () => {
    const html = shell({ title: 'Month', active: 'analytics', path: '/app/results/month', locale: 'ar', bodyHtml: draw(undefined, 'ar') });
    expect(html).toContain('dir="rtl"');
    const css = linkedCss(html);
    expect(css).toContain('.month-report');
    expect(css).toMatch(/\.month-report[^}]*min-inline-size:0/);
    expect(css).toMatch(/\.month-report[^}]*\.btn\.send[^}]*background:var\(--color-ink\)/);
  });
});
