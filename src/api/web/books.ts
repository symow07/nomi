import { type Locale } from '../../core/owner/i18n/locale.js';
import { booksMay, type BooksAction, type Viewer } from '../../core/conversation/people.js';
import type { BooksProblem } from '../../core/books/interchange.js';
import type { BooksConnection } from '../../db/booksConnections.js';
import type { BooksHolding } from '../../db/booksExport.js';
import type { BeforeBooks } from '../../db/booksInterchange.js';
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
  // 0213 — connecting again (the old grant given back first) and trying a stale grant again, as for Xero and QuickBooks.
  { method: 'POST', url: '/app/books/sheets/again', action: 'post' },
  { method: 'POST', url: '/app/books/sheets/stale', action: 'post' },
  // C4 — writing back: the owner's.
  { method: 'POST', url: '/app/books/sheets/write', action: 'post' },
  { method: 'POST', url: '/app/books/odoo/write', action: 'post' },
  // B4 — the shop's own Odoo: the owner's, likewise.
  { method: 'POST', url: '/app/books/odoo/connect', action: 'post' },
  { method: 'POST', url: '/app/books/odoo/read', action: 'post' },
  { method: 'POST', url: '/app/books/odoo/disconnect', action: 'post' },
  // D8 — the shop's own Xero: connecting, reading in, writing back and disconnecting, the owner's; 0212 — connecting
  // again (the old grant given back first) and trying a stale grant again, the owner's too.
  { method: 'GET', url: '/app/books/xero/start', action: 'post' },
  { method: 'GET', url: '/app/books/xero/callback', action: 'post' },
  { method: 'POST', url: '/app/books/xero/read', action: 'post' },
  { method: 'POST', url: '/app/books/xero/write', action: 'post' },
  { method: 'POST', url: '/app/books/xero/disconnect', action: 'post' },
  { method: 'POST', url: '/app/books/xero/again', action: 'post' },
  { method: 'POST', url: '/app/books/xero/stale', action: 'post' },
  // D9 — the shop's own QuickBooks, likewise.
  { method: 'GET', url: '/app/books/quickbooks/start', action: 'post' },
  { method: 'GET', url: '/app/books/quickbooks/callback', action: 'post' },
  { method: 'POST', url: '/app/books/quickbooks/read', action: 'post' },
  { method: 'POST', url: '/app/books/quickbooks/write', action: 'post' },
  { method: 'POST', url: '/app/books/quickbooks/disconnect', action: 'post' },
  { method: 'POST', url: '/app/books/quickbooks/again', action: 'post' },
  { method: 'POST', url: '/app/books/quickbooks/stale', action: 'post' },
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
  { method: 'POST', url: '/app/books/closing/opening-journal', action: 'post' },
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
  // 0216 — a draft edited (an entry, an invoice, a credit note), and a bank's CSV columns kept: the owner's.
  { method: 'GET', url: '/app/books/entries/:id/edit', action: 'post' },
  { method: 'POST', url: '/app/books/entries/:id/edit', action: 'post' },
  { method: 'GET', url: '/app/books/invoices/:id/edit', action: 'post' },
  { method: 'POST', url: '/app/books/invoices/:id/edit', action: 'post' },
  { method: 'GET', url: '/app/books/credit-notes/:id/edit', action: 'post' },
  { method: 'POST', url: '/app/books/credit-notes/:id/edit', action: 'post' },
  { method: 'POST', url: '/app/books/bank/columns', action: 'post' },
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
  readonly sheets: { readonly offered: boolean; readonly connection: BooksConnection | null; readonly silent?: Date | null; readonly stale?: readonly Date[] };
  readonly odoo?: { readonly offered: boolean; readonly connection: BooksConnection | null; readonly key: 'fine' | 'renew' | 'expired' | null; readonly silent?: Date | null };
  /** 0212 — `stale`: when each grant Nomi no longer uses, and the system has not confirmed given back, was set aside. */
  readonly xero?: { readonly offered: boolean; readonly connection: BooksConnection | null; readonly silent?: Date | null; readonly stale?: readonly Date[] };
  readonly quickbooks?: { readonly offered: boolean; readonly connection: BooksConnection | null; readonly silent?: Date | null; readonly stale?: readonly Date[] };
};

