import type { ChannelAdapter } from '../contract.js';
import { parseWebhook } from './parse.js';
import { whatsappClient, type FetchLike } from './client.js';
import { whatsappMediaFetcher, type MediaFetcher } from './media.js';
import { verifySignature } from './signature.js';

/**
 * Meta WhatsApp Cloud API — direct, no BSP. 360dialog HOSTS this same API,
 * so the webhook payloads, wamid semantics, /messages body, and
 * X-Hub-Signature-256 scheme are identical; what changes is the base URL,
 * Bearer auth, and WHICH secret signs webhooks (Meta's App Secret). The
 * parser, dedup keys, status model, retry classification, and timeouts are
 * the existing ones — this file is configuration, not behavior.
 */

export type MetaConfig = {
  readonly accessToken: string;
  readonly phoneNumberId: string;       // sender id — NOT tenant authority
  readonly appSecret: string;           // signs inbound webhooks
  readonly graphVersion: string;        // e.g. v23.0
  readonly fetchImpl?: FetchLike;
};

export const META_GRAPH_BASE = 'https://graph.facebook.com';

export function metaAdapter(cfg: MetaConfig): ChannelAdapter {
  const client = whatsappClient({
    baseUrl: `${META_GRAPH_BASE}/${cfg.graphVersion}/${cfg.phoneNumberId}`,
    apiKey: cfg.accessToken,
    authHeaders: { Authorization: `Bearer ${cfg.accessToken}` },
    ...(cfg.fetchImpl ? { fetchImpl: cfg.fetchImpl } : {}),
  });

  return {
    kind: 'whatsapp',
    provider: 'meta',
    verifyWebhook: (rawBody, header) => verifySignature(rawBody, header, cfg.appSecret),
    parseWebhook,
    sendText: (to, body) => client.sendText(to, body),
  };
}

/** Two-step media retrieval — media ids live at the Graph root, not under the
 * phone number; both hops carry the Bearer token, never exposed in URLs. */
export function metaMediaFetcher(cfg: MetaConfig): MediaFetcher {
  return whatsappMediaFetcher({
    baseUrl: `${META_GRAPH_BASE}/${cfg.graphVersion}`,
    apiKey: cfg.accessToken,
    authHeaders: { Authorization: `Bearer ${cfg.accessToken}` },
    ...(cfg.fetchImpl ? { fetchImpl: cfg.fetchImpl } : {}),
  });
}
