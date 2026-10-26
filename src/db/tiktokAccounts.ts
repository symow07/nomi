import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';

/**
 * The TikTok account a business connected itself (0215; docs/TIKTOK-CHANNEL.md, surface A). A store, like
 * `metaAccounts`: it decides nothing, and the grant arrives sealed and leaves sealed. The grant is ONE sealed
 * credential — TikTok's access token (a day), its refresh token (a year) and when each ends — so a refresh replaces it
 * whole (`rotateTikTokGrant`), in the same transaction that reads it.
 */
export type TikTokAccount = {
  readonly id: string;
  /** TikTok's application-specific id for the account: `business_id` in every call, `user_openid` on every webhook. */
  readonly openId: string;
  readonly username: string;
  readonly ciphertext: string;
  readonly connectedBy: string;
  readonly connectedAt: Date;
  /** Set when a call found the grant dead. She is asked to connect again. */
  readonly needsAttention: 'revoked' | 'refused' | null;
  /** Messages from people in the EEA, Switzerland or the UK: TikTok sends Nomi no content for them, so only counted. */
  readonly euMessages: number;
  readonly euLastAt: Date | null;
};

type Row = {
  id: string; open_id: string; username: string; token_ciphertext: string; connected_by: string; connected_at: Date;
  last_error: 'revoked' | 'refused' | null; eu_messages: number; eu_last_at: Date | null;
};
const ofRow = (r: Row): TikTokAccount => ({
  id: r.id, openId: r.open_id, username: r.username, ciphertext: r.token_ciphertext, connectedBy: r.connected_by,
  connectedAt: r.connected_at, needsAttention: r.last_error, euMessages: r.eu_messages, euLastAt: r.eu_last_at,
});

export async function liveTikTokAccount(tx: Tx, businessId: BusinessId): Promise<TikTokAccount | null> {
  const r = (await sql<Row>`
    select id::text as id, open_id, username, token_ciphertext, connected_by, connected_at, last_error, eu_messages, eu_last_at
      from tiktok_accounts where business_id = ${businessId}::uuid and archived_at is null limit 1`.execute(tx)).rows[0];
  return r ? ofRow(r) : null;
}

/**
 * A new connection archives the live one in the same transaction: one account per business. `account_taken` is the
 * other index speaking — another business holds that account, invisible under row security.
 */
export async function connectTikTokAccount(
  tx: Tx, businessId: BusinessId,
  input: { readonly openId: string; readonly username: string; readonly ciphertext: string; readonly fingerprint: string; readonly scopes: string; readonly by: string },
): Promise<{ readonly ok: true; readonly id: string } | { readonly ok: false; readonly reason: 'account_taken' }> {
  await archiveTikTokAccount(tx, businessId, input.by);
  try {
    const r = (await sql<{ id: string }>`
      insert into tiktok_accounts (business_id, open_id, username, token_ciphertext, fingerprint, scopes, connected_by)
      values (${businessId}::uuid, ${input.openId}, ${input.username.slice(0, 64)}, ${input.ciphertext}, ${input.fingerprint},
              ${input.scopes}, ${input.by})
      returning id::text as id`.execute(tx)).rows[0]!;
    return { ok: true, id: r.id };
  } catch (e) {
    // 23505: the account is live on another business. Nothing else is caught.
    if ((e as { code?: string }).code === '23505') return { ok: false, reason: 'account_taken' };
    throw e;
  }
}

export async function archiveTikTokAccount(tx: Tx, businessId: BusinessId, by: string): Promise<boolean> {
  const r = await sql`update tiktok_accounts set archived_at = now(), archived_by = ${by}
                       where business_id = ${businessId}::uuid and archived_at is null`.execute(tx);
  return Number(r.numAffectedRows ?? 0) > 0;
}

