import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { excelConnector, excelNumber, workbookToBooks } from '../../src/books/connectors/excel.js';
import { xlsxWrite, type XlsxValue } from '../../src/net/xlsx.js';
import { recordsOf } from '../../src/core/books/interchange.js';
import { SAMPLE_BOOKS } from './sample.js';

/**
 * B2 — the Nomi workbook, cell by cell: what Excel itself writes (a file saved by Microsoft Excel 16 on 2026-10-22,
 * its author and path removed), how a figure is read, and every way a template can be broken — each named by sheet,
 * row and column.
 */
const FIXTURE = readFileSync(fileURLToPath(new URL('./fixtures/excel-saved.xlsx', import.meta.url)));
const HEAD = {
  accounts: ['Code', 'Name', 'Kind', 'Parent'],
  journals: ['Code', 'Name', 'Kind'],
  parties: ['Code', 'Name', 'Kind', 'Country', 'ICE', 'Tax number'],
  taxCodes: ['Code', 'Label', 'Rate', 'Kind', 'Account', 'Valid from', 'Valid to'],
  journal: ['Entry', 'Journal', 'Date', 'Label', 'Document', 'Document date', 'State', 'Account', 'Party', 'Tax code', 'Currency', 'Debit', 'Credit', 'Line label'],
};
type Rows = readonly (readonly XlsxValue[])[];
const book = (over: Partial<Record<'nomi' | keyof typeof HEAD, Rows | null>> = {}) => xlsxWrite([
  ...(over.nomi === null ? [] : [{ name: 'Nomi', rows: over.nomi ?? [['Nomi workbook', '1']] }]),
  ...(['accounts', 'journals', 'parties', 'taxCodes', 'journal'] as const).flatMap((k) => {
    const names = { accounts: 'Accounts', journals: 'Journals', parties: 'Parties', taxCodes: 'Tax codes', journal: 'Journal' } as const;
    return over[k] === null ? [] : [{ name: names[k], rows: over[k] ?? [HEAD[k]] }];
  }),
]);
const n = (v: string) => ({ number: v });
const read = (b: Buffer) => workbookToBooks(b, 'MAD');
const problems = (b: Buffer) => read(b).problems.map((p) => `${p.sheet}!${p.row}:${p.column} ${p.reason}`);
const line = (...cells: XlsxValue[]) => cells;

describe('a number cell is read at the spreadsheet\'s own precision, never through a float', () => {
  it('Excel\'s 17 digits back to what was typed; exponents written out; formulas\' tails to 15 significant digits', () => {
    expect(excelNumber('33.340000000000003')).toBe('33.34');
    expect(excelNumber('240.10000000000002')).toBe('240.1');
    expect(excelNumber('1440.6')).toBe('1440.6');
    expect(excelNumber('380')).toBe('380');
    expect(excelNumber('1.2E-5')).toBe('0.000012');
    expect(excelNumber('1E+3')).toBe('1000');
    expect(excelNumber('-0.01')).toBe('-0.01');
    expect(excelNumber('33.333333333333336')).toBe('33.3333333333333');
    expect(excelNumber('abc')).toBeNull();
  });
});

describe('what Microsoft Excel saves reads back as the same books', () => {
  it('shared strings, a date Excel made a serial, and 17-digit doubles: the same records, no problem', () => {
    const r = read(FIXTURE);
    expect(r.problems).toEqual([]);
    expect(recordsOf(r.data)).toEqual(recordsOf(SAMPLE_BOOKS));
  });
});

