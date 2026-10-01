import { withTenantTx, type Db } from '../../db/client.js';
import {
  connectWhatsAppAccount, linkWhatsAppCredentials, liveWhatsAppAccount, unlinkWhatsAppCredentials, archiveWhatsAppAccount,
  type WhatsAppAccount,
} from '../../db/whatsappAccounts.js';
import { credentialFingerprint, decryptSecret, encryptSecret } from '../../security/credentials.js';
import type { BusinessId } from '../../core/types/ids.js';
import type { MetaFetch } from '../meta/messaging.js';
import {
  exchangeWaCode, sharedWabas, wabaNumbers, subscribeWaba, registerNumber, unsubscribeWaba, newPin,
  type WaLogin, type WaFailure,
} from './embeddedSignup.js';

/**
 * WA — the connection itself: from Meta's code (first visit) or the business
 * token the state carried back (after the owner chose a number), to the
 * number's credential that routes customers' messages to this business and
 * the encrypted token the outbound worker sends with. Every network call
 * happens before any transaction opens; the write is one transaction,
 * archive-then-insert. Nothing is stored for a connection that did not finish.
 */
export type WaConnectOutcome =
  | { readonly outcome: 'connected'; readonly display: string | null; readonly verifiedName: string | null; readonly nameStatus: string | null }
  /** Several numbers on the account: the owner chooses. The token travels in the state, encrypted. */
  | { readonly outcome: 'choose'; readonly numbers: readonly { readonly id: string; readonly display: string | null; readonly verifiedName: string | null }[]; readonly tokenCiphertext: string; readonly wabaId: string }
  | { readonly outcome: 'number_taken' }
  | { readonly outcome: 'not_configured' }
  | { readonly outcome: WaFailure };

export type WaConnectDeps = {
  readonly db: Db;
  readonly credentialKey: Buffer | null;
  readonly login: WaLogin | null;
  readonly fetchImpl: MetaFetch;
  readonly graphVersion: string;
};

export async function completeWhatsAppConnection(
  deps: WaConnectDeps,
  input: {
    readonly businessId: BusinessId; readonly by: string; readonly redirectUri: string;
    readonly code?: string;
    /** The business token from the first visit, as the state carried it: encrypted. */
    readonly tokenCiphertext?: string;
    readonly wabaId?: string;
    /** Which number, when the account holds several. */
    readonly phoneNumberId?: string;
  },
): Promise<WaConnectOutcome> {
  if (!deps.login || !deps.credentialKey) return { outcome: 'not_configured' };
  const key = deps.credentialKey;

  let token: string | null = null;
  if (input.tokenCiphertext) {
    try { token = decryptSecret(input.tokenCiphertext, key).plain; } catch { return { outcome: 'rejected' }; }
  }
  if (!token) {
    if (!input.code) return { outcome: 'rejected' };
    const ex = await exchangeWaCode(deps.login, { code: input.code, redirectUri: input.redirectUri, graphVersion: deps.graphVersion }, deps.fetchImpl);
    if (!ex.ok) return { outcome: ex.reason };
    token = ex.token;
  }

  let wabaId = input.wabaId ?? null;
  if (!wabaId) {
    const wabas = await sharedWabas(deps.login, { token, graphVersion: deps.graphVersion }, deps.fetchImpl);
    if (wabas === null) return { outcome: 'unavailable' };
    // Embedded Signup shares one account; should Meta ever hand back more, the first is the one just made.
    wabaId = wabas[0] ?? null;
  }
  if (!wabaId) return { outcome: 'no_account' };

  const numbers = await wabaNumbers({ wabaId, token, graphVersion: deps.graphVersion }, deps.fetchImpl);
  if (numbers === null) return { outcome: 'unavailable' };
  if (numbers.length === 0) return { outcome: 'no_number' };
  const number = input.phoneNumberId
    ? numbers.find((n) => n.id === input.phoneNumberId)
    : numbers.length === 1 ? numbers[0] : undefined;
  if (!number) {
    if (input.phoneNumberId) return { outcome: 'rejected' };
    return {
      outcome: 'choose', wabaId, tokenCiphertext: encryptSecret(token, key),
      numbers: numbers.map((n) => ({ id: n.id, display: n.display, verifiedName: n.verifiedName })),
    };
  }

  if (!await subscribeWaba({ wabaId, token, graphVersion: deps.graphVersion }, deps.fetchImpl)) return { outcome: 'refused' };
  const pin = newPin();
  if (!await registerNumber({ phoneNumberId: number.id, token, pin, graphVersion: deps.graphVersion }, deps.fetchImpl)) return { outcome: 'refused' };

  return withTenantTx(deps.db, input.businessId, async (tx) => {
    const stored = await connectWhatsAppAccount(tx, input.businessId, {
      wabaId, phoneNumberId: number.id, display: number.display, verifiedName: number.verifiedName, nameStatus: number.nameStatus,
      ciphertext: encryptSecret(token!, key), fingerprint: credentialFingerprint(token!), pinCiphertext: encryptSecret(pin, key), by: input.by,
    });
    if (!stored.ok) return { outcome: 'number_taken' as const };
    const linked = await linkWhatsAppCredentials(tx, input.businessId, {
      accountId: stored.id, phoneNumberId: number.id, display: number.display, actor: input.by,
    });
    if (linked === 'number_taken') return { outcome: 'number_taken' as const };
    return { outcome: 'connected' as const, display: number.display, verifiedName: number.verifiedName, nameStatus: number.nameStatus };
  });
}

/** Meta stops sending us the account's messages (best effort); the rows here are archived and the credential switched off. */
export async function disconnectWhatsAppAccount(
  deps: WaConnectDeps, input: { readonly businessId: BusinessId; readonly by: string },
): Promise<boolean> {
  const account = await withTenantTx(deps.db, input.businessId, (tx) => liveWhatsAppAccount(tx, input.businessId));
  if (!account) return false;
  const token = deps.credentialKey ? whatsAppAccountToken(account, deps.credentialKey) : null;
  if (token) await unsubscribeWaba({ wabaId: account.wabaId, token, graphVersion: deps.graphVersion }, deps.fetchImpl);
  return withTenantTx(deps.db, input.businessId, async (tx) => {
    await unlinkWhatsAppCredentials(tx, input.businessId, input.by);
    return archiveWhatsAppAccount(tx, input.businessId, input.by);
  });
}

/** The business token, in memory for one send. Null when the key cannot open it. */
export function whatsAppAccountToken(account: WhatsAppAccount, credentialKey: Buffer): string | null {
  try {
    return decryptSecret(account.ciphertext, credentialKey).plain;
  } catch {
    return null;
  }
}
