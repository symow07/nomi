import { describe, it, expect } from 'vitest';
import { xlsxSheets } from '../../src/net/xlsx.js';
import { booksProblems, canonical, fieldShapeProblem, fieldValueProblem, recordsOf, type BooksData, type BooksField } from '../../src/core/books/interchange.js';
import { booksToWorkbook, sheetsToBooks, workbookSheets, workbookToBooks } from '../../src/books/connectors/excel.js';
import { customMark, readMark, sendEntriesToOdoo } from '../../src/books/connectors/odoo.js';
import { customColumn } from '../../src/core/books/booksFile.js';
import { customFromForm } from '../../src/db/booksFields.js';
import { customInputs, customShown, renderFields } from '../../src/api/web/booksFields.js';
import { SAMPLE_BOOKS, SAMPLE_WITH_FIELDS } from '../books-connectors/sample.js';
import { odooFake } from '../books-connectors/odoo-fake.js';

/**
 * D7 (Phase 5, item 9) — custom fields, the pure parts: a value checked as the database checks it (0170), the
 * definitions' own shape, the workbook's columns, Odoo's mark, the owner's copy, and the page.
 */
const field = (o: Partial<BooksField>): BooksField => ({ appliesTo: 'line', key: 'k', label: 'K', kind: 'text', choices: null, required: false, ...o });
const none = new Set<string>();
const known: Parameters<typeof booksProblems>[1] = { accounts: none, journals: none, parties: none, taxCodes: none, bookCurrency: 'MAD' };
const nowhere = () => ({ sheet: '', row: 0 });
const reasons = (d: BooksData, k = known) => booksProblems(d, k, nowhere).map((p) => `${p.reason} ${p.column}`)
  .filter((r) => !/^unknown_(account|journal|party|tax_code) /.test(r));

describe('D7 · a value, as the database checks it', () => {
  it('a number written exactly, a real day, one of its choices, text under 500', () => {
    const n = field({ kind: 'number' });
    for (const ok of ['12', '12.50', '-0.5']) expect(fieldValueProblem(n, ok), ok).toBeNull();
    for (const bad of ['1e3', '12,5', '12.', '.5', '']) expect(fieldValueProblem(n, bad), bad).toBe('bad_field_value');
    const d = field({ kind: 'date' });
    for (const ok of ['2024-02-29', '2026-12-31']) expect(fieldValueProblem(d, ok), ok).toBeNull();
    for (const bad of ['2026-02-29', '2026-02-30', '2026-13-01', '30/04/2026', '2026-4-1']) expect(fieldValueProblem(d, bad), bad).toBe('bad_field_value');
    const c = field({ kind: 'choice', choices: ['retail', 'wholesale'] });
    expect(fieldValueProblem(c, 'retail')).toBeNull();
    expect(fieldValueProblem(c, 'Retail')).toBe('bad_field_value');
    expect(fieldValueProblem(field({}), 'x'.repeat(500))).toBeNull();
    expect(fieldValueProblem(field({}), 'x'.repeat(501))).toBe('bad_field_value');
  });

  it('a definition the database can keep; only a party\'s field is required', () => {
    expect(fieldShapeProblem(field({}))).toBe(false);
    for (const bad of [{ key: 'Project' }, { key: '1st' }, { key: 'a-b' }, { label: ' ' }, { kind: 'choice' as const },
      { choices: ['a'] }, { kind: 'choice' as const, choices: [] }, { kind: 'choice' as const, choices: ['a', 'a'] },
      { kind: 'choice' as const, choices: ['a | b'] }, { kind: 'choice' as const, choices: [' a'] }]) {
      expect(fieldShapeProblem(field(bad)), JSON.stringify(bad)).toBe(true);
    }
    const books: BooksData = { ...SAMPLE_BOOKS, fields: [field({ required: true }), field({ appliesTo: 'party', key: 'p', required: true })] };
    expect(reasons(books)).toEqual(['required_not_party Required', ...SAMPLE_BOOKS.parties.map(() => 'required_field party.p')]);
  });

  it('every value under a field these books or Nomi define, of its kind; a required one present; a retired one asks for nothing', () => {
    const d: BooksData = { ...SAMPLE_WITH_FIELDS, parties: SAMPLE_WITH_FIELDS.parties.map((p, i) => (i === 0 ? { ...p, custom: { segment: 'vip', since: '2026-02-30', colour: 'red' } } : p)) };
    expect(reasons(d)).toEqual(['bad_field_value party.segment', 'bad_field_value party.since', 'unknown_field party.colour']);
    // the fields Nomi holds count as much as the books' own
    const { fields: _f, ...bare } = d;
    expect(reasons(bare)).toContain('unknown_field party.segment');
    expect(reasons(bare, { ...known, fields: SAMPLE_WITH_FIELDS.fields! })).toEqual(reasons(d));
    const retired: BooksData = { ...SAMPLE_WITH_FIELDS, fields: SAMPLE_WITH_FIELDS.fields!.map((f) => (f.key === 'segment' ? { ...f, retired: true as const } : f)),
      parties: SAMPLE_WITH_FIELDS.parties.map(({ custom: _c, ...p }) => p) };
    expect(reasons(retired)).toEqual([]);
  });

  it('books without custom values read exactly as before: no "custom" in a record, no field record', () => {
    for (const r of recordsOf(SAMPLE_BOOKS)) expect(r.content).not.toContain('"custom"');
    expect(recordsOf(SAMPLE_BOOKS).some((r) => r.kind === 'field')).toBe(false);
    expect(canonical(SAMPLE_WITH_FIELDS.parties[0])).toContain('"custom":{"segment":"wholesale","since":"2024-03-01"}');
  });
});

