import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FEC_FILENAME_DEFAULT, fecFileName, fecFileNameProblem } from '../../src/core/books/fec.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

/**
 * R2 (0209; the owner, 2026-10-23) — no official Moroccan FEC file name exists, so the name is Nomi's DEFAULT,
 * `{ICE}FEC{YYYYMMDD}.txt`, configurable per workspace, and said as a default in words that cannot drift.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

describe('R2 · the FEC\'s file name: a configurable default, never a rule', () => {
  it('the default: the business\'s ICE, "FEC", the fiscal year\'s last day', () => {
    expect(FEC_FILENAME_DEFAULT).toBe('{ICE}FEC{YYYYMMDD}.txt');
    expect(fecFileName(FEC_FILENAME_DEFAULT, { ice: '001234567000089', closesOn: '2026-12-31' })).toBe('001234567000089FEC20261231.txt');
    expect(fecFileName(FEC_FILENAME_DEFAULT, { ice: null, closesOn: '2026-12-31' })).toBe('FEC20261231.txt');
    expect(fecFileName('FEC_{ICE}_{YYYYMMDD}.txt', { ice: '12345678900A057', closesOn: '2027-06-30' })).toBe('FEC_12345678900A057_20270630.txt');
  });

  it('a pattern is a safe file name with only the two placeholders: no path, no hidden file, no other braces', () => {
    for (const ok of [FEC_FILENAME_DEFAULT, 'FEC_{ICE}_{YYYYMMDD}.txt', 'grand-livre.txt', '{ICE}.csv']) expect(fecFileNameProblem(ok), ok).toBeNull();
    for (const bad of ['../x.txt', 'a/b.txt', '.hidden', '', 'x'.repeat(81), 'nom de fichier.txt']) expect(fecFileNameProblem(bad), bad).toBe('shape');
    for (const bad of ['{SIREN}FEC.txt', '{ICE}{', 'FEC}.txt']) expect(fecFileNameProblem(bad), bad).toBe('placeholder');
  });

  it('the database holds the same shape and the same default', () => {
    const m = readFileSync(`${ROOT}migrations/0209_fec_filename.sql`, 'utf8');
    expect(m).toContain(`default '${FEC_FILENAME_DEFAULT}'`);
    expect(m).toContain("check (fec_filename ~ '^[A-Za-z0-9_{}-][A-Za-z0-9_.{}-]{0,79}$')");
  });

  it('the words, exactly as recorded, and never "required", "official" or the DGI\'s', () => {
    expect(t('en', 'books.fec.filename.note')).toBe("Nomi's default filename convention. Your accountant may ask for a different one — you can change it here.");
    expect(readFileSync(`${ROOT}docs/PHASE-5.md`, 'utf8')).toContain("Nomi's default filename convention. Your accountant may ask for a different one — you can change it here.");
    const banned = /required|official|compliant|DGI|obligatoire|officiel|conforme|requerido|obligatorio|oficial|必须|必需|官方|إلزامي|رسمي|مطابق/i;
    for (const l of LOCALES) {
      for (const k of ['books.fec.filename.note', 'books.fec.filename.label', 'books.fec.filename.help'] as const) {
        expect(t(l, k), `${l} ${k}`).not.toMatch(banned);
      }
    }
  });
});
