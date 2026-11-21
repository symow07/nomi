import { describe, it, expect } from 'vitest';
import { renderEntries, renderNewEntry, renderBooksOrders } from '../../src/api/web/booksEntries.js';
import { renderTrialBalance } from '../../src/api/web/booksReports.js';
import { BOOKS_AREA_CSS } from '../../src/api/web/booksAreaStyle.js';
import { decimal } from '../../src/core/types/decimal.js';
import { messages } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

/**
 * F22 (UI correction, Block 5) — the books' wide tables (entries, one entry, the trial balance, orders into the books)
 * and F21's remainder (the new-entry form). Every value in a row carries its column's name for a phone, where a row is
 * a card; figures are end-aligned and tabular; a frame that may scroll is named and reachable by keyboard; the orders'
 * two choices are labelled where they are seen; a new entry opens on its lines in use (two at least) with the empty
 * ones behind one disclosure, every field still in the form.
 */
const d = decimal;
const owner = { isOwner: true };
const cellsOf = (html: string) => [...html.matchAll(/<td([^>]*)>/g)].map((m) => m[1]!);

describe('F22 · the books\' wide tables', () => {
  it('the entries list: every cell labelled, a State column named, the figure end-aligned, the frame named and focusable', () => {
    const html = renderEntries('en', owner, [{ id: 'e1', key: 'SJ-2026-6', journal: 'SJ', date: '2026-11-13', label: 'Ten beach bags returned', state: 'posted', total: '220.00', currency: 'USD', reverses: null, reversedBy: null }]);
    expect(cellsOf(html).every((a) => / data-label="[^"]+"/.test(a))).toBe(true);
    expect(html).toContain('<th scope="col">State</th>');
    expect(html).toMatch(/<td class="num" data-label="Total"><span>\$220\.00<\/span><\/td>/);
    expect(html).toMatch(/<div class="imp-table bk-rows bk-cards" role="region" tabindex="0" aria-label="Entries: the table scrolls sideways">/);
  });
  it('the trial balance: each figure names its column and side; a nothing is an empty cell, never a zero', () => {
    const s = (debit: string, credit: string) => ({ debit: d(debit), credit: d(credit) });
    const html = renderTrialBalance('en', { from: '2026-01-01', to: '2026-11-19' }, {
      rows: [{ code: '1000', name: 'Checking account', kind: 'asset' as never, opening: s('0', '0'), period: s('25310', '1200'), closing: s('24110', '0') }],
      totals: { opening: s('0', '0'), period: s('25310', '1200'), closing: s('24110', '0') }, balanced: true, difference: { opening: d('0'), period: d('0'), closing: d('0') },
    }, 'USD', new Date('2026-11-19T12:00:00Z'), false);
    expect(html).toContain('<td class="num" data-label="Closing · Debit"><span>$24,110.00</span></td>');
    expect(html).toContain('<td class="num" data-label="Opening · Debit"></td>');
    expect(html).not.toMatch(/\$0\.00/);
    expect(html).toContain('class="imp-table bk-rows bk-tb" role="region" tabindex="0"');
  });
  it('orders into the books: the customer and the tax code are labelled where they are seen; every cell named', () => {
    const html = renderBooksOrders('en', [{ id: 'o1', reference: 'ORD-2026-0417', confirmedOn: '2026-11-12', total: '1876.80', currency: 'USD', buyer: 'Ivan Petrov' }], true,
      { parties: [{ id: 'p', code: 'C1', name: 'Casa Olivo' }], taxCodes: [{ id: 'x', code: 'TVA20', label: 'Standard', from: '2026-01-01' }] });
    expect(html).toMatch(/<label class="pq"><span>Customer<\/span><select name="party" required>/);
    expect(html).toMatch(/<label class="pq"><span>Tax code<\/span><select name="taxCode">/);
    expect(cellsOf(html).filter((a) => !a.includes('bk-act')).every((a) => / data-label="[^"]+"/.test(a))).toBe(true);
    expect(html).toContain('<th scope="col">Draft its invoice</th>');
  });
  it('a new entry: two lines open, the six empty ones behind one disclosure; a line in use keeps every line up to it open', () => {
    const c = { accounts: [{ id: 'a', code: '1000', name: 'Checking' }], journals: [{ id: 'j', code: 'BK', name: 'Bank' }], parties: [], taxCodes: [], bookCurrency: 'USD' };
    const blank = renderNewEntry('en', c as never, {}, [], '2026-11-19');
    const [open, more] = blank.split('<details class="el-more">');
    expect([...open!.matchAll(/name="account\d+"/g)].length).toBe(2);
    expect(more).toContain('<summary>More lines (6)</summary>');
    expect([...more!.matchAll(/name="account\d+"/g)].length).toBe(6);
    for (let i = 0; i < 8; i += 1) expect(blank.split(`name="debit${i}"`).length).toBe(2);
    const typed = renderNewEntry('en', c as never, { account4: 'a', currency6: 'EUR' }, [], '2026-11-19');
    expect([...typed.split('<details class="el-more">')[0]!.matchAll(/name="account\d+"/g)].length).toBe(5);
    expect(typed).toContain('<summary>More lines (3)</summary>');
    expect(blank).toMatch(/<label class="el-fx-hit"><input type="checkbox" name="fx0"/);
    expect(blank).toContain('data-n="1"');
  });
  it('the shared rules: a card up to 900 px, each value beside its name, an empty cell left out; figures tabular; 44 px', () => {
    const css = BOOKS_AREA_CSS;
    const card = css.slice(css.indexOf('@media(max-width:900px){'));
    expect(card).toContain('.bk-rows tr>td[data-label]::before{content:attr(data-label);');
    expect(card).toContain('.bk-rows tr>td:empty{display:none;}');
    expect(css).toMatch(/\.books-area \.bk-rows \.num\{text-align:end;white-space:nowrap;overflow-wrap:normal;font-variant-numeric:tabular-nums;\}/);
    expect(css).toContain('.entry-lines .el-fx-hit{display:inline-flex;align-items:center;justify-content:center;min-inline-size:44px;min-block-size:44px;');
    expect(css).not.toContain('counter(entry-line)');
  });
  it('the new words are in all five languages', () => {
    for (const k of ['booksEntry.moreLines', 'booksEntry.tableOf'] as const) for (const l of LOCALES) {
      expect(messages[l][k], `${l} ${k}`).toBeTruthy(); if (l !== 'en') expect(messages[l][k]).not.toBe(messages.en[k]);
    }
  });
});
