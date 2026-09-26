import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { connectedChannels } from '../../db/connectedChannels.js';

/**
 * C9 — connecting the Page and the Instagram account a buyer writes to.
 *
 * The same shape as `connectConfiguredNumber` (G3), and for the same reason:
 * inbound messages find their factory through `channel_credentials`, and until
 * a row exists every message Meta delivers is acknowledged and dropped.
 *
 * WHAT IT WRITES, AND WHAT IT DOES NOT. The account id comes from the HOST's
 * configuration, never from the form, so this can only ever connect the account
 * the operator set up and a crafted post cannot claim someone else's. The token
 * stays in the environment; `secret_ref` names where it lives rather than
 * holding it (ADR-0005: a database backup must never be a credential dump).
 *
 * WHAT IT DOES NOT NEED. No activation switch and no allowlist: these channels
 * can only ever ANSWER, inside the 24 hours after a buyer wrote. There is no
 * cold message to hold back, which is why `gateOutbound` treats them like
 * e-mail rather than like the pilot number.
 */

export type MetaMessagingKind = 'instagram' | 'messenger';

export type ConnectResult =
  | { readonly code: 'connected' }
  | { readonly code: 'already_connected' }
  /** Another factory on this installation holds that account. */
  | { readonly code: 'account_taken' }
  /** The host has no account configured for this channel. */
  | { readonly code: 'not_configured' }
  | { readonly code: 'failed' };

const SECRET_REF = 'env:META_PAGE_ACCESS_TOKEN';

export async function connectMetaChannel(
  db: Db, businessIdRaw: string, kind: MetaMessagingKind, accountId: string | null, actor: string,
): Promise<ConnectResult> {
  // Meta ids are digits; anything else is a misconfiguration, not an account.
  if (accountId === null || !/^[0-9]{5,}$/.test(accountId)) return { code: 'not_configured' };
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { code: 'failed' };

  return withTenantTx(db, bid.value, async (tx) => {
    const existing = (await sql<{ n: number }>`
      select count(*)::int as n from channel_credentials
       where business_id = ${bid.value} and channel = ${kind}`.execute(tx)).rows[0]!.n;
    if (existing > 0) return { code: 'already_connected' as const };

    const cred = (await sql<{ id: string }>`
      insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
      values (${bid.value}, ${kind}, ${accountId}, ${SECRET_REF}, 'service')
      on conflict (channel, external_ref) do nothing
      returning id`.execute(tx)).rows[0];
    // Held elsewhere: invisible under RLS, so ON CONFLICT is how we learn of it.
    if (!cred) return { code: 'account_taken' as const };

    const channelRow = (await sql<{ id: string }>`
      insert into channels (business_id, kind, status, credential_id, connected_at, disconnected_at, updated_at)
      values (${bid.value}, ${kind}, 'connected', ${cred.id}::uuid, now(), null, now())
      on conflict (business_id, kind) do update
        set status = 'connected', credential_id = excluded.credential_id,
            connected_at = now(), disconnected_at = null, updated_at = now()
      returning id`.execute(tx)).rows[0]!;

    // The audit row names the account, never the token that reaches it.
    await sql`
      insert into channel_audit (business_id, channel_id, action, actor, detail)
      values (${bid.value}, ${channelRow.id}::uuid, 'connect', ${actor},
              ${JSON.stringify({ channel: kind, accountId })}::jsonb)`.execute(tx);
    return { code: 'connected' as const };
  });
}

/**
 * C10 — what her page shows for the two channels: which are connected, and
 * through which Page and Instagram account when she connected them herself
 * (a `meta_accounts` row), with the one thing that needs her if the token died.
 */
export type MetaLinkStatus = {
  readonly instagram: boolean;
  readonly messenger: boolean;
  readonly account: {
    readonly pageName: string;
    readonly igUsername: string | null;
    readonly hasInstagram: boolean;
    readonly needsAttention: 'revoked' | 'refused' | null;
    readonly connectedAt: Date;
  } | null;
};

export async function metaLinkStatus(db: Db, businessIdRaw: string): Promise<MetaLinkStatus> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { instagram: false, messenger: false, account: null };
  const { liveMetaAccount } = await import('../../db/metaAccounts.js');
  return withTenantTx(db, bid.value, async (tx) => {
    // Phase 4b — the one definition of "connected" that Setup reads too.
    const connected = await connectedChannels(tx, bid.value);
    const a = await liveMetaAccount(tx, bid.value);
    return {
      instagram: connected.instagram, messenger: connected.messenger,
      account: a ? {
        pageName: a.pageName, igUsername: a.igUsername, hasInstagram: a.igAccountId !== null,
        needsAttention: a.needsAttention, connectedAt: a.connectedAt,
      } : null,
    };
  });
}

