import { randomUUID } from 'node:crypto';
import type { MailMessage, SendResult } from '../contract.js';

/**
 * C4.a — the thing that actually hands a message to a mail server.
 *
 * A PORT, not an implementation, for the same reason every other outside edge
 * in this product is one: the sequence engine, the gate, the unsubscribe
 * headers and the owner's screens can all be built and tested now, and the one
 * piece that needs an account is this interface's other side — since C6,
 * `accountMailTransport`, which sends through the mailbox she connected.
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
  /**
   * C4.c — THE CONTRACT A REAL TRANSPORT MUST KEEP, because replies depend on it:
   *
   *   `providerMessageId` on success is the RFC 5322 Message-ID of the mail as
   *   the recipient's client sees it, without angle brackets.
   *
   * A buyer's reply names the mail it answers only by that header, in
   * In-Reply-To and References, and `resolve_email_reply` (0048) matches it
   * against this stored value. A provider's internal job id in its place would
   * make every reply unmatchable — silently, since an unknown thread is
   * acknowledged and ignored. SES returns `<id>@email.amazonses.com`-shaped
   * ids and Gmail returns the header on the sent message; each adapter maps
   * its own.
   *
   * And `message.tag` goes out as provider metadata — see `MailMessage.tag`.
   */
  send(message: MailMessage): Promise<SendResult>;
}

export type SentMail = MailMessage & { readonly at: Date };

/**
 * The transport every TEST sends through. Production never does: since C6 the
 * composition root builds `accountMailTransport`, and a parity test holds
 * `src/main.ts` to never naming this function.
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
      // provider_message_id` is unique over the whole database, and until C6
      // this fake was what production sent through. A per-instance counter
      // restarted at 1 on every boot, so the first mail after any restart
      // collided with one already stored: the row failed AFTER the transport
      // had accepted the message, the job was retried, and the mail went again
      // — a re-send loop found by the integration suite, where each file is a
      // fresh process. The WhatsApp simulator namespaces its ids for the same
      // reason (G2b).
      // Shaped as a Message-ID, which is the contract above.
      return r.ok && r.providerMessageId === ''
        ? { ok: true, providerMessageId: `fake-mail-${randomUUID()}@nomi.invalid` }
        : r;
    },
  };
}
