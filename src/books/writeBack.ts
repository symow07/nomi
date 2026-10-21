import { sql } from 'kysely';
import { withTenantTx, type Db, type Tx } from '../db/client.js';
import { parseBusinessId } from '../core/types/ids.js';
import { parseDecimal, type Decimal } from '../core/types/decimal.js';
import { recordsOf } from '../core/books/interchange.js';
import type { ConnectRefusalReason } from '../core/books/connector.js';
import { loadConnection, rotateGrant } from '../db/booksConnections.js';
import { GONE, readBooks, rememberWritten, unreadAt, type UnreadRecord } from '../db/booksInterchange.js';
import type { PublicPost } from '../net/publicFetch.js';
import { booksConnector } from './connectors/registry.js';
import { rewriteSpreadsheet, sheetsAccess, type SheetsDeps } from './connectors/sheets.js';
import { sendEntriesToOdoo, type OdooEntryOut, type OdooWriteConflict } from './connectors/odoo.js';
import { sendEntriesToXero, xeroAccess, type XeroDeps, type XeroEntryOut, type XeroWriteConflict } from './connectors/xero.js';

/**
 * C4 (Phase 5; item 13, part 2) — WRITING BACK, NEVER OVER ANYTHING. Nomi's books are the record (decision 10), and a
 * shop's own systems get the copy: the workbook (a download — B2), its Google spreadsheet, its Odoo. A conflict is
 * shown and WAITS; nothing is overwritten.
 *
 *   SHEETS  the spreadsheet is read first. Anything in it Nomi has not read or written (the owner typed it), and any
 *           row Nomi put there that is gone, is a conflict, listed, and nothing is written: read it in, or undo it there, then write again. With nothing
 *           unread, the books are written over it and remembered, so the next read sees nothing new.
 *   ODOO    each posted entry of Nomi's that did not come from Odoo and was not sent before is created and posted
 *           there, its reference Nomi's number; one Odoo already holds, or one naming what Odoo lacks, is a conflict.
 */
export type WriteDeps = {
  readonly db: Db; readonly credentialKey: Buffer;
  readonly sheets?: SheetsDeps;
  readonly odoo?: { readonly post: PublicPost; readonly today: () => string };
  readonly xero?: XeroDeps;
};
export type WriteResult =
  | { readonly kind: 'written'; readonly count: number }
  | { readonly kind: 'conflicts'; readonly sheets?: readonly UnreadRecord[]; readonly odoo?: readonly (OdooWriteConflict | XeroWriteConflict)[]; readonly written: number }
  | { readonly kind: 'refused'; readonly reason: ConnectRefusalReason };

export async function writeBackSheets(deps: WriteDeps, businessIdRaw: string): Promise<WriteResult> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok || !deps.sheets) return { kind: 'refused', reason: 'source_missing' };
  const conn = await withTenantTx(deps.db, bid.value, (tx) => loadConnection(tx, deps.credentialKey, bid.value, 'sheets'));
  const id = conn?.settings['spreadsheetId'];
  if (!conn || conn.state !== 'connected' || !conn.grant || !id) return { kind: 'refused', reason: 'revoked' };
  const access = await sheetsAccess(deps.sheets, conn.grant);
  if ('kind' in access) return { kind: 'refused', reason: access.reason };
  const book = (await withTenantTx(deps.db, bid.value, (tx) => sql<{ c: string }>`select books_currency(${bid.value}::uuid) as c`.execute(tx))).rows[0]!.c;
  const now = await booksConnector('sheets', { bookCurrency: book, sheets: deps.sheets })!.changedSince({ accessToken: access.accessToken, spreadsheetId: id }, null);
  if (now.kind === 'refused') return { kind: 'refused', reason: now.reason };
  const unread = await withTenantTx(deps.db, bid.value, (tx) => unreadAt(tx, bid.value, 'sheets', now.data));
  if (unread.length > 0 || now.problems.length > 0) return { kind: 'conflicts', sheets: unread, written: 0 };
  const books = await withTenantTx(deps.db, bid.value, (tx) => readBooks(tx, bid.value));
  const failed = await rewriteSpreadsheet(deps.sheets, access.accessToken, id, books);
  if (failed) return { kind: 'refused', reason: failed.reason };
  await withTenantTx(deps.db, bid.value, (tx) => rememberWritten(tx, bid.value, 'sheets', books));
  return { kind: 'written', count: recordsOf(books).length };
}

const dec = (v: string): Decimal => parseDecimal(v)!;
/** connector_records' key for a move Nomi sent: `sent:` and the move's Odoo name. */
const SENT = 'sent:';

