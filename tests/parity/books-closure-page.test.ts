import { describe, it, expect } from 'vitest';
import { renderDataRights } from '../../src/api/web/dataRights.js';
import { OWNER_VIEW } from '../../src/core/conversation/people.js';
import { booksFileRows, BOOKS_FILE_HEADER } from '../../src/core/books/booksFile.js';
import { csvRows } from '../../src/core/owner/csv.js';
import { readFileSync } from 'node:fs';

/**
 * A2.4 (the owner, 2026-10-22) — the data page says it in plain words BEFORE the owner presses "close": the books
 * are the legal record, everything else goes at once, the books are kept until a date under a named law and then
 * erased, and a copy must be downloaded first. Only where there are books: a page never states what is not there.
 */
const LOCALES = ['en', 'zh', 'ar', 'es', 'fr'] as const;
const strip = (h: string) => h.replace(/[\u2066-\u2069]/g, '');
const holding = (over = {}) => ({
  hasBooks: true, keepUntil: new Date('2036-12-31T12:00:00Z'), law: 'Code Général des Impôts, art. 211: dix (10) ans',
  lastCopyAt: null, copyCoversAll: false, ...over,
});
const page = (l: (typeof LOCALES)[number], books: ReturnType<typeof holding> | null, viewer = OWNER_VIEW) =>
  strip(renderDataRights({ businessName: 'Atlas', requests: [], books }, l, null, viewer, 'x'));

describe('A2.4 · the data page: what is kept, until when, why, and the copy', () => {
  it('in every language: the date, the law, and the one door to the copy', () => {
    for (const l of LOCALES) {
      const html = page(l, holding());
      expect(html, l).toContain('id="books"');
      expect(html, l).toContain('Code Général des Impôts, art. 211');
      expect(html, l).toMatch(/2036/);
      expect(html.match(/href="\/app\/settings\/data\/books\.csv"/g), l).toHaveLength(1);
    }
    expect(page('en', holding())).toContain('everything else is erased at once, and your books are kept until');
  });
  it('a copy older than the last posting is said so; a copy that covers it is dated', () => {
    expect(page('en', holding({ lastCopyAt: new Date('2026-10-01T09:00:00Z'), copyCoversAll: false }))).toContain('Something was posted after your last copy');
    const ok = page('en', holding({ lastCopyAt: new Date('2026-10-01T09:00:00Z'), copyCoversAll: true }));
    expect(ok).toContain('Your last copy:');
    expect(ok).not.toContain('Something was posted after your last copy');
  });
  it('no books, no section; and it is the owner\'s alone', () => {
    for (const l of LOCALES) expect(page(l, null), l).not.toContain('id="books"');
    expect(page('en', holding(), { ...OWNER_VIEW, isOwner: false } as typeof OWNER_VIEW)).not.toContain('id="books"');
  });
});

describe('A2.4 · the copy itself', () => {
  it('Avis 24\'s eighteen fields under its own names, and the fiscal year; amounts as stored', () => {
    expect(BOOKS_FILE_HEADER.slice(0, 18)).toEqual(['Code_Journal', 'Libelle_Journal', 'Num_Ecriture', 'Date_Ecriture', 'Num_Compte',
      'Libelle_Compte', 'Num_Compte_Aux', 'Libelle_Compte_Aux', 'Ref_Piece', 'Date_Piece', 'Libelle_Ecriture', 'Montant_Debit',
      'Montant_Credit', 'Lettrage_Ecriture', 'Date_Lettrage', 'Date_Validation', 'Montant_Devise', 'Id_devise']);
    const rows = booksFileRows([{ journalCode: 'VT', journalName: 'Ventes', number: 7, entryDate: '2026-03-01', accountCode: '3421',
      accountName: 'Clients', partyCode: 'C0001', partyName: '=HYPERLINK("x")', documentRef: 'F-7', documentDate: '2026-03-01',
      label: 'Facture 7', bookDebit: '1200.50', bookCredit: '0.00', postedAt: new Date('2026-03-01T10:00:00Z'), foreign: null,
      yearStarts: '2026-01-01', yearEnds: '2026-12-31' }]);
    const text = csvRows(BOOKS_FILE_HEADER, rows);
    expect(text).toContain('VT,Ventes,7,2026-03-01,3421,Clients,C0001,"\'=HYPERLINK(""x"")",F-7,2026-03-01,Facture 7,1200.50,0.00,,,2026-03-01,,,2026-01-01/2026-12-31');
    // a line in another currency: the books' amounts, and its own amount and currency
    const eur = booksFileRows([{ journalCode: 'VT', journalName: 'Ventes', number: 8, entryDate: '2026-03-02', accountCode: '3421',
      accountName: 'Clients', partyCode: null, partyName: null, documentRef: 'F-8', documentDate: '2026-03-02', label: 'Facture 8',
      bookDebit: '1087.50', bookCredit: '0.00', postedAt: new Date('2026-03-02T10:00:00Z'), foreign: { currency: 'EUR', amount: '100.00' },
      yearStarts: '2026-01-01', yearEnds: '2026-12-31' }]);
    expect(csvRows(BOOKS_FILE_HEADER, eur)).toContain(',1087.50,0.00,,,2026-03-02,100.00,EUR,');
  });
});

describe('A2.4 · the route', () => {
  it('the owner\'s alone (data_rights), made by makeBooksFile — the one maker, which writes the receipt closing waits for', () => {
    const app = readFileSync(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    const route = app.slice(app.indexOf("app.get('/app/settings/data/books.csv'"), app.indexOf("app.get('/app/settings/data/:file'"));
    expect(route).toContain("ownerOnly(req, reply, 'data_rights'");
    expect(route).toContain('makeBooksFile(deps.db, s.businessId, personOf(s).id');
    expect(route).toContain("'cache-control', 'no-store'");
    expect(route).not.toContain('EXPORT_MAX_ROWS');
  });
});