export function renderBooksHome(locale: Locale, viewer: Viewer & { readonly kind?: 'team' | 'accountant' }, b: BooksHolding, systems?: BooksSystems, o: { readonly morocco?: boolean } = {}): string {
  const lead = viewer.kind === 'accountant' ? t(locale, 'books.home.accountant') : t(locale, 'books.home.owner');
  const state = b.hasBooks
    ? (b.lastCopyAt ? t(locale, 'data.books.lastCopy', { date: show.dateYear(locale, b.lastCopyAt) }) : '')
    : t(locale, 'books.home.empty');
  return `<h1 class="page">${esc(t(locale, 'books.home.title'))}</h1>
    <p class="lede">${esc(lead)}</p>
    ${state ? `<p class="muted">${esc(state)}</p>` : ''}
    ${o.morocco ? moroccoStart(locale) : ''}
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
    ${systems && booksMay({ id: viewer.id ?? '', name: '', ...viewer }, 'post') ? sheetsBlock(locale, systems.sheets) + (systems.odoo ? odooBlock(locale, systems.odoo) : '') + (systems.xero ? ledgerBlock(locale, 'xero', systems.xero) : '') + (systems.quickbooks ? ledgerBlock(locale, 'quickbooks', systems.quickbooks) : '') : ''}`;
}

/**
 * The owner, 2026-10-22 — the advice an accountant would give a Moroccan shop, said where the books start, so it is
 * never learnt from a refusal: start at a fiscal year's first day; mid-year, what came before comes as one opening
 * entry of balances (Avis n° 24, 2.3 d). "Period", as the Avis says it: it sets no length.
 */
const moroccoStart = (locale: Locale): string => `<div class="block" id="morocco-start">
    <h2>${esc(t(locale, 'books.morocco.title'))}</h2>
    <p>${esc(t(locale, 'books.morocco.when'))}</p>
    <p class="caption muted">${esc(t(locale, 'books.morocco.rule'))}</p>
    <p class="caption muted">${esc(t(locale, 'books.morocco.systems'))}</p>
  </div>`;

/** B5 — a connected system that has gone silent: the day it last answered, said plainly. */
const silentLine = (locale: Locale, system: string, since: Date | null | undefined): string =>
  since ? `<p role="status"><span class="pill warn">${esc(t(locale, 'books.silent.pill'))}</span> ${esc(t(locale, 'books.silent.since', { system, date: show.dateYear(locale, since) }))}</p>` : '';

/**
 * B4 — the shop's own Odoo on the books' home, the owner's: the form that connects it (the address, the name Odoo
 * shows at sign-in, the key and the day it ends — Odoo's Custom plan named up front); or where it is, when it was last
 * read, the key's reminder (item 14), a way to read it in, and a disconnect that asks first.
 */
