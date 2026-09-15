import { sql } from 'kysely';
import { randomBytes } from 'node:crypto';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';

/**
 * G11 — the ONE writer of a buyer's proof token.
 *
 * It used to live in `api/web/proof.ts` and open its own transaction, which
 * meant the turn could not mint one: the quote it would prove is written in
 * the turn's transaction and is not visible from outside it until commit. So
 * "every quote she sends carries a link" — the first line of M35 — was an
 * owner tapping a button afterwards, on a page that then showed her a relative
 * path she could not send anywhere.
 *
 * This takes the caller's transaction. The owner's route wraps it in one of
 * its own; `commitTurn` hands it the transaction that is writing the quote.
 *
 * IDEMPOTENT. `quote_proofs` has a partial unique index on the live token per
 * quote, so a second call — an owner tapping twice, a retried job — returns
 * the link that already exists rather than orphaning it.
 */

/** 32 bytes, base64url. Unguessable is the only protection this page has. */
export const mintToken = (): string => randomBytes(32).toString('base64url');

export async function issueProofLinkTx(
  tx: Tx, businessId: BusinessId, quoteId: string,
): Promise<{ token: string } | null> {
  const existing = await sql<{ token: string }>`
    select token from quote_proofs
     where quote_id = ${quoteId}::uuid and revoked_at is null limit 1`.execute(tx);
  if (existing.rows[0]) return { token: existing.rows[0].token };

  const q = await sql<{ conversation_id: string }>`
    select conversation_id from quotes
     where id = ${quoteId}::uuid and business_id = ${businessId}::uuid`.execute(tx);
  if (!q.rows[0]) return null;

  const token = mintToken();
  await sql`
    insert into quote_proofs (token, business_id, quote_id, conversation_id)
    values (${token}, ${businessId}::uuid, ${quoteId}::uuid, ${q.rows[0].conversation_id}::uuid)
  `.execute(tx);
  return { token };
}

/**
 * G11 — the public address this installation is reachable at, and the link a
 * buyer can actually open. Pure: a relative path is not a link she can send,
 * and a link built from a host we do not know is a link that 404s.
 *
 * Absent is a real state, and it is honest: no link is attached to a reply and
 * the owner is told why on the conversation. Never a guess at the host.
 */
export function proofUrl(publicBaseUrl: string | null | undefined, token: string): string | null {
  if (!publicBaseUrl) return null;
  return `${publicBaseUrl.replace(/\/+$/, '')}/p/${token}`;
}
