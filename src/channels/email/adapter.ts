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
 * WHAT IT DELIBERATELY DOES NOT DO. Receive. The contract's webhook methods are
 * shaped for WhatsApp's event stream (a phone-number id, a wa_id), and a mail
 * is neither. A buyer's reply arrives at `/hooks/email/inbound` (C4.c) and
 * bounces and complaints at `/hooks/email` (M40.2), each verifying its own
 * signature over raw bytes and each finding the tenant from what this product
 * sent rather than from the request. So `verifyWebhook` refuses everything and
 * `parseWebhook` returns nothing here — the truth, rather than a second
 * receiving path that could disagree with the first.
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
     * Inbound mail does not arrive here: see the header. Refusing is not a
     * placeholder — an adapter that accepted a payload it cannot parse would
     * acknowledge a buyer's reply and lose it.
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
