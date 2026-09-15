import type { ChannelAdapter } from '../contract.js';
import { parseWebhook } from './parse.js';
import { whatsappClient, type FetchLike } from './client.js';
import {
  whatsappAudioFetcher, whatsappMediaFetcher, type AudioFetcher, type MediaFetcher,
} from './media.js';
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
    // M26 — present, and never called while WHATSAPP_PROVIDER is disabled:
    // main.ts mounts no adapter and no outbound worker in that mode.
    sendMedia: (to, media) => client.sendImage(to, media.url, media.caption),
  };
}

/** Two-step media retrieval — media ids live at the Graph root, not under the
 * phone number; both hops carry the Bearer token, never exposed in URLs. */
export function metaMediaFetcher(cfg: MetaConfig): MediaFetcher {
  return whatsappMediaFetcher(metaMediaConfig(cfg));
}

/**
 * G2b — voice notes, over the same two hops and the same token.
 *
 * `metaMediaFetcher` accepts IMAGES only — its MIME set is jpeg/png/webp — so
 * handing it to the audio path would type-check and then refuse every voice
 * note as `unsupported media: audio/ogg`. Audio gets its own fetcher for the
 * same reason `whatsappAudioFetcher` is its own function: a different accepted
 * set and a different size ceiling are different facts about different media.
 */
export function metaAudioFetcher(cfg: MetaConfig): AudioFetcher {
  return whatsappAudioFetcher(metaMediaConfig(cfg));
}

const metaMediaConfig = (cfg: MetaConfig) => ({
  baseUrl: `${META_GRAPH_BASE}/${cfg.graphVersion}`,
  apiKey: cfg.accessToken,
  authHeaders: { Authorization: `Bearer ${cfg.accessToken}` },
  ...(cfg.fetchImpl ? { fetchImpl: cfg.fetchImpl } : {}),
});
