import type { BooksData, BooksProblem, RecordKind } from './interchange.js';

/**
 * B1 (Phase 5, item 12) — ONE PLUG-IN SHAPE FOR EVERY SYSTEM THE BOOKS MEET. The Excel workbook (B2), Google Sheets
 * (B3) and Odoo (B4) are each one of these, behind one registry (src/books/connectors/registry.ts), and each passes the
 * same conformance suite (tests/books-connectors/conformance.ts): its config, a mapping round trip, a refused
 * sign-in, and "changed since". A new system costs a file, not a change to what calls it.
 *
 * Four things a system provides:
 *
 *   config      what the owner gives to connect it (a file, an address, a key), checked before anything is tried;
 *   sign-in     connect (the OAuth code exchange, a key checked against the system, a workbook opened), refresh,
 *               revoke — a refusal is a REASON from a closed list, never what the vendor said (its error bodies echo
 *               requests, and a request carries the owner's key);
 *   mapping     its own records to the books (BooksData, ./interchange.ts) and back, with every problem located;
 *   changed     what changed since a cursor — the system's own history where it keeps one (Odoo's write date), or
 *   since       everything, for a file, whose sameness the read-in then decides record by record (B5).
 *
 * The shapes are pure; the systems are not (they read files and call the network), so they live outside core.
 */

export const BOOKS_SYSTEMS = ['excel', 'sheets', 'odoo', 'xero', 'quickbooks'] as const;
export type BooksSystem = (typeof BOOKS_SYSTEMS)[number];

/** Why connecting, refreshing or reading was refused. Retryable says whether trying again later could help. */
export const CONNECT_REFUSALS = [
  'not_a_nomi_workbook',   // the file is not the Nomi workbook, or not one this version reads
  'wrong_credentials',     // the key or the grant is not accepted
  'wrong_database',        // Odoo: the database named does not exist there
  'plan_without_api',      // Odoo: a Free or Standard plan, which has no external API (item 15)
  'key_expired',           // Odoo: the key's own expiry has passed (item 14)
  'several_organisations', // Xero: the owner let Nomi into more than one organisation at once — connect again choosing one
  'revoked',               // the owner took the grant back: connect again (never "the books are empty")
  'source_missing',        // the spreadsheet (or the system's books) is gone, or no longer shared with Nomi
  'not_an_address',        // what was given is not a public https address (a private one is never called)
  'unreachable',           // the system did not answer
  'unreadable',            // it answered something this cannot read
] as const;
export type ConnectRefusalReason = (typeof CONNECT_REFUSALS)[number];
export type ConnectRefusal = { readonly kind: 'refused'; readonly reason: ConnectRefusalReason; readonly retryable: boolean };

export const refused = (reason: ConnectRefusalReason): ConnectRefusal => ({
  kind: 'refused', reason, retryable: reason === 'unreachable',
});

export type ConfigField = {
  readonly name: string;
  readonly kind: 'file' | 'url' | 'text' | 'secret';
  readonly required: boolean;
};

export type ConnectorConfig = {
  readonly system: BooksSystem;
  /** What connecting asks for. A file is the whole of it for the workbook; Odoo asks for an address, a database, a key. */
  readonly fields: readonly ConfigField[];
  /** How it signs in: nothing to hold (a file), a grant from OAuth, or a key the owner pasted. */
  readonly signIn: 'none' | 'oauth' | 'key';
};

/** What the owner gave, by field name. A file arrives as its bytes. */
export type ConfigValues = Readonly<Record<string, string | Uint8Array | undefined>>;

/** The config's own check: the required fields, and each field's kind. Nothing is tried until this is empty. */
export function configProblems(config: ConnectorConfig, values: ConfigValues): string[] {
  const out: string[] = [];
  for (const f of config.fields) {
    const v = values[f.name];
    const empty = v === undefined || (typeof v === 'string' ? v.trim() === '' : v.length === 0);
    if (empty) { if (f.required) out.push(`${f.name}: required`); continue; }
    if (f.kind === 'file' && typeof v === 'string') out.push(`${f.name}: a file`);
    if (f.kind !== 'file' && typeof v !== 'string') out.push(`${f.name}: text`);
    if (f.kind === 'url' && typeof v === 'string' && !/^https:\/\/[^\s/]+/.test(v.trim())) out.push(`${f.name}: an https address`);
  }
  return out;
}

/** What a sign-in leaves to keep: the secret part is sealed by the caller (connector_credentials), never held here. */
export type Grant = { readonly secret: string; readonly expiresAt: string | null };

export type Connected<S> = { readonly kind: 'connected'; readonly source: S; readonly grant: Grant | null };

/** Where a record is in its source (a workbook's sheet and row; a system's model and id), for a problem found later. */
export type Located = (kind: RecordKind, key: string, line?: number) => { readonly sheet: string; readonly row: number };

/** One read: the books as the system holds them (or what changed), every problem located, and where to read on from. */
export type ReadOutcome =
  | { readonly kind: 'read'; readonly data: BooksData; readonly problems: readonly BooksProblem[]; readonly cursor: string | null;
      readonly where: Located }
  | ConnectRefusal;

export interface BooksConnector<Source, Raw> {
  readonly config: ConnectorConfig;
  /** Connect: sign in, or open what was given. Refused with a reason, before anything is saved. */
  connect(values: ConfigValues): Promise<Connected<Source> | ConnectRefusal>;
  /** A grant renewed, or the reason it cannot be (revoked, expired). A system that holds nothing returns it as it is. */
  refresh(grant: Grant): Promise<Grant | ConnectRefusal>;
  /** The grant given back to the system. Nothing to do for one that holds nothing. */
  revoke(grant: Grant): Promise<void>;
  /** The mapping, both ways: the system's own form to the books, and the books to it. */
  toBooks(raw: Raw): { readonly data: BooksData; readonly problems: readonly BooksProblem[]; readonly where: Located };
  fromBooks(data: BooksData): Raw;
  /** What changed since `cursor` (null: everything). A system without history hands in everything, with a null cursor. */
  changedSince(source: Source, cursor: string | null): Promise<ReadOutcome>;
}
