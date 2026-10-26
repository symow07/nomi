import { describe, it, expect } from 'vitest';
import {
  amountIn, csvRows, dayIn, guessLayout, layoutOf, readCsvWithLayout, type CsvLayout,
} from '../../src/core/books/statements.js';
import { booksProblems, type BooksData } from '../../src/core/books/interchange.js';
import { booksToWorkbook, workbookToBooks } from '../../src/books/connectors/excel.js';
import { renderNewEntry } from '../../src/api/web/booksEntries.js';
import { renderNewCreditNote, renderNewInvoice } from '../../src/api/web/booksInvoices.js';

/**
 * 0216 — the books' disclosed limits, lifted (PHASE-5.md §10), in the pure parts: (d) a bank's CSV read with the
 * columns the owner said; (c) an entry across currencies, carried by the workbook and held to a bank or cash journal;
 * (a) the draft forms, saving over the draft.
 */
describe('(d) a day and an amount, read the way the owner said', () => {
  it('each date format, and a day that is not one', () => {
    expect(dayIn('02/05/2026', 'DD/MM/YYYY')).toBe('2026-05-02');
    expect(dayIn('05/02/2026', 'MM/DD/YYYY')).toBe('2026-05-02');
    expect(dayIn('2.5.2026', 'DD.MM.YYYY')).toBe('2026-05-02');
    expect(dayIn('02-05-2026', 'DD-MM-YYYY')).toBe('2026-05-02');
    expect(dayIn('2026/05/02', 'YYYY/MM/DD')).toBe('2026-05-02');
    expect(dayIn('2026-05-02 10:31', 'YYYY-MM-DD')).toBe('2026-05-02');
    expect(dayIn('31/02/2026', 'DD/MM/YYYY')).toBeNull();
    expect(dayIn('02/05/26', 'DD/MM/YYYY')).toBeNull();
    expect(dayIn('Solde', 'DD/MM/YYYY')).toBeNull();
  });
  it('the decimal mark she named; the other mark, spaces and money signs are not figures; never a third decimal', () => {
    expect(amountIn('1 250,50 €', ',')).toBe('1250.5');
    expect(amountIn('1.250,5', ',')).toBe('1250.5');
    expect(amountIn('1,250.50', '.')).toBe('1250.5');
    expect(amountIn('(12.00)', '.')).toBe('-12');
    expect(amountIn('-3,50', ',')).toBe('-3.5');
    expect(amountIn('−5,00', ',')).toBe('-5');
    expect(amountIn('12-', '.')).toBe('-12');
    expect(amountIn('', ',')).toBe('none');
    expect(amountIn('1,2,3', ',')).toBeNull();
    expect(amountIn('12.345', '.')).toBeNull();
    expect(amountIn('abc', '.')).toBeNull();
  });
});

describe('(d) the columns: guessed for her, kept whole, and a later file read only when laid out the same', () => {
  const FILE = 'Relevé\nDate opération;Libellé;Débit;Crédit;Réf.\n02/05/2026;VIR ATLAS;;1 250,50;R1\n03/05/2026;FRAIS;12,00;;R2\n';
  it('the guess: the header row, money out and in, the comma, the day\'s order', () => {
    const { sep, rows } = csvRows(FILE);
    expect(sep).toBe(';');
    expect(guessLayout(rows, sep)).toMatchObject({ headerRow: 1, date: 0, amount: { out: 2, in: 3 }, decimal: ',', dateFormat: 'DD/MM/YYYY', description: 1, reference: 4, currency: null });
    expect(guessLayout(csvRows('Fecha,Concepto,Importe\n13/04/2026,Café,"-3,50"\n').rows, ',')).toMatchObject({ headerRow: 0, date: 0, amount: { single: 2 }, decimal: ',', dateFormat: 'DD/MM/YYYY' });
    expect(guessLayout(csvRows('Date,Amount\n04/13/2026,10.00\n').rows, ',')).toMatchObject({ dateFormat: 'MM/DD/YYYY', decimal: '.' });
  });
  const layout: CsvLayout = { v: 1, sep: ';', header: ['date opération', 'libellé', 'débit', 'crédit', 'réf.'], date: 0, dateFormat: 'DD/MM/YYYY',
    amount: { out: 2, in: 3 }, decimal: ',', currency: null, description: 1, reference: 4 };
  it('kept only whole', () => {
    expect(layoutOf(layout)).toEqual(layout);
    expect(layoutOf({ ...layout, v: 2 })).toBeNull();
    expect(layoutOf({ ...layout, dateFormat: 'D/M/Y' })).toBeNull();
    expect(layoutOf({ ...layout, reference: 9 })).toBeNull();                 // a column the header has not
    expect(layoutOf({ ...layout, amount: { out: 2, in: 2 } })).toBeNull();
    expect(layoutOf({ ...layout, sep: '|' })).toBeNull();
    expect(layoutOf('{}')).toBeNull();
  });
  it('read with it: money out below zero; a line it cannot read is said by its number; another layout differs', () => {
    const r = readCsvWithLayout(FILE, layout, 'MAD');
    expect(r).toMatchObject({ kind: 'read', problems: [] });
    if (r.kind !== 'read') throw new Error('read');
    expect(r.lines.map((l) => [l.bookedOn, l.amount, l.currency, l.wording, l.reference])).toEqual([
      ['2026-05-02', '1250.5', 'MAD', 'VIR ATLAS', 'R1'], ['2026-05-03', '-12', 'MAD', 'FRAIS', 'R2']]);
    expect(readCsvWithLayout(`${FILE}TOTAL;;12,00;1 250,50;\n`, layout, 'MAD')).toMatchObject({ problems: [{ line: 5, reason: 'not_a_date' }] });
    expect(readCsvWithLayout('Fecha;Concepto;Importe\n2026-05-04;CAFE;-3,50\n', layout, 'MAD')).toEqual({ kind: 'differs' });
  });
});

