import { type Locale } from '../../core/owner/i18n/locale.js';
import type { BooksAction, Viewer } from '../../core/conversation/people.js';
import type { BooksHolding } from '../../db/booksExport.js';
import { t } from './say.js';
import { esc } from './layout.js';
import { icon } from './icons.js';
import * as show from './values.js';

/**
 * A5 (Phase 5; decision 12) — EVERY ROUTE OF THE BOOKS, AND WHAT IT TAKES. One list, read by the guard in app.ts:
 * a books route is reached only by someone `booksMay` lets do its action; an accountant reaches these and nothing
 * else (and the few doors any signed-in person needs: `ACCOUNTANT_ALSO`). A books route not listed here is a route
 * an accountant cannot reach and staff can — so a new books page is listed here the day it is made, and
 * tests/integration/books-roles.test.ts walks every route the app has against this list.
 */
const BOOKS_ROUTES: readonly { readonly method: 'GET' | 'POST'; readonly url: string; readonly action: BooksAction }[] = [
  { method: 'GET', url: '/app/books', action: 'see' },
  { method: 'GET', url: '/app/books/books.csv', action: 'export' },
];

/** Outside the books, what an accountant may still reach: signing out. Any other page sends them to the books. */
export const ACCOUNTANT_ALSO: ReadonlySet<string> = new Set(['POST /logout']);

export const booksRouteOf = (method: string, url: string | undefined): (typeof BOOKS_ROUTES)[number] | null =>
  BOOKS_ROUTES.find((r) => r.method === method && r.url === url) ?? null;

/**
 * The books' home: what is there, and the copy. A6 grows it into the books' own mode; until then it is the page an
 * accountant lands on, and the owner's door to the same copy.
 */
export function renderBooksHome(locale: Locale, viewer: Viewer & { readonly kind?: 'team' | 'accountant' }, b: BooksHolding): string {
  const lead = viewer.kind === 'accountant' ? t(locale, 'books.home.accountant') : t(locale, 'books.home.owner');
  const state = b.hasBooks
    ? (b.lastCopyAt ? t(locale, 'data.books.lastCopy', { date: show.dateYear(locale, b.lastCopyAt) }) : '')
    : t(locale, 'books.home.empty');
  return `<h1 class="page">${esc(t(locale, 'books.home.title'))}</h1>
    <p class="lede">${esc(lead)}</p>
    ${state ? `<p class="muted">${esc(state)}</p>` : ''}
    <ul class="scard dl-files"><li class="row">
      <span>${esc(t(locale, 'data.books.title'))}</span>
      <a class="dl-get" href="/app/books/books.csv" download>${icon('download')}<span>${esc(t(locale, 'data.books.download'))}</span></a>
    </li></ul>`;
}
