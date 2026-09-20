import { withTenantTx, type Db } from '../../db/client.js';
import { archiveMailAccount, connectMailAccount } from '../../db/mailAccounts.js';
import { credentialFingerprint, encryptSecret } from '../../security/credentials.js';
import {
  exchangeCode, grantsReading, type ConnectFailure, type OAuthClients, type OAuthFetch, type OAuthProvider,
} from '../../connectors/oauth.js';
import type { BusinessId } from '../../core/types/ids.js';

/**
 * C6 · M50 — the last step of "Connect Gmail": the code the provider sent back
 * becomes a stored, encrypted refresh token and an address.
 *
 * The network call happens before any transaction opens; the write that follows
 * is one statement pair, archive-then-insert, so there is never a moment with
 * two sending mailboxes or with none where one was.
 */
export type ConnectOutcome = 'connected' | 'not_configured' | ConnectFailure;

export async function completeMailConnection(
  deps: {
    readonly db: Db; readonly credentialKey: Buffer | null; readonly clients: OAuthClients;
    readonly fetchImpl: OAuthFetch; readonly now: () => Date;
  },
  input: {
    readonly businessId: BusinessId; readonly provider: OAuthProvider; readonly code: string;
    readonly verifier: string; readonly redirectUri: string; readonly by: string;
  },
): Promise<{ readonly outcome: ConnectOutcome; readonly address: string | null }> {
  const client = deps.clients[input.provider];
  if (!client || !deps.credentialKey) return { outcome: 'not_configured', address: null };
  const r = await exchangeCode(input.provider, client, {
    code: input.code, verifier: input.verifier, redirectUri: input.redirectUri,
  }, deps.fetchImpl, deps.now().getTime());
  if (!r.ok) return { outcome: r.reason, address: null };
  const key = deps.credentialKey;
  await withTenantTx(deps.db, input.businessId, (tx) => connectMailAccount(tx, input.businessId, {
    provider: input.provider, address: r.value.address,
    ciphertext: encryptSecret(r.value.refreshToken, key),
    fingerprint: credentialFingerprint(r.value.refreshToken),
    scopes: r.value.scopes.slice(0, 1000), by: input.by,
    // E1 — read off what Google granted, not off what was asked for.
    readsInbox: grantsReading(input.provider, r.value.scopes),
  }));
  return { outcome: 'connected', address: r.value.address };
}

export async function disconnectMailbox(
  db: Db, input: { readonly businessId: BusinessId; readonly by: string },
): Promise<boolean> {
  return withTenantTx(db, input.businessId, (tx) => archiveMailAccount(tx, input.businessId, input.by));
}