describe('D7 · the workbook', () => {
  const sheet = (d: BooksData, name: string) => workbookSheets(d).find((s) => s.name === name)!.rows;
  it('the fields under their header on the "Nomi" sheet; a column per field, named by it', () => {
    const about = sheet(SAMPLE_WITH_FIELDS, 'Nomi');
    expect(about).toContainEqual(['Applies to', 'Key', 'Label', 'Kind', 'Choices', 'Required', 'In use']);
    expect(about).toContainEqual(['party', 'segment', 'Segment', 'choice', 'retail | wholesale', 'yes', 'yes']);
    expect(sheet(SAMPLE_WITH_FIELDS, 'Parties')[0]).toEqual(['Code', 'Name', 'Kind', 'Country', 'ICE', 'Tax number', 'Registry number', 'party.segment', 'party.since']);
    expect(sheet(SAMPLE_WITH_FIELDS, 'Journal')[0]!.slice(-2)).toEqual(['entry.project', 'line.weight_kg']);
    // books without fields: the sheets as before
    expect(sheet(SAMPLE_BOOKS, 'Nomi')).toHaveLength(2);
    // 0216 — six columns and the registry number's (written always, read where there)
    expect(sheet(SAMPLE_BOOKS, 'Parties')[0]).toHaveLength(7);
  });

  it('an entry\'s value is the same on each of its lines; a day may be an Excel date; a value of a retired field is kept', () => {
    const rows = (name: string) => [...sheet(SAMPLE_WITH_FIELDS, name)].map((r) => [...r]);
    const journal = rows('Journal');
    const col = journal[0]!.indexOf('entry.project');
    const first = journal.findIndex((r) => r[0] === 'VE-2026-1');
    journal[first + 1]![col] = 'Another project';
    const parties = rows('Parties');
    parties[1]![parties[0]!.indexOf('party.since')] = { number: '45352' };   // 2024-03-01, as Excel keeps it
    const book = { date1904: false, sheets: [...workbookSheets(SAMPLE_WITH_FIELDS).filter((s) => !['Journal', 'Parties'].includes(s.name)), { name: 'Journal', rows: journal }, { name: 'Parties', rows: parties }]
      .map((s) => ({ name: s.name, rows: new Map(s.rows.map((r, i) => [i + 1, r.map((c) => (c !== null && typeof c === 'object' ? { text: (c as { number: string }).number, number: true } : { text: c === null ? '' : String(c), number: false }))])) })) };
    const read = sheetsToBooks(book, 'MAD');
    expect(read.problems.map((p) => `${p.sheet} ${p.row} ${p.column} ${p.reason}`)).toEqual([`Journal ${first + 2} entry.project entry_fields_differ`]);
    expect(read.data.parties[0]!.custom).toEqual({ segment: 'wholesale', since: '2024-03-01' });
    const retired: BooksData = { ...SAMPLE_WITH_FIELDS, fields: SAMPLE_WITH_FIELDS.fields!.map((f) => (f.key === 'weight_kg' ? { ...f, retired: true as const } : f)) };
    const back = workbookToBooks(booksToWorkbook(retired), 'MAD');
    expect(back.problems).toEqual([]);
    expect(recordsOf(back.data)).toEqual(recordsOf(retired));
    expect(xlsxSheets(booksToWorkbook(retired))?.sheets.find((s) => s.name === 'Nomi')?.rows.size).toBe(2 + 2 + 4);   // the blank row between is not kept
  });
});

