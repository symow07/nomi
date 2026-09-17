import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';

/**
 * C10 — the Page a business connected itself (0054). A store, like
 * `mailAccounts`: it decides nothing, and it never holds anything that could
 * send by itself — the Page token arrives encrypted and leaves encrypted.
 */

export type MetaAccount = {
  readonly id: string;
  readonly pageId: string;
  readonly pageName: string;
  readonly igAccountId: string | null;
  readonly igUsername: string | null;
  readonly ciphertext: string;
  readonly connectedBy: string;
  readonly connectedAt: Date;
  /** Set when a send found the token dead. She is asked to connect it again. */
  readonly needsAttention: 'revoked' | 'refused' | null;
};

export async function liveMetaAccount(tx: Tx, businessId: BusinessId): Promise<MetaAccount | null> {
  const r = (await sql<{
    id: string; page_id: string; page_name: string; ig_account_id: string | null; ig_username: string | null;
    token_ciphertext: string; connected_by: string; connected_at: Date; last_error: 'revoked' | 'refused' | null;
  }>`select id::text as id, page_id, page_name, ig_account_id, ig_username, token_ciphertext,
            connected_by, connected_at, last_error
       from meta_accounts where business_id = ${businessId}::uuid and archived_at is null limit 1`
    .execute(tx)).rows[0];
  return r ? {
    id: r.id, pageId: r.page_id, pageName: r.page_name, igAccountId: r.ig_account_id, igUsername: r.ig_username,
    ciphertext: r.token_ciphertext, connectedBy: r.connected_by, connectedAt: r.connected_at,
    needsAttention: r.last_error,
  } : null;
}

/**
 * A new connection archives the live one in the same transaction: one Page per
 * business. `page_taken` is the other index speaking — another business holds
 * that Page, invisible under RLS, so the conflict is how we learn of it.
 */
export async function connectMetaAccount(
  tx: Tx, businessId: BusinessId,
  input: {
    readonly pageId: string; readonly pageName: string;
    readonly igAccountId: string | null; readonly igUsername: string | null;
    readonly ciphertext: string; readonly fingerprint: string; readonly scopes: string; readonly by: string;
  },
): Promise<{ readonly ok: true; readonly id: string } | { readonly ok: false; readonly reason: 'page_taken' }> {
  await archiveMetaAccount(tx, businessId, input.by);
  try {
    const r = (await sql<{ id: string }>`
      insert into meta_accounts
        (business_id, page_id, page_name, ig_account_id, ig_username, token_ciphertext, fingerprint, scopes, connected_by)
      values (${businessId}::uuid, ${input.pageId}, ${input.pageName}, ${input.igAccountId}, ${input.igUsername},
              ${input.ciphertext}, ${input.fingerprint}, ${input.scopes}, ${input.by})
      returning id::text as id`.execute(tx)).rows[0]!;
    return { ok: true, id: r.id };
  } catch (e) {
    // 23505: the Page is live on another business. Nothing else is caught —
    // a different failure must surface, not read as "taken".
    if ((e as { code?: string }).code === '23505') return { ok: false, reason: 'page_taken' };
    throw e;
  }
}

export async function archiveMetaAccount(tx: Tx, businessId: BusinessId, by: string): Promise<boolean> {
  const r = await sql`update meta_accounts set archived_at = now(), archived_by = ${by}
                       where business_id = ${businessId}::uuid and archived_at is null`.execute(tx);
  return Number(r.numAffectedRows ?? 0) > 0;
}

/**
 * The credential rows that ROUTE: `resolve_tenant(channel, external_ref)` finds
 * the business by the Page id and the Instagram id, and `secret_ref` names the
 * row that holds the token rather than holding it. One credential per business
 * per channel: connecting a different Page re-points the row, and a Page live
 * on another business — invisible under RLS — is learnt from the unique index.
 * A Page with no Instagram switches the Instagram credential off, so a buyer's
 * DM to an account this business no longer answers for is dropped, not routed.
 */
