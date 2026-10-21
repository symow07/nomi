import type { BooksSystem } from '../../core/books/connector.js';
import type { PublicPost } from '../../net/publicFetch.js';
import { excelConnector } from './excel.js';
import { sheetsConnector, type SheetsDeps } from './sheets.js';
import { odooConnector } from './odoo.js';
import { xeroConnector, type XeroDeps } from './xero.js';
import { qboConnector, type QboDeps } from './quickbooks.js';

/**
 * B1 (Phase 5, item 12) — EVERY BOOKS CONNECTOR, BEHIND ONE REGISTRY. A page, the read-in and (C4) the write-back ask
 * here for a system by name; none of them names a connector's file. Each one here passes
 * tests/books-connectors/conformance.ts. A system whose installation lacks what it needs (Sheets without the Google
 * client) is not made: the page says it is not set up.
 */
export type ConnectorContext = {
  /** The currency the books are kept in (A3, `books_currency()`): a foreign entry balances in it after conversion. */
  readonly bookCurrency: string;
  /** B3 — the installation's Google client and the fetch it calls Google with. */
  readonly sheets?: SheetsDeps;
  /** B4 — the one way Nomi posts to a shop's own system on the public internet, and today's date (a key's expiry). */
  readonly odoo?: { readonly post: PublicPost; readonly today: () => string };
  /** D8 — the installation's Xero client and the fetch it calls Xero with. */
  readonly xero?: XeroDeps;
  /** D9 — the installation's Intuit client and the fetch it calls Intuit with. */
  readonly quickbooks?: QboDeps;
};

const REGISTRY = {
  excel: (c: ConnectorContext) => excelConnector(c.bookCurrency),
  sheets: (c: ConnectorContext) => (c.sheets ? sheetsConnector(c.sheets, c.bookCurrency) : null),
  odoo: (c: ConnectorContext) => (c.odoo ? odooConnector(c.odoo.post, c.bookCurrency, c.odoo.today) : null),
  xero: (c: ConnectorContext) => (c.xero ? xeroConnector(c.xero, c.bookCurrency) : null),
  quickbooks: (c: ConnectorContext) => (c.quickbooks ? qboConnector(c.quickbooks, c.bookCurrency) : null),
} as const satisfies Record<BooksSystem, (c: ConnectorContext) => unknown>;

export function booksConnector<S extends BooksSystem>(system: S, context: ConnectorContext): ReturnType<(typeof REGISTRY)[S]> {
  return REGISTRY[system](context) as ReturnType<(typeof REGISTRY)[S]>;
}
