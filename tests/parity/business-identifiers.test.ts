import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateIdentifiers } from '../../src/core/books/identifiers.js';

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
