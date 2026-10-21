import { type Locale } from '../../core/owner/i18n/locale.js';
import { booksMay, type BooksAction, type Viewer } from '../../core/conversation/people.js';
import type { BooksProblem } from '../../core/books/interchange.js';
import type { BooksConnection } from '../../db/booksConnections.js';
import type { BooksHolding } from '../../db/booksExport.js';
import { t } from './say.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
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
  // B2 — the Nomi workbook: a copy out (the accountant's too), and a read-in, which writes the books (the owner's).
  { method: 'GET', url: '/app/books/workbook.xlsx', action: 'export' },
  { method: 'POST', url: '/app/books/workbook', action: 'post' },
  // B3 — the books in the owner's Google Sheets: connecting, reading in and disconnecting write the books (the owner's).
  { method: 'GET', url: '/app/books/sheets/start', action: 'post' },
  { method: 'GET', url: '/app/books/sheets/callback', action: 'post' },
  { method: 'POST', url: '/app/books/sheets/read', action: 'post' },
  { method: 'POST', url: '/app/books/sheets/disconnect', action: 'post' },
  // B4 — the shop's own Odoo: the owner's, likewise.
  { method: 'POST', url: '/app/books/odoo/connect', action: 'post' },
  { method: 'POST', url: '/app/books/odoo/read', action: 'post' },
  { method: 'POST', url: '/app/books/odoo/disconnect', action: 'post' },
];

/** Outside the books, what an accountant may still reach: signing out. Any other page sends them to the books. */
export const ACCOUNTANT_ALSO: ReadonlySet<string> = new Set(['POST /logout']);

export const booksRouteOf = (method: string, url: string | undefined): (typeof BOOKS_ROUTES)[number] | null =>
  BOOKS_ROUTES.find((r) => r.method === method && r.url === url) ?? null;

/**
 * The books' home: what is there, and the copy. A6 grows it into the books' own mode; until then it is the page an
 * accountant lands on, and the owner's door to the same copy.
 */
export type BooksSystems = {
  readonly sheets: { readonly offered: boolean; readonly connection: BooksConnection | null; readonly silent?: Date | null };
  readonly odoo?: { readonly offered: boolean; readonly connection: BooksConnection | null; readonly key: 'fine' | 'renew' | 'expired' | null; readonly silent?: Date | null };
};

