/**
 * HOW LONG A CLOSED WORKSPACE'S BOOKS ARE KEPT, BY COUNTRY, AS THE PRIVACY PAGE SAYS IT (0172, 0218; the owner,
 * 2026-10-28).
 *
 * The database decides: `books_retention` (years per country, counted from the end of the last financial year with a
 * posted entry; `*` for every country not on record) is what `books_keep_until` and a paper's `keep_until` read. This
 * is the page's copy of that table, one line each, in the order the page lists them. They cannot drift apart:
 * `tests/integration/books-retention-country.test.ts` holds this list equal to the table's rows, so a migration that
 * adds a country fails until the page says it too.
 */
export type BooksRetention = {
  /** ISO 3166 alpha-2, as `businesses.country` stores it; `*` is every other country. */
  readonly country: string;
  readonly years: number;
  /** The privacy page's line for it, in every language. */
  readonly key:
    | 'legal.privacy.books.years.gb' | 'legal.privacy.books.years.fr' | 'legal.privacy.books.years.ma'
    | 'legal.privacy.books.years.es' | 'legal.privacy.books.years.other';
};

export const BOOKS_RETENTION: readonly BooksRetention[] = [
  { country: 'GB', years: 6, key: 'legal.privacy.books.years.gb' },
  { country: 'FR', years: 10, key: 'legal.privacy.books.years.fr' },
  { country: 'MA', years: 10, key: 'legal.privacy.books.years.ma' },
  { country: 'ES', years: 10, key: 'legal.privacy.books.years.es' },
  { country: '*', years: 10, key: 'legal.privacy.books.years.other' },
];
