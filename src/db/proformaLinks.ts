import { sql } from 'kysely';
import type { Db, Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { mintToken } from './proofs.js';

/**
 * Phase 2c (0151) — the ONE writer of an order's proforma link.
 *
 * One live link per order: a token on the order itself (`orders.proforma_token`), unguessable like the price
 * link's (32 bytes, base64url, `mintToken`). Making it is idempotent — a second tap, from the conversation or the
 * order, returns the link that exists. Turning it off clears the token, and the page answers 404, as one that
 * never existed. A customer's erasure clears it with their e-mail and notes (0151's `erase_customer_rows`).
 *
 * Nothing here sends anything: the owner copies the link and sends it in the conversation.
 */

/** The order's live token, or null. */
export async function proformaToken(tx: Tx, businessId: BusinessId, orderId: string): Promise<string | null> {
  return (await sql<{ token: string | null }>`
    select proforma_token as token from orders where id = ${orderId}::uuid and business_id = ${businessId}::uuid`
    .execute(tx)).rows[0]?.token ?? null;
}

/** Make the order's link, or return the one it has. Null: no such order in this workspace. */
export async function makeProformaLink(tx: Tx, businessId: BusinessId, orderId: string): Promise<{ token: string; made: boolean } | null> {
  const made = (await sql<{ token: string }>`
    update orders set proforma_token = ${mintToken()}
     where id = ${orderId}::uuid and business_id = ${businessId}::uuid and proforma_token is null
    returning proforma_token as token`.execute(tx)).rows[0];
  if (made) return { token: made.token, made: true };
  const live = await proformaToken(tx, businessId, orderId);
  return live ? { token: live, made: false } : null;
}

/** Turn the order's link off. False: there was none (or no such order). */
export async function stopProformaLink(tx: Tx, businessId: BusinessId, orderId: string): Promise<boolean> {
  return (await sql<{ id: string }>`
    update orders set proforma_token = null
     where id = ${orderId}::uuid and business_id = ${businessId}::uuid and proforma_token is not null
    returning id::text as id`.execute(tx)).rows.length > 0;
}

/**
 * Public: the token to its workspace and order, through the one definer function, which returns nothing of the
 * order. Null for every failure alike — unknown, turned off, erased — so the page is no oracle.
 */
export async function resolveProforma(db: Db, token: string): Promise<{ businessId: string; orderId: string } | null> {
  if (token.length < 32) return null;
  const r = (await sql<{ business_id: string; order_id: string }>`
    select business_id::text as business_id, order_id::text as order_id from resolve_proforma(${token})`.execute(db)).rows[0];
  return r ? { businessId: r.business_id, orderId: r.order_id } : null;
}

/** The link the owner sends: the installation's public address, or null when none is set (never a guess at the host). */
export function proformaUrl(publicBaseUrl: string | null | undefined, token: string): string | null {
  if (!publicBaseUrl) return null;
  return `${publicBaseUrl.replace(/\/+$/, '')}/pi/${token}`;
}
