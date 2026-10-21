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
  // C4 — writing back: the owner's.
  { method: 'POST', url: '/app/books/sheets/write', action: 'post' },
  { method: 'POST', url: '/app/books/odoo/write', action: 'post' },
  // B4 — the shop's own Odoo: the owner's, likewise.
  { method: 'POST', url: '/app/books/odoo/connect', action: 'post' },
  { method: 'POST', url: '/app/books/odoo/read', action: 'post' },
  { method: 'POST', url: '/app/books/odoo/disconnect', action: 'post' },
  // D8 — the shop's own Xero: connecting, reading in, writing back and disconnecting, the owner's.
  { method: 'GET', url: '/app/books/xero/start', action: 'post' },
  { method: 'GET', url: '/app/books/xero/callback', action: 'post' },
  { method: 'POST', url: '/app/books/xero/read', action: 'post' },
  { method: 'POST', url: '/app/books/xero/write', action: 'post' },
  { method: 'POST', url: '/app/books/xero/disconnect', action: 'post' },
  // C0 — the day a tax took effect, where its system gave none: the owner's.
  { method: 'POST', url: '/app/books/taxes/start', action: 'post' },
  // C1 — entries: the list and each one are the books' to see; drafting, posting, discarding, reversing the owner's.
  { method: 'GET', url: '/app/books/entries', action: 'see' },
  // D1b — credit notes and refunds: each one is the books' to see; making, issuing, discarding and refunding the owner's.
  { method: 'GET', url: '/app/books/credit-notes/:id', action: 'see' },
  { method: 'POST', url: '/app/books/credit-notes/:id/issue', action: 'post' },
  { method: 'POST', url: '/app/books/credit-notes/:id/discard', action: 'post' },
  { method: 'GET', url: '/app/books/invoices/:id/credit-notes/new', action: 'post' },
  { method: 'POST', url: '/app/books/invoices/:id/credit-notes', action: 'post' },
  { method: 'POST', url: '/app/books/invoices/:id/refunds', action: 'post' },
  // D2 — closing the books: the page the books' to see; locking, reopening, opening and closing a year the owner's.
  { method: 'GET', url: '/app/books/closing', action: 'see' },
  { method: 'POST', url: '/app/books/closing/lock', action: 'post' },
  { method: 'POST', url: '/app/books/closing/reopen', action: 'post' },
  { method: 'POST', url: '/app/books/closing/open-year', action: 'post' },
  { method: 'POST', url: '/app/books/closing/journal', action: 'post' },
  { method: 'POST', url: '/app/books/closing/year', action: 'post' },
  // D3 — the accountant pack: a copy out, the accountant's too.
  { method: 'GET', url: '/app/books/pack.xlsx', action: 'export' },
  // D6 — the books' papers: seen and taken by the accountant; kept, read and drafted from by the owner.
  { method: 'GET', url: '/app/books/papers', action: 'see' },
  { method: 'GET', url: '/app/books/papers/:id', action: 'see' },
  { method: 'GET', url: '/app/books/papers/:id/file', action: 'export' },
  { method: 'POST', url: '/app/books/papers', action: 'post' },
  { method: 'POST', url: '/app/books/papers/:id/read', action: 'post' },
  { method: 'POST', url: '/app/books/papers/:id/draft', action: 'post' },
  // D4 — the Moroccan FEC: the page the books' to see, each year's file a copy out (the accountant's too).
  { method: 'GET', url: '/app/books/fec', action: 'see' },
  { method: 'GET', url: '/app/books/fec/:file', action: 'export' },
  // D4 — the books started from the CGNC chart: the owner's.
  { method: 'POST', url: '/app/books/chart/cgnc', action: 'post' },
  // D1 — the trial balance: the books' to see (the accountant's too).
  { method: 'GET', url: '/app/books/trial-balance', action: 'see' },
  // D7 — custom fields: the list the books' to see; adding, retiring and using one again the owner's.
  { method: 'GET', url: '/app/books/fields', action: 'see' },
  { method: 'POST', url: '/app/books/fields', action: 'post' },
  { method: 'POST', url: '/app/books/fields/:id/retire', action: 'post' },
  { method: 'POST', url: '/app/books/fields/:id/use', action: 'post' },
  { method: 'GET', url: '/app/books/entries/:id', action: 'see' },
  { method: 'GET', url: '/app/books/entries/new', action: 'post' },
  { method: 'POST', url: '/app/books/entries', action: 'post' },
  { method: 'POST', url: '/app/books/entries/:id/post', action: 'post' },
  { method: 'POST', url: '/app/books/entries/:id/discard', action: 'post' },
  { method: 'POST', url: '/app/books/entries/:id/reverse', action: 'post' },
  // C1 (0183) — orders into the books, and the accounts they go to: the owner's (the orders name buyers).
  { method: 'GET', url: '/app/books/orders', action: 'post' },
  { method: 'POST', url: '/app/books/orders/:id/draft', action: 'post' },
  { method: 'POST', url: '/app/books/settings/accounts', action: 'post' },
  // C2 — invoices and payments: seen by the books' readers; drafted, issued, paid and discarded by the owner.
  { method: 'GET', url: '/app/books/invoices', action: 'see' },
  { method: 'GET', url: '/app/books/invoices/:id', action: 'see' },
  { method: 'GET', url: '/app/books/invoices/new', action: 'post' },
  { method: 'POST', url: '/app/books/invoices', action: 'post' },
  { method: 'POST', url: '/app/books/invoices/:id/issue', action: 'post' },
  { method: 'POST', url: '/app/books/invoices/:id/discard', action: 'post' },
  { method: 'POST', url: '/app/books/invoices/:id/payments', action: 'post' },
  { method: 'POST', url: '/app/books/parties', action: 'post' },
  // C3 — reconciliation: the page is the books'; reading a statement, matching and undoing are the owner's.
  { method: 'GET', url: '/app/books/bank', action: 'see' },
  { method: 'POST', url: '/app/books/bank/import', action: 'post' },
  { method: 'POST', url: '/app/books/bank/match', action: 'post' },
  { method: 'POST', url: '/app/books/bank/unmatch', action: 'post' },
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
  readonly xero?: { readonly offered: boolean; readonly connection: BooksConnection | null; readonly silent?: Date | null };
};

