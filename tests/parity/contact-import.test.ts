import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { FIXTURE_CONTACT_IMPORT_COLUMNS, FIXTURE_CONTACT_IMPORT_PREVIEW } from '../fixtures/setupMinutes.js';
import {
  candidatePhones, contactColumnsView, contactsPreview, decodeContactFile, guessColumns, readContactMapping,
  readContactRecords, readContactText, readContacts, readLanguage, readPhone, readSelectedRows,
  CONTACT_IMPORT_MAX_BYTES, CONTACT_IMPORT_MAX_ROWS,
} from '../../src/core/onboard/contactImport.js';
import { parseTable, tableRecords } from '../../src/core/onboard/csvTable.js';
import { xlsxRecords, xlsxRows, xlsxWrite } from '../../src/net/xlsx.js';

/**
 * Block 4.4 — customers from a file, the pure part (src/core/onboard/contactImport.ts): reading the file, the columns,
 * every row, and the Check step, held to the frozen contract's fixtures. Writing and matching against the database:
 * tests/integration/contact-import.test.ts.
 */
const F = FIXTURE_CONTACT_IMPORT_COLUMNS;
const RECORDS = [F.headers, ...F.rows];
const CASEY = { id: '00000000-0000-4000-8000-000000000103', name: 'Casey on record' };
const MATCHES = new Map([
  ['12025550103', [CASEY]],
  ['12025550108', [{ id: 'a', name: 'One' }, { id: 'b', name: 'Two' }]],
]);

describe('Block 4.4 · customers from a file · the contract', () => {
  it('pre-chooses the fixture\'s columns from its header, and shows them as the contract does', () => {
    const g = guessColumns(RECORDS);
    expect(g).toEqual({ hasHeader: true, mapping: F.mapping });
    expect(contactColumnsView(F.importId, RECORDS, g.hasHeader, g.mapping)).toEqual(F);
  });

  it('reads every row and judges it exactly as the fixture preview says', () => {
    const rows = readContacts(RECORDS, true, F.mapping);
    expect(candidatePhones(rows)).toEqual(['12025550101', '12025550102', '12025550103', '12025550108']);
    expect(contactsPreview(F.importId, rows, MATCHES, null)).toEqual(FIXTURE_CONTACT_IMPORT_PREVIEW);
  });

  it('a row the owner unticked stays to add, unticked, and leaves the selected count', () => {
    const p = contactsPreview(F.importId, readContacts(RECORDS, true, F.mapping), MATCHES, [3]);
    expect(p.rows.filter((r) => r.verdict.kind === 'to_add').map((r) => [r.row, r.verdict.kind === 'to_add' && r.verdict.selected]))
      .toEqual([[2, false], [3, true]]);
    expect(p.counts).toEqual({ ...FIXTURE_CONTACT_IMPORT_PREVIEW.counts, selected: 1 });
    expect(contactsPreview(F.importId, readContacts(RECORDS, true, F.mapping), MATCHES, []).counts.selected).toBe(0);
  });

  it('the first row with a number owns it, even when it was refused for something else', () => {
    const recs = [['phone', 'language'], ['+44 20 7946 0000', 'Klingonese'], ['0044 20 7946 0000', 'en'], ['+442079460000', '']];
    const rows = readContacts(recs, true, { name: null, phone: 0, language: 1, notes: null });
    expect(rows.map((r) => r.verdict)).toEqual([
      { kind: 'refused', reason: 'language_not_recognised' },
      { kind: 'duplicate_in_file', firstRow: 2 },
      { kind: 'duplicate_in_file', firstRow: 2 },
    ]);
  });

  it('row numbers are the file\'s own: the header and blank lines count, blank rows are left out', () => {
    const read = readContactText('name,phone\n\nAda,+12025550101\n,\nBo,+12025550102\n');
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const rows = readContacts(read.records, true, { name: 0, phone: 1, language: null, notes: null });
    expect(rows.map((r) => r.row)).toEqual([3, 5]);
  });
});

