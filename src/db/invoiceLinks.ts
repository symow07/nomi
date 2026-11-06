import { sql } from 'kysely';
import type { Db, Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { mintToken } from './proofs.js';
import { invoicePdfFilename } from '../core/books/invoicePdf.js';

/**
 * 0226 — THE LINK A CHANNEL FETCHES AN INVOICE'S PDF FROM (`invoice_links`).
 *
 * Nothing of the document is stored: the page at `/inv/<token>/<key>.pdf` renders the invoice from its own rows each
 * time it is opened. The token is unguessable (32 random bytes, as the proforma link's), lives `INVOICE_LINK_DAYS`
 * and is resolved through one definer function that answers nothing for an unknown, expired or erased token alike.
 * One link is made per send: a provider fetches it within minutes, and a customer who kept the address can still
 * open it for two weeks.
 *
 * The file name ends the address so a provider that names a file after its path (Telegram) and the worker (which
 * reads it back for WhatsApp and e-mail) agree on it — the invoice's key, nothing else.
 */
export const INVOICE_LINK_DAYS = 14;

export async function makeInvoiceLink(
  tx: Tx, businessId: BusinessId, invoiceId: string, by: string, now: Date,
): Promise<string> {
  const token = mintToken();
  const expires = new Date(now.getTime() + INVOICE_LINK_DAYS * 86_400_000);
  await sql`insert into invoice_links (business_id, invoice_id, token, made_by, made_at, expires_at)
    values (${businessId}::uuid, ${invoiceId}::uuid, ${token}, ${by}, ${now}, ${expires})`.execute(tx);
  return token;
}

/** The address's path for a token and the invoice's key. */
export const invoiceLinkPath = (token: string, key: string): string =>
  `/inv/${encodeURIComponent(token)}/${encodeURIComponent(invoicePdfFilename(key))}`;

/** The whole address, or null where the installation has no public address (never a guess at the host). */
export function invoiceLinkUrl(publicBaseUrl: string | null | undefined, token: string, key: string): string | null {
  if (!publicBaseUrl) return null;
  return `${publicBaseUrl.replace(/\/+$/, '')}${invoiceLinkPath(token, key)}`;
}

/** The token inside an address this module made, or null for any other address. */
export function invoiceLinkToken(url: string): string | null {
  try {
    const m = /^\/inv\/([A-Za-z0-9_-]{32,})\/[^/]+$/.exec(new URL(url).pathname);
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}

/** Public: the token to its workspace and invoice, while the link lives. Null for every failure alike. */
export async function resolveInvoiceLink(db: Db | Tx, token: string): Promise<{ businessId: string; invoiceId: string } | null> {
  if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) return null;
  const r = (await sql<{ business_id: string; invoice_id: string }>`
    select business_id::text as business_id, invoice_id::text as invoice_id from resolve_invoice_link(${token})`.execute(db)).rows[0];
  return r ? { businessId: r.business_id, invoiceId: r.invoice_id } : null;
}