export function renderBooksHome(locale: Locale, viewer: Viewer & { readonly kind?: 'team' | 'accountant' }, b: BooksHolding, systems?: BooksSystems): string {
  const lead = viewer.kind === 'accountant' ? t(locale, 'books.home.accountant') : t(locale, 'books.home.owner');
  const state = b.hasBooks
    ? (b.lastCopyAt ? t(locale, 'data.books.lastCopy', { date: show.dateYear(locale, b.lastCopyAt) }) : '')
    : t(locale, 'books.home.empty');
  return `<h1 class="page">${esc(t(locale, 'books.home.title'))}</h1>
    <p class="lede">${esc(lead)}</p>
    ${state ? `<p class="muted">${esc(state)}</p>` : ''}
    <p><a class="deeper" href="/app/books/entries">${esc(t(locale, 'books.entries.title'))}</a></p>
    <p><a class="deeper" href="/app/books/invoices">${esc(t(locale, 'books.invoices.title'))}</a></p>
    <p><a class="deeper" href="/app/books/bank">${esc(t(locale, 'books.bank.title'))}</a></p>
    <p><a class="deeper" href="/app/books/trial-balance">${esc(t(locale, 'books.trial.title'))}</a></p>
    <p><a class="deeper" href="/app/books/closing">${esc(t(locale, 'books.close.title'))}</a></p>
    <p><a class="deeper" href="/app/books/fec">${esc(t(locale, 'books.fec.title'))}</a></p>
    <p><a class="deeper" href="/app/books/papers">${esc(t(locale, 'books.papers.title'))}</a></p>
    <p><a class="deeper" href="/app/books/fields">${esc(t(locale, 'books.fields.door'))}</a></p>
    <ul class="scard dl-files"><li class="row">
      <span>${esc(t(locale, 'data.books.title'))}</span>
      <a class="dl-get" href="/app/books/books.csv" download>${icon('download')}<span>${esc(t(locale, 'data.books.download'))}</span></a>
    </li></ul>
    ${workbookBlock(locale, viewer)}
    ${systems && booksMay({ id: viewer.id ?? '', name: '', ...viewer }, 'post') ? sheetsBlock(locale, systems.sheets) + (systems.odoo ? odooBlock(locale, systems.odoo) : '') + (systems.xero ? xeroBlock(locale, systems.xero) : '') : ''}`;
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
      <form method="post" action="/app/books/odoo/write" class="pform"><button class="btn ghost" type="submit">${esc(t(locale, 'books.odoo.write'))}</button></form>
      <p class="caption muted">${esc(t(locale, 'books.workbook.asDrafts'))}</p>` : form}
      <form method="post" action="/app/books/odoo/disconnect" class="pform">
        <button class="btn ghost" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, 'books.odoo.disconnectAsk'))}">${esc(t(locale, 'books.sheets.disconnect'))}</button></form>
    </div>`;
}