describe('Block 4.4 · the values', () => {
  it('a phone must say its country with + or 00; the country is never guessed', () => {
    expect(readPhone('+1 (202) 555-0101')).toEqual({ ok: true, phone: '12025550101' });
    expect(readPhone('(+44) 20 7946 0000')).toEqual({ ok: true, phone: '442079460000' });
    expect(readPhone('0012025550102')).toEqual({ ok: true, phone: '12025550102' });
    expect(readPhone('  ')).toEqual({ ok: false, reason: 'no_phone' });
    for (const local of ['2025550104', '0612345678', '612 34 56 78', '1-202-555-0101']) expect([local, readPhone(local)]).toEqual([local, { ok: false, reason: 'not_international' }]);
    for (const bad of ['+1-CALL-ME', '+12', '+1234567890123456', '00abc']) expect([bad, readPhone(bad)]).toEqual([bad, { ok: false, reason: 'bad_phone' }]);
  });

  it('a language is a code, a tag, or its name in English, in itself or in the owner\'s languages; anything else refuses', () => {
    const cases: [string, string | null | undefined][] = [
      ['', null], ['en', 'en'], ['EN', 'en'], ['pt-BR', 'pt'], ['zh_Hans', 'zh'], ['English', 'en'], ['french', 'fr'],
      ['Français', 'fr'], ['francais', 'fr'], ['Español', 'es'], ['العربية', 'ar'], ['中文', 'zh'], ['Deutsch', 'de'],
      ['Arabe', 'ar'], ['árabe', 'ar'], ['阿拉伯语', 'ar'],
      ['xx', undefined], ['Klingon', undefined], ['unrecognised language', undefined], ['english please', undefined],
    ];
    for (const [raw, code] of cases) expect([raw, readLanguage(raw)]).toEqual([raw, code]);
  });

  it('a name over 120 characters or notes over 1,000 refuse the row; nothing is cut', () => {
    const recs = [['n', 'p', 'x'], ['é'.repeat(120), '+12025550101', 'x'.repeat(1000)], ['é'.repeat(121), '+12025550102', ''], ['A', '+12025550103', 'x'.repeat(1001)]];
    const rows = readContacts(recs, true, { name: 0, phone: 1, language: null, notes: 2 });
    expect(rows.map((r) => r.verdict.kind === 'refused' ? r.verdict.reason : r.verdict.kind)).toEqual(['candidate', 'long_name', 'long_notes']);
  });
});

describe('Block 4.4 · reading the file', () => {
  it('reads commas, tabs and semicolons, and quotes as CSV writes them', () => {
    expect(readContactText('Name;Phone\n"Diaz; Ana";+34 600 000 000')).toEqual({ ok: true, records: [['Name', 'Phone'], ['Diaz; Ana', '+34 600 000 000']] });
    expect(readContactText('Name\tPhone\nAna\t+34600000000')).toEqual({ ok: true, records: [['Name', 'Phone'], ['Ana', '+34600000000']] });
    expect(readContactText('﻿name,phone\n"Ana ""A"" Diaz","+34 600, 000"')).toEqual({ ok: true, records: [['name', 'phone'], ['Ana "A" Diaz', '+34 600, 000']] });
  });

  it('refuses before step 2: a broken quote, nothing at all, a header alone, too much', () => {
    expect(readContactText('name,phone\n"Ana,+34600000000')).toEqual({ ok: false, reason: 'not_a_table' });
    expect(readContactText('\n , \n')).toEqual({ ok: false, reason: 'empty' });
    expect(readContactText('Name,Phone\n')).toEqual({ ok: false, reason: 'empty' });
    const many = (n: number) => ['phone', ...Array.from({ length: n }, (_, i) => `+1202555${String(i).padStart(4, '0')}`)].join('\n');
    expect(readContactText(many(CONTACT_IMPORT_MAX_ROWS)).ok).toBe(true);
    expect(readContactText(many(CONTACT_IMPORT_MAX_ROWS + 1))).toEqual({ ok: false, reason: 'too_many' });
    expect(readContactText(`phone\n+12025550101,${'x'.repeat(CONTACT_IMPORT_MAX_BYTES)}`)).toEqual({ ok: false, reason: 'too_large' });
  });

  it('decodes UTF-8 and UTF-16 with its mark; anything else is unreadable text', () => {
    const enc = new TextEncoder();
    expect(decodeContactFile(enc.encode('name,phone\nZoë,+33612345678'))).toBe('name,phone\nZoë,+33612345678');
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('名字\t电话', 'utf16le')]);
    expect(decodeContactFile(le)).toBe('名字\t电话');
    expect(decodeContactFile(Buffer.from([0x6e, 0x61, 0xe9, 0x2c, 0x31]))).toBeNull();   // Latin-1 é
    expect(decodeContactFile(Buffer.from('a,b\u0000c'))).toBeNull();
  });

  it('with no header, the phone column is the one whose cells are international numbers', () => {
    expect(guessColumns([['Ana', '+34600000000'], ['Bo', '+34600000001']])).toEqual({ hasHeader: false, mapping: { name: null, phone: 1, language: null, notes: null } });
    expect(guessColumns([['+34600000000']]).mapping.phone).toBe(0);
    expect(guessColumns([['Téléphone', 'NOM'], ['+33612345678', 'Zoé']])).toEqual({ hasHeader: true, mapping: { name: 1, phone: 0, language: null, notes: null } });
    expect(guessColumns([['الاسم', 'رقم', 'اللغة', 'ملاحظات']]).mapping).toEqual({ name: 0, phone: 1, language: 2, notes: 3 });
  });

  it('the owner\'s columns: a number that is a column, or none; no phone column is refused', () => {
    expect(readContactMapping({ name: '0', phone: '1', language: '', notes: '7' }, 4)).toEqual({ ok: true, mapping: { name: 0, phone: 1, language: null, notes: null } });
    expect(readContactMapping({ name: '0', phone: '' }, 4)).toEqual({ ok: false, reason: 'no_phone_column' });
    expect(readContactMapping({ phone: '4' }, 4)).toEqual({ ok: false, reason: 'no_phone_column' });
    expect(readContactMapping({ phone: ['1'] as unknown as string }, 4)).toEqual({ ok: false, reason: 'no_phone_column' });
    expect(readContactMapping({ phone: '01' }, 4)).toEqual({ ok: false, reason: 'no_phone_column' });
  });

  it('the ticked rows: repeated record numbers; anything else is ignored', () => {
    expect(readSelectedRows(['3', '2', '2', 'x', '0', '-1', ' 5 '])).toEqual([2, 3, 5]);
    expect(readSelectedRows('4')).toEqual([4]);
    expect(readSelectedRows(undefined)).toEqual([]);
  });

  it('a workbook\'s rows stay where the sheet put them; past the cap is too many', () => {
    const book = xlsxWrite([{ name: 'Customers', rows: [['Name', 'Phone'], ['Ana', '+34600000000'], [], ['Bo', '+34600000001']] }]);
    const read = xlsxRecords(book, 10);
    expect(read).toEqual({ records: [['Name', 'Phone'], ['Ana', '+34600000000'], [], ['Bo', '+34600000001']] });
    if (read && read !== 'too_many') {
      const ok = readContactRecords(read.records);
      expect(ok.ok && readContacts(ok.records, true, { name: 0, phone: 1, language: null, notes: null }).map((r) => r.row)).toEqual([2, 4]);
    }
    expect(xlsxRecords(book, 3)).toBe('too_many');
    expect(xlsxRecords(Buffer.from('PK\u0003\u0004not a zip'), 10)).toBeNull();
    // The catalogue's reader is unchanged: blank rows dropped, two rows at least.
    expect(xlsxRows(book)).toEqual([['Name', 'Phone'], ['Ana', '+34600000000'], ['Bo', '+34600000001']]);
  });

  it('the shared tokenizer keeps parseTable\'s rule: a comma wins a tie with a tab', () => {
    expect(tableRecords('a\tb,c\n1\t2,3').records[0]).toEqual(['a\tb', 'c']);
    expect(parseTable('a\tb,c\n1\t2,3')).toEqual({ header: ['a\tb', 'c'], rows: [['1\t2', '3']] });
    expect(parseTable('a\tb\tc\n1\t2\t3')).toEqual({ header: ['a', 'b', 'c'], rows: [['1', '2', '3']] });
  });
});

