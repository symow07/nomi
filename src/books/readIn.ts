import { sql } from 'kysely';
import { withTenantTx, type Db } from '../db/client.js';
import { parseBusinessId } from '../core/types/ids.js';
import type { BooksProblem } from '../core/books/interchange.js';
import type { ConnectRefusalReason } from '../core/books/connector.js';
import { loadLiveConnection, noteRead, type ConnectedSystem } from '../db/booksConnections.js';
import { readInBooks, type BeforeBooks } from '../db/booksInterchange.js';
import type { PublicPost } from '../net/publicFetch.js';
import { booksConnector } from './connectors/registry.js';
import { sheetsAccess, type SheetsDeps } from './connectors/sheets.js';
import type { XeroDeps } from './connectors/xero.js';
import { qboAccessLocked, xeroAccessLocked } from './grantLock.js';
import { qboWithAccess, type QboDeps } from './connectors/quickbooks.js';
import { sentTo } from './writeBack.js';

/**
 * B5 (Phase 5; item 13, part 1) — READING CHANGES FROM A CONNECTED SYSTEM, the one way: the owner's "Read it in" and
 * the morning's read go through here alike.
 *
 *   · IDEMPOTENT: what the system says is compared, record by record, with what it said the last time
 *     (`connector_records`, 0178), so the same change read twice is recorded once;
 *   · A CURSOR PER SYSTEM, in the database (`books_connections.cursor`, 0179): it survives a restart, and moves only
 *     when a read went in — a read refused for its problems is read again from the same place once they are fixed;
 *   · how it went is written down every time (`last_read_at`, `last_ok_at`, the reason), so a system that has gone
 *     SILENT is said on the books' page (`silentSince`).
 */
export type ReadDeps = {
  readonly db: Db;
  readonly credentialKey: Buffer;
  readonly sheets?: SheetsDeps;
  readonly odoo?: { readonly post: PublicPost; readonly today: () => string };
  readonly xero?: XeroDeps;
  readonly quickbooks?: QboDeps;
};

export type ReadResult =
  | { readonly kind: 'read'; readonly added: number; readonly replaced: number; readonly unchanged: number;
      /** E3 — entries dated before the books' open window, left where they are (Odoo, Xero, QuickBooks); 0 for Sheets. */
      readonly leftThere: number }
  | { readonly kind: 'refused'; readonly reason: ConnectRefusalReason }
  | { readonly kind: 'problems'; readonly problems: readonly BooksProblem[]; readonly undatedTaxes?: readonly { readonly code: string; readonly label: string }[];
      /** E3 — Sheets: the entries dated before these books that stopped the read, counted. */
      readonly beforeBooks?: BeforeBooks };

