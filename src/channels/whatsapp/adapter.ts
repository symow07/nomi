import type { ChannelAdapter } from '../contract.js';
import { parseWebhook } from './parse.js';
import { whatsappClient, type FetchLike } from './client.js';
import { verifySignature } from './signature.js';

/**
 * The one real channel: WhatsApp via 360dialog, wired into the contract.
 * Everything provider-specific (base URLs, header names, payload shapes)
 * ends at this file.
 */

export function whatsappAdapter(cfg: {
  baseUrl: string;                 // sandbox or production
  apiKey: string;
  webhookSecret: string;           // HMAC secret for inbound verification
  fetchImpl?: FetchLike;
}): ChannelAdapter {
  const client = whatsappClient({
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    ...(cfg.fetchImpl ? { fetchImpl: cfg.fetchImpl } : {}),
  });

  return {
    kind: 'whatsapp',
    provider: '360dialog',
    verifyWebhook: (rawBody, header) => verifySignature(rawBody, header, cfg.webhookSecret),
    parseWebhook,
    sendText: (to, body) => client.sendText(to, body),
    // M26 — the simulator is built on this factory, so implementing it here is
    // what lets the media path be driven end to end in tests without a provider.
    sendMedia: (to, media) => client.sendImage(to, media.url, media.caption),
  };
}
