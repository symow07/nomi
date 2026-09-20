import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import type { OAuthProvider } from '../connectors/oauth.js';

/**
 * C6 · M50 — the mailbox her e-mail leaves from (0050). A store; it decides
 * nothing, and it never holds anything that could send by itself: the refresh
 * token arrives encrypted and leaves encrypted.
 */

export type MailAccount = {
  readonly id: string;
  readonly provider: OAuthProvider;
  readonly address: string;
  readonly ciphertext: string;
  readonly connectedBy: string;
  readonly connectedAt: Date;
  /** Set when a send found the token dead. She is asked to connect it again. */
  readonly needsAttention: 'revoked' | 'refused' | null;
  /** E1 — the owner granted reading, and the newest mail seen so far. */
  readonly readsInbox: boolean;
  readonly inboxReadAt: Date | null;
};

export async function liveMailAccount(tx: Tx, businessId: BusinessId): Promise<MailAccount | null> {
  const r = (await sql<{
    id: string; provider: OAuthProvider; address: string; refresh_token_ciphertext: string;
    connected_by: string; connected_at: Date; last_error: 'revoked' | 'refused' | null;
    reads_inbox: boolean; inbox_read_at: Date | null;
  }>`select id::text as id, provider, address, refresh_token_ciphertext, connected_by, connected_at, last_error,
            reads_inbox, inbox_read_at
       from mail_accounts where business_id = ${businessId}::uuid and archived_at is null limit 1`
    .execute(tx)).rows[0];
  return r ? {
    id: r.id, provider: r.provider, address: r.address, ciphertext: r.refresh_token_ciphertext,
    connectedBy: r.connected_by, connectedAt: r.connected_at, needsAttention: r.last_error,
    readsInbox: r.reads_inbox, inboxReadAt: r.inbox_read_at,
  } : null;
}

/** A new connection archives the live one in the same transaction: one sending mailbox. */
export async function connectMailAccount(
  tx: Tx, businessId: BusinessId,
  input: {
    readonly provider: OAuthProvider; readonly address: string; readonly ciphertext: string;
    readonly fingerprint: string; readonly scopes: string; readonly by: string;
    /** E1 — true only when the provider's grant included reading. */
    readonly readsInbox?: boolean;
  },
): Promise<void> {
  await archiveMailAccount(tx, businessId, input.by);
  await sql`
    insert into mail_accounts (business_id, provider, address, refresh_token_ciphertext, fingerprint, scopes, connected_by, reads_inbox)
    values (${businessId}::uuid, ${input.provider}, ${input.address}, ${input.ciphertext},
            ${input.fingerprint}, ${input.scopes}, ${input.by}, ${input.readsInbox === true})`.execute(tx);
}

/** E1 — the newest mail seen; a minute's read asks only for what is newer. */
export async function markInboxRead(tx: Tx, accountId: string, at: Date): Promise<void> {
  await sql`update mail_accounts set inbox_read_at = greatest(coalesce(inbox_read_at, '-infinity'::timestamptz), ${at})
             where id = ${accountId}::uuid`.execute(tx);
}

export async function archiveMailAccount(tx: Tx, businessId: BusinessId, by: string): Promise<boolean> {
  const r = await sql`update mail_accounts set archived_at = now(), archived_by = ${by}
                       where business_id = ${businessId}::uuid and archived_at is null`.execute(tx);
  return Number(r.numAffectedRows ?? 0) > 0;
}

/** The token is dead: record it once, so the page asks her and every later send says why. */
export async function markMailAccountNeedsAttention(
  tx: Tx, accountId: string, reason: 'revoked' | 'refused',
): Promise<void> {
  await sql`update mail_accounts set needs_attention_at = coalesce(needs_attention_at, now()), last_error = ${reason}
             where id = ${accountId}::uuid and archived_at is null`.execute(tx);
}

/** Microsoft rotated the refresh token; the new one replaces the old, still encrypted. */
export async function rotateMailAccountToken(
  tx: Tx, accountId: string, input: { readonly ciphertext: string; readonly fingerprint: string },
): Promise<void> {
  await sql`update mail_accounts set refresh_token_ciphertext = ${input.ciphertext}, fingerprint = ${input.fingerprint}
             where id = ${accountId}::uuid and archived_at is null`.execute(tx);
}
