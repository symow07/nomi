import type { ChannelAdapter } from '../contract.js';
import { verifySignature } from '../whatsapp/signature.js';
import { parseMetaMessaging, metaMessagingSender, metaProfileLookup, type MetaFetch } from '../meta/messaging.js';

/**
 * Facebook Messenger conversations, as this product's contract sees them.
 *
 * Everything provider-specific is in `../meta/messaging.ts`, which Instagram
 * shares. What this file settles is the one thing that differs: which account
 * the messages belong to, and which webhook object they arrive under — Meta
 * delivers Page messages under the object `page`, not `messenger`.
 *
 * REPLY-ONLY, by Meta's rules and by ours: `CHANNEL_REGISTRY.messenger` says
 * `coldInitiate: 'never'`, and `gateOutbound` refuses a first message here
 * before any of this code is reached.
 */
export function messengerAdapter(cfg: {
  /** The Facebook Page's id — the tenant's own handle. */
  readonly accountId: string;
  /** The Page access token. */
  readonly accessToken: string;
  /** The Meta app secret, which signs every webhook. */
  readonly appSecret: string;
  readonly graphVersion: string;
  readonly fetchImpl?: MetaFetch;
}): ChannelAdapter {
  const send = metaMessagingSender({
    accountId: cfg.accountId, accessToken: cfg.accessToken, graphVersion: cfg.graphVersion,
    ...(cfg.fetchImpl ? { fetchImpl: cfg.fetchImpl } : {}),
  });
  const nameOf = metaProfileLookup({
    channel: 'messenger', accessToken: cfg.accessToken, graphVersion: cfg.graphVersion,
    ...(cfg.fetchImpl ? { fetchImpl: cfg.fetchImpl } : {}),
  });
  return {
    kind: 'messenger',
    provider: 'meta',
    verifyWebhook: (rawBody, header) => verifySignature(rawBody, header, cfg.appSecret),
    parseWebhook: (payload) => parseMetaMessaging('messenger', payload),
    sendText: send,
    nameOf,
  };
}
