import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { xlsxRows, rowsAsCsv, looksLikeXlsx, XLSX_MAX_ROWS } from '../../src/net/xlsx.js';
import { parseTable } from '../../src/core/onboard/csvTable.js';

/**
 * EXT — an Excel workbook read with node:zlib alone. Each workbook here is
 * built in the test from its XML parts, so nothing binary lives in the repo.
 */

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

/** A ZIP of these parts (deflated unless told to store), as Excel writes one. */
function zip(parts: Record<string, string>, opts: { store?: boolean; encrypt?: string } = {}): Buffer {
  const locals: Buffer[] = []; const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(parts)) {
    const raw = Buffer.from(text, 'utf8');
    const data = opts.store ? raw : deflateRawSync(raw);
    const nameB = Buffer.from(name, 'utf8');
    const flags = opts.encrypt === name ? 1 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(opts.store ? 0 : 8, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameB.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(opts.store ? 0 : 8, 10); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameB.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameB, data); centrals.push(central, nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(parts).length, 8); end.writeUInt16LE(Object.keys(parts).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const WORKBOOK = '<workbook><sheets><sheet name="Prices" sheetId="1" r:id="rId7"/><sheet name="Notes" sheetId="2" r:id="rId8"/></sheets></workbook>';
const RELS = '<Relationships><Relationship Id="rId8" Target="worksheets/sheet1.xml"/><Relationship Id="rId7" Target="worksheets/sheet2.xml"/></Relationships>';
const SST = '<sst><si><t>Name</t></si><si><t>Price</t></si><si><r><t>Silk </t></r><r><t xml:space="preserve">scarf &amp; box</t></r></si></sst>';
const PRICES = `<worksheet><sheetData>
  <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>Size</t></is></c></row>
  <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>24.5</v></c><c r="D2" t="str"><v>S, M</v></c></row>
  <row r="3"/>
  <row r="4"><c r="A4" t="inlineStr"><is><t>Tote "Big"</t></is></c><c r="B4"><f>B2*2</f><v>49</v></c></row>
</sheetData></worksheet>`;
const NOTES = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>not this sheet</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>';
const BOOK = { 'xl/workbook.xml': WORKBOOK, 'xl/_rels/workbook.xml.rels': RELS, 'xl/sharedStrings.xml': SST, 'xl/worksheets/sheet2.xml': PRICES, 'xl/worksheets/sheet1.xml': NOTES };

describe('EXT · an Excel workbook, read as the table it is', () => {
  it('the FIRST sheet as the workbook orders it: shared and inline strings, saved formula values, gaps kept, empty rows dropped', () => {
    expect(xlsxRows(zip(BOOK))).toEqual([
      ['Name', 'Price', '', 'Size'],
      ['Silk scarf & box', '24.5', '', 'S, M'],
      ['Tote "Big"', '49'],
    ]);
    expect(xlsxRows(zip(BOOK, { store: true }))).toEqual(xlsxRows(zip(BOOK)));
  });
  it('as CSV, it reads back as the same table the column mapping takes', () => {
    const rows = xlsxRows(zip(BOOK))!;
    const table = parseTable(rowsAsCsv(rows))!;
    expect(table.header).toEqual(['Name', 'Price', '', 'Size']);
    expect(table.rows[0]).toEqual(['Silk scarf & box', '24.5', '', 'S, M']);
    expect(table.rows[1]![0]).toBe('Tote "Big"');
  });
  it('refused, as a broken CSV is: not a ZIP, no sheet, an encrypted part, a part that inflates past its limit, too many rows', () => {
    expect(looksLikeXlsx(Buffer.from('Name,Price\nA,1'))).toBe(false);
    expect(xlsxRows(Buffer.from('Name,Price\nA,1'))).toBeNull();
    expect(xlsxRows(zip({ 'word/document.xml': '<w/>' }))).toBeNull();
    expect(xlsxRows(zip(BOOK, { encrypt: 'xl/worksheets/sheet2.xml' }))).toBeNull();
    const bomb = { ...BOOK, 'xl/sharedStrings.xml': `<sst><si><t>${'a'.repeat(21 * 1024 * 1024)}</t></si></sst>` };
    expect(xlsxRows(zip(bomb))).toBeNull();
    const many = `<worksheet><sheetData>${Array.from({ length: XLSX_MAX_ROWS + 2 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c></row>`).join('')}</sheetData></worksheet>`;
    expect(xlsxRows(zip({ ...BOOK, 'xl/worksheets/sheet2.xml': many }))).toBeNull();
  });
  it('the file route reads a workbook this way, and the form offers .xlsx', () => {
    const app = src('src/api/web/app.ts');
    expect(app).toContain('if (looksLikeXlsx(bytes)) {');
    expect(app).toContain('text = rowsAsCsv(rows);');
    expect(src('src/api/web/storeImport.ts')).toContain('.xlsx,');
  });
});