export async function linkMetaCredentials(
  tx: Tx, businessId: BusinessId,
  input: { readonly accountId: string; readonly pageId: string; readonly igAccountId: string | null; readonly actor: string },
): Promise<'linked' | 'account_taken'> {
  const secretRef = `meta_accounts:${input.accountId}`;
  for (const [kind, ref] of [['messenger', input.pageId], ['instagram', input.igAccountId]] as const) {
    if (!ref) {
      await sql`update channel_credentials set is_active = false where business_id = ${businessId} and channel = ${kind}`.execute(tx);
      await sql`update channels set status = 'disconnected', disconnected_at = now(), updated_at = now()
                 where business_id = ${businessId} and kind = ${kind}`.execute(tx);
      continue;
    }
    const existing = (await sql<{ id: string }>`
      select id::text as id from channel_credentials where business_id = ${businessId} and channel = ${kind} limit 1`
      .execute(tx)).rows[0];
    let credId: string | undefined;
    try {
      credId = existing
        ? (await sql<{ id: string }>`
            update channel_credentials set external_ref = ${ref}, secret_ref = ${secretRef}, is_active = true
             where id = ${existing.id}::uuid returning id::text as id`.execute(tx)).rows[0]?.id
        : (await sql<{ id: string }>`
            insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
            values (${businessId}, ${kind}, ${ref}, ${secretRef}, 'service')
            on conflict (channel, external_ref) do nothing
            returning id::text as id`.execute(tx)).rows[0]?.id;
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return 'account_taken';
      throw e;
    }
    if (!credId) return 'account_taken';
    const channelRow = (await sql<{ id: string }>`
      insert into channels (business_id, kind, status, credential_id, connected_at, disconnected_at, updated_at)
      values (${businessId}, ${kind}, 'connected', ${credId}::uuid, now(), null, now())
      on conflict (business_id, kind) do update
        set status = 'connected', credential_id = excluded.credential_id,
            connected_at = now(), disconnected_at = null, updated_at = now()
      returning id::text as id`.execute(tx)).rows[0]!;
    // The audit row names the account, never the token that reaches it.
    await sql`
      insert into channel_audit (business_id, channel_id, action, actor, detail)
      values (${businessId}, ${channelRow.id}::uuid, 'connect', ${input.actor},
              ${JSON.stringify({ channel: kind, accountId: ref, via: 'meta_login' })}::jsonb)`.execute(tx);
  }
  return 'linked';
}

/** Disconnect: the credentials switch off, so Meta's next delivery is dropped; nothing is erased. */
export async function unlinkMetaCredentials(tx: Tx, businessId: BusinessId, actor: string): Promise<void> {
  for (const kind of ['messenger', 'instagram'] as const) {
    await sql`update channel_credentials set is_active = false
               where business_id = ${businessId} and channel = ${kind} and secret_ref like 'meta_accounts:%'`.execute(tx);
    const row = (await sql<{ id: string }>`
      update channels set status = 'disconnected', disconnected_at = now(), updated_at = now()
       where business_id = ${businessId} and kind = ${kind} returning id::text as id`.execute(tx)).rows[0];
    if (row) {
      await sql`insert into channel_audit (business_id, channel_id, action, actor, detail)
                values (${businessId}, ${row.id}::uuid, 'disconnect', ${actor}, ${JSON.stringify({ channel: kind, via: 'meta_login' })}::jsonb)`.execute(tx);
    }
  }
}

/** The token is dead: record it once, so the page asks her and every later send says why. */
export async function markMetaAccountNeedsAttention(
  tx: Tx, accountId: string, reason: 'revoked' | 'refused',
): Promise<void> {
  await sql`update meta_accounts set needs_attention_at = coalesce(needs_attention_at, now()), last_error = ${reason}
             where id = ${accountId}::uuid and archived_at is null`.execute(tx);
}
