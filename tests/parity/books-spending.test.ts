import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { nextOn, splitGross, dayOf, isEvery, EVERY } from '../../src/core/books/spending.js';
import { decimal } from '../../src/core/types/decimal.js';
import { BOOKS_SPENDING_EN } from '../../src/core/owner/i18n/booksSpending.js';

/**
 * Block 2 PR 3 (0227) — the spending book's pure parts: the schedule's calendar arithmetic, the tax split that adds back
 * exactly, and the page's words, which promise nothing the code does not do ("nothing posts by itself").
 */
describe('a recurring cost\'s calendar', () => {
  it('every month, quarter or year from a day; the day of the month kept where the month has it', () => {
    expect(nextOn('2026-01-15', 'month')).toBe('2026-02-15');
    expect(nextOn('2026-11-15', 'quarter')).toBe('2027-02-15');
    expect(nextOn('2026-03-01', 'year')).toBe('2027-03-01');
  });
  it('…and clamped where it does not: the 31st in a shorter month, the 29th of February in a year without one', () => {
    expect(nextOn('2026-01-31', 'month')).toBe('2026-02-28');
    expect(nextOn('2028-01-31', 'month')).toBe('2028-02-29');          // a leap year keeps the 29th
    expect(nextOn('2028-02-29', 'year')).toBe('2029-02-28');
    expect(nextOn('2026-08-31', 'quarter')).toBe('2026-11-30');
    expect(nextOn('2026-12-31', 'month')).toBe('2027-01-31');
  });
  it('the three words, and a day that is one', () => {
    expect(EVERY).toEqual(['month', 'quarter', 'year']);
    expect(isEvery('week')).toBe(false);
    expect(dayOf('2026-02-30')).toBeNull();
    expect(dayOf('2026-02-28')).toBe('2026-02-28');
    expect(dayOf('28/02/2026')).toBeNull();
  });
});

describe('a bill\'s gross, split into the net and its tax', () => {
  it('the net rounds to the cent; the tax is the rest, so the two add back to the gross exactly', () => {
    expect(splitGross(decimal('120'), decimal('20'))).toEqual({ net: '100', tax: '20' });          // canonical text: no trailing zeros
    expect(splitGross(decimal('1250.00'), decimal('20'))).toEqual({ net: '1041.67', tax: '208.33' });
    expect(splitGross(decimal('100'), decimal('7'))).toEqual({ net: '93.46', tax: '6.54' });
    expect(splitGross(decimal('99.99'), decimal('14'))).toEqual({ net: '87.71', tax: '12.28' });
  });
  it('no tax code, or a zero rate: the whole figure is the expense', () => {
    expect(splitGross(decimal('45.5'), null)).toEqual({ net: '45.5', tax: '0' });
    expect(splitGross(decimal('45.5'), decimal('0'))).toEqual({ net: '45.5', tax: '0' });
  });
  it('the net at the rate agrees with the tax within a cent', () => {
    const { net, tax } = splitGross(decimal('1250.00'), decimal('20'));
    expect(Math.abs(Number(net) * 0.2 - Number(tax))).toBeLessThanOrEqual(0.01);
  });
});

describe('the page\'s words', () => {
  it('English only, in the redesign catalogue, and they promise only what the code does', () => {
    const words = Object.entries(BOOKS_SPENDING_EN).filter(([k]) => k.startsWith('booksSpending.waiting') || k.startsWith('booksSpending.recurring')).map(([, v]) => v).join(' ');
    expect(words).toMatch(/Nothing (is written|posts) /);
    expect(words).not.toMatch(/automatic(ally)?\b/i);
  });
  it('the routes the page posts to are the books\' owner routes', () => {
    const routes = readFileSync(new URL('../../src/api/web/books.ts', import.meta.url), 'utf8');
    for (const url of ['/app/books/spending/bills', '/app/books/spending/bills/:id/pay', '/app/books/spending/categories', '/app/books/spending/recurring', '/app/books/spending/proposals/:id/post', '/app/books/spending/proposals/:id/skip']) {
      expect(routes).toContain(`{method:'POST',url:'${url}',action:'post'}`);
    }
  });
});