describe('D7 · Odoo\'s mark', () => {
  it('URL-safe base64 of the values, read back through HTML, from a label, in any script; nothing else is taken for one', () => {
    const v = { note: 'تسليم في الدار البيضاء', 项目: 'x' } as Record<string, string>;
    const mark = customMark(v);
    expect(mark).toMatch(/^\[nomi:[A-Za-z0-9_-]+\]$/);
    expect(readMark(`<p>${mark}</p>`).custom).toEqual({ note: 'تسليم في الدار البيضاء', 项目: 'x' });
    expect(readMark(`Sacs en toile ${mark}`)).toEqual({ rest: 'Sacs en toile', custom: v });
    expect(readMark(mark)).toEqual({ rest: null, custom: v });
    expect(customMark({})).toBe('');
    expect(readMark('Sacs [nomi:not-json]').custom).toBeUndefined();
    expect(readMark('[nomi:WzFd]').custom).toBeUndefined();   // "[1]": not an object of texts
    expect(readMark('Facture [12]')).toEqual({ rest: 'Facture [12]', custom: undefined });
  });

  it('writing back: an entry\'s values in the move\'s notes, a line\'s at the end of its label — and read back so', async () => {
    const odoo = odooFake();
    odoo.publish(SAMPLE_BOOKS);
    const s = { origin: 'https://shop.odoo.com', database: 'shop-db', key: 'good-key' };
    const sent = await sendEntriesToOdoo(odoo.post, s, [{ key: 'VE-2026-7', journal: 'VE', date: '2026-05-02', label: 'Facture 7', custom: { project: 'Expo' },
      lines: [{ account: '3421', party: 'C001', currency: 'MAD', label: null, bookDebit: '10' as never, bookCredit: '0' as never, own: '10' as never, custom: { weight_kg: '2.5' } },
        { account: '7111', party: null, currency: 'MAD', label: 'Sacs', bookDebit: '0' as never, bookCredit: '10' as never, own: '-10' as never }] }]);
    expect('written' in sent && sent.written).toHaveLength(1);
    const vals = odoo.created[0]!.vals as { narration: string; line_ids: [number, number, { name: string }][] };
    expect(vals.narration).toBe(customMark({ project: 'Expo' }));
    expect(vals.line_ids.map((l) => l[2].name)).toEqual([`Facture 7 ${customMark({ weight_kg: '2.5' })}`, 'Sacs']);
  });
});

describe('D7 · the owner\'s copy, and the page', () => {
  it('one exact column: the entry\'s and the line\'s values, keys in order; empty when none', () => {
    expect(customColumn({ entry: { project: 'Expo' }, line: { weight_kg: '2.5', batch: 'B' } })).toBe('{"entry.project":"Expo","line.batch":"B","line.weight_kg":"2.5"}');
    expect(customColumn({ entry: {}, line: {} })).toBeNull();
    expect(customColumn(undefined)).toBeNull();
  });

  it('the forms: one input per field, its kind\'s own; the values checked and named by the field', () => {
    const fields = SAMPLE_WITH_FIELDS.fields!;
    const html = customInputs('en', fields, 'party', 'cf_party_', { cf_party_segment: 'retail' });
    expect(html).toContain('<select name="cf_party_segment" aria-label="Segment" required><option value=""></option><option selected>retail</option><option>wholesale</option></select>');
    expect(html).toContain('name="cf_party_since" value="" aria-label="Customer since" type="date"');
    expect(customInputs('en', fields, 'line', 'cf_line0_', {}, { bare: true, n: 1 })).toBe('<td><input name="cf_line0_weight_kg" value="" aria-label="Weight (kg) 1" inputmode="decimal" dir="ltr" /></td>');
    expect(customFromForm(fields, 'party', { cf_party_since: '2026-02-30' }, 'cf_party_').wrong).toEqual([
      { label: 'Segment', why: 'required_field' }, { label: 'Customer since', why: 'bad_field_value' }]);
    expect(customFromForm(fields, 'party', { cf_party_segment: ' retail ' }, 'cf_party_')).toEqual({ values: { segment: 'retail' }, wrong: [] });
    const shown = customShown('fr', fields, 'party', { since: '2024-03-01', gone: 'x' });
    expect(shown).toMatch(/^<bdi>Customer since<\/bdi>: <bdi>[^<]*1 mars 2024<\/bdi> · <bdi>gone<\/bdi>: <bdi>x<\/bdi>$/);
  });

  it('the page: the owner adds and retires; the accountant sees the list and no form', () => {
    const rows = SAMPLE_WITH_FIELDS.fields!.map((f, i) => ({ ...f, id: `00000000-0000-4000-8000-00000000000${i}`, inUse: i !== 1 }));
    const owner = renderFields('en', { id: 'o', isOwner: true }, rows);
    expect(owner).toContain('action="/app/books/fields"');
    expect(owner).toContain('/retire"');
    expect(owner).toContain('/use"');
    expect(owner).toContain('Retired');
    const accountant = renderFields('en', { id: 'a', isOwner: false, kind: 'accountant' }, rows);
    expect(accountant).toContain('Segment');
    expect(accountant).not.toContain('<form');
  });
});
