/**
 * M17.2 — "are we ready to switch WhatsApp on?", answered WITHOUT switching
 * anything on.
 *
 * Pure and offline by construction: it inspects the shape of what has been
 * configured and reports what is still missing. It performs no network call, so
 * running it can never send a message, never contact Meta, and never change the
 * channel's status. Reachability against Meta is a manual go-live step
 * (docs/GO-LIVE.md) precisely because it cannot be done without live credentials.
 *
 * The shapes here are the SINGLE definition — src/main.ts validates boot
 * environment against these same predicates, so the readiness page and the
 * fail-closed boot check can never disagree.
 */

export type MetaCredential =
  | 'accessToken' | 'phoneNumberId' | 'businessAccountId' | 'appSecret'
  | 'verifyToken' | 'graphVersion';

/** Why a credential is not usable yet. 'ok' = present and correctly shaped. */
export type CredentialState = 'missing' | 'placeholder' | 'malformed' | 'ok';

/** The env variable each credential comes from — shown so an owner/operator
 *  knows exactly what to set, without ever displaying the value. */
export const META_ENV_VAR: Record<MetaCredential, string> = {
  accessToken: 'META_WHATSAPP_ACCESS_TOKEN',
  phoneNumberId: 'META_WHATSAPP_PHONE_NUMBER_ID',
  businessAccountId: 'META_WHATSAPP_BUSINESS_ACCOUNT_ID',
  appSecret: 'META_APP_SECRET',
  verifyToken: 'WEBHOOK_VERIFY_TOKEN',
  graphVersion: 'META_GRAPH_API_VERSION',
};

/** Canonical shape predicates — imported by src/main.ts so there is one truth. */
export const META_SHAPE: Record<MetaCredential, (v: string) => boolean> = {
  accessToken: (v) => v.length >= 20,
  phoneNumberId: (v) => /^\d{5,}$/.test(v),
  businessAccountId: (v) => /^\d{5,}$/.test(v),
  appSecret: (v) => v.length >= 16,
  verifyToken: (v) => v.length >= 16,
  graphVersion: (v) => /^v\d+\.\d+$/.test(v),
};

export const META_CREDENTIALS: readonly MetaCredential[] =
  ['accessToken', 'phoneNumberId', 'businessAccountId', 'appSecret', 'verifyToken', 'graphVersion'];

export function credentialState(key: MetaCredential, value: string | undefined): CredentialState {
  const v = value?.trim();
  if (!v) return 'missing';
  if (v.includes('CHANGE_ME')) return 'placeholder';
  return META_SHAPE[key](v) ? 'ok' : 'malformed';
}

/** Neutral blocker codes — the UI localizes them; no sentence is built here. */
export type MetaBlocker = 'credentials_incomplete' | 'provider_disabled' | 'channel_not_connected' | 'not_started';

export type MetaReadiness = {
  /** Per-credential state. NEVER carries the value itself. */
  readonly credentials: readonly { readonly key: MetaCredential; readonly state: CredentialState }[];
  readonly allCredentialsOk: boolean;
  /** The messaging mode this process booted with ('disabled' until go-live). */
  readonly provider: string;
  /** The stored channel status — stays 'not_connected' until explicit activation. */
  readonly channelStatus: string;
  /**
   * True only once every credential is shaped correctly, the operator has
   * switched the provider on, the channel is connected AND she has been
   * started. Preparation alone never flips this.
   *
   * D7 — the last of those was missing, so a connected-but-never-started
   * channel read "Live — she is talking to real buyers" on the same day every
   * send was refused with "messaging is switched off". Connected is a wire;
   * started is a decision, and only the owner makes it.
   */
  readonly live: boolean;
  readonly blockers: readonly MetaBlocker[];
};

export function checkMetaReadiness(input: {
  readonly values: Partial<Record<MetaCredential, string | undefined>>;
  readonly provider: string;
  readonly channelStatus: string;
  /** D7 — has the owner started her? Absent means no, which is what it meant before. */
  readonly activated?: boolean;
}): MetaReadiness {
  const credentials = META_CREDENTIALS.map((key) => ({
    key, state: credentialState(key, input.values[key]),
  }));
  const allCredentialsOk = credentials.every((c) => c.state === 'ok');
  const providerActive = input.provider === 'meta';
  const connected = input.channelStatus === 'connected';

  const started = input.activated === true;

  const blockers: MetaBlocker[] = [];
  if (!allCredentialsOk) blockers.push('credentials_incomplete');
  if (!providerActive) blockers.push('provider_disabled');
  if (!connected) blockers.push('channel_not_connected');
  if (connected && !started) blockers.push('not_started');

  return {
    credentials,
    allCredentialsOk,
    provider: input.provider,
    channelStatus: input.channelStatus,
    live: allCredentialsOk && providerActive && connected && started,
    blockers,
  };
}
