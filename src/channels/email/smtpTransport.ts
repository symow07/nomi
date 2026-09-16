import { withTenantTx, type Db } from '../../db/client.js';
import type { BusinessId } from '../../core/types/ids.js';
import { sendingDomain } from '../../db/sendingDomain.js';
import type { MailMessage, SendResult } from '../contract.js';
import type { MailTransport } from './transport.js';
import { mimeMessage, mintMessageId } from './senders.js';
import { smtpDeliver, type SmtpConfig, type SmtpDeps } from './smtp.js';

/**
 * Her own mail server as a transport, for one business.
 *
 * ── THE SAME REFUSALS AS THE MAILBOX PATH ─────────────────────────────────
 *
 * `accountMailTransport` (C6) refuses when the connected mailbox is not on the
 * verified sending domain, because a mail from one domain signed by another
 * fails SPF and DKIM alignment and teaches every receiving server to distrust
 * her. That rule belongs to the DOMAIN, not to Gmail, so it is enforced here
 * too — read on every send, so a domain changed this morning binds this
 * afternoon's mail.
 *
 * ── THE MESSAGE-ID IS OURS, AND IT IS WHAT REPLIES QUOTE ──────────────────
 *
 * Minted on her domain, written into the message, and returned as
 * `providerMessageId` (the transport contract). An SMTP server accepts the
 * header as submitted, so unlike Gmail there is nothing to read back.
 *
 * ── WHAT SMTP CANNOT DO, SAID PLAINLY ─────────────────────────────────────
 *
 * There is no provider metadata channel, so `MailMessage.tag` cannot ride along
 * as it does with an e-mail service provider: a bounce comes back as a message
 * to her own mailbox rather than as a signed webhook event. Her buyers' way out
 * is unaffected — the List-Unsubscribe headers are part of the message itself.
 */

export type SmtpTransportDeps = {
  readonly db: Db;
  readonly businessId: BusinessId;
  readonly config: SmtpConfig;
  readonly now?: () => Date;
  readonly smtp?: SmtpDeps;
};

export function smtpMailTransport(deps: SmtpTransportDeps): MailTransport {
  const now = deps.now ?? (() => new Date());
  const refuse = (error: string): SendResult => ({ ok: false, retryable: false, error });

  return {
    provider: 'smtp',
    async send(message: MailMessage): Promise<SendResult> {
      const domain = await withTenantTx(deps.db, deps.businessId, (tx) => sendingDomain(tx, deps.businessId));
      const fromDomain = deps.config.from.slice(deps.config.from.lastIndexOf('@') + 1);
      if (!domain || domain.domain !== fromDomain) {
        return refuse('the mail server sends as an address that is not on the verified sending domain');
      }

      const messageId = mintMessageId(deps.config.from);
      const data = mimeMessage({ ...message, from: deps.config.from }, messageId, now());
      const sent = await smtpDeliver(deps.config, { to: message.to, data }, deps.smtp);
      return sent.ok
        ? { ok: true, providerMessageId: messageId }
        : { ok: false, retryable: sent.retryable, error: sent.error };
    },
  };
}