/** D8 — why Xero refused, in the owner's words (a Xero that no longer lets Nomi in has its own). */
export const xeroWhy = (locale: Locale, reason: string): string =>
  (reason === 'source_missing' ? t(locale, 'books.xero.missing') : t(locale, `books.connection.${reason}` as MessageKey, { system: 'Xero' }));

/**
 * D8 — the shop's own Xero on the books' home, the owner's: not set up on this installation (said, not hidden); a door
 * to connect (Xero's own page, where the organisation is chosen); or the organisation, when it was last read, a way to
 * read it in and to send posted entries, and a disconnect that asks first.
 */
function xeroBlock(locale: Locale, x: NonNullable<BooksSystems['xero']>): string {
  const head = `<h2>${esc(t(locale, 'books.xero.title'))}</h2><p>${esc(t(locale, 'books.xero.explain'))}</p>`;
  if (!x.offered) return `<div class="block" id="xero">${head}<p class="caption muted">${esc(t(locale, 'books.xero.notSetUp'))}</p></div>`;
  const c = x.connection;
  const connect = (key: 'books.xero.connect' | 'books.sheets.again') => `<p><a class="deeper" href="/app/books/xero/start">${esc(t(locale, key))}</a></p>`;
  if (!c || c.state === 'disconnected') return `<div class="block" id="xero">${head}${connect('books.xero.connect')}</div>`;
  if (c.state !== 'connected') {
    return `<div class="block" id="xero">${head}
      <p role="status"><span class="pill warn">${esc(t(locale, 'books.sheets.needsAgain'))}</span> ${esc(xeroWhy(locale, c.reason ?? 'revoked'))}</p>
      ${connect('books.sheets.again')}</div>`;
  }
  return `<div class="block" id="xero">${head}
      <p><bdi>${esc(c.settings['tenantName'] ?? '')}</bdi></p>
      ${silentLine(locale, 'Xero', x.silent)}
      ${c.lastOkAt ? `<p class="caption muted">${esc(t(locale, 'books.sheets.lastRead', { date: show.dateYear(locale, new Date(c.lastOkAt)) }))}</p>` : ''}
      ${c.reason === 'unreachable' ? `<p class="caption muted">${esc(t(locale, 'books.connection.unreachable', { system: 'Xero' }))}</p>` : ''}
      <form method="post" action="/app/books/xero/read" class="pform"><button class="btn" type="submit">${esc(t(locale, 'books.sheets.read'))}</button></form>
      <form method="post" action="/app/books/xero/write" class="pform"><button class="btn ghost" type="submit">${esc(t(locale, 'books.xero.write'))}</button></form>
      <p class="caption muted">${esc(t(locale, 'books.workbook.asDrafts'))}</p>
      <form method="post" action="/app/books/xero/disconnect" class="pform">
        <button class="btn ghost" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, 'books.xero.disconnectAsk'))}">${esc(t(locale, 'books.sheets.disconnect'))}</button></form>
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
      <form method="post" action="/app/books/sheets/write" class="pform"><button class="btn ghost" type="submit">${esc(t(locale, 'books.sheets.write'))}</button></form>
      <p class="caption muted">${esc(t(locale, 'books.sheets.writeNote'))}</p>
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
export function renderWorkbookRefused(locale: Locale, problems: readonly BooksProblem[],
  undated?: { readonly system: 'odoo' | 'xero'; readonly taxes: readonly { readonly code: string; readonly label: string }[] }): string {
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
    ${undated && undated.taxes.length > 0 ? taxStartForm(locale, undated.system, undated.taxes) : ''}
    <p><a class="deeper" href="/app/books#workbook">${esc(t(locale, 'books.workbook.again'))}</a></p>`;
}