/**
 * The moves (manual journals) of Nomi's own that an Odoo or a Xero read finds — sent by C4 — are not read back in as
 * new entries: known by the name the system gave them, or by Nomi's number (Odoo's reference, Xero's mark).
 */
export async function sentTo(tx: Tx, businessId: string, system: 'odoo' | 'xero'): Promise<{ readonly names: ReadonlySet<string>; readonly refs: ReadonlySet<string> }> {
  const rows = (await sql<{ key: string; nomi: string }>`
    select r.key, j.code || '-' || extract(year from f.starts_on)::int || '-' || e.number as nomi
      from connector_records r join journal_entries e on e.id = r.nomi_id join journals j on j.id = e.journal_id join fiscal_years f on f.id = e.fiscal_year_id
     where r.business_id = ${businessId}::uuid and r.system = ${system} and r.kind = 'entry' and r.key like ${`${SENT}%`}`.execute(tx)).rows;
  return { names: new Set(rows.map((r) => r.key.slice(SENT.length))), refs: new Set(rows.map((r) => r.nomi)) };
}
export async function writeBackOdoo(deps: WriteDeps, businessIdRaw: string): Promise<WriteResult> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok || !deps.odoo) return { kind: 'refused', reason: 'unreachable' };
  const conn = await withTenantTx(deps.db, bid.value, (tx) => loadConnection(tx, deps.credentialKey, bid.value, 'odoo'));
  if (!conn || conn.state === 'disconnected' || !conn.grant) return { kind: 'refused', reason: 'revoked' };
  const book = (await withTenantTx(deps.db, bid.value, (tx) => sql<{ c: string }>`select books_currency(${bid.value}::uuid) as c`.execute(tx))).rows[0]!.c;
  const live = await booksConnector('odoo', { bookCurrency: book, odoo: deps.odoo })!.refresh(conn.grant);
  if ('kind' in live) return { kind: 'refused', reason: live.reason };
  // Posted, not from Odoo (no draft Odoo's read made became it), not sent before.
  const entries = await withTenantTx(deps.db, bid.value, async (tx) => {
    const heads = (await sql<{ id: string; key: string; journal: string; date: string; label: string; custom: Record<string, string> }>`
      select e.id::text as id, j.code || '-' || extract(year from f.starts_on)::int || '-' || e.number as key, j.code as journal, e.entry_date::text as date, e.label, e.custom
        from journal_entries e join journals j on j.id = e.journal_id join fiscal_years f on f.id = e.fiscal_year_id
       where e.business_id = ${bid.value}::uuid and e.state = 'posted'
         and not exists (select 1 from connector_records r where r.business_id = e.business_id and r.system = 'odoo' and r.kind = 'entry' and r.nomi_id = e.id)
       order by e.entry_date, e.number limit 200`.execute(tx)).rows;
    const out: (OdooEntryOut & { id: string })[] = [];
    for (const h of heads) {
      const lines = (await sql<{ account: string; party: string | null; currency: string; label: string | null; debit: string; credit: string; book_debit: string; book_credit: string; custom: Record<string, string> }>`
        select a.code as account, p.code as party, l.currency, l.label, l.debit::text as debit, l.credit::text as credit, l.custom,
               coalesce(l.book_debit, 0)::text as book_debit, coalesce(l.book_credit, 0)::text as book_credit
          from journal_lines l join accounts a on a.id = l.account_id left join parties p on p.id = l.party_id
         where l.entry_id = ${h.id}::uuid order by l.line_no`.execute(tx)).rows;
      out.push({ ...h, lines: lines.map((l) => ({ account: l.account, party: l.party, currency: l.currency, label: l.label, custom: l.custom,
        bookDebit: dec(l.book_debit), bookCredit: dec(l.book_credit),
        own: dec(l.debit) !== '0' ? dec(l.debit) : (`-${dec(l.credit)}` as Decimal) })) });
    }
    return out;
  });
  if (entries.length === 0) return { kind: 'written', count: 0 };
  const sent = await sendEntriesToOdoo(deps.odoo.post, { origin: conn.settings['url'] ?? '', database: conn.settings['database'] ?? '', key: conn.grant.secret }, entries);
  if ('kind' in sent) return { kind: 'refused', reason: sent.reason };
  // What was sent is remembered by its Nomi entry (never sent twice) and by the name Odoo gave it (never read back in).
  await withTenantTx(deps.db, bid.value, async (tx) => {
    for (const s of sent.written) {
      const e = entries.find((x) => x.key === s.key)!;
      await sql`insert into connector_records (business_id, system, kind, key, digest, nomi_id)
        values (${bid.value}::uuid, 'odoo', 'entry', ${`${SENT}${s.odooName ?? `#${s.key}`}`}, ${GONE}, ${e.id}::uuid)
        on conflict (business_id, system, kind, key) do nothing`.execute(tx);
    }
  });
  return sent.conflicts.length > 0 ? { kind: 'conflicts', odoo: sent.conflicts, written: sent.written.length } : { kind: 'written', count: sent.written.length };
}

