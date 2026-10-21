import type { BooksSystem } from '../../core/books/connector.js';
import { excelConnector } from './excel.js';

/**
 * B1 (Phase 5, item 12) — EVERY BOOKS CONNECTOR, BEHIND ONE REGISTRY. A page, the read-in and (C4) the write-back ask
 * here for a system by name; none of them names a connector's file. A system not built yet answers null, and its
 * page says so — it is never a half-connector. Each one here passes tests/books-connectors/conformance.ts.
 */
export type ConnectorContext = {
  /** The currency the books are kept in (A3, `books_currency()`): a foreign entry balances in it after conversion. */
  readonly bookCurrency: string;
};

const REGISTRY = {
  excel: (c: ConnectorContext) => excelConnector(c.bookCurrency),
  sheets: null,   // B3
  odoo: null,     // B4
} as const satisfies Record<BooksSystem, ((c: ConnectorContext) => unknown) | null>;

export function booksConnector<S extends BooksSystem>(system: S, context: ConnectorContext):
  (typeof REGISTRY)[S] extends (c: ConnectorContext) => infer C ? C : null {
  const make = REGISTRY[system] as ((c: ConnectorContext) => unknown) | null;
  return (make ? make(context) : null) as never;
}
