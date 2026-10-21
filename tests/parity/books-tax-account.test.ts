import { describe, it, expect } from 'vitest';
import { booksProblems, type BooksData } from '../../src/core/books/interchange.js';
import type { Decimal } from '../../src/core/types/decimal.js';
import { SAMPLE_BOOKS } from '../books-connectors/sample.js';

/**
 * D8 (found building Xero) — a tax that is collected or deducted goes to an account (0170's check). Books that bring
 * one without — Xero's tax rates name none, a workbook's row may leave it empty — are told so by the books' one check,
 * named by the tax code, never left to fail in the database.
 */
describe('a tax with no account', () => {
  const known = { accounts: new Set(['4455']), journals: new Set<string>(), parties: new Set<string>(), taxCodes: new Set<string>(), bookCurrency: 'MAD' };
  const problems = (d: BooksData) => booksProblems(d, known, () => ({ sheet: 'Tax codes', row: 2 })).filter((p) => p.column === 'Account');
  it('collected or deducted: required; exempt: none needed', () => {
    const tax = SAMPLE_BOOKS.taxCodes[0]!;
    expect(problems({ ...SAMPLE_BOOKS, taxCodes: [{ ...tax, account: null }] })).toEqual([{ sheet: 'Tax codes', row: 2, column: 'Account', reason: 'required' }]);
    expect(problems({ ...SAMPLE_BOOKS, taxCodes: [{ ...tax, account: null, kind: 'deductible' }] })).toHaveLength(1);
    expect(problems({ ...SAMPLE_BOOKS, taxCodes: [{ ...tax, account: null, kind: 'exempt', rate: '0' as Decimal }] })).toEqual([]);
    expect(problems(SAMPLE_BOOKS)).toEqual([]);
  });
});
