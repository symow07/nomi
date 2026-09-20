import { describe, it, expect } from 'vitest';
import { csvCell, csvRow, csvRows, csvFile, csvFilename, CSV_BOM } from '../../src/core/owner/csv.js';

/**
 * CC-12 — the writer behind her export. Every cell in that file is text a
 * BUYER typed, so the two failure modes that matter are a spreadsheet reading
 * one as a formula, and Excel reading the file in the wrong encoding.
 */

describe('a cell is quoted only where the format says', () => {
  it('leaves ordinary text alone', () => {
    expect(csvCell('Canvas tote bag')).toBe('Canvas tote bag');
    expect(csvCell(1200)).toBe('1200');
    expect(csvCell(true)).toBe('true');
  });

  it('quotes a comma, a quote and a newline — and doubles the quote', () => {
    expect(csvCell('Yiwu, Zhejiang')).toBe('"Yiwu, Zhejiang"');
    expect(csvCell('he said "no"')).toBe('"he said ""no"""');
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"');
    expect(csvCell('carriage\rreturn')).toBe('"carriage\rreturn"');
  });

  it('writes nothing for nothing, never the word null', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    // …and an empty string is also just empty, not `""`.
    expect(csvCell('')).toBe('');
  });

  it('writes an instant as ISO-8601 in UTC', () => {
    expect(csvCell(new Date(Date.UTC(2026, 8, 21, 7, 36, 0)))).toBe('2026-09-21T07:36:00.000Z');
  });
});

describe('a buyer cannot write a formula into her spreadsheet', () => {
  it('a cell that starts like one is marked as text', () => {
    // The classic: a clickable link the owner never wrote, in her own export.
    expect(csvCell('=HYPERLINK("http://evil.test","Invoice")'))
      .toBe(`"'=HYPERLINK(""http://evil.test"",""Invoice"")"`);
    expect(csvCell('+1-800-CALL')).toBe(`'+1-800-CALL`);
    expect(csvCell('@SUM(A1:A9)')).toBe(`'@SUM(A1:A9)`);
    // A tab is not a delimiter here, so it needs no quoting — only the mark.
    expect(csvCell('\tstarts with a tab')).toBe(`'\tstarts with a tab`);
    expect(csvCell('-- not a number')).toBe(`'-- not a number`);
  });

  it('but a NUMBER is still a number — nothing is mangled to be safe', () => {
    expect(csvCell('-5')).toBe('-5');
    expect(csvCell('+0.25')).toBe('+0.25');
    expect(csvCell('-1.5e3')).toBe('-1.5e3');
    expect(csvCell(-5)).toBe('-5');
  });

  it('a formula in the MIDDLE of a cell is not a formula, and is left alone', () => {
    expect(csvCell('the price =50 each')).toBe('the price =50 each');
  });
});

describe('a row, and a file', () => {
  it('joins cells with commas and rows with CRLF, ending with one', () => {
    expect(csvRow(['a', 'b'])).toBe('a,b');
    const out = csvRows(['name', 'qty'], [['Tote', 500], ['Cap, small', 20]]);
    expect(out).toBe('name,qty\r\nTote,500\r\n"Cap, small",20\r\n');
  });

  it('an export with no rows is still a file with its header', () => {
    expect(csvRows(['name'], [])).toBe('name\r\n');
  });

  it('the file starts with the mark Excel needs, so Chinese and Arabic survive', () => {
    const file = csvFile(['名字'], [['小雅'], ['ياسمين']]);
    expect(file.startsWith(CSV_BOM), 'without it Excel on Windows reads UTF-8 as its code page').toBe(true);
    expect(file).toContain('小雅');
    expect(file).toContain('ياسمين');
    // The mark is the ONLY difference from the plain rows.
    expect(file.slice(1)).toBe(csvRows(['名字'], [['小雅'], ['ياسمين']]));
  });
});

describe('the filename', () => {
  it('says what is inside and dates it, and names no business', () => {
    expect(csvFilename('buyers', new Date(Date.UTC(2026, 8, 21)))).toBe('nomi-buyers-2026-09-21.csv');
  });
});
