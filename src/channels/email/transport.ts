import { randomUUID } from 'node:crypto';
import type { MailMessage, SendResult } from '../contract.js';

/**
 * C4.a — the thing that actually hands a message to a mail server.
 *
 * A PORT, not an implementation, for the same reason every other outside edge
 * in this product is one: the sequence engine, the gate, the unsubscribe
 * headers and the owner's screens can all be built and tested now, and the one
 * piece that needs an account from M52 is this interface's other side.
 *
 * `SendResult` is the channel contract's own, so a mail failure retries,
 * dead-letters and shows on her refusal list through exactly the machinery a
 * WhatsApp failure does. `retryable` is the whole decision a transport has to
 * make: a 4xx from the provider is permanent (a bad address stays bad), a 5xx
 * or a dropped connection is not.
 */
export interface MailTransport {
  /** Provider name for the audit trail — 'fake', 'ses', 'gmail'. */
  readonly provider: string;
  send(message: MailMessage): Promise<SendResult>;
}

export type SentMail = MailMessage & { readonly at: Date };

/**
 * The transport for a product with no mail account yet.
 *
 * It is not a stub that pretends: it records exactly what would have left, and
 * that record is what the tests assert against — the unsubscribe headers, the
 * subject she wrote, the address the gate allowed. A fake that only returned
 * `ok` would let every one of those be wrong.
 *
 * `outcome` lets a test drive the failure paths that matter more than the happy
 * one: a permanent rejection must never be retried, and a temporary one must.
 */
export function fakeMailTransport(
  outcome: (message: MailMessage) => SendResult = () => ({ ok: true, providerMessageId: '' }),
): MailTransport & { readonly sent: readonly SentMail[] } {
  const sent: SentMail[] = [];
  return {
    provider: 'fake',
    sent,
    async send(message) {
      sent.push({ ...message, at: new Date() });
      const r = outcome(message);
      // A provider always names what it accepted; an empty id would break the
      // status reconciliation that keys on it.
      //
      // UNIQUE ACROSS PROCESSES, not a counter. `outbound_messages.
      // provider_message_id` is unique over the whole database, and this fake
      // is what production sends through until M52. A per-instance counter
      // restarted at 1 on every boot, so the first mail after any restart
      // collided with one already stored: the row failed AFTER the transport
      // had accepted the message, the job was retried, and the mail went again
      // — a re-send loop found by the integration suite, where each file is a
      // fresh process. The WhatsApp simulator namespaces its ids for the same
      // reason (G2b).
      return r.ok && r.providerMessageId === ''
        ? { ok: true, providerMessageId: `fake-mail-${randomUUID()}@nomi.invalid` }
        : r;
    },
  };
}
