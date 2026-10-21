import { sql } from 'kysely';
import { withTenantTx, type Db } from '../db/client.js';
import { parseBusinessId } from '../core/types/ids.js';
import type { BooksProblem } from '../core/books/interchange.js';
import type { ConnectRefusalReason } from '../core/books/connector.js';
import { loadConnection, noteRead, type ConnectedSystem } from '../db/booksConnections.js';
import { readInBooks } from '../db/booksInterchange.js';
import type { PublicPost } from '../net/publicFetch.js';
import { booksConnector } from './connectors/registry.js';
import { sheetsAccess, type SheetsDeps } from './connectors/sheets.js';
import { sentToOdoo } from './writeBack.js';

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
};

export type ReadResult =
  | { readonly kind: 'read'; readonly added: number; readonly replaced: number; readonly unchanged: number }
  | { readonly kind: 'refused'; readonly reason: ConnectRefusalReason }
  | { readonly kind: 'problems'; readonly problems: readonly BooksProblem[]; readonly undatedTaxes?: readonly { readonly code: string; readonly label: string }[] };

export async function readConnectedSystem(deps: ReadDeps, businessIdRaw: string, system: ConnectedSystem, by: string): Promise<ReadResult> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { kind: 'refused', reason: 'unreadable' };
  const conn = await withTenantTx(deps.db, bid.value, (tx) => loadConnection(tx, deps.credentialKey, bid.value, system));
  if (!conn || conn.state === 'disconnected' || !conn.grant) return { kind: 'refused', reason: 'revoked' };
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
  } else {
    if (!deps.odoo) return { kind: 'refused', reason: 'unreachable' };
    const odoo = booksConnector('odoo', { bookCurrency, odoo: deps.odoo })!;
    // Item 14: an expired key is not used — the read stops, with that reason.
    const live = await odoo.refresh(conn.grant);
    if ('kind' in live) return refuse(live.reason);
    read = await odoo.changedSince({ origin: conn.settings['url'] ?? '', database: conn.settings['database'] ?? '', key: conn.grant.secret }, conn.cursor);
  }
  if (read.kind === 'refused') return refuse(read.reason);
  if (system === 'odoo') {
    // C4: a move Nomi sent there is Nomi's own entry, already in these books — never a new one
    const sent = await withTenantTx(deps.db, bid.value, (tx) => sentToOdoo(tx, bid.value));
    read = { ...read, data: { ...read.data, entries: read.data.entries.filter((e) => !sent.names.has(e.key) && !sent.refs.has(e.label)) } };
  }
  if (read.problems.length > 0) { await note({ ok: true, cursor: conn.cursor }); return { kind: 'problems', problems: read.problems }; }
  const out = await readInBooks(deps.db, bid.value, by, system, read.data, read.where);
  if (out.kind === 'refused') {
    await note({ ok: true, cursor: conn.cursor });
    return { kind: 'problems', problems: out.problems, ...(out.undatedTaxes ? { undatedTaxes: out.undatedTaxes } : {}) };
  }
  await note({ ok: true, cursor: read.cursor });
  return { kind: 'read', added: out.added, replaced: out.replaced, unchanged: out.unchanged };
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
