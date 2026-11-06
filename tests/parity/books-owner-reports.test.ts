import { describe, it, expect } from 'vitest';
import { ageBucket, isSpan, SPANS } from '../../src/db/booksOwnerReports.js';
import { renderOwnerReport, ownerReportSheet } from '../../src/api/web/booksOwnerReports.js';
import { decimal } from '../../src/core/types/decimal.js';

describe('Block 2 PR 5 · reports in the owner\'s words', () => {
  it('an unpaid invoice is aged from the day after its due date; no due date is not due', () => {
    expect(ageBucket(null)).toBe('not_due'); expect(ageBucket(0)).toBe('not_due'); expect(ageBucket(-5)).toBe('not_due');
    expect(ageBucket(1)).toBe('d1_30'); expect(ageBucket(30)).toBe('d1_30'); expect(ageBucket(31)).toBe('d31_60'); expect(ageBucket(60)).toBe('d31_60');
    expect(ageBucket(61)).toBe('d61_90'); expect(ageBucket(90)).toBe('d61_90'); expect(ageBucket(91)).toBe('over_90'); expect(ageBucket(400)).toBe('over_90');
  });
  it('the period switch knows three spans and refuses anything else', () => {
    expect(SPANS).toEqual(['month', 'quarter', 'year']);
    for (const s of SPANS) expect(isSpan(s)).toBe(true);
    for (const s of ['week', '', null, 2026, 'MONTH']) expect(isSpan(s)).toBe(false);
  });
  it('the page names the report plainly, shows the figures and a download; a loss is called a loss; a refund is owed to you', () => {
    const period = { from: '2026-11-01', to: '2026-11-06' };
    const made = renderOwnerReport('en', { kind: 'made', data: { period, income: decimal('300'), spending: decimal('380'), result: decimal('-80'), rows: [{ code: '7111', name: 'Sales', kind: 'income', amount: decimal('300') }] } }, 'month', 'USD');
    expect(made).toContain('<h1 class="page">What you made</h1>'); expect(made).toContain('What you lost'); expect(made).toContain('$300.00'); expect(made).toContain('href="/app/books/reports/made.xlsx?period=month"');
    expect(made).toContain('aria-current="page">This month'); expect(made).toContain('?period=quarter'); expect(made).not.toMatch(/P&amp;L|P&L|debit|credit/i);
    const tax = renderOwnerReport('en', { kind: 'tax', data: { period, collected: decimal('10'), deductible: decimal('40'), owed: decimal('-30'), rows: [] } }, 'quarter', 'MAD');
    expect(tax).toContain('Owed to you'); expect(tax).not.toContain('>You owe<'); expect(tax).toContain('Nothing in this period.');
    const unpaid = renderOwnerReport('en', { kind: 'unpaid', data: { today: '2026-11-06', total: decimal('0'), rows: [], byBucket: { not_due: decimal('0'), d1_30: decimal('0'), d31_60: decimal('0'), d61_90: decimal('0'), over_90: decimal('0') } } }, 'month', 'USD');
    expect(unpaid).toContain('Every invoice is paid.'); expect(unpaid).not.toContain('days late');
  });
  it('the spreadsheet carries the figures as numbers and the rows under a header line', () => {
    const sheet = ownerReportSheet('en', { kind: 'customers', data: { period: { from: '2026-11-01', to: '2026-11-06' }, total: decimal('450'), others: { customers: 2, billed: decimal('50') }, rows: [{ partyId: 'p', name: 'Rif Coton', invoices: 2, billed: decimal('400'), currency: 'USD' }] } }, 'USD');
    expect(sheet.name).toBe('Top customers');
    expect(sheet.rows).toContainEqual(['Total', { number: '450' }]);
    expect(sheet.rows).toContainEqual(['Rif Coton', { number: '2' }, { number: '400' }]);
    expect(sheet.rows.at(-1)).toEqual(['2 other customers: 50']);
  });
});
