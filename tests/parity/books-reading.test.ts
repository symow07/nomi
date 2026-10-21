import { describe, it, expect } from 'vitest';
import { checkReading, parseReadingAnswer } from '../../src/core/books/reading.js';

/** D6 (Phase 5, item 7) — what a reader says is printed on a paper, checked before anything is drafted from it. */
const answer = (o: Record<string, unknown>) => JSON.stringify({ kind: 'invoice', supplier: { name: 'Rif Coton', taxId: '001234567000089' }, number: 'FA-311',
  date: '2026-04-05', currency: 'MAD', lines: [{ label: 'Coton écru', net: '1 000,00', taxRate: '20', tax: '200,00' }], totalNet: '1 000,00', totalTax: '200,00',
  total: '1 200,00', ...o });

describe('D6 · a paper, read', () => {
  it('a clean invoice: its figures read by A1\'s rule, its lines adding up to its total — no problem', () => {
    const r = parseReadingAnswer(`Here it is:\n${answer({})}`);
    if (!r) throw new Error('no reading');
    const { reading, problems } = checkReading(r);
    expect(problems).toEqual([]);
    expect(reading).toEqual({ kind: 'invoice', supplierName: 'Rif Coton', supplierTaxId: '001234567000089', number: 'FA-311', date: '2026-04-05', currency: 'MAD',
      lines: [{ label: 'Coton écru', net: '1000', taxRate: '20', tax: '200' }], total: '1200' });
  });

  it('a figure that reads two ways is a problem, never a guess; lines that do not add up are said with both figures', () => {
    const amb = checkReading(parseReadingAnswer(answer({ total: '1.200' }))!);
    expect(amb.problems).toContainEqual({ kind: 'ambiguous', where: 'total' });
    const off = checkReading(parseReadingAnswer(answer({ total: '1 250,00' }))!);
    expect(off.problems).toEqual([{ kind: 'not_adding_up', lines: '1200', total: '1250' }]);
  });

  it('a till receipt with no lines becomes one line from its totals; a missing day, an unknown currency and no number are each said', () => {
    const till = checkReading(parseReadingAnswer(answer({ kind: 'receipt', lines: [], totalNet: '', totalTax: '1,50', total: '9,00' }))!);
    expect(till.problems).toEqual([]);
    expect(till.reading.lines).toEqual([{ label: 'Rif Coton', net: '7.5', taxRate: '0', tax: '1.5' }]);
    const bad = checkReading(parseReadingAnswer(answer({ date: '05/04/2026', currency: 'XYZ', number: '' }))!);
    expect(bad.problems.map((p) => p.kind)).toEqual(['no_date', 'unknown_currency', 'no_number']);
  });

  it('UNREADABLE, or anything but the JSON asked for, is no reading at all', () => {
    expect(parseReadingAnswer('UNREADABLE')).toBeNull();
    expect(parseReadingAnswer('I could not see the total.')).toBeNull();
    expect(parseReadingAnswer('{not json')).toBeNull();
  });
});