function odooBlock(locale: Locale, o: NonNullable<BooksSystems['odoo']>): string {
  const head = `<h2>${esc(t(locale, 'books.odoo.title'))}</h2><p>${esc(t(locale, 'books.odoo.explain'))}</p>
    <p class="caption muted">${esc(t(locale, 'books.systems.history', { system: 'Odoo' }))}</p>`;
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

/** D8, D9 — the name each shop's own ledger goes by on the page. */
export const LEDGER_NAME = { xero: 'Xero', quickbooks: 'QuickBooks' } as const;
type Ledger = keyof typeof LEDGER_NAME;
/** Why Xero or QuickBooks refused, in the owner's words (one that no longer lets Nomi in has its own sentence). */
export const ledgerWhy = (locale: Locale, system: Ledger, reason: string): string =>
  (reason === 'source_missing' ? t(locale, `books.${system}.missing` as MessageKey) : t(locale, `books.connection.${reason}` as MessageKey, { system: LEDGER_NAME[system] }));
export const xeroWhy = (locale: Locale, reason: string): string => ledgerWhy(locale, 'xero', reason);

/**
 * D8, D9 — the shop's own Xero or QuickBooks on the books' home, the owner's: not set up on this installation (said,
 * not hidden); a door to connect (the vendor's own page, where the organisation or company is chosen); or which one it
 * is, when it was last read, a way to read it in and to send posted entries, and a disconnect that asks first.
 */
/** 0212 / 0213 — a grant still open there that Nomi no longer uses: said in every state, with a way to try again now. */
function staleLine(locale: Locale, system: Ledger | 'sheets', name: string, stale: readonly Date[] | undefined): string {
  if (!stale || stale.length === 0) return '';
  return `<p role="status"><span class="pill warn">${esc(t(locale, 'books.stale.pill'))}</span> ${esc(t(locale, 'books.stale.line', { system: name, date: show.dateYear(locale, stale[0]!) }))}</p>
      <form method="post" action="/app/books/${system}/stale" class="pform"><button class="btn ghost" type="submit">${esc(t(locale, 'books.stale.retry'))}</button></form>`;
}
/**
 * 0212 / 0213 — "Connect again" while a grant is still held: a button (it changes something before the consent page
 * opens) that gives the grant back first — so it says, in one line, that the connection ends first (the owner,
 * 2026-10-24): a consent left unfinished leaves the system disconnected.
 */
function againButton(locale: Locale, system: Ledger | 'sheets'): string {
  return `<form method="post" action="/app/books/${system}/again" class="pform"><button class="btn" type="submit">${esc(t(locale, 'books.sheets.again'))}</button></form>
      <p class="caption muted">${esc(t(locale, 'books.again.first'))}</p>`;
}

function ledgerBlock(locale: Locale, system: Ledger, x: NonNullable<BooksSystems['xero']>): string {
  const key = (k: string) => `books.${system}.${k}` as MessageKey;
  const head = `<h2>${esc(t(locale, key('title')))}</h2><p>${esc(t(locale, key('explain')))}</p>
    <p class="caption muted">${esc(t(locale, 'books.systems.history', { system: LEDGER_NAME[system] }))}</p>`;
  const stale = staleLine(locale, system, LEDGER_NAME[system], x.stale);
  if (!x.offered) return `<div class="block" id="${system}">${head}<p class="caption muted">${esc(t(locale, key('notSetUp')))}</p>${stale}</div>`;
  const c = x.connection;
  const connect = (k: MessageKey) => `<p><a class="deeper" href="/app/books/${system}/start">${esc(t(locale, k))}</a></p>`;
  if (!c || c.state === 'disconnected') return `<div class="block" id="${system}">${head}${stale}${connect(key('connect'))}</div>`;
  if (c.state !== 'connected') {
    const again = c.grant ? againButton(locale, system) : connect('books.sheets.again');
    return `<div class="block" id="${system}">${head}
      <p role="status"><span class="pill warn">${esc(t(locale, 'books.sheets.needsAgain'))}</span> ${esc(ledgerWhy(locale, system, c.reason ?? 'revoked'))}</p>
      ${stale}${again}</div>`;
  }
  return `<div class="block" id="${system}">${head}${stale}
      <p><bdi>${esc(c.settings['tenantName'] ?? c.settings['companyName'] ?? '')}</bdi></p>
      ${silentLine(locale, LEDGER_NAME[system], x.silent)}
      ${c.lastOkAt ? `<p class="caption muted">${esc(t(locale, 'books.sheets.lastRead', { date: show.dateYear(locale, new Date(c.lastOkAt)) }))}</p>` : ''}
      ${c.reason === 'unreachable' ? `<p class="caption muted">${esc(t(locale, 'books.connection.unreachable', { system: LEDGER_NAME[system] }))}</p>` : ''}
      <form method="post" action="/app/books/${system}/read" class="pform"><button class="btn" type="submit">${esc(t(locale, 'books.sheets.read'))}</button></form>
      <form method="post" action="/app/books/${system}/write" class="pform"><button class="btn ghost" type="submit">${esc(t(locale, key('write')))}</button></form>
      <p class="caption muted">${esc(t(locale, 'books.workbook.asDrafts'))}</p>
      <form method="post" action="/app/books/${system}/disconnect" class="pform">
        <button class="btn ghost" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, key('disconnectAsk')))}">${esc(t(locale, 'books.sheets.disconnect'))}</button></form>
    </div>`;
}

/**
 * B3 — Google Sheets on the books' home, the owner's: not set up on this installation (said, not hidden); a door to
 * connect; or the spreadsheet, a way to read it in, when it was last read, and a disconnect that asks first. A grant
 * that no longer works says why and offers to connect again — and the books here are unchanged.
 */
function sheetsBlock(locale: Locale, s: BooksSystems['sheets']): string {
  const head = `<h2>${esc(t(locale, 'books.sheets.title'))}</h2><p>${esc(t(locale, 'books.sheets.explain'))}</p>`;
  const stale = staleLine(locale, 'sheets', t(locale, 'books.sheets.title'), s.stale);
  if (!s.offered) return `<div class="block" id="sheets">${head}<p class="caption muted">${esc(t(locale, 'books.sheets.notSetUp'))}</p>${stale}</div>`;
  const c = s.connection;
  const connect = (key: 'books.sheets.connect' | 'books.sheets.again') =>
    `<p><a class="deeper" href="/app/books/sheets/start">${esc(t(locale, key))}</a></p>`;
  if (!c || c.state === 'disconnected') return `<div class="block" id="sheets">${head}${stale}${connect('books.sheets.connect')}</div>`;
  if (c.state !== 'connected') {
    return `<div class="block" id="sheets">${head}
      <p role="status"><span class="pill warn">${esc(t(locale, 'books.sheets.needsAgain'))}</span> ${esc(t(locale, `books.connection.${c.reason ?? 'revoked'}` as MessageKey, { system: t(locale, 'books.sheets.title') }))}</p>
      ${stale}${c.grant ? againButton(locale, 'sheets') : connect('books.sheets.again')}</div>`;
  }
  const url = c.settings['url'] ?? '';
  return `<div class="block" id="sheets">${head}${stale}
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
      <p class="caption muted">${esc(t(locale, 'books.workbook.asDrafts'))}</p>
      <p class="caption muted">${esc(t(locale, 'books.workbook.history'))}</p>` : '';
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
  undated?: { readonly system: 'odoo' | 'xero'; readonly taxes: readonly { readonly code: string; readonly label: string }[] },
  before?: BeforeBooks & { readonly from: 'sheets' | 'workbook' }): string {
  const shown = problems.slice(0, 200);
  // E3 — entries dated before these books, where they cannot be left where they are: how many, and why, before the
  // rows, as Odoo, Xero and QuickBooks say how many they left (the owner, 2026-10-23).
  const old = before ? `<p>${esc(t(locale, 'books.workbook.refused.beforeBooks', { n: show.count(locale, before.entries),
    date: show.dateYear(locale, new Date(`${before.opensOn}T12:00:00Z`)) }))} ${esc(t(locale, `books.workbook.refused.beforeBooks.${before.from}`))}</p>` : '';
  return `<h1 class="page">${esc(t(locale, 'books.workbook.refused.title'))}</h1>
    <p class="lede" role="alert">${esc(t(locale, 'books.workbook.refused.explain', { n: problems.length }))}</p>
    ${old}
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
export function renderWriteConflicts(locale: Locale, system: 'sheets' | 'odoo' | 'xero' | 'quickbooks', r: {
  readonly sheets?: readonly { kind: string; key: string; how: 'changed' | 'removed' }[]; readonly odoo?: readonly { key: string; reason: string; detail: string }[]; readonly written: number;
}): string {
  const items = system === 'sheets'
    ? (r.sheets ?? []).map((c) => esc(t(locale, c.how === 'removed' ? 'books.conflict.sheetsRemoved' : 'books.conflict.sheetsRecord', { kind: t(locale, `books.conflict.kind.${c.kind}` as MessageKey), key: c.key })))
    : (r.odoo ?? []).map((c) => esc(t(locale, `books.conflict.${system}.${c.reason}` as MessageKey, { key: c.key, detail: c.detail })));
  return `<h1 class="page">${esc(t(locale, 'books.conflict.title'))}</h1>
    <p class="lede" role="alert">${esc(t(locale, system === 'sheets' ? 'books.conflict.sheetsLede' : system === 'xero' ? 'books.conflict.xeroLede' : system === 'quickbooks' ? 'books.conflict.quickbooksLede' : 'books.conflict.odooLede', { n: r.written }))}</p>
    <ul class="rows">${items.slice(0, 200).map((x) => `<li class="row"><span>${x}</span></li>`).join('')}</ul>
    <p><a class="deeper" href="/app/books#${system}">${esc(t(locale, 'books.workbook.again'))}</a></p>`;
}

/** D4 (0190) — the owner's door to the CGNC chart, read from the CNC's own text (docs/cgnc/README.md). */
export function renderBooksChart(locale: Locale): string {
  return `<div class="block" id="chart">
      <h2>${esc(t(locale, 'books.chart.title'))}</h2>
      <p>${esc(t(locale, 'books.chart.explain'))}</p>
      <form method="post" action="/app/books/chart/cgnc" class="pform"><button class="btn ghost" type="submit">${esc(t(locale, 'books.chart.apply'))}</button></form>
    </div>`;
}
