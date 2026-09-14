import type { ChannelAdapter, MailMessage, SendResult } from '../contract.js';
import type { ChannelEvent } from '../whatsapp/parse.js';
import type { MailTransport } from './transport.js';

/**
 * C4.a — e-mail behind the same contract every other channel is behind.
 *
 * THE DIRECTORY IS THE SWITCH. `tests/parity/m39-registry.test.ts` ties
 * `CHANNEL_REGISTRY.email.availableHere` to the existence of this folder, and
 * `canBeEnabled` ties her outreach switch to that flag. So this file existing
 * is what turns "write first by e-mail" from a greyed-out row into something
 * she can turn on — which is why it lands with the send path that can carry a
 * message, and not one commit earlier. A switch that does nothing is the thing
 * this product exists to refuse.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. Inbound mail arrives in C4.c; until then
 * `verifyWebhook` refuses everything and `parseWebhook` returns nothing, which
 * is the truth rather than a half-parser that would drop a buyer's reply
 * silently. Bounces and complaints already arrive by their own route —
 * `/hooks/email`, M40.2 — which verifies its own signature over raw bytes and
 * writes suppressions; it is not this adapter's business and is not routed
 * through it.
 *
 * `sendText` is absent on purpose. A mail with no subject is not the message
 * she wrote, and an adapter that invented one would be inventing the only part
 * of it her buyer sees first.
 */
export function emailAdapter(deps: { readonly transport: MailTransport }): ChannelAdapter {
  return {
    kind: 'email',
    provider: deps.transport.provider,

    /**
     * Inbound mail does not arrive here (C4.c). Refusing is not a placeholder:
     * an adapter that accepted a payload it cannot parse would acknowledge a
     * buyer's reply and lose it.
     */
    verifyWebhook(): boolean {
      return false;
    },
    parseWebhook(): ChannelEvent[] {
      return [];
    },

    /**
     * The contract's `sendText` exists for channels whose whole message is a
     * body. This one refuses rather than guessing a subject; the worker never
     * calls it for an e-mail row, and this is what happens if that ever changes.
     */
    async sendText(): Promise<SendResult> {
      return { ok: false, retryable: false, error: 'email needs a subject: use sendMail' };
    },

    async sendMail(message: MailMessage): Promise<SendResult> {
      return deps.transport.send(message);
    },
  };
}