describe('(c) an entry across currencies', () => {
  const data = (journalKind: 'bank' | 'sales'): BooksData => ({
    accounts: [{ code: '5141', name: 'Banque', kind: 'asset', parent: null }, { code: '3421', name: 'Clients', kind: 'asset', parent: null }],
    journals: [{ code: 'BQ', name: 'Banque', kind: journalKind }],
    parties: [], taxCodes: [],
    entries: [{ key: 'E1', journal: 'BQ', date: '2026-04-05', label: 'Paid in CNY', documentRef: 'R', documentDate: '2026-04-05', state: 'draft', acrossCurrencies: true,
      lines: [{ account: '5141', party: null, taxCode: null, currency: 'CNY', debit: '720.33' as never, credit: null, label: null },
        { account: '3421', party: null, taxCode: null, currency: 'USD', debit: null, credit: '100' as never, label: null }] }],
  });
  const known = { accounts: new Set<string>(), journals: new Set<string>(), parties: new Set<string>(), taxCodes: new Set<string>(), bookCurrency: 'MAD' };
  const where = () => ({ sheet: 'Journal', row: 2 });
  it('is not held to each foreign currency on its own; only a bank or cash journal takes it', () => {
    expect(booksProblems(data('bank'), known, where).map((p) => p.reason)).toEqual([]);
    expect(booksProblems(data('sales'), known, where).map((p) => p.reason)).toEqual(['across_journal']);
    const unmarked = { ...data('bank'), entries: data('bank').entries.map((e) => ({ ...e, acrossCurrencies: false })) };
    expect(booksProblems(unmarked, known, where).map((p) => p.reason)).toContain('unbalanced');
  });
  it('the workbook carries the mark both ways ("Across currencies"), and a workbook from before it reads the same', () => {
    const back = workbookToBooks(booksToWorkbook(data('bank')), 'MAD');
    expect(back.problems).toEqual([]);
    expect(back.data.entries[0]!.acrossCurrencies).toBe(true);
    const plain = workbookToBooks(booksToWorkbook({ ...data('bank'), entries: data('bank').entries.map(({ acrossCurrencies: _, ...e }) => e) }), 'MAD');
    expect(plain.data.entries[0]!.acrossCurrencies).toBeUndefined();
  });
});

describe('(a) a draft\'s own form saves over it', () => {
  it('entry, invoice and credit note: the same form, its address the draft\'s', () => {
    const c = { journals: [], accounts: [], parties: [], taxCodes: [], bookCurrency: 'MAD', fields: [] };
    expect(renderNewEntry('en', c as never, {}, [], '2026-04-10', 'e0000000-0000-4000-8000-000000000001')).toContain('action="/app/books/entries/e0000000-0000-4000-8000-000000000001/edit"');
    expect(renderNewEntry('en', c as never, {}, [], '2026-04-10')).toContain('action="/app/books/entries"');
    expect(renderNewInvoice('en', c as never, {}, [], '2026-04-10', 'i0000000-0000-4000-8000-000000000001')).toContain('action="/app/books/invoices/i0000000-0000-4000-8000-000000000001/edit"');
    expect(renderNewCreditNote('en', { id: 'inv', key: 'F-2026-0001', party: 'Atlas', currency: 'MAD' }, [], {}, [], '2026-04-10', 'c0000000-0000-4000-8000-000000000001'))
      .toContain('action="/app/books/credit-notes/c0000000-0000-4000-8000-000000000001/edit"');
  });
  it('a draft with more lines than the form\'s own draws them all, and two more', () => {
    const c = { journals: [], accounts: [], parties: [], taxCodes: [], bookCurrency: 'MAD', fields: [] };
    const values: Record<string, string> = {};
    for (let i = 0; i < 12; i++) values[`account${i}`] = 'x';
    const html = renderNewEntry('en', c as never, values, [], '2026-04-10', 'e0000000-0000-4000-8000-000000000001');
    expect(html).toContain('name="account13"');
    expect(html).not.toContain('name="account14"');
  });
});
