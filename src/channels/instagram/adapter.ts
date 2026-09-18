import type { ChannelAdapter } from '../contract.js';
import { verifySignature } from '../whatsapp/signature.js';
import { parseMetaMessaging, metaMessagingSender, metaProfileLookup, type MetaFetch } from '../meta/messaging.js';

/**
 * Instagram direct messages, as this product's contract sees them.
 *
 * Everything provider-specific is in `../meta/messaging.ts`, which Messenger
 * shares. What this file settles is the one thing that differs: which account
 * the messages belong to, and which webhook object they arrive under.
 *
 * REPLY-ONLY, by Meta's rules and by ours: `CHANNEL_REGISTRY.instagram` says
 * `coldInitiate: 'never'`, and `gateOutbound` refuses a first message here
 * before any of this code is reached.
 */
export function instagramAdapter(cfg: {
  /**
   * The Facebook Page the Instagram account is connected to. A reply is posted
   * to `/{page}/messages` with the Page token and Meta routes it to Instagram
   * by the buyer's scoped id. Posting to the Instagram account's own id on
   * graph.facebook.com is refused with a 400 — found on the first live reply.
   */
  readonly pageId: string;
  /** The Page access token that authorises the connected Instagram account. */
  readonly accessToken: string;
  /** The Meta app secret, which signs every webhook. */
  readonly appSecret: string;
  readonly graphVersion: string;
  readonly fetchImpl?: MetaFetch;
}): ChannelAdapter {
  const send = metaMessagingSender({
    accountId: cfg.pageId, accessToken: cfg.accessToken, graphVersion: cfg.graphVersion,
    ...(cfg.fetchImpl ? { fetchImpl: cfg.fetchImpl } : {}),
  });
  const nameOf = metaProfileLookup({
    channel: 'instagram', accessToken: cfg.accessToken, graphVersion: cfg.graphVersion,
    ...(cfg.fetchImpl ? { fetchImpl: cfg.fetchImpl } : {}),
  });
  return {
    kind: 'instagram',
    provider: 'meta',
    verifyWebhook: (rawBody, header) => verifySignature(rawBody, header, cfg.appSecret),
    parseWebhook: (payload) => parseMetaMessaging('instagram', payload),
    sendText: send,
    nameOf,
  };
}
