import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateIdentifiers, iceAsTyped, isIce, partyIce } from '../../src/core/books/identifiers.js';
import { excelConnector } from '../../src/books/connectors/excel.js';
import { SAMPLE_BOOKS } from '../books-connectors/sample.js';

/**
 * E2 (Phase 5; 0206) — the business's ICE, IF and RC: a rule only where an official source publishes one. The ICE's
 * fifteen positions (OMPIC; the ICE portal's guide) are checked here and by the database; the IF (no published format)
 * and the RC's number (none of today's texts publishes one) are kept as typed; the RC goes with its court (Code de
 * commerce, art. 49 and 154).
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ok = (ice: string, taxId = '', rc = '', rcCourt = '') => validateIdentifiers({ ice, taxId, rc, rcCourt });

describe('E2 · the business\'s identifiers, checked only where a source sets a rule', () => {
  it('ICE: fifteen positions, spaces as typed taken out; fourteen or sixteen refused', () => {
    expect(ok('123456789 0000 57')).toEqual({ ok: true, value: { ice: '123456789000057', taxId: null, rc: null, rcCourt: null } });
    expect(ok('12345678900005')).toEqual({ ok: false, errors: { ice: 'iceLength' } });
    expect(ok('1234567890000571')).toEqual({ ok: false, errors: { ice: 'iceLength' } });
  });

  it('ICE: neither "digits only" nor a check key is invented — no official text states either', () => {
    // every official example is digits; none says they must be. 123456789000057 fails mod 97, and is OMPIC's own example.
    expect(ok('123456789000057').ok).toBe(true);
    expect(ok('12345678900A057').ok).toBe(true);
  });

  it('IF: no published format, so any IF is kept as typed, trimmed; only the storage bound refuses', () => {
    expect(ok('', ' 40 123 456 ')).toEqual({ ok: true, value: { ice: null, taxId: '40 123 456', rc: null, rcCourt: null } });
    expect(ok('', 'x'.repeat(41))).toEqual({ ok: false, errors: { taxId: 'tooLong' } });
  });

  it('RC: the number with its court, both or neither; the number itself unchecked', () => {
    expect(ok('', '', 'RC 12-A', 'Casablanca').ok).toBe(true);
    expect(ok('', '', '123', '')).toEqual({ ok: false, errors: { rcCourt: 'rcNeedsCourt' } });
    expect(ok('', '', '', 'Rabat')).toEqual({ ok: false, errors: { rc: 'courtNeedsRc' } });
  });

  it('empty clears; every bad field is said at once', () => {
    expect(ok('')).toEqual({ ok: true, value: { ice: null, taxId: null, rc: null, rcCourt: null } });
    const r = validateIdentifiers({ ice: '1', taxId: 'x'.repeat(41), rc: '1', rcCourt: '' });
    expect(r).toEqual({ ok: false, errors: { ice: 'iceLength', taxId: 'tooLong', rcCourt: 'rcNeedsCourt' } });
  });

  it('the database holds the same rules (0206): fifteen positions, the RC with its court, nothing more', () => {
    const m = readFileSync(`${ROOT}migrations/0206_business_identifiers.sql`, 'utf8');
    expect(m).toMatch(/legal_ice is null or legal_ice ~ '\^\[\^\[:space:\]\]\{15\}\$'/);
    expect(m).toMatch(/\(legal_rc is null\) = \(legal_rc_court is null\)/);
    expect(m).not.toMatch(/legal_if ~|legal_rc ~/);
  });
});

/**
 * 0208 (the owner, 2026-10-23) — ONE RULE FOR ONE IDENTIFIER. A party's ICE was fifteen digits (0170) while the
 * business's was fifteen positions (0206); a party's is now the business's, at what the source says.
 */
describe('0208 · a party\'s ICE is checked as the business\'s', () => {
  it('the rule: spaces as typed out, then fifteen positions, none a space; a letter is not refused', () => {
    expect(iceAsTyped(' 123456789 0000 57 ')).toBe('123456789000057');
    expect(isIce('12345678900A057')).toBe(true);
    expect(isIce('12345678900005')).toBe(false);
    expect(isIce('1234567890000571')).toBe(false);
    expect(isIce('12345678900005 ')).toBe(false);
  });

  it('a connected system\'s registry field is the party\'s ICE only for a party in Morocco, and only when it is one', () => {
    expect(partyIce('MA', '123456789 00A 057')).toBe('12345678900A057');
    expect(partyIce('MA', 'RC 12345')).toBeNull();
    expect(partyIce('MA', '')).toBeNull();
    expect(partyIce('MA', null)).toBeNull();
    // a Spanish or French company's fifteen-character registry number is not an ICE, nor one with no country
    expect(partyIce('ES', 'B12345678901234')).toBeNull();
    expect(partyIce('FR', '123456789000057')).toBeNull();
    expect(partyIce(null, '123456789000057')).toBeNull();
  });

  it('every connector reads a party\'s ICE through that one door, with the party\'s own country', () => {
    for (const c of ['odoo', 'xero', 'quickbooks']) {
      const src = readFileSync(`${ROOT}src/books/connectors/${c}.ts`, 'utf8');
      expect(src, c).toMatch(/ice: partyIce\((str\(p\['country_code'\]\)|country|country\(c\)), /);
    }
  });

  it('the workbook (and so Sheets): an ICE on a party not in Morocco is refused, said for what it is', () => {
    const excel = excelConnector('MAD');
    const atlas = SAMPLE_BOOKS.parties[0]!;
    const books = { ...SAMPLE_BOOKS, parties: [atlas, { ...atlas, code: 'C900', name: 'Textiles Ibéricos SL', country: 'ES', ice: 'B12345678901234' }] };
    const read = excel.toBooks(excel.fromBooks(books));
    expect(read.problems.map((p) => [p.sheet, p.column, p.reason])).toEqual([['Parties', 'ICE', 'ice_not_morocco']]);
    expect(read.data.parties.map((p) => p.code)).toEqual(['C001']);
  });

  it('the database: the parties\' check is the business\'s, word for word', () => {
    const shape = (file: string, column: string) =>
      new RegExp(`${column} is null or ${column} ~ '([^']+)'`).exec(readFileSync(`${ROOT}migrations/${file}`, 'utf8'))?.[1];
    expect(shape('0208_party_ice_positions.sql', 'ice')).toBe('^[^[:space:]]{15}$');
    expect(shape('0208_party_ice_positions.sql', 'ice')).toBe(shape('0206_business_identifiers.sql', 'legal_ice'));
    expect(readFileSync(`${ROOT}migrations/0208_party_ice_positions.sql`, 'utf8')).toMatch(/parties_ice_morocco check \(ice is null or country is not distinct from 'MA'\)/);
  });

  it('no digits-only ICE check is left anywhere in the code', () => {
    const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
      const p = `${dir}/${f}`;
      return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
    });
    const left = files(`${ROOT}src`).filter((f) => readFileSync(f, 'utf8').includes('[0-9]{15}'));
    expect(left).toEqual([]);
  });
});