/** A refreshed grant (TikTok returns a new access token, and may return a new refresh token): kept at once, whole. */
export async function rotateTikTokGrant(tx: Tx, accountId: string, ciphertext: string, fingerprint: string): Promise<void> {
  await sql`update tiktok_accounts set token_ciphertext = ${ciphertext}, fingerprint = ${fingerprint}
             where id = ${accountId}::uuid and archived_at is null`.execute(tx);
}

/** The grant is dead: record it once, so the page asks her and every later send says why. */
export async function markTikTokNeedsAttention(tx: Tx, accountId: string, reason: 'revoked' | 'refused'): Promise<void> {
  await sql`update tiktok_accounts set needs_attention_at = coalesce(needs_attention_at, now()), last_error = ${reason}
             where id = ${accountId}::uuid and archived_at is null`.execute(tx);
}

/**
 * The credential row that ROUTES: `resolve_tenant('tiktok', open_id)` finds the business by the account's open_id,
 * and `secret_ref` names the row that holds the grant rather than holding it. An account live on another business —
 * invisible under row security — is learnt from the unique index.
 */
export async function linkTikTokCredential(
  tx: Tx, businessId: BusinessId, input: { readonly accountId: string; readonly openId: string; readonly actor: string },
): Promise<'linked' | 'account_taken'> {
  const secretRef = `tiktok_accounts:${input.accountId}`;
  const existing = (await sql<{ id: string }>`
    select id::text as id from channel_credentials where business_id = ${businessId} and channel = 'tiktok' limit 1`.execute(tx)).rows[0];
  let credId: string | undefined;
  try {
    credId = existing
      ? (await sql<{ id: string }>`
          update channel_credentials set external_ref = ${input.openId}, secret_ref = ${secretRef}, is_active = true
           where id = ${existing.id}::uuid returning id::text as id`.execute(tx)).rows[0]?.id
      : (await sql<{ id: string }>`
          insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
          values (${businessId}, 'tiktok', ${input.openId}, ${secretRef}, 'service')
          on conflict (channel, external_ref) do nothing
          returning id::text as id`.execute(tx)).rows[0]?.id;
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return 'account_taken';
    throw e;
  }
  if (!credId) return 'account_taken';
  const channelRow = (await sql<{ id: string }>`
    insert into channels (business_id, kind, status, credential_id, connected_at, disconnected_at, updated_at)
    values (${businessId}, 'tiktok', 'connected', ${credId}::uuid, now(), null, now())
    on conflict (business_id, kind) do update
      set status = 'connected', credential_id = excluded.credential_id, connected_at = now(), disconnected_at = null, updated_at = now()
    returning id::text as id`.execute(tx)).rows[0]!;
  // The audit row names the account, never the grant that reaches it.
  await sql`
    insert into channel_audit (business_id, channel_id, action, actor, detail)
    values (${businessId}, ${channelRow.id}::uuid, 'connect', ${input.actor},
            ${JSON.stringify({ channel: 'tiktok', accountId: input.openId, via: 'tiktok_login' })}::jsonb)`.execute(tx);
  return 'linked';
}

/** Disconnect: the credential switches off, so TikTok's next delivery is dropped; nothing is erased. */
export async function unlinkTikTokCredential(tx: Tx, businessId: BusinessId, actor: string): Promise<void> {
  await sql`update channel_credentials set is_active = false
             where business_id = ${businessId} and channel = 'tiktok' and secret_ref like 'tiktok_accounts:%'`.execute(tx);
  const row = (await sql<{ id: string }>`
    update channels set status = 'disconnected', disconnected_at = now(), updated_at = now()
     where business_id = ${businessId} and kind = 'tiktok' returning id::text as id`.execute(tx)).rows[0];
  if (row) {
    await sql`insert into channel_audit (business_id, channel_id, action, actor, detail)
              values (${businessId}, ${row.id}::uuid, 'disconnect', ${actor}, ${JSON.stringify({ channel: 'tiktok', via: 'tiktok_login' })}::jsonb)`.execute(tx);
  }
}