describe('a broken template is refused, naming the sheet, the row and the column', () => {
  it('a missing sheet, and a missing column in the header row', () => {
    expect(problems(book({ parties: null }))).toContain('Parties!0: missing_sheet');
    expect(problems(book({ journals: [['Code', 'Kind']] }))).toContain('Journals!1:Name missing_column');
  });
  it('the header row is the first row with anything in it; a row keeps its own number across blank rows', () => {
    const b = book({ accounts: [[], [], HEAD.accounts, ['3421', 'Clients', 'asset', null], [], ['3421', 'Doublon', 'asset', null]] });
    expect(problems(b)).toEqual(['Accounts!6:Code duplicate']);
  });
  it('a figure written as text with one reading is taken; "1.250" is refused, never guessed; a date is a day', () => {
    const b = book({
      accounts: [HEAD.accounts, ['3421', 'Clients', 'asset', null], ['7111', 'Ventes', 'income', null]],
      journals: [HEAD.journals, ['VE', 'Ventes', 'sales']],
      journal: [HEAD.journal,
        line('e1', 'VE', '01/05/2026', 'Facture', null, null, null, '3421', null, null, 'MAD', '1.250', null, null),
        line('e1', null, null, null, null, null, null, '7111', null, null, 'MAD', null, '1 250,00', null)],
    });
    expect(problems(b)).toEqual(['Journal!2:Date not_a_date', 'Journal!2:Debit ambiguous_amount']);
  });
  it('an entry\'s lines must agree on the entry, balance, and keep to the currency\'s cents', () => {
    const b = book({
      accounts: [HEAD.accounts, ['3421', 'Clients', 'asset', null], ['7111', 'Ventes', 'income', null]],
      journals: [HEAD.journals, ['VE', 'Ventes', 'sales']],
      journal: [HEAD.journal,
        line('e1', 'VE', '2026-05-01', 'Facture', null, null, null, '3421', null, null, 'MAD', n('100'), null, null),
        line('e1', 'VE', '2026-05-02', null, null, null, null, '7111', null, null, 'MAD', null, n('100'), null),
        line('e2', 'VE', '2026-05-03', 'Avoir', null, null, null, '3421', null, null, 'MAD', n('100'), null, null),
        line('e2', null, null, null, null, null, null, '7111', null, null, 'MAD', null, n('90'), null),
        line('e3', 'VE', '2026-05-04', 'Tiers', null, null, null, '3421', null, null, 'MAD', n('33.333333333333336'), null, null),
        line('e3', null, null, null, null, null, null, '7111', null, null, 'MAD', null, n('33.3333333333333'), null)],
    });
    expect(problems(b)).toEqual(['Journal!3:Date entry_fields_differ', 'Journal!4:Debit unbalanced', 'Journal!6:Debit too_many_decimals', 'Journal!7:Credit too_many_decimals']);
  });
  it('kinds, codes, currencies and the ICE are checked; one line is one side', () => {
    const b = book({
      accounts: [HEAD.accounts, ['3421', 'Clients', 'cash', null], ['74 11', 'Ventes', 'income', null]],
      parties: [HEAD.parties, ['C001', 'Atlas', 'customer', 'MA', '0012345670000', null]],
      journals: [HEAD.journals, ['VE', 'Ventes', 'sales']],
      journal: [HEAD.journal,
        line('e1', 'VE', '2026-05-01', 'Facture', null, null, null, '3421', null, null, 'XAU', n('10'), n('10'), null)],
    });
    expect(problems(b)).toEqual(expect.arrayContaining([
      'Accounts!2:Kind unknown_kind', 'Accounts!3:Code bad_code', 'Parties!2:ICE bad_ice', 'Journal!2:Currency unknown_currency',
    ]));
  });
});

describe('connecting opens only the Nomi workbook, of a version this reads', () => {
  const excel = excelConnector('MAD');
  it('a CSV, a workbook without the marker, a later version: each refused as not the Nomi workbook', async () => {
    for (const workbook of [Buffer.from('Code,Name\n3421,Clients'), book({ nomi: null }), book({ nomi: [['Nomi workbook', '2']] })]) {
      expect(await excel.connect({ workbook })).toEqual({ kind: 'refused', reason: 'not_a_nomi_workbook', retryable: false });
    }
    expect((await excel.connect({ workbook: book() })).kind).toBe('connected');
  });
});