/**
 * C0 (0181) — the taxes a system gave no start date, each with the day to confirm: the owner's, never Nomi's guess.
 * Until a day is confirmed, the tax counts from the day it was first read, and an earlier entry naming it waits.
 */
function taxStartForm(locale: Locale, system: 'odoo' | 'xero', taxes: readonly { readonly code: string; readonly label: string }[]): string {
  return `<div class="block" id="tax-start">
      <h2>${esc(t(locale, 'books.taxStart.title'))}</h2>
      <p>${esc(t(locale, 'books.taxStart.explain', { system: system === 'xero' ? 'Xero' : 'Odoo' }))}</p>
      ${taxes.map((x) => `<form method="post" action="/app/books/taxes/start" class="pform">
        <input type="hidden" name="system" value="${esc(system)}" /><input type="hidden" name="code" value="${esc(x.code)}" />
        <label class="pq"><span><bdi>${esc(x.label)}</bdi> · <bdi>${esc(x.code)}</bdi></span><input type="date" name="from" required /></label>
        <button class="btn" type="submit">${esc(t(locale, 'books.taxStart.save'))}</button></form>`).join('')}
    </div>`;
}

/**
 * C4 — a write-back that waits: what in the spreadsheet Nomi has not read (the owner's own edits), or which of Nomi's
 * entries Odoo could not take and why. Nothing was written over anything; the owner decides, then writes again.
 */
export function renderWriteConflicts(locale: Locale, system: 'sheets' | 'odoo' | 'xero', r: {
  readonly sheets?: readonly { kind: string; key: string; how: 'changed' | 'removed' }[]; readonly odoo?: readonly { key: string; reason: string; detail: string }[]; readonly written: number;
}): string {
  const items = system === 'sheets'
    ? (r.sheets ?? []).map((c) => esc(t(locale, c.how === 'removed' ? 'books.conflict.sheetsRemoved' : 'books.conflict.sheetsRecord', { kind: t(locale, `books.conflict.kind.${c.kind}` as MessageKey), key: c.key })))
    : (r.odoo ?? []).map((c) => esc(t(locale, `books.conflict.${system}.${c.reason}` as MessageKey, { key: c.key, detail: c.detail })));
  return `<h1 class="page">${esc(t(locale, 'books.conflict.title'))}</h1>
    <p class="lede" role="alert">${esc(t(locale, system === 'sheets' ? 'books.conflict.sheetsLede' : system === 'xero' ? 'books.conflict.xeroLede' : 'books.conflict.odooLede', { n: r.written }))}</p>
    <ul class="rows">${items.slice(0, 200).map((x) => `<li class="row"><span>${x}</span></li>`).join('')}</ul>
    <p><a class="deeper" href="/app/books#${system}">${esc(t(locale, 'books.workbook.again'))}</a></p>`;
}

/**
 * D0 — WHAT THE BOOKS DO NOT DO YET, said where they are used, so a limit is disclosed and not discovered (the owner,
 * 2026-10-22). Each line is a limit that holds today; one goes from here the day it is lifted.
 */
export function renderBooksNotYet(locale: Locale): string {
  return `<div class="block" id="not-yet">
      <h2>${esc(t(locale, 'books.notYet.title'))}</h2>
      <ul class="rows">${(['books.notYet.currency', 'books.notYet.csv', 'books.notYet.drafts', 'books.notYet.price'] as const).map((k) =>
        `<li class="row"><span>${esc(t(locale, k))}</span></li>`).join('')}</ul>
    </div>`;
}

/** D4 (0190) — the owner's door to the CGNC chart, read from the CNC's own text (docs/cgnc/README.md). */
export function renderBooksChart(locale: Locale): string {
  return `<div class="block" id="chart">
      <h2>${esc(t(locale, 'books.chart.title'))}</h2>
      <p>${esc(t(locale, 'books.chart.explain'))}</p>
      <form method="post" action="/app/books/chart/cgnc" class="pform"><button class="btn ghost" type="submit">${esc(t(locale, 'books.chart.apply'))}</button></form>
    </div>`;
}