/**
 * D8 — Nomi's posted entries into the shop's Xero, as POSTED manual journals: the same entries as Odoo's (posted, not
 * from Xero, not sent before), in the books' own amounts — Xero's manual journals have no currency. A conflict is
 * shown and waits (src/books/connectors/xero.ts). The grant is rotated and kept first, as for every Xero call.
 */
export async function writeBackXero(deps: WriteDeps, businessIdRaw: string, by: string): Promise<WriteResult> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok || !deps.xero) return { kind: 'refused', reason: 'source_missing' };
  const conn = await withTenantTx(deps.db, bid.value, (tx) => loadConnection(tx, deps.credentialKey, bid.value, 'xero'));
  const tenantId = conn?.settings['tenantId'];
  if (!conn || conn.state === 'disconnected' || !conn.grant || !tenantId) return { kind: 'refused', reason: 'revoked' };
  const access = await xeroAccess(deps.xero, conn.grant);
  if ('kind' in access) return { kind: 'refused', reason: access.reason };
  await withTenantTx(deps.db, bid.value, (tx) => rotateGrant(tx, deps.credentialKey, bid.value, 'xero', access.grant.secret, by));
  const book = (await withTenantTx(deps.db, bid.value, (tx) => sql<{ c: string }>`select books_currency(${bid.value}::uuid) as c`.execute(tx))).rows[0]!.c;
  const entries = await withTenantTx(deps.db, bid.value, async (tx) => {
    const heads = (await sql<{ id: string; key: string; date: string; label: string; custom: Record<string, string> }>`
      select e.id::text as id, j.code || '-' || extract(year from f.starts_on)::int || '-' || e.number as key, e.entry_date::text as date, e.label, e.custom
        from journal_entries e join journals j on j.id = e.journal_id join fiscal_years f on f.id = e.fiscal_year_id
       where e.business_id = ${bid.value}::uuid and e.state = 'posted'
         and not exists (select 1 from connector_records r where r.business_id = e.business_id and r.system = 'xero' and r.kind = 'entry' and r.nomi_id = e.id)
       order by e.entry_date, e.number limit 200`.execute(tx)).rows;
    const out: (XeroEntryOut & { id: string })[] = [];
    for (const h of heads) {
      const lines = (await sql<{ account: string; party: string | null; tax_code: string | null; label: string | null; book_debit: string; book_credit: string; custom: Record<string, string> }>`
        select a.code as account, p.code as party, t.code as tax_code, l.label, coalesce(l.book_debit, l.debit)::text as book_debit,
               coalesce(l.book_credit, l.credit)::text as book_credit, l.custom
          from journal_lines l join accounts a on a.id = l.account_id left join parties p on p.id = l.party_id left join tax_codes t on t.id = l.tax_code_id
         where l.entry_id = ${h.id}::uuid order by l.line_no`.execute(tx)).rows;
      const nonEmpty = (c: Record<string, string>) => (Object.keys(c).length > 0 ? { custom: c } : {});
      out.push({ id: h.id, key: h.key, date: h.date, label: h.label, ...nonEmpty(h.custom), lines: lines.map((l) => ({ account: l.account, party: l.party,
        taxCode: l.tax_code, label: l.label, bookDebit: dec(l.book_debit), bookCredit: dec(l.book_credit), ...nonEmpty(l.custom) })) });
    }
    return out;
  });
  if (entries.length === 0) return { kind: 'written', count: 0 };
  const sent = await sendEntriesToXero(deps.xero, { accessToken: access.accessToken, tenantId }, book, entries);
  if ('kind' in sent) return { kind: 'refused', reason: sent.reason };
  await withTenantTx(deps.db, bid.value, async (tx) => {
    for (const s of sent.written) {
      const e = entries.find((x) => x.key === s.key)!;
      await sql`insert into connector_records (business_id, system, kind, key, digest, nomi_id)
        values (${bid.value}::uuid, 'xero', 'entry', ${`${SENT}${s.journalId}`}, ${GONE}, ${e.id}::uuid)
        on conflict (business_id, system, kind, key) do nothing`.execute(tx);
    }
  });
  return sent.conflicts.length > 0 ? { kind: 'conflicts', odoo: sent.conflicts, written: sent.written.length } : { kind: 'written', count: sent.written.length };
}
