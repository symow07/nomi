import { randomUUID } from 'node:crypto';
import type { ChannelAdapter } from '../contract.js';

/**
 * S7 (Phase 5, item 22) — WEB CHAT: the business's own chat page, served by Nomi (src/api/web/webChat.ts).
 *
 * There is no provider between the buyer and Nomi. A message the buyer types is posted to the page and joins the
 * inbound queue like any webhook's; a reply is "sent" by being accepted here — the outbound path then writes it to
 * the conversation, which is what the buyer's page shows when it next looks. Nothing leaves the building, so nothing
 * here can fail but the page itself, and no webhook is read.
 */
export function webChatAdapter(): ChannelAdapter {
  return {
    kind: 'web_chat',
    provider: 'nomi',
    verifyWebhook: () => false,
    parseWebhook: () => [],
    sendText: async () => ({ ok: true, providerMessageId: `wc-${randomUUID()}` }),
  };
}