describe('Block 4.4 · the file\'s language releases nothing (t1r, 2026-11-08)', () => {
  const ROOT = new URL('../../', import.meta.url);
  const read = (f: string) => readFileSync(new URL(f, ROOT), 'utf8');
  it('only the import writes clients.stated_language and only the customer\'s data copy reads it: nothing on the send path', () => {
    const naming = (readdirSync(new URL('src/', ROOT), { recursive: true }) as string[])
      .filter((f) => f.endsWith('.ts') && read(`src/${f}`).includes('stated_language')).map((f) => `src/${f}`).sort();
    expect(naming).toEqual(['src/api/web/buyerCopy.ts', 'src/db/contactImports.ts']);
  });
  it('the import never writes preferred_language, the customer\'s own reading that surveys, reminders and the send gate trust', () => {
    const insert = read('src/db/contactImports.ts').match(/insert into clients \(([^)]*)\)/);
    expect(insert?.[1]).toBe('business_id, display_name, phone, stated_language, notes');
    expect(read('src/db/surveys.ts')).toMatch(/coalesce\(cl\.preferred_language,/);
    expect(read('src/outbound/invoiceReminders.ts')).toMatch(/coalesce\(cl\.preferred_language,/);
  });
  it('0232 adds the column, names it in the erasure contract and the tool, and the wrapped erasure clears it', () => {
    const m = read('migrations/0232_setup_minutes.sql');
    expect(m).toMatch(/alter table clients\s+add column if not exists stated_language text/);
    expect(m).toContain("('clients', 'anonymise', array['display_name','email','phone','country','preferred_language','notes','stated_language']");
    expect(m).toContain('rename to erase_customer_rows_before_0232');
    expect(m).toMatch(/erase_customer_rows_before_0232\(p_business, p_client, p_request, p_restored\);\s+update clients set stated_language = null/);
    expect(read('tools/erase-buyer.mjs')).toContain("'preferred_language', 'notes', 'stated_language']");
  });
});
