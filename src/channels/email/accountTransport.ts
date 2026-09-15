import { withTenantTx, type Db } from '../../db/client.js';
import {
  liveMailAccount, markMailAccountNeedsAttention, rotateMailAccountToken,
} from '../../db/mailAccounts.js';
import { sendingDomain } from '../../db/sendingDomain.js';
import { credentialFingerprint, decryptSecret, encryptSecret } from '../../security/credentials.js';
import { refreshAccessToken, type OAuthClients, type OAuthFetch, type OAuthProvider } from '../../connectors/oauth.js';
import type { MailMessage, SendResult } from '../contract.js';
import type { MailTransport } from './transport.js';
import type { MailSender } from './senders.js';
import type { BusinessId } from '../../core/types/ids.js';

/**
 * C6 · M50 — THE REAL TRANSPORT: her connected mailbox, for one business.
 *
 * Replaces the recording fake as what production sends through. Every send
 * reads the live `mail_accounts` row, so a disconnect takes effect on the next
 * mail, not the next boot.
 *
 * ── EVERY WAY IT CANNOT SEND IS A REFUSAL THAT SAYS WHY ───────────────────
 *
 *   no mailbox connected           permanent until she connects one
 *   no app for that provider here  the installation lacks its OAuth client
 *   her mailbox is not on her      a Gmail address sending as yiwuhf.com's
 *   verified domain                buyers would fail SPF and DKIM alignment
 *   the token is dead              recorded on the row; she reconnects
 *   the provider is down           retryable, and retried
 *
 * None of these is a silent success. The fake's `ok` for a mail that went
 * nowhere is exactly the thing this file exists to stop being true in production.
 *
 * ── THE ACCESS TOKEN LIVES IN MEMORY ONLY ─────────────────────────────────
 *
 * Cached per account until a minute before it expires, then fetched again from
 * the refresh token. Never written to a row, never logged.
 */

type Cached = { readonly token: string; readonly until: number };

export function accountMailTransport(deps: {
  readonly db: Db;
  readonly businessId: BusinessId;
  readonly credentialKey: Buffer;
  readonly clients: OAuthClients;
  readonly senders: Readonly<Record<OAuthProvider, MailSender>>;
  readonly fetchImpl: OAuthFetch;
  readonly now?: () => Date;
  /** Shared across transports built for the same process, so a token is refreshed once. */
  readonly cache?: Map<string, Cached>;
}): MailTransport {
  const now = deps.now ?? (() => new Date());
  const cache = deps.cache ?? new Map<string, Cached>();
  const refuse = (error: string): SendResult => ({ ok: false, retryable: false, error });

  return {
    provider: 'account',
    async send(message: MailMessage): Promise<SendResult> {
      const { account, domain } = await withTenantTx(deps.db, deps.businessId, async (tx) => ({
        account: await liveMailAccount(tx, deps.businessId),
        domain: await sendingDomain(tx, deps.businessId),
      }));
      if (!account) return refuse('no mail account is connected');
      if (account.needsAttention) return refuse('the mail account must be connected again');
      const client = deps.clients[account.provider];
      if (!client) return refuse(`no ${account.provider} app is configured for this installation`);
      const accountDomain = account.address.slice(account.address.lastIndexOf('@') + 1);
      if (!domain || domain.domain !== accountDomain) {
        return refuse('the connected mailbox is not on the verified sending domain');
      }

      let refreshToken: string;
      try {
        refreshToken = decryptSecret(account.ciphertext, deps.credentialKey).plain;
      } catch {
        return refuse('the stored mail account can no longer be opened; connect it again');
      }

      const markDead = (reason: 'revoked' | 'refused') => withTenantTx(deps.db, deps.businessId,
        (tx) => markMailAccountNeedsAttention(tx, account.id, reason));

      const accessToken = async (force: boolean): Promise<string | SendResult> => {
        const hit = cache.get(account.id);
        if (!force && hit && hit.until > now().getTime()) return hit.token;
        const r = await refreshAccessToken(account.provider, client, refreshToken, deps.fetchImpl);
        if (!r.ok) {
          if (r.reason === 'revoked') {
            await markDead('revoked');
            return refuse('the mail account must be connected again');
          }
          return { ok: false, retryable: true, error: 'mail provider unavailable' };
        }
        if (r.rotatedRefreshToken) {
          refreshToken = r.rotatedRefreshToken;
          await withTenantTx(deps.db, deps.businessId, (tx) => rotateMailAccountToken(tx, account.id, {
            ciphertext: encryptSecret(r.rotatedRefreshToken!, deps.credentialKey),
            fingerprint: credentialFingerprint(r.rotatedRefreshToken!),
          }));
        }
        cache.set(account.id, { token: r.accessToken, until: now().getTime() + (r.expiresInSec - 60) * 1000 });
        return r.accessToken;
      };

      const send = deps.senders[account.provider];
      for (const force of [false, true]) {
        const token = await accessToken(force);
        if (typeof token !== 'string') return token;
        const r = await send(token, { ...message, from: account.address });
        if (!('unauthorized' in r)) return r;
        // A 401 with a token we believed fresh: refresh once and try again. A
        // second 401 means the grant itself no longer lets us send.
        cache.delete(account.id);
      }
      await markDead('refused');
      return refuse('the mail account must be connected again');
    },
  };
}