export function renderBooksHome(locale: Locale, viewer: Viewer & { readonly kind?: 'team' | 'accountant' }, b: BooksHolding, systems?: BooksSystems): string {
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
    </li></ul>
    ${workbookBlock(locale, viewer)}
    ${systems && booksMay({ id: viewer.id ?? '', name: '', ...viewer }, 'post') ? sheetsBlock(locale, systems.sheets) + (systems.odoo ? odooBlock(locale, systems.odoo) : '') : ''}`;
}

/** B5 — a connected system that has gone silent: the day it last answered, said plainly. */
const silentLine = (locale: Locale, system: string, since: Date | null | undefined): string =>
  since ? `<p role="status"><span class="pill warn">${esc(t(locale, 'books.silent.pill'))}</span> ${esc(t(locale, 'books.silent.since', { system, date: show.dateYear(locale, since) }))}</p>` : '';

/**
 * B4 — the shop's own Odoo on the books' home, the owner's: the form that connects it (the address, the name Odoo
 * shows at sign-in, the key and the day it ends — Odoo's Custom plan named up front); or where it is, when it was last
 * read, the key's reminder (item 14), a way to read it in, and a disconnect that asks first.
 */
function odooBlock(locale: Locale, o: NonNullable<BooksSystems['odoo']>): string {
  const head = `<h2>${esc(t(locale, 'books.odoo.title'))}</h2><p>${esc(t(locale, 'books.odoo.explain'))}</p>`;
  if (!o.offered) return '';
  const c = o.connection;
  const form = `<form method="post" action="/app/books/odoo/connect" class="pform">
      <label class="pq"><span>${esc(t(locale, 'books.odoo.url'))}</span><input type="url" name="url" required placeholder="https://" inputmode="url" autocomplete="off" /></label>
      <label class="pq"><span>${esc(t(locale, 'books.odoo.name'))}</span><input type="text" name="database" required autocomplete="off" /></label>
      <label class="pq"><span>${esc(t(locale, 'books.odoo.key'))}</span><input type="password" name="key" required autocomplete="off" /></label>
      <p class="caption muted">${esc(t(locale, 'books.odoo.keyHelp'))}</p>
      <label class="pq"><span>${esc(t(locale, 'books.odoo.expires'))}</span><input type="date" name="expires" required /></label>
      <button class="btn" type="submit">${esc(t(locale, 'books.odoo.connect'))}</button>
    </form>`;
  if (!c || c.state === 'disconnected') return `<div class="block" id="odoo">${head}${form}</div>`;
  if (c.state !== 'connected') {
    return `<div class="block" id="odoo">${head}
      <p role="status"><span class="pill warn">${esc(t(locale, 'books.sheets.needsAgain'))}</span> ${esc(t(locale, `books.connection.${c.reason ?? 'revoked'}` as MessageKey, { system: 'Odoo' }))}</p>
      ${form}</div>`;
  }
  const where = `${c.settings['url'] ?? ''} · ${c.settings['database'] ?? ''}`;
  return `<div class="block" id="odoo">${head}
      <p><bdi>${esc(where)}</bdi></p>
      ${silentLine(locale, 'Odoo', o.silent)}
      ${o.key === 'renew' && c.keyExpiresOn ? `<p role="status"><span class="pill warn">${esc(t(locale, 'books.odoo.renewSoon'))}</span> ${esc(t(locale, 'books.odoo.renew', { date: show.dateYear(locale, new Date(`${c.keyExpiresOn}T12:00:00Z`)) }))}</p>` : ''}
      ${o.key === 'expired' ? `<p role="status"><span class="pill warn">${esc(t(locale, 'books.sheets.needsAgain'))}</span> ${esc(t(locale, 'books.connection.key_expired', { system: 'Odoo' }))}</p>` : ''}
      ${c.lastOkAt ? `<p class="caption muted">${esc(t(locale, 'books.sheets.lastRead', { date: show.dateYear(locale, new Date(c.lastOkAt)) }))}</p>` : ''}
      ${o.key !== 'expired' ? `<form method="post" action="/app/books/odoo/read" class="pform"><button class="btn" type="submit">${esc(t(locale, 'books.sheets.read'))}</button></form>
      <p class="caption muted">${esc(t(locale, 'books.workbook.asDrafts'))}</p>` : form}
      <form method="post" action="/app/books/odoo/disconnect" class="pform">
        <button class="btn ghost" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, 'books.odoo.disconnectAsk'))}">${esc(t(locale, 'books.sheets.disconnect'))}</button></form>
    </div>`;
}

/**
 * B3 — Google Sheets on the books' home, the owner's: not set up on this installation (said, not hidden); a door to
 * connect; or the spreadsheet, a way to read it in, when it was last read, and a disconnect that asks first. A grant
 * that no longer works says why and offers to connect again — and the books here are unchanged.
 */
function sheetsBlock(locale: Locale, s: BooksSystems['sheets']): string {
  const head = `<h2>${esc(t(locale, 'books.sheets.title'))}</h2><p>${esc(t(locale, 'books.sheets.explain'))}</p>`;
  if (!s.offered) return `<div class="block" id="sheets">${head}<p class="caption muted">${esc(t(locale, 'books.sheets.notSetUp'))}</p></div>`;
  const c = s.connection;
  const connect = (key: 'books.sheets.connect' | 'books.sheets.again') =>
    `<p><a class="deeper" href="/app/books/sheets/start">${esc(t(locale, key))}</a></p>`;
  if (!c || c.state === 'disconnected') return `<div class="block" id="sheets">${head}${connect('books.sheets.connect')}</div>`;
  if (c.state !== 'connected') {
    return `<div class="block" id="sheets">${head}
      <p role="status"><span class="pill warn">${esc(t(locale, 'books.sheets.needsAgain'))}</span> ${esc(t(locale, `books.connection.${c.reason ?? 'revoked'}` as MessageKey, { system: t(locale, 'books.sheets.title') }))}</p>
      ${connect('books.sheets.again')}</div>`;
  }
  const url = c.settings['url'] ?? '';
  return `<div class="block" id="sheets">${head}
      ${silentLine(locale, t(locale, 'books.sheets.title'), s.silent)}
      ${url.startsWith('https://docs.google.com/') ? `<p><a class="deeper" href="${esc(url)}" rel="noopener" target="_blank">${esc(t(locale, 'books.sheets.open'))}</a></p>` : ''}
      ${c.lastOkAt ? `<p class="caption muted">${esc(t(locale, 'books.sheets.lastRead', { date: show.dateYear(locale, new Date(c.lastOkAt)) }))}</p>` : ''}
      ${c.reason === 'unreachable' ? `<p class="caption muted">${esc(t(locale, 'books.connection.unreachable', { system: t(locale, 'books.sheets.title') }))}</p>` : ''}
      <form method="post" action="/app/books/sheets/read" class="pform"><button class="btn" type="submit">${esc(t(locale, 'books.sheets.read'))}</button></form>
      <p class="caption muted">${esc(t(locale, 'books.workbook.asDrafts'))}</p>
      <form method="post" action="/app/books/sheets/disconnect" class="pform">
        <button class="btn ghost" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, 'books.sheets.disconnectAsk'))}">${esc(t(locale, 'books.sheets.disconnect'))}</button></form>
    </div>`;
}

/**
 * B2 — the Nomi workbook on the books' home: the copy for anyone who may export, and the way back in for whoever may
 * post. What comes back in arrives as drafts: the owner posts them, as every entry is posted.
 */
function workbookBlock(locale: Locale, viewer: Viewer & { readonly kind?: 'team' | 'accountant' }): string {
  const back = booksMay({ id: viewer.id ?? '', name: '', ...viewer }, 'post') ? `
      <form method="post" action="/app/books/workbook" enctype="multipart/form-data" class="pform">
        <label class="pq"><span>${esc(t(locale, 'books.workbook.upload'))}</span>
          <input type="file" name="workbook" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required /></label>
        <button class="btn" type="submit">${esc(t(locale, 'books.workbook.send'))}</button>
      </form>
      <p class="caption muted">${esc(t(locale, 'books.workbook.asDrafts'))}</p>` : '';
  return `<div class="block" id="workbook">
      <h2>${esc(t(locale, 'books.workbook.title'))}</h2>
      <p>${esc(t(locale, 'books.workbook.explain'))}</p>
      <ul class="scard dl-files"><li class="row">
        <span>${esc(t(locale, 'books.workbook.file'))}</span>
        <a class="dl-get" href="/app/books/workbook.xlsx" download>${icon('download')}<span>${esc(t(locale, 'books.workbook.download'))}</span></a>
      </li></ul>${back}
    </div>`;
}

/** B2 — a workbook that was not read in, and every reason: the sheet, the row, the column, and what is wrong there. */
export function renderWorkbookRefused(locale: Locale, problems: readonly BooksProblem[]): string {
  const shown = problems.slice(0, 200);
  return `<h1 class="page">${esc(t(locale, 'books.workbook.refused.title'))}</h1>
    <p class="lede" role="alert">${esc(t(locale, 'books.workbook.refused.explain', { n: problems.length }))}</p>
    <div class="imp-table"><table>
      <thead><tr><th scope="col">${esc(t(locale, 'books.workbook.col.sheet'))}</th><th scope="col">${esc(t(locale, 'books.workbook.col.row'))}</th>
        <th scope="col">${esc(t(locale, 'books.workbook.col.column'))}</th><th scope="col">${esc(t(locale, 'books.workbook.col.what'))}</th></tr></thead>
      <tbody>${shown.map((p) => `<tr><td><bdi>${esc(p.sheet)}</bdi></td><td>${p.row > 0 ? esc(show.count(locale, p.row)) : ''}</td>
        <td><bdi>${esc(p.column)}</bdi></td><td>${esc(t(locale, `books.problem.${p.reason}` as MessageKey))}</td></tr>`).join('')}</tbody>
    </table></div>
    ${problems.length > shown.length ? `<p class="caption muted">${esc(t(locale, 'books.workbook.refused.more', { n: problems.length - shown.length }))}</p>` : ''}
    <p><a class="deeper" href="/app/books#workbook">${esc(t(locale, 'books.workbook.again'))}</a></p>`;
}