export async function readConnectedSystem(deps: ReadDeps, businessIdRaw: string, system: ConnectedSystem, by: string): Promise<ReadResult> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { kind: 'refused', reason: 'unreadable' };
  const conn = await loadLiveConnection(deps.db, deps.credentialKey, bid.value, system);
  if (!conn) return { kind: 'refused', reason: 'revoked' };
  const note = (o: Parameters<typeof noteRead>[3]) => withTenantTx(deps.db, bid.value, (tx) => noteRead(tx, bid.value, system, o));
  const refuse = async (reason: ConnectRefusalReason): Promise<ReadResult> => { await note({ ok: false, reason }); return { kind: 'refused', reason }; };
  const bookCurrency = (await withTenantTx(deps.db, bid.value, (tx) =>
    sql<{ c: string }>`select books_currency(${bid.value}::uuid) as c`.execute(tx))).rows[0]!.c;

  let read;
  if (system === 'sheets') {
    if (!deps.sheets || !conn.settings['spreadsheetId']) return { kind: 'refused', reason: 'source_missing' };
    const access = await sheetsAccess(deps.sheets, conn.grant);
    if ('kind' in access) return refuse(access.reason);
    read = await booksConnector('sheets', { bookCurrency, sheets: deps.sheets })!
      .changedSince({ accessToken: access.accessToken, spreadsheetId: conn.settings['spreadsheetId'] }, conn.cursor);
  } else if (system === 'xero') {
    if (!deps.xero || !conn.settings['tenantId']) return { kind: 'refused', reason: 'source_missing' };
    // Xero's refresh token rotates: the new one is kept before anything is read with it — B12: one refresh at a time.
    const access = await xeroAccessLocked(deps.xero, { db: deps.db, credentialKey: deps.credentialKey, businessId: bid.value, by });
    if ('kind' in access) return refuse(access.reason);
    read = await booksConnector('xero', { bookCurrency, xero: deps.xero })!
      .changedSince({ accessToken: access.accessToken, tenantId: conn.settings['tenantId'] }, conn.cursor);
  } else if (system === 'quickbooks') {
    if (!deps.quickbooks) return { kind: 'refused', reason: 'source_missing' };
    // R4 — the access token used again while good (refreshed only near its end, or once on a 401); whatever grant
    // Intuit returns (its refresh token changes every 24 hours) kept before anything is read with it. The realmId is
    // in the sealed grant, never in the connection's settings.
    const qbo = deps.quickbooks;
    // B12 — the access got under the connection's lock, which keeps a fresh grant itself.
    const got = await qboWithAccess(qbo, conn.grant, async () => undefined,
      (source) => booksConnector('quickbooks', { bookCurrency, quickbooks: qbo })!.changedSince(source, conn.cursor),
      qboAccessLocked(qbo, { db: deps.db, credentialKey: deps.credentialKey, businessId: bid.value, by }));
    if (got.kind === 'refused') return refuse(got.reason);
    read = got;
  } else {
    if (!deps.odoo) return { kind: 'refused', reason: 'unreachable' };
    const odoo = booksConnector('odoo', { bookCurrency, odoo: deps.odoo })!;
    // Item 14: an expired key is not used — the read stops, with that reason.
    const live = await odoo.refresh(conn.grant);
    if ('kind' in live) return refuse(live.reason);
    read = await odoo.changedSince({ origin: conn.settings['url'] ?? '', database: conn.settings['database'] ?? '', key: conn.grant.secret }, conn.cursor);
  }
  if (read.kind === 'refused') return refuse(read.reason);
  if (system === 'odoo' || system === 'xero' || system === 'quickbooks') {
    // C4: a move (a manual journal) Nomi sent there is Nomi's own entry, already in these books — never a new one
    const sent = await withTenantTx(deps.db, bid.value, (tx) => sentTo(tx, bid.value, system));
    read = { ...read, data: { ...read.data, entries: read.data.entries.filter((e) => !sent.names.has(e.key) && !sent.refs.has(e.label) && !sent.refs.has(e.key)) } };
  }
  if (read.problems.length > 0) { await note({ ok: true, cursor: conn.cursor }); return { kind: 'problems', problems: read.problems }; }
  // E3 (0207) — what Odoo, Xero and QuickBooks hold from before these books stays there: the owner still has it, and
  // nothing of it is copied. Sheets is Nomi's own spreadsheet, written back to: an entry before the window there
  // stays a problem to fix, never a row left unread — and the refusal says how many, and why (the owner, 2026-10-23).
  const out = await readInBooks(deps.db, bid.value, by, system, read.data, read.where,
    system === 'sheets' ? { kind: 'refuse' } : { kind: 'left_there' });
  if (out.kind === 'refused') {
    await note({ ok: true, cursor: conn.cursor });
    return { kind: 'problems', problems: out.problems, ...(out.undatedTaxes ? { undatedTaxes: out.undatedTaxes } : {}), ...(out.beforeBooks ? { beforeBooks: out.beforeBooks } : {}) };
  }
  await note({ ok: true, cursor: read.cursor });
  return { kind: 'read', added: out.added, replaced: out.replaced, unchanged: out.unchanged, leftThere: out.history?.entries ?? 0 };
}

/** B5 — a connected system is SILENT when no read has worked for two days (Nomi reads each one every morning). */
export const SILENT_AFTER_MS = 2 * 24 * 3600 * 1000;
export function silentSince(c: { readonly state: string; readonly lastOkAt: string | null; readonly connectedAt: string }, now: Date): Date | null {
  if (c.state !== 'connected') return null;
  const since = new Date(c.lastOkAt ?? c.connectedAt);
  return now.getTime() - since.getTime() >= SILENT_AFTER_MS ? since : null;
}

/**
 * B5 — the morning's read: every connected system of every workspace whose books are shown, one after the other,
 * as Nomi ("nomi" on the drafts it makes). Nothing here is the owner's to decide: entries arrive as drafts, a
 * problem reads nothing, a refusal is written down for the page to say.
 */
export async function readEveryConnectedSystem(deps: ReadDeps): Promise<{ readonly read: number; readonly refused: number; readonly problems: number }> {
  const due = (await sql<{ business_id: string; system: ConnectedSystem }>`
    select business_id::text as business_id, system from books_connections_due()`.execute(deps.db)).rows;
  const tally = { read: 0, refused: 0, problems: 0 };
  for (const d of due) {
    const r = await readConnectedSystem(deps, d.business_id, d.system, 'nomi').catch((): ReadResult => ({ kind: 'refused', reason: 'unreachable' }));
    if (r.kind === 'read') tally.read++; else if (r.kind === 'refused') tally.refused++; else tally.problems++;
  }
  return tally;
}
