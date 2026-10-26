import { withTenantTx, type Db } from '../../db/client.js';
import {
  archiveTikTokAccount, connectTikTokAccount, linkTikTokCredential, liveTikTokAccount, unlinkTikTokCredential,
} from '../../db/tiktokAccounts.js';
import { credentialFingerprint, decryptSecret, encryptSecret } from '../../security/credentials.js';
import type { BusinessId } from '../../core/types/ids.js';
import {
  exchangeTikTokCode, openTikTokGrant, packTikTokGrant, revokeTikTokGrant, TIKTOK_MESSAGING_SCOPES,
  type TikTokApp, type TikTokFetch, type TikTokGrant,
} from './api.js';

/**
 * 0215 — A BUSINESS CONNECTS ITS OWN TIKTOK ACCOUNT (docs/TIKTOK-CHANNEL.md, surface A). Owner only, under the same
 * decision as activating messaging (it decides whose conversations land here, and as whom replies leave), and behind
 * the operator's stop and first-connection approval like every connect (app.ts `connectionRefusal`).
 *
 * The code TikTok sent back becomes ONE sealed grant (both tokens, when each ends) and the credential row that routes
 * the account's webhooks to this business. The four messaging permissions must all be granted: a consent that left
 * one out is refused, and the grant just given is given back at once — never kept, never left live there.
 */
export type TikTokConnectDeps = {
  readonly db: Db;
  readonly credentialKey: Buffer | null;
  readonly app: TikTokApp | null;
  readonly fetchImpl: TikTokFetch;
};

export type TikTokConnectOutcome =
  | { readonly outcome: 'connected'; readonly openId: string }
  /** The owner did not grant every permission the messaging calls need. */
  | { readonly outcome: 'scopes_missing' }
  /** The account is connected to another workspace. */
  | { readonly outcome: 'account_taken' }
  | { readonly outcome: 'not_configured' }
  /** TikTok refused the code (expired, reused, a redirect that does not match). */
  | { readonly outcome: 'rejected' }
  /** TikTok did not answer. */
  | { readonly outcome: 'unavailable' };

export async function completeTikTokConnection(
  deps: TikTokConnectDeps,
  input: { readonly businessId: BusinessId; readonly by: string; readonly code: string; readonly redirectUri: string },
): Promise<TikTokConnectOutcome> {
  if (!deps.app || !deps.credentialKey) return { outcome: 'not_configured' };
  const app = deps.app; const key = deps.credentialKey;
  const t = await exchangeTikTokCode(app, input.code, input.redirectUri, deps.fetchImpl);
  if (!t.ok) return { outcome: t.reason };
  const giveBack = async <T>(out: T): Promise<T> => { await revokeTikTokGrant(app, t.grant, deps.fetchImpl).catch(() => false); return out; };
  if (!TIKTOK_MESSAGING_SCOPES.every((s) => t.scopes.includes(s))) return giveBack({ outcome: 'scopes_missing' as const });

  const packed = packTikTokGrant(t.grant);
  const stored = await withTenantTx(deps.db, input.businessId, async (tx) => {
    const saved = await connectTikTokAccount(tx, input.businessId, {
      openId: t.openId, username: '', ciphertext: encryptSecret(packed, key), fingerprint: credentialFingerprint(packed),
      scopes: t.scopes.join(','), by: input.by,
    });
    if (!saved.ok) return 'account_taken' as const;
    return linkTikTokCredential(tx, input.businessId, { accountId: saved.id, openId: t.openId, actor: input.by });
  });
  if (stored === 'account_taken') return giveBack({ outcome: 'account_taken' as const });
  return { outcome: 'connected', openId: t.openId };
}

/**
 * Disconnect: the grant given back at TikTok (best effort, and said), the credential switched off and the account
 * archived here — whatever TikTok answers. Null: there was nothing connected.
 */
export async function disconnectTikTokAccount(
  deps: TikTokConnectDeps, input: { readonly businessId: BusinessId; readonly by: string },
): Promise<{ readonly givenBack: boolean } | null> {
  const account = await withTenantTx(deps.db, input.businessId, (tx) => liveTikTokAccount(tx, input.businessId));
  if (!account) return null;
  let givenBack = false;
  if (deps.app && deps.credentialKey) {
    let grant: TikTokGrant | null = null;
    try { grant = openTikTokGrant(decryptSecret(account.ciphertext, deps.credentialKey).plain); } catch { grant = null; }
    if (grant) givenBack = await revokeTikTokGrant(deps.app, grant, deps.fetchImpl).catch(() => false);
  }
  await withTenantTx(deps.db, input.businessId, async (tx) => {
    await unlinkTikTokCredential(tx, input.businessId, input.by);
    await archiveTikTokAccount(tx, input.businessId, input.by);
  });
  return { givenBack };
}
