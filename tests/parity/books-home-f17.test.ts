import { describe, it, expect } from 'vitest';
import { renderBooksOverview } from '../../src/api/web/booksOverview.js';
import type { BooksOverview } from '../../src/db/booksOverview.js';
import { decimal } from '../../src/core/types/decimal.js';
import { messages } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

/**
 * F17 (UI correction, Block 5) — the Books home: what needs you, then the three actions, then one setup step, then the
 * money in three groups (cash, owed, profit), each figure with its period and the report it is read from; a figure the
 * records cannot give is its link, never a zero; each figure's basis is kept word for word under one disclosure.
 */
const owner = { id: 'o', name: 'Mei', isOwner: true };
const accountant = { id: 'a', name: 'Amal', isOwner: false, kind: 'accountant' as const };
const base: BooksOverview = {
  today: '2026-11-19', bookCurrency: 'USD', month: { from: '2026-11-01', to: '2026-11-19' }, fiscalYear: null,
  needsYou: { overdueInvoices: 1, unmatchedLines: 4, papers: { unread: 2, problem: 0, ready: 0, draft: 0, posted: 0, setAside: 0, pending: 2 } },
  customerOwed: { byCurrency: [{ currency: 'USD', owed: decimal('1876943.70'), refundDue: decimal('0'), count: 3, overdue: 1 }] },
  profit: { amount: decimal('1875713.20'), from: '2026-01-01', to: '2026-11-19', basis: 'fiscal' },
  cashToday: { state: 'available', balance: decimal('24110'), defaulted: true, byAccount: [] },
  cash: { state: 'available', defaulted: true, received: decimal('310'), paidOut: decimal('1200'), selectedIds: [], transferIds: [], reviewEntryIds: [], reviewCount: 0, excludedTransferCount: 0 },
  supplierOwed: { state: 'available', owed: decimal('340.50'), advances: decimal('0'), knownOwed: decimal('340.50'), knownAdvances: decimal('0'), unassignedOwed: decimal('0'), unassignedAdvances: decimal('0'), selectedIds: [] },
};
const unset: BooksOverview = {
  ...base,
  cashToday: { state: 'needs_setup', balance: null, defaulted: false, byAccount: [] },
  cash: { ...base.cash, state: 'needs_review', received: null, paidOut: null },
  supplierOwed: { ...base.supplierOwed, state: 'unavailable', owed: null },
};
const page = (o: BooksOverview, who: typeof owner | typeof accountant = owner, setup = { year: true, accounts: true }) =>
  renderBooksOverview('en', who, o, { today: o.today }, [], [], setup);
// Each figure, from its opening to the next figure (or the end of its group).
const figures = (html: string) => html.split('<div class="ba-fig">').slice(1).map((f) => f.split('</dl>')[0]!);

describe('F17 · the Books home', () => {
  it('needs you, then the three actions, then the money', () => {
    const html = page(base);
    const at = (s: string) => { const i = html.indexOf(s); expect(i, s).toBeGreaterThan(-1); return i; };
    expect(at('class="ba-waiting"')).toBeLessThan(at('class="ba-actions"'));
    expect(at('class="ba-actions"')).toBeLessThan(at('class="ba-sum"'));
    expect(at('href="/app/books/invoices?state=overdue"')).toBeLessThan(at('href="/app/books/invoices/new"'));
  });
  it('every figure says its period and links to its source', () => {
    const f = figures(page(base));
    expect(f).toHaveLength(6);
    for (const one of f) {
      expect(one).toMatch(/<p class="ba-period">[^<]+/);
      expect(one).toMatch(/<p class="ba-source"><a href="\/app\/books\/(reports\/(cash|suppliers|profit)|invoices\?state=unpaid)/);
    }
    expect(f[0]).toContain('As of Nov 19, 2026'); expect(f[1]).toContain('This month · Nov 1 to Nov 19, 2026');
    expect(f[5]).toContain('Jan 1 to Nov 19, 2026');
  });
  it('cash and profit are apart, and profit says it is not cash', () => {
    const html = page(base);
    const cash = html.slice(html.indexOf('id="ba-cash"'), html.indexOf('id="ba-owed"'));
    const profit = html.slice(html.indexOf('id="ba-profit"'), html.indexOf('class="ba-how"'));
    expect(cash).not.toContain('Profit');
    expect(profit).toContain('This is not cash received.');
  });
  it('an unavailable figure is its link, never a zero', () => {
    const html = page(unset);
    const f = figures(html);
    expect(f[0]).toContain('href="#figure-accounts">Choose accounts</a>');
    expect(f[1]).toContain('Check the supporting entries'); expect(f[2]).toContain('Check the supporting entries');
    expect(f[4]).toContain('Not available from these records');
    for (const i of [0, 1, 2, 4]) expect(f[i]).not.toMatch(/\$0\.00|\b0\.00\b/);
  });
  it('the basis of every figure is kept, word for word, under one disclosure', () => {
    const html = page({ ...base, profit: { ...base.profit, basis: 'calendar' } });
    const how = html.slice(html.indexOf('<details class="ba-how">'), html.indexOf('</details>', html.indexOf('<details class="ba-how">')));
    for (const s of ['What your bank and cash accounts hold from the entries saved up to Thu, Nov 19, 2026: every posted line on them, opening balances included.',
      'Your bank and cash accounts, as the chart marks them; choose others below for this view.',
      'Saved entries in the selected bank and cash accounts, from Sun, Nov 1, 2026 to Thu, Nov 19, 2026. Transfers between these accounts are excluded.',
      'Issued invoices, with payments and credit notes recorded by Thu, Nov 19, 2026.',
      'Saved balances in the selected supplier accounts, through Thu, Nov 19, 2026.',
      'Income less expenses saved from Thu, Jan 1, 2026 to Thu, Nov 19, 2026. Unpaid sales can be included; this is not cash received.',
      'No fiscal year covers today. This uses the calendar year.']) expect(how).toContain(s);
    expect(html.match(/class="ba-how"/g)).toHaveLength(1);
  });
  it('one setup notice: the first step still missing, for the owner only', () => {
    const both = page(base, owner, { year: false, accounts: false });
    expect(both.match(/class="ba-setup"/g)).toHaveLength(1);
    expect(both).toContain('href="/app/settings/books/starting-balances"');
    expect(both).not.toContain('href="/app/settings/books/accounts"');
    expect(page(base, owner, { year: true, accounts: false })).toContain('<p class="ba-setup"><strong>Setting up</strong> <a href="/app/settings/books/accounts">');
    expect(page(base, owner)).not.toContain('class="ba-setup"');
    expect(page(base, accountant, { year: false, accounts: false })).not.toContain('class="ba-setup"');
    expect(page(base, accountant)).not.toContain('class="ba-actions"');
  });
  it('the new words are in all five languages', () => {
    for (const k of ['booksHome.actions', 'booksHome.cash', 'booksHome.owed', 'booksHome.profit', 'booksHome.notCash', 'booksHome.span', 'booksHome.how', 'booksHome.srcUnpaid'] as const)
      for (const l of LOCALES) { expect(messages[l][k], `${l} ${k}`).toBeTruthy(); if (l !== 'en') expect(messages[l][k], `${l} ${k}`).not.toBe(messages.en[k]); }
  });
});
